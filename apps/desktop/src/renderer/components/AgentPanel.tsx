import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentApprovalMode,
  AgentProposalStatus,
  AgentRunView,
  AgentStep,
  AgentStepNotification,
} from "@translunar/contracts";
import {
  Badge,
  Button,
  EmptyState,
  Meter,
  Panel,
  SelectField,
  TextAreaField,
  TextField,
} from "@translunar/ui";
import type { BadgeTone } from "@translunar/ui";

import { useAiStatus } from "../lib/ai-status.js";
import { callEngine, describeError, isAiNotConfigured } from "../lib/engine.js";
import { HarnessPanel } from "./HarnessPanel.js";

export interface AgentPanelProps {
  documentId: string | null;
  onCompleted: () => void;
  onStatusMessage: (message: string) => void;
  /** Human gate: jump into the export flow. The agent never exports. */
  onGoExport: () => void;
  /** Human gate: open the QA dock to finish the leftover issues. */
  onGoQa: () => void;
  /** Steps and proposals carry segment ids; a click lands on the row. */
  onJumpToSegment: (segmentId: string) => void;
  /**
   * Segment ids currently visible under the grid filter. The 当前筛选
   * scope sends them as `segmentIds`; the engine intersects with the
   * untranslated, unlocked set.
   */
  filteredSegmentIds: string[];
}

const STEP_TONE: Record<AgentStep["status"], BadgeTone> = {
  done: "ok",
  failed: "danger",
  skipped: "neutral",
};

const STEP_LABEL: Record<AgentStep["kind"], string> = {
  plan: "规划",
  tm: "TM 预翻",
  translate: "AI 起草",
  proposal: "候选",
  confirm: "确认",
  qa: "质检",
  summary: "总结",
  cancel: "取消",
};

const RUN_STATUS_LABEL: Record<AgentRunView["status"], string> = {
  running: "运行中",
  awaitingReview: "等待人工审核",
  canceled: "已取消",
  failed: "失败",
};

const RUN_STATUS_TONE: Record<AgentRunView["status"], BadgeTone> = {
  running: "neutral",
  awaitingReview: "warn",
  canceled: "neutral",
  failed: "danger",
};

const MODE_LABEL: Record<AgentApprovalMode, string> = {
  manual: "手动",
  auto: "自动",
  turbo: "Turbo",
};

/** One line per tier, straight from the engine behavior. */
const MODE_NOTE: Record<AgentApprovalMode, string> = {
  manual: "候选进入待审队列，人工批准后写入草稿",
  auto: "标签完整的候选自动写入草稿，确认由人工完成",
  turbo: "草稿写入后，QA 无错误的句段自动确认并写入 TM",
};

const PROPOSAL_STATUS_LABEL: Record<AgentProposalStatus, string> = {
  pending: "待审",
  applied: "已写入",
  rejected: "已拒绝",
  stale: "已作废",
};

const PROPOSAL_STATUS_TONE: Record<AgentProposalStatus, BadgeTone> = {
  pending: "warn",
  applied: "ok",
  rejected: "neutral",
  stale: "danger",
};

const POLL_INTERVAL_MS = 800;

interface StartOverrides {
  segmentIds?: string[];
  approvalMode?: AgentApprovalMode;
  profileId?: string | null;
}

