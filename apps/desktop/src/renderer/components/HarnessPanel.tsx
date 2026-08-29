import { useCallback, useEffect, useState } from "react";

import type {
  HarnessRunView,
  HarnessStep,
  HarnessStepNotification,
} from "@translunar/contracts";
import {
  Badge,
  Button,
  EmptyState,
  Meter,
  TextAreaField,
  TextField,
} from "@translunar/ui";
import type { BadgeTone } from "@translunar/ui";

import { useAiStatus } from "../lib/ai-status.js";
import { callEngine, describeError, isAiNotConfigured } from "../lib/engine.js";

/**
 * The whole-document agent (`ai.harness.*`): one LLM conversation drives a
 * tool loop over the document — reads it in windows, looks up TM and
 * terminology, writes drafts through the same guards as the batch agent,
 * keeps notes, runs QA. Everything terminal parks at the human review
 * gate; this panel starts, observes, and cancels, never applies.
 * The MT-shaped batch pipeline lives in the sibling tab (AgentPanel).
 */

const STEP_LABEL: Record<HarnessStep["kind"], string> = {
  model: "模型",
  tool: "工具",
  draft: "草稿",
  note: "笔记",
  qa: "质检",
  web: "网络",
  summary: "总结",
  cancel: "取消",
};

const STEP_TONE: Record<HarnessStep["status"], BadgeTone> = {
  done: "ok",
  failed: "danger",
  skipped: "neutral",
};

const RUN_STATUS_LABEL: Record<HarnessRunView["status"], string> = {
  running: "运行中",
  awaitingReview: "等待人工审核",
  failed: "失败",
  canceled: "已取消",
};

const RUN_STATUS_TONE: Record<HarnessRunView["status"], BadgeTone> = {
  running: "neutral",
  awaitingReview: "warn",
  failed: "danger",
  canceled: "neutral",
};

const POLL_INTERVAL_MS = 800;

export interface HarnessPanelProps {
  documentId: string | null;
  onCompleted: () => void;
  onStatusMessage: (message: string) => void;
  onJumpToSegment: (segmentId: string) => void;
}

