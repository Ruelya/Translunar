/* eslint-disable -- Generated from the Rust protocol schema. Do not edit. */

export type RpcErrorCode =
  | "invalidRequest"
  | "methodNotFound"
  | "invalidParams"
  | "notFound"
  | "conflict"
  | "filterFailed"
  | "exportBlocked"
  | "aiNotConfigured"
  | "aiFailed"
  | "io"
  | "internal";
/**
 * Approval tier for one agent run. The tiers govern what happens to
 * AI-generated drafts only: exact-TM reuse, the tag-integrity gate, the
 * locked/confirmed shields, and human-only export are identical everywhere.
 */
export type AgentApprovalMode = "manual" | "auto" | "turbo";
export type AiProviderKind =
  | "openai"
  | "openaiResponses"
  | "anthropic"
  | "gemini"
  | "deepl"
  | "deepseek"
  | "qwen"
  | "glm"
  | "kimi"
  | "volcengine"
  | "openaiCompatible";
/**
 * One AI candidate held for human review in a manual-mode run. Tag-broken
 * candidates never become proposals (they are recorded as failures), so a
 * pending proposal is always applicable.
 */
export type AgentProposalStatus = ("pending" | "applied" | "rejected") | "stale";
/**
 * Lifecycle of an agent run. The run never confirms segments, never signs
 * off, and never exports: it always parks at `awaitingReview` for a human.
 */
export type AgentRunStatus = ("running" | "canceled" | "failed") | "awaitingReview";
export type AgentStepKind = ("plan" | "qa" | "summary" | "cancel") | "tm" | "translate" | "proposal" | "confirm";
export type AgentStepStatus = "done" | "failed" | "skipped";
export type AgentReviewDecision = "apply" | "reject";
export type AiAssistAction = "translate" | "refine";
/**
 * Lifecycle of one asynchronous assist request. `ai.assist.start` validates
 * and returns immediately; the provider call runs off the RPC thread and the
 * client polls `ai.assist.status` until the run turns terminal. Assist never
 * writes to the segment: a `done` run only carries a proposal for a human.
 */
export type AiAssistRunStatus = "running" | "done" | "failed" | "canceled";
/**
 * Lifecycle of one harness run. Like the batch agent, the run never
 * confirms and never exports: every terminal state leaves drafts (if any)
 * parked at the human review gate.
 */
export type HarnessRunStatus = ("running" | "failed" | "canceled") | "awaitingReview";
export type HarnessStepKind = ("summary" | "cancel") | "model" | "tool" | "draft" | "note" | "qa" | "web";
export type DegradationSeverity = "warning" | "error";
export type DocumentStatus = "active" | "failed" | "superseded";
export type QaSeverity = "error" | "warning" | "info";
/**
 * Default segmentation mode applied when `document.import` is called without
 * an explicit segmentation choice. Serialized as `sentence` / `paragraph`,
 * matching the strings `DocumentImportParams.segmentation` accepts.
 */
export type ProjectSegmentation = "sentence" | "paragraph";
export type ProjectLifecycle = "active" | "archived" | "trash";
/**
 * Lifecycle of a persisted QA issue.
 *
 * - `Open`: the finding reproduced on the latest run and nobody accepted it.
 * - `Waived`: a user explicitly accepted this exact finding (`qa.waive`).
 *   A waiver is pinned to the issue fingerprint, which hashes the rule,
 *   segment, and evidence — so it holds only while the very same evidence
 *   keeps reproducing. If the evidence changes, the changed finding opens
 *   as a new issue instead of hiding behind the old waiver.
 * - `Resolved`: the finding stopped reproducing (e.g. the numbers now
 *   actually match). Only `qa.run` moves issues here; waiving never does.
 */
export type QaIssueStatus = "open" | "waived" | "resolved";
/**
 * Closed set of places a segment's target text can honestly come from.
 * `human` exists for completeness; plain human typing normally leaves the
 * origin absent instead of stamping it.
 */
export type SegmentOriginKind = "tmExact" | "tmFuzzy" | "aiDraft" | "human";
export type SegmentState = "untranslated" | "draft" | "confirmed";
export type TermStatus = "candidate" | "active" | "deprecated";
export type TermExchangeFormat = "csv" | "tsv" | "tbx";
export type TmExchangeFormat = "tmx" | "csv" | "tsv";
export type TmMatchGrade = "exact" | "inContext" | "fuzzy";

/**
 * Root schema exported for the TypeScript contracts package.
 *
 * The runtime stdout frame is `EngineFrame` (an internally tagged enum); its
 * constituent parts are exported here individually so the generated
 * TypeScript keeps their full field lists.
 */
export interface ProtocolCatalog {
  error: RpcError;
  methods: RpcMethodCatalog;
  notification: RpcNotification;
  notifications: NotificationCatalog;
  request: RpcRequest;
  response: RpcResponse;
}
export interface RpcError {
  code: RpcErrorCode;
  data?: unknown;
  message: string;
  [k: string]: unknown;
}
/**
 * Method-name-keyed catalog. Field renames must match [`methods`] constants;
 * the test below keeps them honest.
 */
