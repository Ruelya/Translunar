import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AiAssistResult, Segment } from "@translunar/contracts";
import { Badge, Button, EmptyState, Panel } from "@translunar/ui";

import { useAiStatus } from "../lib/ai-status.js";
import { diffChars } from "../lib/diff.js";
import { callEngine, describeError, isAiNotConfigured } from "../lib/engine.js";

/** Assist runs off the engine RPC thread; the panel polls until terminal. */
const ASSIST_POLL_INTERVAL_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AiPanelProps {
  activeSegment: Segment | null;
  /**
   * Applies the candidate as a draft. The provider model travels with the
   * text so the write can stamp an honest aiDraft origin.
   */
  onApplyDraft: (targetText: string, model: string) => void;
  onStatusMessage: (message: string) => void;
  /**
   * Opens the application settings at the AI provider section. Provider
   * configuration lives there — the dock panel only reports status and
   * runs assists.
   */
  onOpenSettings: () => void;
  /**
   * Menu-driven assist (翻译 ▸ AI 翻译/润色当前句段). Each token runs the
   * exact assist the panel buttons run, once. When the panel would refuse
   * (unconfigured, no segment, confirmed row, busy, refine with an empty
   * target) the request is dropped and the panel's own state says why.
   */
  request?: { action: "translate" | "refine"; token: number } | null;
  /** Marks the request consumed so a later remount never replays it. */
  onRequestConsumed?: () => void;
}

interface Candidate {
  action: "translate" | "refine";
  /** The profile that produced this candidate. */
  profileId: string;
  profileLabel: string;
  result: AiAssistResult;
  /** Target text at request time; the diff is rendered against it. */
  baseTarget: string;
  segmentId: string;
}

interface CandidateFailure {
  profileLabel: string;
  message: string;
}