export function HarnessPanel({
  documentId,
  onCompleted,
  onStatusMessage,
  onJumpToSegment,
}: HarnessPanelProps) {
  const { configured } = useAiStatus();
  const [instruction, setInstruction] = useState("");
  const [maxTurnsText, setMaxTurnsText] = useState("");
  const [webAccess, setWebAccess] = useState(false);
  const [runs, setRuns] = useState<Record<string, HarnessRunView>>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = documentId ? (runs[documentId] ?? null) : null;
  const running = run?.status === "running";

  // Live step feed over the reserved notification; the poll below stays
  // the authority for counters and the terminal view.
  useEffect(() => {
    return window.tl.onNotification((notification) => {
      if (notification.method !== "notify.ai.harness.step") {
        return;
      }
      const payload = notification.params as HarnessStepNotification;
      setRuns((current) => {
        const existing = current[payload.documentId];
        if (!existing || existing.harnessId !== payload.harnessId) {
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

  useEffect(() => {
    const active = Object.values(runs).filter(
      (view) => view.status === "running",
    );
    if (active.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      for (const target of active) {
        void callEngine("ai.harness.status", { harnessId: target.harnessId })
          .then((view) => {
            setRuns((current) =>
              current[view.documentId]?.harnessId === view.harnessId
                ? { ...current, [view.documentId]: view }
                : current,
            );
            if (view.status !== "running") {
              onStatusMessage(
                view.status === "awaitingReview"
                  ? `智能体已完成：草稿 ${view.draftedSegments}，术语 ${view.termsAdded}，用 ${view.turnsUsed} 轮`
                  : view.status === "failed"
                    ? `智能体运行失败：${view.errorMessage ?? "未知错误"}`
                    : "智能体运行已取消",
              );
              onCompleted();
            }
          })
          .catch(() => {
            // Engine unreachable; keep the last known view.
          });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [runs, onCompleted, onStatusMessage]);

  const start = useCallback(async () => {
    if (!documentId || !configured) {
      return;
    }
    setStarting(true);
    setError(null);
    const maxTurns = Number.parseInt(maxTurnsText, 10);
    try {
      const view = await callEngine("ai.harness.start", {
        documentId,
        instruction: instruction.trim() ? instruction.trim() : null,
        maxTurns: Number.isFinite(maxTurns) && maxTurns > 0 ? maxTurns : null,
        webAccess,
      });
      setRuns((current) => ({ ...current, [view.documentId]: view }));
      onStatusMessage(
        `智能体已启动：${view.model}，${view.maxTurns} 轮预算${view.webAccess ? "，已开启网络访问" : ""}`,
      );
    } catch (startError) {
      if (isAiNotConfigured(startError)) {
        setError("未配置 AI 供应商");
      } else {
        setError(`启动失败：${describeError(startError)}`);
      }
    } finally {
      setStarting(false);
    }
  }, [
    documentId,
    configured,
    instruction,
    maxTurnsText,
    webAccess,
    onStatusMessage,
  ]);

  const cancel = useCallback(async () => {
    if (!run) {
      return;
    }
    try {
      const view = await callEngine("ai.harness.cancel", {
        harnessId: run.harnessId,
      });
      setRuns((current) => ({ ...current, [view.documentId]: view }));
      onStatusMessage("已请求取消智能体运行");
    } catch (cancelError) {
      setError(`取消失败：${describeError(cancelError)}`);
    }
  }, [run, onStatusMessage]);

  return (
    <div className="dock-stack" data-testid="harness-panel">
      <p className="agent-modes__note">
        全文智能体：一个模型会话通读文档、查记忆与术语、逐段写草稿并自查
        QA——区别于按句段扇出的批量预翻。译文只落草稿，确认与导出由你完成。
      </p>
      {!configured ? (
        <div className="honest-note" role="note">
          未配置 AI 供应商
        </div>
      ) : null}
      <TextAreaField
        label="任务指令（可选）"
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder="默认：翻译整篇文档，术语与风格全文一致。可补充领域、语气、禁译词等要求。"
      />
      <TextField
        label="轮次预算（默认 24，上限 64）"
        value={maxTurnsText}
        onChange={(event) => setMaxTurnsText(event.target.value)}
        inputMode="numeric"
        placeholder="24"
        hint="每轮 = 一次模型调用；预算耗尽会诚实停在评审门"
      />
      <label className="harness-web-toggle">
        <input
          type="checkbox"
          checked={webAccess}
          onChange={(event) => setWebAccess(event.target.checked)}
        />
        允许本次运行抓取网页（web_fetch）
      </label>
      <div className="tl-toolbar">
        <Button
          variant="primary"
          disabled={!documentId || !configured || starting || running}
          onClick={() => void start()}
        >
          {running ? "运行中…" : starting ? "启动中…" : "启动全文智能体"}
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
        <div className="agent-progress" data-testid="harness-progress">
          <Meter
            ratio={run.maxTurns > 0 ? run.turnsUsed / run.maxTurns : 0}
            label={`轮次 ${run.turnsUsed} / ${run.maxTurns}`}
          />
          <span className="agent-progress__text">
            轮次 {run.turnsUsed} / {run.maxTurns}
          </span>
          <Badge tone={RUN_STATUS_TONE[run.status]}>
            {RUN_STATUS_LABEL[run.status]}
          </Badge>
          <span className="agent-progress__model">{run.model}</span>
        </div>
      ) : null}
      {run ? (
        <div className="agent-run-summary" data-testid="harness-run-summary">
          <span>草稿 {run.draftedSegments}</span>
          <span>术语 {run.termsAdded}</span>
          <span>笔记 {run.notes.length}</span>
          {run.webAccess ? <span>网络已开启</span> : null}
        </div>
      ) : null}
      {run?.summary ? (
        <div className="honest-note" role="note" data-testid="harness-summary">
          {run.summary}
        </div>
      ) : null}
      {run?.errorMessage ? (
        <div className="honest-note" data-tone="danger" role="alert">
          {run.errorMessage}
        </div>
      ) : null}
      {run?.status === "awaitingReview" ? (
        <div className="tl-toolbar">
          <Button size="sm" variant="primary" onClick={onCompleted}>
            去工作台查看草稿
          </Button>
        </div>
      ) : null}
      {run && run.notes.length > 0 ? (
        <div className="dock-stack" data-testid="harness-notes">
          {run.notes.map((note, index) => (
            <div key={`${index}-${note.slice(0, 12)}`} className="agent-step">
              <div className="agent-step__meta">
                <Badge tone="neutral">笔记</Badge>
                <span>#{index + 1}</span>
              </div>
              <p className="agent-step__detail">{note}</p>
            </div>
          ))}
        </div>
      ) : null}
      {!run && !error ? <EmptyState title="尚未运行" /> : null}
      {run && run.steps.length > 0 ? (
        <div className="dock-stack">
          {run.steps.map((step) => (
            <div key={`${step.index}-${step.kind}`} className="agent-step">
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
    </div>
  );
}