export interface RpcMethodCatalog {
  "ai.agent.cancel": MethodContract62;
  "ai.agent.review": MethodContract61;
  "ai.agent.start": MethodContract59;
  "ai.agent.status": MethodContract60;
  "ai.assist.cancel": MethodContract58;
  "ai.assist.start": MethodContract56;
  "ai.assist.status": MethodContract57;
  "ai.configure": MethodContract51;
  "ai.harness.cancel": MethodContract65;
  "ai.harness.start": MethodContract63;
  "ai.harness.status": MethodContract64;
  "ai.profile.add": MethodContract53;
  "ai.profile.list": MethodContract54;
  "ai.profile.remove": MethodContract55;
  "ai.status": MethodContract52;
  "document.export": MethodContract11;
  "document.import": MethodContract8;
  "document.list": MethodContract9;
  "document.remove": MethodContract10;
  "engine.initialize": MethodContract;
  "engine.shutdown": MethodContract2;
  "memory.attach": MethodContract27;
  "memory.create": MethodContract25;
  "memory.delete": MethodContract31;
  "memory.detach": MethodContract28;
  "memory.list": MethodContract26;
  "memory.rename": MethodContract30;
  "memory.update": MethodContract29;
  "project.archive": MethodContract7;
  "project.create": MethodContract3;
  "project.get": MethodContract5;
  "project.list": MethodContract4;
  "project.update": MethodContract6;
  "qa.fix.apply": MethodContract48;
  "qa.fix.list": MethodContract47;
  "qa.list": MethodContract45;
  "qa.profile.get": MethodContract49;
  "qa.profile.update": MethodContract50;
  "qa.run": MethodContract44;
  "qa.waive": MethodContract46;
  "segment.confirm": MethodContract16;
  "segment.list": MethodContract12;
  "segment.lock": MethodContract17;
  "segment.replace": MethodContract15;
  "segment.update": MethodContract13;
  "segment.updateSource": MethodContract14;
  "term.add": MethodContract39;
  "term.delete": MethodContract41;
  "term.list": MethodContract42;
  "term.lookup": MethodContract43;
  "term.update": MethodContract40;
  "termbase.attach": MethodContract34;
  "termbase.create": MethodContract32;
  "termbase.detach": MethodContract35;
  "termbase.export": MethodContract38;
  "termbase.import": MethodContract37;
  "termbase.list": MethodContract33;
  "termbase.update": MethodContract36;
  "tm.delete": MethodContract21;
  "tm.export": MethodContract23;
  "tm.import": MethodContract22;
  "tm.list": MethodContract19;
  "tm.lookup": MethodContract18;
  "tm.pretranslate": MethodContract24;
  "tm.update": MethodContract20;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract62 {
  params: AgentCancelParams;
  result: AgentRunView;
}
export interface AgentCancelParams {
  runId: string;
  [k: string]: unknown;
}
/**
 * The observable task order for one agent run.
 */
export interface AgentRunView {
  aiDrafted: number;
  approvalMode: AgentApprovalMode;
  /**
   * Turbo mode: segments confirmed through `segment.confirm` after the
   * segment-scoped QA gate found zero open error-severity issues.
   */
  autoConfirmed: number;
  cancelRequested: boolean;
  createdAtMs: number;
  documentId: string;
  /**
   * Untranslated, unlocked segments in the requested scope before the
   * cap — makes any truncation explicit.
   */
  eligibleSegments: number;
  /**
   * Segment ids behind `failedSegments`, for the precise rerun.
   */
  failedSegmentIds: string[];
  failedSegments: number;
  model: string;
  openQaIssues: number;
  /**
   * Untranslated segments claimed by this run at start time (after the
   * `maxSegments` cap).
   */
  plannedSegments: number;
  /**
   * Planned segments that reached a per-segment outcome (TM applied, AI
   * draft applied, proposal queued, failed, or skipped). The honest
   * progress numerator; `plannedSegments` is the denominator.
   */
  processedSegments: number;
  /**
   * The resolved profile drafting this run.
   */
  profileId: string;
  /**
   * Manual mode: the review queue. Empty in auto and turbo runs.
   */
  proposals: AgentProposal[];
  provider: AiProviderKind;
  runId: string;
  /**
   * Planned segments left untouched because a human edited or locked
   * them while the run was in flight.
   */
  skippedSegments: number;
  status: AgentRunStatus;
  steps: AgentStep[];
  tmApplied: number;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AgentProposal {
  draftTarget: string;
  elapsedMs: number;
  model: string;
  /**
   * Present for `stale` proposals: why the live row refused the apply.
   */
  note?: string | null;
  provider: AiProviderKind;
  segmentId: string;
  sourceText: string;
  status: AgentProposalStatus;
  tagCheck: TagIntegrityReport;
  [k: string]: unknown;
}
/**
 * Verdict on whether a proposal preserves the source's placeholder tokens.
 *
 * `missing` lists tokens the proposal dropped, `extra` lists tokens it
 * invented; both are multiset differences, so a duplicated token counts.
 * Detection is [`tl_domain::placeholder_mismatch`] — the same detector the
 * deterministic QA tag rules use, so the AI gate and QA agree token for
 * token.
 */
export interface TagIntegrityReport {
  extra?: string[];
  missing?: string[];
  ok: boolean;
  [k: string]: unknown;
}
export interface AgentStep {
  detail: string;
  index: number;
  kind: AgentStepKind;
  segmentId?: string | null;
  status: AgentStepStatus;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract61 {
  params: AgentReviewParams;
  result: AgentRunView;
}
/**
 * Human decision on pending manual-mode proposals, one or many at a time.
 * `apply` writes each draft through the same guards as auto mode (live row
 * still untranslated and unlocked) and refreshes that segment's QA in the
 * same transaction; a moved row turns the proposal `stale` instead of
 * overwriting human work. `reject` records the decision and writes nothing.
 */
export interface AgentReviewParams {
  decision: AgentReviewDecision;
  runId: string;
  segmentIds: string[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract59 {
  params: AgentStartParams;
  result: AgentRunView;
}
export interface AgentStartParams {
  /**
   * Approval tier for one agent run. The tiers govern what happens to
   * AI-generated drafts only: exact-TM reuse, the tag-integrity gate, the
   * locked/confirmed shields, and human-only export are identical everywhere.
   */
  approvalMode?: "manual" | "auto" | "turbo";
  documentId: string;
  instruction?: string | null;
  /**
   * Upper bound on segments the agent may touch in one run.
   */
  maxSegments?: number | null;
  /**
   * Profile to draft with; the default profile when omitted.
   */
  profileId?: string | null;
  /**
   * Optional scope: only these segments are considered (intersected with
   * the document's untranslated, unlocked set). Powers "run the current
   * filter" and the precise failed-segment rerun.
   */
  segmentIds?: string[] | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract60 {
  params: AgentStatusParams;
  result: AgentRunView;
}
export interface AgentStatusParams {
  runId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract58 {
  params: AiAssistCancelParams;
  result: AiAssistRunView;
}
export interface AiAssistCancelParams {
  assistId: string;
  [k: string]: unknown;
}
/**
 * The observable state of one assist request.
 */
export interface AiAssistRunView {
  action: AiAssistAction;
  assistId: string;
  cancelRequested: boolean;
  createdAtMs: number;
  /**
   * Present exactly when `status` is `failed`.
   */
  errorMessage?: string | null;
  /**
   * The resolved profile serving this request.
   */
  profileId: string;
  /**
   * Present exactly when `status` is `done`.
   */
  result?: AiAssistResult | null;
  segmentId: string;
  status: AiAssistRunStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface AiAssistResult {
  draftTarget: string;
  elapsedMs: number;
  model: string;
  provider: AiProviderKind;
  tagCheck: TagIntegrityReport1;
  [k: string]: unknown;
}
/**
 * Verdict on whether a proposal preserves the source's placeholder tokens.
 *
 * `missing` lists tokens the proposal dropped, `extra` lists tokens it
 * invented; both are multiset differences, so a duplicated token counts.
 * Detection is [`tl_domain::placeholder_mismatch`] — the same detector the
 * deterministic QA tag rules use, so the AI gate and QA agree token for
 * token.
 */
export interface TagIntegrityReport1 {
  extra?: string[];
  missing?: string[];
  ok: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract56 {
  params: AiAssistParams;
  result: AiAssistRunView;
}
export interface AiAssistParams {
  action: AiAssistAction;
  instruction?: string | null;
  /**
   * Profile to call; the default profile when omitted. Requests for the
   * same segment through *different* profiles run in parallel (the
   * multi-candidate path); a second request on the same (segment,
   * profile) pair is a Conflict.
   */
  profileId?: string | null;
  segmentId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract57 {
  params: AiAssistStatusParams;
  result: AiAssistRunView;
}
export interface AiAssistStatusParams {
  assistId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract51 {
  params: AiConfigureParams;
  result: AiStatusResult;
}
export interface AiConfigureParams {
  /**
   * Held in engine memory only; never persisted to disk.
   */
  apiKey: string;
  /**
   * Overrides the provider's default base URL. Required for
   * `openaiCompatible`, optional otherwise.
   */
  baseUrl?: string | null;
  model: string;
  provider: AiProviderKind;
  [k: string]: unknown;
}
/**
 * `provider`/`model` describe the default profile; `profileCount` counts
 * every configured profile (`ai.profile.list` has the full views).
 */
export interface AiStatusResult {
  configured: boolean;
  model?: string | null;
  profileCount?: number;
  provider?: AiProviderKind | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract65 {
  params: HarnessCancelParams;
  result: HarnessRunView;
}
export interface HarnessCancelParams {
  harnessId: string;
  [k: string]: unknown;
}
/**
 * The observable state of one harness run.
 */
export interface HarnessRunView {
  cancelRequested: boolean;
  createdAtMs: number;
  documentId: string;
  /**
   * Drafts written through `write_draft` (guards passed).
   */
  draftedSegments: number;
  /**
   * Present exactly when `status` is `failed`.
   */
  errorMessage?: string | null;
  harnessId: string;
  instruction: string;
  maxTurns: number;
  model: string;
  /**
   * The model's own scratchpad, in order. Never pruned by the budget.
   */
  notes: string[];
  profileId: string;
  projectId: string;
  provider: AiProviderKind;
  status: HarnessRunStatus;
  steps: HarnessStep[];
  /**
   * Present when terminal via `finish` (or the turn budget note).
   */
  summary?: string | null;
  /**
   * Term entries written through `term_add`.
   */
  termsAdded: number;
  turnsUsed: number;
  updatedAtMs: number;
  webAccess: boolean;
  [k: string]: unknown;
}
export interface HarnessStep {
  detail: string;
  index: number;
  kind: HarnessStepKind;
  segmentId?: string | null;
  status: AgentStepStatus;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract63 {
  params: HarnessStartParams;
  result: HarnessRunView;
}
export interface HarnessStartParams {
  documentId: string;
  /**
   * The task brief. Optional: the default brief is "translate this
   * document" with the project's language pair.
   */
  instruction?: string | null;
  /**
   * Model/tool turns before the honest circuit breaker trips.
   * Default 24, cap 64.
   */
  maxTurns?: number | null;
  /**
   * Profile to drive the conversation; the default profile when omitted.
   */
  profileId?: string | null;
  /**
   * Enables the `web_fetch` tool for this run. Off by default: network
   * reach is an explicit human decision, never an ambient capability.
   */
  webAccess?: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract64 {
  params: HarnessStatusParams;
  result: HarnessRunView;
}
export interface HarnessStatusParams {
  harnessId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract53 {
  params: AiProfileAddParams;
  result: AiProfileListResult;
}
/**
 * Add one provider profile to the engine's in-memory list. Credentials
 * follow the `ai.configure` rules exactly: engine memory only, never
 * persisted, never echoed back.
 */
export interface AiProfileAddParams {
  /**
   * Held in engine memory only; never persisted to disk.
   */
  apiKey: string;
  /**
   * Overrides the provider's default base URL. Required for
   * `openaiCompatible`, optional otherwise.
   */
  baseUrl?: string | null;
  /**
   * Display label; defaults to "provider · model" when omitted.
   */
  label?: string | null;
  model: string;
  provider: AiProviderKind;
  [k: string]: unknown;
}
export interface AiProfileListResult {
  defaultProfileId?: string | null;
  profiles: AiProfileView[];
  [k: string]: unknown;
}
/**
 * The observable face of one configured profile. The credential is never
 * part of this view.
 */
export interface AiProfileView {
  baseUrl: string;
  createdAtMs: number;
  label: string;
  model: string;
  profileId: string;
  provider: AiProviderKind;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract54 {
  params: AiProfileListParams;
  result: AiProfileListResult;
}
export interface AiProfileListParams {
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract55 {
  params: AiProfileRemoveParams;
  result: AiProfileListResult;
}
export interface AiProfileRemoveParams {
  profileId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract52 {
  params: AiStatusParams;
  result: AiStatusResult;
}
export interface AiStatusParams {
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract11 {
  params: DocumentExportParams;
  result: DocumentExportResult;
}
export interface DocumentExportParams {
  documentId: string;
  outputPath: string;
  /**
   * Pass the QA export gate this once. When the project's QA profile has
   * `blockExportOnError`, the engine re-checks the document before
   * exporting and refuses with `exportBlocked` (error `data.reason` =
   * `"qaGate"`, plus open-error count and leading rule ids) while
   * error-severity open issues exist. Same honest pattern as `overwrite`:
   * refuse → the user decides explicitly → pass. Defaults to false.
   */
  overrideQaGate?: boolean | null;
  /**
   * Replace an existing destination file (staged sibling temp + atomic
   * rename). Defaults to false: the export is refused with `exportBlocked`
   * when the path exists. Even with overwrite, the engine refuses paths
   * inside its own managed data directory — it cannot tell who owns an
   * arbitrary file on disk, but its own project data it can protect.
   */
  overwrite?: boolean | null;
  /**
   * Embed per-paragraph grid-segment anchors into the exported artifact so
   * a layout preview can map clicks back to segments. Preview aid; filters
   * without anchor support ignore it. Defaults to a plain export.
   */
  segmentAnchors?: boolean | null;
  [k: string]: unknown;
}
export interface DocumentExportResult {
  degradation: DegradationFinding[];
  outputPath: string;
  translatedSegments: number;
  [k: string]: unknown;
}
export interface DegradationFinding {
  code: string;
  message: string;
  severity: DegradationSeverity;
  structuralPath?: string | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract8 {
  params: DocumentImportParams;
  result: DocumentImportResult;
}
export interface DocumentImportParams {
  /**
   * Explicit filter id. When omitted, the engine probes registered filters.
   */
  filterId?: string | null;
  projectId: string;
  /**
   * Segmentation mode: `sentence` or `paragraph`. When omitted together
   * with `srxPath`, the project's stored default applies (falling back
   * to sentence with built-in rules).
   */
  segmentation?: string | null;
  sourcePath: string;
  /**
   * Path to a custom SRX ruleset used for sentence segmentation. When
   * omitted together with `segmentation`, the project's stored default
   * applies; when provided without `segmentation` it implies sentence
   * mode. An explicit `segmentation` makes the params the complete
   * choice, so `srxPath: null` then means the built-in rules.
   */
  srxPath?: string | null;
  [k: string]: unknown;
}
export interface DocumentImportResult {
  document: Document;
  segmentCount: number;
  [k: string]: unknown;
}
export interface Document {
  currentVersion: number;
  degradation: DegradationFinding[];
  filterId: string;
  format: string;
  id: string;
  importedAtMs: number;
  name: string;
  projectId: string;
  relativePath: string;
  revision: number;
  segmentCount: number;
  sourceSha256: string;
  status: DocumentStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract9 {
  params: DocumentListParams;
  result: DocumentListResult;
}
export interface DocumentListParams {
  projectId: string;
  [k: string]: unknown;
}
export interface DocumentListResult {
  documents: Document[];
  /**
   * Per-document segment-state and open-QA counts, aligned with
   * `documents` (same order), so the file rail can show honest progress
   * without materializing any segment rows client-side.
   */
  progress: DocumentProgress[];
  [k: string]: unknown;
}
/**
 * Segment progress of one document, counted in SQL at list time.
 */
export interface DocumentProgress {
  counts: SegmentCounts;
  documentId: string;
  [k: string]: unknown;
}
export interface SegmentCounts {
  confirmed: number;
  draft: number;
  openIssues: number;
  /**
   * Total source word count of the counted segments, computed by the
   * engine with [`source_word_count`]. 口径：UAX #29 词边界；CJK 统一
   * 表意文字与假名逐字计 1；数字串计 1；URL/email 计 1（对齐 Crowdin
   * Word Counter）。Absent from older engines — clients must render
   * nothing rather than count locally.
   */
  sourceWords?: number;
  total: number;
  untranslated: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract10 {
  params: DocumentRemoveParams;
  result: DocumentRemoveResult;
}
export interface DocumentRemoveParams {
  documentId: string;
  [k: string]: unknown;
}
/**
 * What `document.remove` deleted and what it deliberately kept. The
 * document row, its segments, and its QA issues are gone (one SQLite
 * transaction); the project TM — including entries confirmed from this
 * document — and termbases are untouched by design.
 */
export interface DocumentRemoveResult {
  document: Document1;
  /**
   * Whether the engine deleted its own managed copy of the imported
   * source file (the copy under the engine data directory). The original
   * file at the import path is never touched, and a managed path that
   * resolves outside the data directory (possible for legacy imports) is
   * left alone too — the engine cannot tell who owns it.
   */
  managedCopyDeleted: boolean;
  removedQaIssues: number;
  removedSegments: number;
  [k: string]: unknown;
}
/**
 * The removed document's last metadata, echoed for the status line.
 */
export interface Document1 {
  currentVersion: number;
  degradation: DegradationFinding[];
  filterId: string;
  format: string;
  id: string;
  importedAtMs: number;
  name: string;
  projectId: string;
  relativePath: string;
  revision: number;
  segmentCount: number;
  sourceSha256: string;
  status: DocumentStatus;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract {
  params: InitializeParams;
  result: InitializeResult;
}
export interface InitializeParams {
  clientName: string;
  clientVersion: string;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface InitializeResult {
  capabilities: EngineCapabilities;
  engineName: string;
  engineVersion: string;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface EngineCapabilities {
  aiAgent: boolean;
  aiAssist: boolean;
  /**
   * Registered document filter ids, e.g. `builtin.docx`.
   */
  filters: string[];
  /**
   * Whether the engine emits notification frames.
   */
  notifications: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract2 {
  params: ProjectListParams;
  result: ShutdownResult;
}
export interface ProjectListParams {
  [k: string]: unknown;
}
export interface ShutdownResult {
  ok: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract27 {
  params: MemoryAttachParams;
  result: MemoryAttachResult;
}
export interface MemoryAttachParams {
  memoryId: string;
  projectId: string;
  [k: string]: unknown;
}
/**
 * New mounts are enabled for lookup but never writable: promoting the
 * working memory is always an explicit `memory.update`, so a confirm can
 * never silently start writing into a freshly attached memory.
 */
export interface MemoryAttachResult {
  mount: MemoryMount;
  [k: string]: unknown;
}
/**
 * A project's mount of one memory — the same family shape as
 * [`TermbaseMount`]. `enabled` gates the read path (lookup, pretranslate);
 * `writable` marks the working memory, the single mount confirmation-time
 * TM writes go to. The engine enforces at most one writable mount per
 * project.
 */
export interface MemoryMount {
  createdAtMs: number;
  enabled: boolean;
  memoryId: string;
  priority: number;
  projectId: string;
  revision: number;
  updatedAtMs: number;
  writable: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract25 {
  params: MemoryCreateParams;
  result: Memory;
}
export interface MemoryCreateParams {
  name: string;
  sourceLocale: string;
  targetLocale: string;
  [k: string]: unknown;
}
/**
 * One translation memory: a named store of confirmed segment pairs.
 * `tm_entries.memory_id` points here. Projects reach a memory through a
 * [`MemoryMount`]; the memory itself carries no project binding.
 */
export interface Memory {
  createdAtMs: number;
  id: string;
  name: string;
  revision: number;
  sourceLocale: string;
  targetLocale: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract31 {
  params: MemoryDeleteParams;
  result: MemoryDeleteResult;
}
/**
 * `memory.delete` — remove a memory row for good. Honest conflicts, never
 * a silent orphan: mounted anywhere fails (detach it from every project
 * first), and entries remaining fails unless `deleteEntries` explicitly
 * asks for the cascade. The conflict message names the entry count so the
 * caller can put a real number in front of the user.
 */
export interface MemoryDeleteParams {
  /**
   * Delete the memory's TM entries along with it. Defaults to false:
   * a memory that still holds entries conflicts instead.
   */
  deleteEntries?: boolean;
  memoryId: string;
  [k: string]: unknown;
}
export interface MemoryDeleteResult {
  /**
   * TM entries removed in the same transaction (0 for an empty memory).
   */
  deletedEntries: number;
  memory: Memory1;
  [k: string]: unknown;
}
/**
 * One translation memory: a named store of confirmed segment pairs.
 * `tm_entries.memory_id` points here. Projects reach a memory through a
 * [`MemoryMount`]; the memory itself carries no project binding.
 */
export interface Memory1 {
  createdAtMs: number;
  id: string;
  name: string;
  revision: number;
  sourceLocale: string;
  targetLocale: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract28 {
  params: MemoryDetachParams;
  result: MemoryDetachResult;
}
export interface MemoryDetachParams {
  memoryId: string;
  projectId: string;
  [k: string]: unknown;
}
/**
 * Carries the removed mount. Detaching a memory that is not mounted fails
 * with `notFound` instead of pretending success. Detaching the writable
 * mount is allowed and leaves the project without a working memory —
 * confirms then fail honestly until another mount is promoted.
 */
export interface MemoryDetachResult {
  mount: MemoryMount;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract26 {
  params: MemoryListParams;
  result: MemoryListResult;
}
export interface MemoryListParams {
  /**
   * When set, `mounts` is restricted to this project.
   */
  projectId?: string | null;
  [k: string]: unknown;
}
export interface MemoryListResult {
  memories: Memory[];
  /**
   * Mounts in (project, priority) order.
   */
  mounts: MemoryMount[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract30 {
  params: MemoryRenameParams;
  result: MemoryRenameResult;
}
/**
 * `memory.rename` — rename the memory itself (mount edits stay in
 * `memory.update`). The new name applies everywhere the memory is
 * mounted; entries and mounts are untouched.
 */
export interface MemoryRenameParams {
  /**
   * Optimistic concurrency: must match the memory's current revision.
   */
  baseRevision: number;
  memoryId: string;
  name: string;
  [k: string]: unknown;
}
export interface MemoryRenameResult {
  memory: Memory;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract29 {
  params: MemoryUpdateParams;
  result: MemoryUpdateResult;
}
/**
 * Edit one mount: enable/disable the read path, promote/demote the
 * working memory, and/or move the mount to a new priority position.
 * Omitted fields stay unchanged.
 *
 * `writable: true` while another mount is writable fails with `conflict`
 * (demote the current working memory first) — the engine never lets two
 * mounts receive confirmation-time writes.
 */
export interface MemoryUpdateParams {
  enabled?: boolean | null;
  memoryId: string;
  /**
   * Target position in the project's mount list (0 = highest priority).
   * Values past the end clamp to the last position. Sibling mounts are
   * renumbered to keep priorities contiguous.
   */
  priority?: number | null;
  projectId: string;
  writable?: boolean | null;
  [k: string]: unknown;
}
/**
 * The project's mounts after the edit, in priority order — a priority
 * move renumbers siblings, so one mount alone would hide real changes.
 */
export interface MemoryUpdateResult {
  mounts: MemoryMount[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract7 {
  params: ProjectArchiveParams;
  result: Project;
}
/**
 * Parameters for `project.archive`. `archived: true` (the default) moves the
 * lifecycle to `archived` and stamps `archivedAtMs`; `archived: false`
 * restores `active` and clears the stamp. Both directions are idempotent.
 */
export interface ProjectArchiveParams {
  archived?: boolean;
  projectId: string;
  [k: string]: unknown;
}
export interface Project {
  archivedAtMs?: number | null;
  configuration: ProjectConfiguration;
  createdAtMs: number;
  domain: string;
  id: string;
  lifecycle: ProjectLifecycle;
  name: string;
  revision: number;
  sourceLocale: string;
  targetLocale: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface ProjectConfiguration {
  aiProfileIds?: string[];
  analysisProfileId?: string | null;
  editorDefaults?: EditorPreferences | null;
  engineAllowlist?: string[];
  pipelineId?: string | null;
  /**
   * Project-level QA profile overrides (severity remaps, settings, export
   * gate) applied over the built-in profile named by `qa_profile_id`.
   */
  qaProfile?: QaProfileOverrides | null;
  qaProfileId?: string | null;
  /**
   * Default segmentation for future imports. `None` means sentence mode.
   */
  segmentation?: ProjectSegmentation | null;
  /**
   * Default SRX ruleset path for future sentence-mode imports. Only the
   * path is stored — a missing or invalid file fails at import time, not
   * when the default is saved. Ignored (but kept) while the segmentation
   * default is paragraph, so switching back to sentence restores it.
   */
  srxPath?: string | null;
  taskPackage?: TaskPackageProjectReference | null;
  templateId?: string | null;
  [k: string]: unknown;
}
export interface EditorPreferences {
  autocomplete: boolean;
  cjkSpacing: boolean;
  punctuationAssistance: boolean;
  shortcuts: {
    [k: string]: string;
  };
  showNonprinting: boolean;
  theme: string;
  zoom: number;
  [k: string]: unknown;
}
/**
 * Project-level QA profile overrides, applied over the resolved built-in
 * profile (memoQ convention: built-ins are immutable, the project layer is
 * a clone-then-override). Absent overrides mean the built-in profile runs
 * exactly as shipped.
 */
export interface QaProfileOverrides {
  /**
   * Export gate: `document.export` refuses while error-severity open
   * issues exist (an explicit `overrideQaGate` lets the user pass).
   * Off by default — the gate is configured, never ambient.
   */
  blockExportOnError?: boolean;
  /**
   * Full replacement of the base profile's tunable settings. `None`
   * keeps the base profile's own values.
   */
  settings?: QaRuleSettings | null;
  /**
   * Per-rule severity remaps (rule id → severity) layered over the base
   * profile's table. Keys may name parameterized rules
   * (`qa.term-missing:<id>`, `qa.regex:<id>`) as well as fixed ones.
   */
  severityOverrides?: {
    [k: string]: QaSeverity;
  };
  [k: string]: unknown;
}
/**
 * Tunable knobs of a QA profile (thresholds and locale-convention toggles).
 * Lives in the domain crate because project configuration stores a
 * project-level replacement of these values.
 */
export interface QaRuleSettings {
  cjkPunctuation: boolean;
  cjkSpacing: boolean;
  maxLengthRatioPercent: number;
  maxTargetChars?: number | null;
  minLengthRatioPercent: number;
  requireSentenceFinalPunctuation: boolean;
  [k: string]: unknown;
}
export interface TaskPackageProjectReference {
  instructions?: string;
  originProjectId: string;
  packageId: string;
  parentPackageId?: string | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract3 {
  params: ProjectCreateParams;
  result: Project;
}
export interface ProjectCreateParams {
  name: string;
  sourceLocale: string;
  targetLocale: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract5 {
  params: ProjectGetParams;
  result: Project;
}
export interface ProjectGetParams {
  projectId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract4 {
  params: ProjectListParams;
  result: ProjectListResult;
}
export interface ProjectListResult {
  projects: Project[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract6 {
  params: ProjectUpdateParams;
  result: Project;
}
/**
 * Parameters for `project.update`. Omitted fields stay unchanged. `name`,
 * `sourceLocale`, and `targetLocale` are trimmed and must not be empty when
 * provided.
 *
 * Language-pair rule: the source/target locales may only change while the
 * project holds no linguistic assets — no imported documents, no project-TM
 * entries, and no attached termbases. Documents were segmented with the old
 * source locale and TM/term data was collected for the old pair, so once
 * assets exist a locale change is rejected with `conflict` instead of
 * silently orphaning TM and term lookups.
 *
 * Import-default rule: `segmentation` (`sentence` | `paragraph`) and
 * `srxPath` persist the project's default import choices in
 * `configuration`. Empty or omitted values keep the current defaults;
 * `clearSrxPath: true` resets the SRX default back to the built-in rules
 * (and cannot be combined with a new `srxPath`). An `srxPath` is only
 * accepted while the effective segmentation default is `sentence` — SRX
 * rules never apply in paragraph mode. Only the path is stored: a missing
 * SRX file fails honestly at import time, not when the default is saved.
 */
export interface ProjectUpdateParams {
  /**
   * Reset the stored SRX default back to the built-in rules.
   */
  clearSrxPath?: boolean;
  name?: string | null;
  projectId: string;
  /**
   * Default segmentation mode for future imports: `sentence` or
   * `paragraph`. Empty or omitted keeps the current default.
   */
  segmentation?: string | null;
  sourceLocale?: string | null;
  /**
   * Default SRX ruleset path for future sentence-mode imports. Empty or
   * omitted keeps the current default; use `clearSrxPath` to reset.
   */
  srxPath?: string | null;
  targetLocale?: string | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract48 {
  params: QaFixApplyParams;
  result: QaFixApplyResult;
}
/**
 * `qa.fix.apply` — apply one correction through the exact `segment.update`
 * guards: a stale `baseRevision` conflicts, a locked segment conflicts,
 * and a confirmed segment honestly returns to draft. The engine recomputes
 * the correction from the current text (a finding without one conflicts);
 * the segment's QA refreshes in the same transaction. Applying never
 * confirms and never writes TM.
 */
export interface QaFixApplyParams {
  /**
   * Optimistic concurrency: must match the segment's current revision.
   */
  baseRevision: number;
  issueId: string;
  [k: string]: unknown;
}
export interface QaFixApplyResult {
  /**
   * The segment's full issue list after the same-transaction refresh.
   */
  qaIssues: QaIssue[];
  segment: Segment;
  [k: string]: unknown;
}
export interface QaIssue {
  createdAtMs: number;
  evidence: NumberEvidence;
  fingerprint: string;
  id: string;
  message: string;
  /**
   * Structured message parameters (e.g. `{"expected": "30", "found":
   * "40"}`) so clients can localize the finding; `message` stays the
   * engine-produced English fallback. Empty for rules with nothing to
   * parameterize; rows persisted before the field existed parse as empty.
   */
  params?: {
    [k: string]: string;
  };
  ruleId: string;
  segmentId: string;
  severity: QaSeverity;
  status: QaIssueStatus;
  updatedAtMs: number;
  /**
   * Free-form note recorded with a waiver. Optional by design — waiving
   * must not demand a ritual reason. Non-null only while `status` is
   * [`QaIssueStatus::Waived`].
   */
  waiveNote?: string | null;
  [k: string]: unknown;
}
/**
 * Evidence attached to a QA issue. Historically number-only; general rules
 * reuse the same shape with free-form source/target values.
 */
export interface NumberEvidence {
  relatedSegmentIds?: string[];
  sourceNumbers: string[];
  sourceValues?: string[];
  targetNumbers: string[];
  targetValues?: string[];
  [k: string]: unknown;
}
export interface Segment {
  contextHash: string;
  documentId: string;
  id: string;
  /**
   * Locked rows are read-only: update/confirm conflict, replace,
   * pretranslate, propagation, and AI skip them, and QA leaves their
   * issues untouched. Toggled only by `segment.lock`. Defaults false so
   * rows serialized before the field existed still parse.
   */
  locked?: boolean;
  ordinal: number;
  /**
   * Where the current target text came from. Absent for rows written
   * before origins existed and for plain human typing.
   */
  origin?: SegmentOrigin | null;
  revision: number;
  sourceHash: string;
  sourceText: string;
  state: SegmentState;
  structuralPath: string;
  targetText: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * Where the current target text came from, stamped by the write that put
 * it there. Only writes that carry an origin stamp one — rows written
 * before this field existed stay origin-less forever (no backfill), and an
 * update that empties the target clears the origin (an empty target has no
 * origin). Confirming never changes the origin.
 */
export interface SegmentOrigin {
  /**
   * Pollution signal: true once the target was edited after the origin
   * write (Studio-style "edited fuzzy"). Engine-owned — the value sent
   * by a client is ignored; a stamping write always resets it to false.
   */
  edited?: boolean;
  kind: SegmentOriginKind;
  /**
   * Provider model that produced an `aiDraft`; absent otherwise.
   */
  model?: string | null;
  /**
   * Real TM match score (0-100) as reported at apply time. Present only
   * for TM origins; never fabricated for AI or human writes.
   */
  score?: number | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract47 {
  params: QaFixListParams;
  result: QaFixListResult;
}
/**
 * `qa.fix.list` — the engine-proposed corrections for a document's open
 * findings (PRD S3 ④).
 *
 * Corrections are recomputed from each segment's *current* target text at
 * call time, never persisted: a stale issue whose text was already edited
 * simply stops producing one. Only mechanically fixable rules propose
 * anything (edge whitespace, CJK half-width punctuation and the ASCII
 * ellipsis, adjacent repeated words, the unambiguous single-number
 * mismatch); a finding without a correction is honestly absent from the
 * list. Locked segments are shielded — their findings never offer a fix.
 */
export interface QaFixListParams {
  documentId: string;
  [k: string]: unknown;
}
export interface QaFixListResult {
  fixes: QaFix[];
  [k: string]: unknown;
}
/**
 * One engine-proposed correction. The client previews `fixedTargetText`
 * verbatim and applies it through `qa.fix.apply` — it never invents or
 * edits replacement text.
 */
export interface QaFix {
  /**
   * Segment revision the fix was computed against; pass it as
   * `baseRevision` to `qa.fix.apply`.
   */
  baseRevision: number;
  /**
   * The target text the fix replaces (the segment's current text).
   */
  currentTargetText: string;
  /**
   * Short English description of the mechanical change; clients
   * localize by `ruleId`, like issue messages.
   */
  description: string;
  /**
   * The full replacement target text, applied verbatim.
   */
  fixedTargetText: string;
  issueId: string;
  ruleId: string;
  segmentId: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract45 {
  params: QaListParams;
  result: QaListResult;
}
export interface QaListParams {
  documentId: string;
  /**
   * Page size. When omitted every issue from `offset` on is returned,
   * which is the pre-paging behavior existing clients rely on.
   */
  limit?: number | null;
  /**
   * Issues to skip in list order (open first, then oldest); defaults to 0.
   */
  offset?: number | null;
  [k: string]: unknown;
}
export interface QaListResult {
  /**
   * One window of the document's issues: open first, then waived, then
   * resolved.
   */
  issues: QaIssue[];
  /**
   * Issues for the document before the page window was applied, so
   * clients can page honestly.
   */
  total: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract49 {
  params: QaProfileGetParams;
  result: QaProfileView;
}
export interface QaProfileGetParams {
  projectId: string;
  [k: string]: unknown;
}
/**
 * The QA profile the engine will actually run for one project: the
 * resolved built-in base plus the project-level overrides layered on it.
 * Built-in profiles are immutable; the project layer is a clone-then-
 * override (memoQ convention), stored in the project configuration.
 *
 * Returned by both `qa.profile.get` and `qa.profile.update`.
 */
export interface QaProfileView {
  /**
   * The built-in profile the project resolves to (configured id when it
   * names a built-in, otherwise the target-locale default).
   */
  baseProfileId: string;
  /**
   * Whether `document.export` refuses while error-severity open issues
   * exist. Off by default.
   */
  blockExportOnError: boolean;
  /**
   * The static rule ids the compiled profile runs, in lexicographic
   * order — the rows a severity table can offer. Parameterized families
   * (`qa.term-required:<id>`, `qa.term-forbidden:<id>`, `qa.regex:<id>`,
   * and the `qa.tag` family marker behind the concrete `qa.tag-*` ids)
   * exist per term/regex definition and are not listed.
   */
  enabledRuleIds: string[];
  /**
   * Project revision, for `qa.profile.update` optimistic concurrency.
   */
  revision: number;
  settings: QaRuleSettings1;
  /**
   * Project-level severity remaps (rule id → severity), layered over the
   * base profile's table. Built-in profiles ship without remaps, so this
   * is also the effective table.
   */
  severityOverrides: {
    [k: string]: QaSeverity;
  };
  [k: string]: unknown;
}
/**
 * Tunable knobs of a QA profile (thresholds and locale-convention toggles).
 * Lives in the domain crate because project configuration stores a
 * project-level replacement of these values.
 */
export interface QaRuleSettings1 {
  cjkPunctuation: boolean;
  cjkSpacing: boolean;
  maxLengthRatioPercent: number;
  maxTargetChars?: number | null;
  minLengthRatioPercent: number;
  requireSentenceFinalPunctuation: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract50 {
  params: QaProfileUpdateParams;
  result: QaProfileView;
}
/**
 * `qa.profile.update` — write the project-level QA overrides. Omitted
 * fields keep their stored values; provided fields replace them wholesale
 * (`severityOverrides: {}` clears every remap). The engine compiles the
 * merged profile before storing anything, so a configuration that cannot
 * run is rejected instead of persisted.
 */
export interface QaProfileUpdateParams {
  /**
   * Optimistic concurrency: must match the project's current revision.
   */
  baseRevision: number;
  /**
   * Toggle the export gate.
   */
  blockExportOnError?: boolean | null;
  /**
   * Drop the stored settings replacement (mutually exclusive with
   * `settings`).
   */
  clearSettings?: boolean;
  projectId: string;
  /**
   * Replacement settings. `null` inside the option is not expressible —
   * send `clearSettings: true` to drop the project replacement and
   * return to the base profile's values.
   */
  settings?: QaRuleSettings | null;
  /**
   * Replacement severity remap table. Keys must be rule ids
   * (`qa.`-prefixed, including parameterized `qa.term-*:<id>` /
   * `qa.regex:<id>` forms).
   */
  severityOverrides?: {
    [k: string]: QaSeverity;
  } | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract44 {
  params: QaRunParams;
  result: QaRunResult;
}
export interface QaRunParams {
  documentId: string;
  [k: string]: unknown;
}
export interface QaRunResult {
  checkedSegments: number;
  issues: QaIssue[];
  openIssues: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract46 {
  params: QaWaiveParams;
  result: QaWaiveResult;
}
/**
 * `qa.waive` — record a human decision about findings without pretending
 * they went away.
 *
 * Waiving never edits the segment, never confirms it, and never writes TM:
 * the numbers still disagree, and the issue rows say so. The waiver sticks
 * exactly as long as later runs reproduce the same fingerprint (rule +
 * segment + evidence). When the evidence changes, the old row resolves and
 * the changed finding opens as a brand-new issue — a waiver never carries
 * over to evidence the user has not seen.
 *
 * Exactly one selector must be provided:
 *
 * - `issueId` — one issue. Waiving a resolved issue or restoring a
 *   non-waived issue is a conflict.
 * - `ruleId` + `documentId` — every issue of that rule in the document.
 * - `segmentId` — every issue of that segment.
 *
 * The batch selectors are operation granularity, not storage granularity:
 * each affected row records its own waiver, so audit and
 * fingerprint-invalidation semantics are identical to per-issue waiving.
 * Batches skip rows already in the requested state instead of erroring.
 */
export interface QaWaiveParams {
  /**
   * Scope for `ruleId`. Per-rule waivers are document-scoped — never a
   * hidden project-wide exemption.
   */
  documentId?: string | null;
  /**
   * Selector: one issue by id.
   */
  issueId?: string | null;
  /**
   * Optional free-form note. Deliberately not required: an empty or
   * omitted note is a perfectly valid waiver.
   */
  note?: string | null;
  /**
   * Selector: every issue of this rule; requires `documentId`.
   */
  ruleId?: string | null;
  /**
   * Selector: every issue of this segment.
   */
  segmentId?: string | null;
  /**
   * `true` waives open issues; `false` restores waived issues to open.
   */
  waived: boolean;
  [k: string]: unknown;
}
export interface QaWaiveResult {
  /**
   * Every issue the call changed, straight from the store. Clients
   * replace their copies of these rows wholesale.
   */
  issues: QaIssue[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract16 {
  params: SegmentConfirmParams;
  result: SegmentConfirmResult;
}
export interface SegmentConfirmParams {
  baseRevision: number;
  segmentId: string;
  /**
   * Confirm without touching translation memory: the segment still turns
   * confirmed and confirm-time QA still runs, but no TM entry is written
   * and no duplicate propagation happens — the pair spreads nowhere.
   * Also the escape hatch when no writable memory is mounted. Defaults
   * to false: the ordinary confirm keeps writing TM.
   */
  skipTmWrite?: boolean | null;
  [k: string]: unknown;
}
export interface SegmentConfirmResult {
  /**
   * Sibling segments auto-filled from the confirmed translation.
   */
  propagated: Segment[];
  /**
   * Confirm-time QA: every persisted issue of the confirmed segment
   * after the engine re-ran the segment-scoped rules against the
   * confirmed text, committed in the same transaction as the confirm.
   * All statuses are included so clients can replace their records for
   * this segment wholesale. Cross-segment consistency rules are not
   * re-evaluated here — those refresh on the next `qa.run`.
   */
  qaIssues?: QaIssue[];
  segment: Segment;
  /**
   * The translation-memory entry written by the confirmation; absent
   * when the confirm skipped the TM write.
   */
  tmEntry?: TmEntry | null;
  [k: string]: unknown;
}
export interface TmEntry {
  confirmedAtMs: number;
  id: string;
  memoryId: string;
  originDocumentId: string;
  originProjectId: string;
  originSegmentId: string;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract12 {
  params: SegmentListParams;
  result: SegmentListResult;
}
export interface SegmentListParams {
  documentId: string;
  /**
   * Page size. When omitted the whole document is returned, which is the
   * pre-paging behavior existing clients rely on.
   */
  limit?: number | null;
  /**
   * Rows to skip in ordinal order; defaults to 0.
   */
  offset?: number | null;
  [k: string]: unknown;
}
export interface SegmentListResult {
  segments: Segment[];
  /**
   * Segments in the document before the page window was applied, so
   * clients can size scrollbars without fetching every row.
   */
  totalSegments: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract17 {
  params: SegmentLockParams;
  result: SegmentLockResult;
}
/**
 * Parameters for `segment.lock`: set or clear a segment's lock. Locking is
 * idempotent — locking an already-locked row (or unlocking an unlocked one)
 * still bumps the revision and succeeds. `baseRevision` follows the same
 * optimistic-concurrency rule as `segment.update`.
 */
export interface SegmentLockParams {
  baseRevision: number;
  locked: boolean;
  segmentId: string;
  [k: string]: unknown;
}
export interface SegmentLockResult {
  segment: Segment;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract15 {
  params: SegmentReplaceParams;
  result: SegmentReplaceResult;
}
/**
 * Parameters for `segment.replace`: one document-wide search-and-replace
 * over target text. Matching is case-insensitive with per-character
 * Unicode lowercase folding — the same semantics as the grid find box —
 * and occurrences never overlap. Source text is never touched.
 */
export interface SegmentReplaceParams {
  documentId: string;
  /**
   * Text to find in target text. Must not be empty.
   */
  find: string;
  /**
   * Also rewrite confirmed segments. A rewritten confirmed segment moves
   * back to `draft` — the confirmation covered the old text — and its TM
   * entry is left as it was (replace drafts, it never confirms). Default
   * false: confirmed matches are skipped and counted instead.
   */
  includeConfirmed?: boolean | null;
  /**
   * Replacement text. May be empty, which deletes the found text; a
   * target emptied this way honestly returns to `untranslated`.
   */
  replaceWith: string;
  [k: string]: unknown;
}
export interface SegmentReplaceResult {
  /**
   * How many of `segments` were confirmed before this replace moved them
   * back to draft. Non-zero only with `includeConfirmed`.
   */
  demotedConfirmed: number;
  /**
   * Total occurrences replaced across `segments`.
   */
  replacedOccurrences: number;
  /**
   * Rewritten segments in grid order, carrying their new revision and
   * state, so clients can apply them without a full reload.
   */
  segments: Segment[];
  /**
   * Matching confirmed segments left untouched because
   * `includeConfirmed` was not set.
   */
  skippedConfirmed: number;
  /**
   * Matching locked segments left untouched. Locked rows are never
   * rewritten, even with `includeConfirmed`.
   */
  skippedLocked?: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract13 {
  params: SegmentUpdateParams;
  result: SegmentUpdateResult;
}
export interface SegmentUpdateParams {
  /**
   * Optimistic concurrency: must match the segment's current revision.
   */
  baseRevision: number;
  /**
   * Where `targetText` came from, for writes that apply stored material
   * (TM match apply → `tmExact`/`tmFuzzy` with the real lookup score, AI
   * draft apply → `aiDraft` with the provider model). The kinds are the
   * closed [`SegmentOrigin`] enum — nothing free-form. Omit for human
   * typing: the engine then keeps any existing origin and marks it
   * `edited` when the target changed, and clears the origin entirely
   * when the update empties the target. `origin.edited` is engine-owned
   * and ignored on input.
   */
  origin?: SegmentOrigin | null;
  segmentId: string;
  targetText: string;
  [k: string]: unknown;
}
export interface SegmentUpdateResult {
  segment: Segment;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract14 {
  params: SegmentUpdateSourceParams;
  result: SegmentUpdateSourceResult;
}
/**
 * Parameters for `segment.updateSource`: rewrite the source text of one
 * segment (imported text carrying an OCR error or a typo the translator
 * must fix in place). Guards mirror `segment.update`: a stale
 * `baseRevision` conflicts and a locked segment conflicts. The source
 * must not become empty — a segment without source text has no meaning.
 * Rewriting the source of a confirmed segment honestly returns it to
 * `draft`: the confirmation covered the old source. Any TM entry written
 * by an earlier confirm is left as it was (mirroring `segment.replace`),
 * and the stored target-origin stamp is kept — it still describes where
 * the target text came from.
 */
export interface SegmentUpdateSourceParams {
  /**
   * Optimistic concurrency: must match the segment's current revision.
   */
  baseRevision: number;
  segmentId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface SegmentUpdateSourceResult {
  segment: Segment;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract39 {
  params: TermAddParams;
  result: TermAddResult;
}
export interface TermAddParams {
  definition?: string | null;
  domain?: string | null;
  /**
   * Marks the target as forbidden instead of preferred.
   */
  forbidden?: boolean;
  sourceTerm: string;
  targetLocale: string;
  targetTerm: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermAddResult {
  entry: TermEntry;
  [k: string]: unknown;
}
export interface TermEntry {
  createdAtMs: number;
  definition?: string | null;
  domain?: string | null;
  example?: string | null;
  id: string;
  partOfSpeech?: string | null;
  revision: number;
  sourceLocale: string;
  sourceTerm: string;
  status: TermStatus;
  termbaseId: string;
  translations: TermTranslation[];
  updatedAtMs: number;
  [k: string]: unknown;
}
export interface TermTranslation {
  createdAtMs: number;
  entryId: string;
  forbidden: boolean;
  id: string;
  locale: string;
  preferred: boolean;
  term: string;
  updatedAtMs: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract41 {
  params: TermDeleteParams;
  result: TermDeleteResult;
}
export interface TermDeleteParams {
  entryId: string;
  /**
   * When set, removes only this translation and keeps the entry.
   */
  translationId?: string | null;
  [k: string]: unknown;
}
export interface TermDeleteResult {
  /**
   * The surviving entry after a translation-level delete; `None` when the
   * whole entry was removed.
   */
  entry?: TermEntry | null;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract42 {
  params: TermListParams;
  result: TermListResult;
}
export interface TermListParams {
  /**
   * Page size. When omitted every entry from `offset` on is returned,
   * which is the pre-paging behavior existing clients rely on.
   */
  limit?: number | null;
  /**
   * Entries to skip in source-term order; defaults to 0.
   */
  offset?: number | null;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermListResult {
  /**
   * One window of entries in source-term order.
   */
  entries: TermEntry[];
  /**
   * Entries in the termbase before the page window was applied, so
   * clients can page honestly.
   */
  total: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract43 {
  params: TermLookupParams;
  result: TermLookupResult;
}
export interface TermLookupParams {
  projectId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface TermLookupResult {
  /**
   * Hits over the normalized source text, ordered by span position. Spans
   * are Unicode-scalar offsets into the normalized text.
   */
  matches: TermMatch[];
  [k: string]: unknown;
}
export interface TermMatch {
  end: number;
  entryId: string;
  sourceTerm: string;
  start: number;
  termbaseId: string;
  translations: TermTranslation[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract40 {
  params: TermUpdateParams;
  result: TermUpdateResult;
}
export interface TermUpdateParams {
  entryId: string;
  /**
   * Marks the selected translation as forbidden (or preferred again).
   */
  forbidden?: boolean | null;
  /**
   * New source term for the entry. Left unchanged when omitted.
   */
  sourceTerm?: string | null;
  /**
   * New term text for the selected translation.
   */
  targetTerm?: string | null;
  /**
   * Translation being edited. Required for `target_term` / `forbidden`.
   */
  translationId?: string | null;
  [k: string]: unknown;
}
export interface TermUpdateResult {
  entry: TermEntry;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract34 {
  params: TermbaseAttachParams;
  result: TermbaseAttachResult;
}
export interface TermbaseAttachParams {
  projectId: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseAttachResult {
  mount: TermbaseMount;
  [k: string]: unknown;
}
export interface TermbaseMount {
  createdAtMs: number;
  enabled: boolean;
  priority: number;
  projectId: string;
  revision: number;
  termbaseId: string;
  updatedAtMs: number;
  writable: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract32 {
  params: TermbaseCreateParams;
  result: Termbase;
}
export interface TermbaseCreateParams {
  name: string;
  sourceLocale: string;
  [k: string]: unknown;
}
export interface Termbase {
  createdAtMs: number;
  domain?: string | null;
  id: string;
  name: string;
  revision: number;
  sourceLocale: string;
  updatedAtMs: number;
  writable: boolean;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract35 {
  params: TermbaseDetachParams;
  result: TermbaseDetachResult;
}
export interface TermbaseDetachParams {
  projectId: string;
  termbaseId: string;
  [k: string]: unknown;
}
/**
 * Carries the removed mount. Detaching a termbase that is not attached fails
 * with `notFound` instead of pretending success.
 */
export interface TermbaseDetachResult {
  mount: TermbaseMount;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract38 {
  params: TermbaseExportParams;
  result: TermbaseExportResult;
}
export interface TermbaseExportParams {
  format?: TermExchangeFormat | null;
  /**
   * Replace an existing destination file (staged sibling temp + atomic
   * rename). Defaults to false: the export is refused with `exportBlocked`
   * when the path exists. Even with overwrite, the engine refuses paths
   * inside its own managed data directory.
   */
  overwrite?: boolean | null;
  path: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseExportResult {
  exported: number;
  outputPath: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract37 {
  params: TermbaseImportParams;
  result: TermbaseImportResult;
}
export interface TermbaseImportParams {
  /**
   * Explicit exchange format. When omitted, inferred from the extension.
   */
  format?: TermExchangeFormat | null;
  path: string;
  /**
   * Fallback target locale for rows/entries that do not carry one.
   */
  targetLocale: string;
  termbaseId: string;
  [k: string]: unknown;
}
export interface TermbaseImportResult {
  /**
   * New term entries created.
   */
  added: number;
  /**
   * Entries read from the file.
   */
  imported: number;
  /**
   * Existing entries that gained or refreshed translations.
   */
  merged: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract33 {
  params: TermbaseListParams;
  result: TermbaseListResult;
}
export interface TermbaseListParams {
  /**
   * When set, `mounts` is restricted to this project.
   */
  projectId?: string | null;
  [k: string]: unknown;
}
export interface TermbaseListResult {
  mounts: TermbaseMount[];
  termbases: Termbase[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract36 {
  params: TermbaseUpdateParams;
  result: TermbaseUpdateResult;
}
/**
 * `termbase.update` — edit one mount: enable/disable the read path
 * (`term.lookup` and QA only consult enabled mounts), flip the per-mount
 * write switch, and/or move the mount to a new priority position. Omitted
 * fields stay unchanged; an all-omitted update is `invalidParams`.
 *
 * Unlike TM mounts there is no single-writable invariant: `termbase.attach`
 * mounts every termbase writable, several writable mounts are the normal
 * state, and `writable` here is a per-mount switch. Term additions target
 * the first writable mount in priority order.
 */
export interface TermbaseUpdateParams {
  enabled?: boolean | null;
  /**
   * Target position in the project's mount list (0 = highest priority).
   * Values past the end clamp to the last position. Sibling mounts are
   * renumbered to keep priorities contiguous.
   */
  priority?: number | null;
  projectId: string;
  termbaseId: string;
  writable?: boolean | null;
  [k: string]: unknown;
}
/**
 * The project's mounts after the edit, in priority order — a priority
 * move renumbers siblings, so one mount alone would hide real changes.
 */
export interface TermbaseUpdateResult {
  mounts: TermbaseMount[];
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract21 {
  params: TmDeleteParams;
  result: TmDeleteResult;
}
export interface TmDeleteParams {
  entryId: string;
  [k: string]: unknown;
}
export interface TmDeleteResult {
  entry: TmEntry1;
  [k: string]: unknown;
}
/**
 * The removed entry, echoed so clients can report what was deleted.
 */
export interface TmEntry1 {
  confirmedAtMs: number;
  id: string;
  memoryId: string;
  originDocumentId: string;
  originProjectId: string;
  originSegmentId: string;
  sourceHash: string;
  sourceText: string;
  targetText: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract23 {
  params: TmExportParams;
  result: TmExportResult;
}
export interface TmExportParams {
  format?: TmExchangeFormat | null;
  /**
   * Memory to export. Must be mounted on the project. Defaults to the
   * project's writable mount; fails with `conflict` when the project has
   * no writable mount and no explicit id was given.
   */
  memoryId?: string | null;
  /**
   * Replace an existing destination file (staged sibling temp + atomic
   * rename). Defaults to false: the export is refused with `exportBlocked`
   * when the path exists. Even with overwrite, the engine refuses paths
   * inside its own managed data directory.
   */
  overwrite?: boolean | null;
  path: string;
  projectId: string;
  [k: string]: unknown;
}
export interface TmExportResult {
  exported: number;
  outputPath: string;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract22 {
  params: TmImportParams;
  result: TmImportResult;
}
export interface TmImportParams {
  /**
   * Explicit exchange format. When omitted, inferred from the extension.
   */
  format?: TmExchangeFormat | null;
  /**
   * Destination memory. Must be mounted on the project. Defaults to the
   * project's writable mount; fails with `conflict` when the project has
   * no writable mount and no explicit id was given.
   */
  memoryId?: string | null;
  path: string;
  projectId: string;
  [k: string]: unknown;
}
export interface TmImportResult {
  /**
   * New TM entries created.
   */
  added: number;
  /**
   * Units read from the file.
   */
  imported: number;
  /**
   * Existing entries whose target was replaced.
   */
  updated: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract19 {
  params: TmListParams;
  result: TmListResult;
}
export interface TmListParams {
  /**
   * Page size (1..=[`TM_LIST_MAX_LIMIT`]); defaults to
   * [`TM_LIST_DEFAULT_LIMIT`].
   */
  limit?: number | null;
  /**
   * Memory to page. Must be mounted on the project (enabled or not —
   * managing a disabled mount's entries is legitimate). Defaults to the
   * project's writable mount; fails with `conflict` when the project has
   * no writable mount and no explicit id was given.
   */
  memoryId?: string | null;
  /**
   * Entries to skip before the page starts; defaults to 0.
   */
  offset?: number | null;
  projectId: string;
  /**
   * Case-insensitive substring filter over source and target text.
   */
  query?: string | null;
  [k: string]: unknown;
}
export interface TmListResult {
  /**
   * One page of entries, most recently confirmed first.
   */
  entries: TmEntry[];
  /**
   * Entries that matched the filter before `offset`/`limit`, so clients
   * can page honestly.
   */
  total: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract18 {
  params: TmLookupParams;
  result: TmLookupResult;
}
export interface TmLookupParams {
  /**
   * Maximum matches to return; defaults to [`TM_LOOKUP_DEFAULT_LIMIT`].
   */
  limit?: number | null;
  /**
   * Fuzzy score floor (1..=100); defaults to
   * [`TM_LOOKUP_DEFAULT_MIN_SCORE`]. Exact matches always pass.
   */
  minScore?: number | null;
  projectId: string;
  sourceText: string;
  [k: string]: unknown;
}
export interface TmLookupResult {
  matches: TmMatchItem[];
  /**
   * Total candidates that met the floor before the limit was applied, so
   * clients can tell when a `limit` cut the list short.
   */
  totalMatches: number;
  [k: string]: unknown;
}
export interface TmMatchItem {
  entry: TmEntry;
  grade: TmMatchGrade;
  /**
   * Name of the memory the entry lives in (`entry.memoryId` carries the
   * id). `None` only when the memory row is unknown to the engine.
   */
  memoryName?: string | null;
  /**
   * 0..=100.
   */
  score: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract24 {
  params: TmPretranslateParams;
  result: TmPretranslateResult;
}
export interface TmPretranslateParams {
  documentId: string;
  /**
   * Score threshold (1..=100) a match must reach to be applied; defaults
   * to [`TM_PRETRANSLATE_DEFAULT_MIN_SCORE`].
   */
  minScore?: number | null;
  [k: string]: unknown;
}
export interface TmPretranslateResult {
  /**
   * Untranslated segments examined.
   */
  checked: number;
  exact: number;
  fuzzy: number;
  /**
   * Segments filled from the TM (exact + fuzzy).
   */
  pretranslated: number;
  /**
   * The segments that changed, at their new revisions.
   */
  segments: Segment[];
  /**
   * Untranslated segments left alone because they are locked. Not part
   * of `checked`.
   */
  skippedLocked?: number;
  [k: string]: unknown;
}
/**
 * A `{ params, result }` pair for one method. Only used for schema export.
 */
export interface MethodContract20 {
  params: TmUpdateParams;
  result: TmUpdateResult;
}
export interface TmUpdateParams {
  entryId: string;
  sourceText: string;
  targetText: string;
  [k: string]: unknown;
}
export interface TmUpdateResult {
  entry: TmEntry;
  [k: string]: unknown;
}
/**
 * Reserved notification frame: engine-initiated, no request id, never awaited.
 */
export interface RpcNotification {
  method: string;
  params?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
/**
 * Notification-name-keyed catalog for the reserved notification frames.
 */
export interface NotificationCatalog {
  "notify.ai.agent.step": AgentStepNotification;
  "notify.ai.harness.step": HarnessStepNotification;
  "notify.engine.ready": EngineReadyNotification;
}
/**
 * Payload for the reserved `notify.ai.agent.step` frame emitted while a run
 * is in flight. `runStatus` lets clients notice the terminal transition
 * without polling.
 */
export interface AgentStepNotification {
  documentId: string;
  runId: string;
  runStatus: AgentRunStatus;
  step: AgentStep;
  [k: string]: unknown;
}
/**
 * Payload for the reserved `notify.ai.harness.step` frame.
 */
export interface HarnessStepNotification {
  documentId: string;
  harnessId: string;
  runStatus: HarnessRunStatus;
  step: HarnessStep;
  [k: string]: unknown;
}
/**
 * Payload for the reserved `notify.engine.ready` frame emitted on startup.
 */
export interface EngineReadyNotification {
  engineName: string;
  engineVersion: string;
  protocolVersion: number;
  [k: string]: unknown;
}
export interface RpcRequest {
  id: number;
  method: string;
  params?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface RpcResponse {
  error?: RpcError | null;
  id?: number | null;
  result?: unknown;
  [k: string]: unknown;
}