export function AiPanel({
  activeSegment,
  onApplyDraft,
  onStatusMessage,
  onOpenSettings,
  request,
  onRequestConsumed,
}: AiPanelProps) {
  const { status, configured, profiles } = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [failures, setFailures] = useState<CandidateFailure[]>([]);
  const [activeAssistIds, setActiveAssistIds] = useState<string[]>([]);
  // Bumped to invalidate an in-flight poll loop (cancel or unmount).
  const assistGeneration = useRef(0);

  useEffect(() => {
    return () => {
      assistGeneration.current += 1;
    };
  }, []);

  // ai.assist.start returns immediately; the provider call runs off the
  // engine RPC thread and this panel polls ai.assist.status until terminal.
  // One request fans out across every configured profile: requests for the
  // same segment through different profiles run in parallel in the engine,
  // so each profile answers with its own candidate card.
  const assist = useCallback(
    async (action: "translate" | "refine") => {
      if (!activeSegment) {
        return;
      }
      const generation = ++assistGeneration.current;
      setBusy(true);
      setError(null);
      setCandidates([]);
      setFailures([]);
      // The legacy single-slot config still answers through the default
      // profile when the list is empty.
      const targets: Array<{ profileId: string | null; label: string }> =
        profiles.length > 0
          ? profiles.map((profile) => ({
              profileId: profile.profileId,
              label: profile.label,
            }))
          : [
              {
                profileId: null,
                label: `${status?.provider ?? ""} · ${status?.model ?? ""}`,
              },
            ];
      const collected: Candidate[] = [];
      const failed: CandidateFailure[] = [];
      try {
        const started = await Promise.all(
          targets.map(async (target) => {
            try {
              const view = await callEngine("ai.assist.start", {
                segmentId: activeSegment.id,
                action,
                instruction: null,
                profileId: target.profileId,
              });
              return { target, view };
            } catch (startError) {
              if (isAiNotConfigured(startError)) {
                throw startError;
              }
              failed.push({
                profileLabel: target.label,
                message: describeError(startError),
              });
              return null;
            }
          }),
        );
        const inFlight = started.filter(
          (entry): entry is NonNullable<typeof entry> => entry !== null,
        );
        if (assistGeneration.current !== generation) {
          return;
        }
        setActiveAssistIds(inFlight.map((entry) => entry.view.assistId));
        await Promise.all(
          inFlight.map(async ({ target, view: startedView }) => {
            let view = startedView;
            while (view.status === "running") {
              await sleep(ASSIST_POLL_INTERVAL_MS);
              if (assistGeneration.current !== generation) {
                return;
              }
              view = await callEngine("ai.assist.status", {
                assistId: startedView.assistId,
              });
            }
            if (view.status === "done" && view.result) {
              collected.push({
                action,
                profileId: view.profileId,
                profileLabel: target.label,
                result: view.result,
                baseTarget: activeSegment.targetText,
                segmentId: activeSegment.id,
              });
            } else if (view.status === "failed") {
              failed.push({
                profileLabel: target.label,
                message: view.errorMessage ?? "未知错误",
              });
            }
            // A canceled run ends silently: the cancel action already
            // reported.
          }),
        );
        if (assistGeneration.current !== generation) {
          return;
        }
        setCandidates(collected);
        setFailures(failed);
        if (collected.length > 0) {
          const failureNote =
            failed.length > 0 ? `，${failed.length} 个失败` : "";
          onStatusMessage(
            `AI ${action === "translate" ? "翻译" : "润色"}完成：${collected.length} 个候选${failureNote}`,
          );
        }
      } catch (assistError) {
        if (assistGeneration.current !== generation) {
          return;
        }
        if (isAiNotConfigured(assistError)) {
          setError("未配置 AI 供应商");
        } else {
          setError(`AI 调用失败：${describeError(assistError)}`);
        }
      } finally {
        if (assistGeneration.current === generation) {
          setBusy(false);
          setActiveAssistIds([]);
        }
      }
    },
    [activeSegment, profiles, status, onStatusMessage],
  );

  // Menu-driven assist: each token is consumed exactly once (the consumer
  // reports back through onRequestConsumed, so a later remount never
  // replays it). The guards mirror the buttons' own enablement — the panel
  // is already showing why it refuses.
  const consumedRequestTokenRef = useRef(0);
  useEffect(() => {
    if (!request || request.token === consumedRequestTokenRef.current) {
      return;
    }
    // ai.status is still in flight: hold the request until the answer says
    // whether the panel can run at all.
    if (status === null) {
      return;
    }
    consumedRequestTokenRef.current = request.token;
    onRequestConsumed?.();
    if (
      !configured ||
      busy ||
      !activeSegment ||
      activeSegment.state === "confirmed" ||
      (request.action === "refine" && !activeSegment.targetText.trim())
    ) {
      return;
    }
    void assist(request.action);
  }, [
    request,
    onRequestConsumed,
    status,
    configured,
    busy,
    activeSegment,
    assist,
  ]);

  const cancelAssist = useCallback(async () => {
    if (activeAssistIds.length === 0) {
      return;
    }
    // Stop the poll loops first so the UI frees up immediately; the engine
    // marks each run canceled and discards any late provider result.
    assistGeneration.current += 1;
    const assistIds = activeAssistIds;
    setActiveAssistIds([]);
    setBusy(false);
    onStatusMessage("已取消 AI 请求");
    for (const assistId of assistIds) {
      try {
        await callEngine("ai.assist.cancel", { assistId });
      } catch {
        // The run may already be terminal or pruned; nothing to surface.
      }
    }
  }, [activeAssistIds, onStatusMessage]);

  const confirmedSegment = activeSegment?.state === "confirmed";
  const candidatesForActive = useMemo(
    () =>
      candidates.filter(
        (candidate) => candidate.segmentId === activeSegment?.id,
      ),
    [candidates, activeSegment],
  );

  const dismissCandidate = useCallback((profileId: string) => {
    setCandidates((current) =>
      current.filter((candidate) => candidate.profileId !== profileId),
    );
  }, []);

  return (
    <Panel
      title="AI 辅助"
      className="dock-panel"
      actions={
        configured ? (
          <Badge tone="ok">
            {profiles.length > 1
              ? `${profiles.length} 个模型`
              : `${status?.provider} · ${status?.model}`}
          </Badge>
        ) : (
          <Badge tone="warn">未配置</Badge>
        )
      }
    >
      <div className="dock-stack">
        {configured ? (
          <>
            {!activeSegment ? (
              <EmptyState title="未选中句段" />
            ) : confirmedSegment ? (
              <div className="honest-note">该句段已确认</div>
            ) : (
              <div className="tl-toolbar">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void assist("translate")}
                >
                  AI 翻译
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !activeSegment.targetText.trim()}
                  onClick={() => void assist("refine")}
                >
                  AI 润色
                </Button>
                {busy && activeAssistIds.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void cancelAssist()}
                  >
                    取消请求
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={onOpenSettings}>
                  管理模型…
                </Button>
              </div>
            )}
            {!confirmedSegment && failures.length > 0
              ? failures.map((failure) => (
                  <div
                    key={failure.profileLabel}
                    className="honest-note"
                    data-tone="danger"
                    role="alert"
                  >
                    {failure.profileLabel}：{failure.message}
                  </div>
                ))
              : null}
            {!confirmedSegment && candidatesForActive.length > 0
              ? candidatesForActive.map((candidate) => {
                  const tagCheck = candidate.result.tagCheck;
                  const applyBlocked = !tagCheck.ok;
                  const diffParts = candidate.baseTarget.trim()
                    ? diffChars(
                        candidate.baseTarget,
                        candidate.result.draftTarget,
                      )
                    : [];
                  return (
                    <div
                      key={candidate.profileId}
                      className="ai-draft"
                      data-testid="ai-candidate"
                    >
                      <div className="ai-draft__meta">
                        <Badge tone="neutral">
                          {candidate.action === "translate"
                            ? "翻译候选"
                            : "润色候选"}
                        </Badge>
                        <Badge tone="neutral">
                          {candidate.result.provider} · {candidate.result.model}
                        </Badge>
                        <span className="ai-draft__elapsed">
                          {candidate.result.elapsedMs}ms
                        </span>
                        {tagCheck.ok ? (
                          <Badge tone="ok">标签完整</Badge>
                        ) : (
                          <Badge tone="danger">标签破损</Badge>
                        )}
                      </div>
                      <p className="ai-draft__text">
                        {candidate.result.draftTarget}
                      </p>
                      {diffParts.length > 0 ? (
                        <p
                          className="ai-diff"
                          aria-label="候选与当前译文的差异"
                        >
                          {diffParts.map((part, index) => (
                            <span
                              key={`${index}-${part.kind}`}
                              className={
                                part.kind === "insert"
                                  ? "ai-diff__ins"
                                  : part.kind === "delete"
                                    ? "ai-diff__del"
                                    : "ai-diff__eq"
                              }
                            >
                              {part.text}
                            </span>
                          ))}
                        </p>
                      ) : null}
                      {!tagCheck.ok ? (
                        <div
                          className="honest-note"
                          data-tone="danger"
                          role="alert"
                        >
                          候选破坏了占位符/标签，不能应用。
                          {tagCheck.missing?.length
                            ? ` 缺失：${tagCheck.missing.join("、")}`
                            : ""}
                          {tagCheck.extra?.length
                            ? ` 多余：${tagCheck.extra.join("、")}`
                            : ""}
                        </div>
                      ) : null}
                      <div className="tl-toolbar">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={applyBlocked}
                          onClick={() => {
                            onApplyDraft(
                              candidate.result.draftTarget,
                              candidate.result.model,
                            );
                            setCandidates([]);
                          }}
                        >
                          应用为草稿
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => dismissCandidate(candidate.profileId)}
                        >
                          拒绝
                        </Button>
                      </div>
                    </div>
                  );
                })
              : null}
          </>
        ) : (
          // Honest unconfigured state: no fake output, one path forward —
          // the settings center owns provider configuration.
          <div className="dock-stack">
            <div className="honest-note">
              未配置 AI 供应商。在设置中添加模型后即可使用 AI 翻译/润色与 AGENT
              模式；没有凭据时本面板不会伪造结果。
            </div>
            <div className="tl-toolbar">
              <Button variant="primary" size="sm" onClick={onOpenSettings}>
                打开 AI 设置
              </Button>
            </div>
          </div>
        )}
        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