export function AgentPanel({
  documentId,
  onCompleted,
  onStatusMessage,
  onGoExport,
  onGoQa,
  onJumpToSegment,
  filteredSegmentIds,
}: AgentPanelProps) {
  const { configured, profiles, defaultProfileId } = useAiStatus();
  // Two distinct products under one dock section (docs/agent-harness.md):
  // the segment-batch MT pipeline, and the whole-document tool-loop agent.
  const [surface, setSurface] = useState<"batch" | "harness">("batch");
  const [instruction, setInstruction] = useState("");
  const [approvalMode, setApprovalMode] = useState<AgentApprovalMode>("manual");
  const [profileId, setProfileId] = useState("");
  const [scope, setScope] = useState<"all" | "filtered">("all");
  const [maxSegmentsText, setMaxSegmentsText] = useState("");
  // The engine allows concurrent runs on different documents; track the
  // latest run per document so switching documents neither hides a live run
  // nor blocks starting one elsewhere.
  const [runs, setRuns] = useState<Record<string, AgentRunView>>({});
  const [starting, setStarting] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completedRuns = useRef<Set<string>>(new Set());
  // Runs whose terminal view was already re-fetched (see below).
  const reconciledRuns = useRef<Set<string>>(new Set());

  const run = documentId ? (runs[documentId] ?? null) : null;
  const running = run?.status === "running";
  const pendingProposals =
    run?.proposals.filter((proposal) => proposal.status === "pending") ?? [];

  const finishRun = useCallback(
    (finished: AgentRunView) => {
      if (completedRuns.current.has(finished.runId)) {
        return;
      }
      completedRuns.current.add(finished.runId);
      if (finished.status === "awaitingReview") {
        const pending = finished.proposals.filter(
          (proposal) => proposal.status === "pending",
        ).length;
        const parts = [`TM ${finished.tmApplied}`];
        if (finished.approvalMode === "manual") {
          parts.push(`待审候选 ${pending}`);
        } else {
          parts.push(`AI 草稿 ${finished.aiDrafted}`);
        }
        if (finished.approvalMode === "turbo") {
          parts.push(`自动确认 ${finished.autoConfirmed}`);
        }
        parts.push(`失败 ${finished.failedSegments}`);
        parts.push(`QA 未解决 ${finished.openQaIssues}`);
        onStatusMessage(`Agent 已完成：${parts.join("，")}`);
      } else if (finished.status === "canceled") {
        onStatusMessage("Agent 运行已取消");
      } else {
        onStatusMessage("Agent 运行失败");
      }
      onCompleted();
    },
    [onCompleted, onStatusMessage],
  );

  // Live step feed from the engine's reserved notification frames. Steps
  // carry the run id, so concurrent runs never cross wires.
  useEffect(() => {
    return window.tl.onNotification((notification) => {
      if (notification.method !== "notify.ai.agent.step") {
        return;
      }
      const payload = notification.params as AgentStepNotification;
      setRuns((current) => {
        const existing = current[payload.documentId];
        if (!existing || existing.runId !== payload.runId) {
          return current;
        }
        const steps = existing.steps.some(
          (step) => step.index === payload.step.index,
        )
          ? existing.steps
          : [...existing.steps, payload.step];
        return {
          ...current,
          [payload.documentId]: {
            ...existing,
            status: payload.runStatus,
            steps,
          },
        };
      });
    });
  }, []);

  // Poll every running run, not just the visible one: counts and terminal
  // transitions arrive even if a notification frame is missed or the user
  // switched documents.
  useEffect(() => {
    const active = Object.values(runs).filter(
      (view) => view.status === "running",
    );
    if (active.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      for (const target of active) {
        void callEngine("ai.agent.status", { runId: target.runId })
          .then((view) => {
            setRuns((current) =>
              current[view.documentId]?.runId === view.runId
                ? { ...current, [view.documentId]: view }
                : current,
            );
            if (view.status !== "running") {
              finishRun(view);
            }
          })
          .catch(() => {
            // Engine unreachable; keep the last known view.
          });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runs, finishRun]);

  // A step notification can flip a run terminal before any poll sees it —
  // the frame carries the status but not the final counters or proposals.
  // Fetch the authoritative view once so the queue and numbers are real.
  useEffect(() => {
    for (const view of Object.values(runs)) {
      if (view.status === "running" || reconciledRuns.current.has(view.runId)) {
        continue;
      }
      reconciledRuns.current.add(view.runId);
      void callEngine("ai.agent.status", { runId: view.runId })
        .then((fresh) => {
          setRuns((current) =>
            current[fresh.documentId]?.runId === fresh.runId
              ? { ...current, [fresh.documentId]: fresh }
              : current,
          );
          finishRun(fresh);
        })
        .catch(() => {
          // Engine unreachable; finish with the last known view.
          finishRun(view);
        });
    }
  }, [runs, finishRun]);

  const start = useCallback(
    async (overrides: StartOverrides = {}) => {
      if (!documentId || !configured) {
        return;
      }
      setStarting(true);
      setError(null);
      const maxSegments = Number.parseInt(maxSegmentsText, 10);
      try {
        const view = await callEngine("ai.agent.start", {
          documentId,
          instruction: instruction.trim() ? instruction.trim() : null,
          maxSegments:
            Number.isFinite(maxSegments) && maxSegments > 0
              ? maxSegments
              : null,
          approvalMode: overrides.approvalMode ?? approvalMode,
          profileId:
            overrides.profileId !== undefined
              ? overrides.profileId
              : profileId || null,
          segmentIds:
            overrides.segmentIds ??
            (scope === "filtered" ? filteredSegmentIds : null),
        });
        setRuns((current) => ({ ...current, [view.documentId]: view }));
        const scopeNote =
          view.eligibleSegments > view.plannedSegments
            ? `（范围内 ${view.eligibleSegments} 句）`
            : "";
        onStatusMessage(
          `Agent 任务单已创建：计划 ${view.plannedSegments} 句${scopeNote}，TM 预翻 ${view.tmApplied} 句`,
        );
        if (view.status !== "running") {
          finishRun(view);
        }
      } catch (startError) {
        if (isAiNotConfigured(startError)) {
          setError("未配置 AI 供应商");
        } else {
          setError(`Agent 启动失败：${describeError(startError)}`);
        }
      } finally {
        setStarting(false);
      }
    },
    [
      documentId,
      configured,
      instruction,
      maxSegmentsText,
      approvalMode,
      profileId,
      scope,
      filteredSegmentIds,
      onStatusMessage,
      finishRun,
    ],
  );

  const cancel = useCallback(async () => {
    if (!run) {
      return;
    }
    try {
      const view = await callEngine("ai.agent.cancel", { runId: run.runId });
      setRuns((current) => ({ ...current, [view.documentId]: view }));
      onStatusMessage("已请求取消 Agent 运行");
    } catch (cancelError) {
      setError(`取消失败：${describeError(cancelError)}`);
    }
  }, [run, onStatusMessage]);

  const review = useCallback(
    async (segmentIds: string[], decision: "apply" | "reject") => {
      if (!run || segmentIds.length === 0) {
        return;
      }
      setReviewBusy(true);
      setError(null);
      try {
        const view = await callEngine("ai.agent.review", {
          runId: run.runId,
          segmentIds,
          decision,
        });
        setRuns((current) => ({ ...current, [view.documentId]: view }));
        const touched = view.proposals.filter((proposal) =>
          segmentIds.includes(proposal.segmentId),
        );
        if (decision === "apply") {
          const applied = touched.filter(
            (proposal) => proposal.status === "applied",
          ).length;
          const stale = touched.filter(
            (proposal) => proposal.status === "stale",
          ).length;
          onStatusMessage(
            `已写入 ${applied} 条候选${stale > 0 ? `，${stale} 条已作废` : ""}`,
          );
          onCompleted();
        } else {
          onStatusMessage(`已拒绝 ${touched.length} 条候选`);
        }
      } catch (reviewError) {
        setError(`审批失败：${describeError(reviewError)}`);
      } finally {
        setReviewBusy(false);
      }
    },
    [run, onCompleted, onStatusMessage],
  );

  return (
    <Panel
      title="Agent 模式"
      className="dock-panel"
      actions={
        run ? (
          <Badge tone={RUN_STATUS_TONE[run.status]}>
            {RUN_STATUS_LABEL[run.status]}
          </Badge>
        ) : null
      }
    >
      <div className="dock-stack">
        <div
          className="agent-modes"
          role="tablist"
          aria-label="Agent 形态"
          data-testid="agent-surfaces"
        >
          <button
            type="button"
            role="tab"
            aria-selected={surface === "batch"}
            data-active={surface === "batch"}
            onClick={() => setSurface("batch")}
          >
            批量预翻（MT）
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === "harness"}
            data-active={surface === "harness"}
            onClick={() => setSurface("harness")}
          >
            全文智能体
          </button>
        </div>
        {surface === "harness" ? (
          <HarnessPanel
            documentId={documentId}
            onCompleted={onCompleted}
            onStatusMessage={onStatusMessage}
            onJumpToSegment={onJumpToSegment}
          />
        ) : (
          <>
            {!configured ? (
              <div className="honest-note" role="note">
                未配置 AI 供应商
              </div>
            ) : null}
            <p className="agent-modes__note">
              批量预翻：TM 精确命中直接落格，未命中句段按段扇出给模型起草 ——传统
              MT 心智，适合大批量粗翻。
            </p>
            <div
              className="agent-modes"
              role="tablist"
              aria-label="审批模式"
              data-testid="agent-modes"
            >
              {(Object.keys(MODE_LABEL) as AgentApprovalMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={approvalMode === mode}
                  data-active={approvalMode === mode}
                  disabled={running || starting}
                  onClick={() => setApprovalMode(mode)}
                >
                  {MODE_LABEL[mode]}
                </button>
              ))}
            </div>
            {approvalMode === "turbo" ? (
              <div className="honest-note" role="note">
                {MODE_NOTE.turbo}
              </div>
            ) : (
              <p className="agent-modes__note">{MODE_NOTE[approvalMode]}</p>
            )}
            {profiles.length > 1 ? (
              <SelectField
                label="模型"
                value={profileId || (defaultProfileId ?? "")}
                onChange={(event) => setProfileId(event.target.value)}
              >
                {profiles.map((profile) => (
                  <option key={profile.profileId} value={profile.profileId}>
                    {profile.label}
                  </option>
                ))}
              </SelectField>
            ) : null}
            <SelectField
              label="作用域"
              value={scope}
              onChange={(event) =>
                setScope(event.target.value === "filtered" ? "filtered" : "all")
              }
            >
              <option value="all">全部未译句段</option>
              <option value="filtered">
                当前筛选可见句段（{filteredSegmentIds.length}）
              </option>
            </SelectField>
            <TextAreaField
              label="任务指令（可选）"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <TextField
              label="句段上限（默认 50）"
              value={maxSegmentsText}
              onChange={(event) => setMaxSegmentsText(event.target.value)}
              inputMode="numeric"
            />
            <div className="tl-toolbar">
              <Button
                variant="primary"
                disabled={!documentId || !configured || starting || running}
                onClick={() => void start()}
              >
                {running
                  ? "运行中…"
                  : starting
                    ? "启动中…"
                    : "创建任务单并运行"}
              </Button>
              {running ? (
                <Button variant="outline" onClick={() => void cancel()}>
                  {run?.cancelRequested ? "正在取消…" : "取消运行"}
                </Button>
              ) : null}
            </div>
            {error ? (
              <div className="honest-note" data-tone="danger" role="alert">
                {error}
              </div>
            ) : null}
            {run ? (
              <div className="agent-progress" data-testid="agent-progress">
                <Meter
                  ratio={
                    run.plannedSegments > 0
                      ? run.processedSegments / run.plannedSegments
                      : 0
                  }
                  label={`已处理 ${run.processedSegments} / ${run.plannedSegments}`}
                />
                <span className="agent-progress__text">
                  已处理 {run.processedSegments} / {run.plannedSegments}
                </span>
                <Badge tone="neutral">{MODE_LABEL[run.approvalMode]}</Badge>
                <span className="agent-progress__model">{run.model}</span>
              </div>
            ) : null}
            {run ? (
              <div
                className="agent-run-summary"
                data-testid="agent-run-summary"
              >
                <span>计划 {run.plannedSegments}</span>
                {run.eligibleSegments !== run.plannedSegments ? (
                  <span>范围 {run.eligibleSegments}</span>
                ) : null}
                <span>TM {run.tmApplied}</span>
                <span>AI 草稿 {run.aiDrafted}</span>
                {run.approvalMode === "manual" ? (
                  <span>待审 {pendingProposals.length}</span>
                ) : null}
                {run.approvalMode === "turbo" ? (
                  <span>自动确认 {run.autoConfirmed}</span>
                ) : null}
                {run.skippedSegments > 0 ? (
                  <span>跳过 {run.skippedSegments}</span>
                ) : null}
                <span>失败 {run.failedSegments}</span>
                <span>QA 未解决 {run.openQaIssues}</span>
              </div>
            ) : null}
            {run &&
            run.status !== "running" &&
            run.failedSegmentIds.length > 0 ? (
              <div className="tl-toolbar">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={starting}
                  onClick={() =>
                    void start({
                      segmentIds: run.failedSegmentIds,
                      approvalMode: run.approvalMode,
                      profileId: run.profileId,
                    })
                  }
                >
                  重跑失败句段（{run.failedSegmentIds.length}）
                </Button>
              </div>
            ) : null}
            {run && run.proposals.length > 0 ? (
              <div className="agent-proposals" data-testid="agent-proposals">
                <div className="agent-proposals__head">
                  <span>待审候选 {pendingProposals.length}</span>
                  {pendingProposals.length > 0 ? (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={reviewBusy}
                        onClick={() =>
                          void review(
                            pendingProposals.map(
                              (proposal) => proposal.segmentId,
                            ),
                            "apply",
                          )
                        }
                      >
                        全部批准
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={reviewBusy}
                        onClick={() =>
                          void review(
                            pendingProposals.map(
                              (proposal) => proposal.segmentId,
                            ),
                            "reject",
                          )
                        }
                      >
                        全部拒绝
                      </Button>
                    </>
                  ) : null}
                </div>
                {run.proposals.map((proposal) => (
                  <div
                    key={proposal.segmentId}
                    className="agent-proposal"
                    data-testid="agent-proposal"
                  >
                    <div className="agent-proposal__meta">
                      <Badge tone={PROPOSAL_STATUS_TONE[proposal.status]}>
                        {PROPOSAL_STATUS_LABEL[proposal.status]}
                      </Badge>
                      <span className="agent-proposal__model">
                        {proposal.model} · {proposal.elapsedMs}ms
                      </span>
                      <button
                        type="button"
                        className="agent-step__jump"
                        onClick={() => onJumpToSegment(proposal.segmentId)}
                      >
                        定位句段
                      </button>
                    </div>
                    <p className="agent-proposal__source">
                      {proposal.sourceText}
                    </p>
                    <p className="agent-proposal__draft">
                      {proposal.draftTarget}
                    </p>
                    {proposal.note ? (
                      <div className="honest-note" data-tone="danger">
                        {proposal.note}
                      </div>
                    ) : null}
                    {proposal.status === "pending" ? (
                      <div className="tl-toolbar">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={reviewBusy}
                          onClick={() =>
                            void review([proposal.segmentId], "apply")
                          }
                        >
                          批准
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={reviewBusy}
                          onClick={() =>
                            void review([proposal.segmentId], "reject")
                          }
                        >
                          拒绝
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {run?.status === "awaitingReview" ? (
              <div className="agent-gate" data-testid="agent-human-gate">
                <div className="tl-toolbar">
                  <Button size="sm" variant="primary" onClick={onCompleted}>
                    去工作台查看草稿
                  </Button>
                  {run.openQaIssues > 0 ? (
                    <Button size="sm" variant="outline" onClick={onGoQa}>
                      查看 QA 修复项
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={onGoExport}>
                    去导出…
                  </Button>
                </div>
              </div>
            ) : null}
            {!run && !error ? <EmptyState title="尚未运行" /> : null}
            {run && run.steps.length > 0 ? (
              <div className="dock-stack">
                {run.steps.map((step) => (
                  <div
                    key={`${step.index}-${step.kind}`}
                    className="agent-step"
                  >
                    <div className="agent-step__meta">
                      <Badge tone={STEP_TONE[step.status]}>
                        {STEP_LABEL[step.kind]}
                      </Badge>
                      <span>#{step.index}</span>
                      {step.segmentId ? (
                        <button
                          type="button"
                          className="agent-step__jump"
                          onClick={() => onJumpToSegment(step.segmentId!)}
                        >
                          定位句段
                        </button>
                      ) : null}
                    </div>
                    <p className="agent-step__detail">{step.detail}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  );
}
