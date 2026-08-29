//! AI domain: assisted drafting and the autonomous agent skeleton.
//!
//! Both surfaces degrade honestly: when no provider is configured the engine
//! answers with the `aiNotConfigured` error code instead of fabricating output.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
pub use tl_ai::AiProviderKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigureParams {
    pub provider: AiProviderKind,
    pub model: String,
    /// Overrides the provider's default base URL. Required for
    /// `openaiCompatible`, optional otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Held in engine memory only; never persisted to disk.
    pub api_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusParams {}

/// `provider`/`model` describe the default profile; `profileCount` counts
/// every configured profile (`ai.profile.list` has the full views).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusResult {
    pub configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<AiProviderKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default)]
    pub profile_count: u32,
}

/// Add one provider profile to the engine's in-memory list. Credentials
/// follow the `ai.configure` rules exactly: engine memory only, never
/// persisted, never echoed back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileAddParams {
    pub provider: AiProviderKind,
    pub model: String,
    /// Overrides the provider's default base URL. Required for
    /// `openaiCompatible`, optional otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Held in engine memory only; never persisted to disk.
    pub api_key: String,
    /// Display label; defaults to "provider · model" when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// The observable face of one configured profile. The credential is never
/// part of this view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileView {
    pub profile_id: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub base_url: String,
    pub label: String,
    pub created_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileListParams {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileListResult {
    pub profiles: Vec<AiProfileView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_profile_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiProfileRemoveParams {
    pub profile_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AiAssistAction {
    /// Draft a translation for the segment source.
    Translate,
    /// Improve the segment's current target.
    Refine,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistParams {
    pub segment_id: String,
    pub action: AiAssistAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    /// Profile to call; the default profile when omitted. Requests for the
    /// same segment through *different* profiles run in parallel (the
    /// multi-candidate path); a second request on the same (segment,
    /// profile) pair is a Conflict.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
}

/// Placeholder integrity verdict for an AI proposal. When `ok` is false the
/// proposal must not be applied to the segment.
pub use tl_ai::TagIntegrityReport as AiTagCheck;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistResult {
    pub draft_target: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub elapsed_ms: u64,
    /// Placeholder/tag integrity of the draft against the segment source.
    pub tag_check: AiTagCheck,
}

/// Lifecycle of one asynchronous assist request. `ai.assist.start` validates
/// and returns immediately; the provider call runs off the RPC thread and the
/// client polls `ai.assist.status` until the run turns terminal. Assist never
/// writes to the segment: a `done` run only carries a proposal for a human.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AiAssistRunStatus {
    Running,
    /// The provider answered; `result` carries the proposal and tag verdict.
    Done,
    /// The provider call failed; `errorMessage` says why. Never fabricated.
    Failed,
    /// Cancellation was requested and honored; any late result is discarded.
    Canceled,
}

impl AiAssistRunStatus {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Running)
    }
}

/// The observable state of one assist request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistRunView {
    pub assist_id: String,
    pub segment_id: String,
    /// The resolved profile serving this request.
    pub profile_id: String,
    pub action: AiAssistAction,
    pub status: AiAssistRunStatus,
    pub cancel_requested: bool,
    /// Present exactly when `status` is `done`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<AiAssistResult>,
    /// Present exactly when `status` is `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistStatusParams {
    pub assist_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistCancelParams {
    pub assist_id: String,
}

/// Approval tier for one agent run. The tiers govern what happens to
/// AI-generated drafts only: exact-TM reuse, the tag-integrity gate, the
/// locked/confirmed shields, and human-only export are identical everywhere.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentApprovalMode {
    /// Default. AI drafts queue as proposals; nothing is written until a
    /// human approves them through `ai.agent.review`.
    #[default]
    Manual,
    /// AI drafts that pass the tag gate land in the grid as drafts.
    /// Confirmation and export stay human.
    Auto,
    /// Explicit high-trust tier: drafts land like `auto`, and segments whose
    /// segment-scoped QA has zero open error-severity issues are confirmed
    /// through the ordinary `segment.confirm` path (TM write included).
    /// Export stays human; the run still parks at `awaitingReview`.
    Turbo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartParams {
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    /// Upper bound on segments the agent may touch in one run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_segments: Option<u32>,
    /// Approval tier; `manual` when omitted.
    #[serde(default)]
    pub approval_mode: AgentApprovalMode,
    /// Optional scope: only these segments are considered (intersected with
    /// the document's untranslated, unlocked set). Powers "run the current
    /// filter" and the precise failed-segment rerun.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_ids: Option<Vec<String>>,
    /// Profile to draft with; the default profile when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusParams {
    pub run_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelParams {
    pub run_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentStepKind {
    Plan,
    /// Exact TM reuse during pretranslation.
    Tm,
    /// AI drafting for a TM miss.
    Translate,
    /// Manual mode: an AI candidate queued, approved, rejected, or went
    /// stale (`ai.agent.review` outcomes included).
    Proposal,
    /// Turbo mode: the auto-confirm decision for one drafted segment.
    Confirm,
    Qa,
    Summary,
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentStepStatus {
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStep {
    pub index: u32,
    pub kind: AgentStepKind,
    pub status: AgentStepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    pub detail: String,
}

/// Lifecycle of an agent run. The run never confirms segments, never signs
/// off, and never exports: it always parks at `awaitingReview` for a human.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentRunStatus {
    Running,
    /// Terminal human gate: drafts are in the grid, a person decides what
    /// gets confirmed or exported.
    AwaitingReview,
    Canceled,
    Failed,
}

impl AgentRunStatus {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Running)
    }
}

/// One AI candidate held for human review in a manual-mode run. Tag-broken
/// candidates never become proposals (they are recorded as failures), so a
/// pending proposal is always applicable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentProposalStatus {
    Pending,
    Applied,
    Rejected,
    /// The live segment moved (edited, locked, or confirmed by a human)
    /// before the proposal was applied; the human state wins.
    Stale,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentProposal {
    pub segment_id: String,
    pub source_text: String,
    pub draft_target: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub elapsed_ms: u64,
    pub tag_check: AiTagCheck,
    pub status: AgentProposalStatus,
    /// Present for `stale` proposals: why the live row refused the apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum AgentReviewDecision {
    Apply,
    Reject,
}

/// Human decision on pending manual-mode proposals, one or many at a time.
/// `apply` writes each draft through the same guards as auto mode (live row
/// still untranslated and unlocked) and refreshes that segment's QA in the
/// same transaction; a moved row turns the proposal `stale` instead of
/// overwriting human work. `reject` records the decision and writes nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentReviewParams {
    pub run_id: String,
    pub segment_ids: Vec<String>,
    pub decision: AgentReviewDecision,
}

/// The observable task order for one agent run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunView {
    pub run_id: String,
    pub document_id: String,
    pub status: AgentRunStatus,
    pub approval_mode: AgentApprovalMode,
    /// The resolved profile drafting this run.
    pub profile_id: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub cancel_requested: bool,
    /// Untranslated segments claimed by this run at start time (after the
    /// `maxSegments` cap).
    pub planned_segments: u32,
    /// Untranslated, unlocked segments in the requested scope before the
    /// cap — makes any truncation explicit.
    pub eligible_segments: u32,
    /// Planned segments that reached a per-segment outcome (TM applied, AI
    /// draft applied, proposal queued, failed, or skipped). The honest
    /// progress numerator; `plannedSegments` is the denominator.
    pub processed_segments: u32,
    pub tm_applied: u32,
    pub ai_drafted: u32,
    /// Planned segments left untouched because a human edited or locked
    /// them while the run was in flight.
    pub skipped_segments: u32,
    pub failed_segments: u32,
    /// Segment ids behind `failedSegments`, for the precise rerun.
    pub failed_segment_ids: Vec<String>,
    /// Turbo mode: segments confirmed through `segment.confirm` after the
    /// segment-scoped QA gate found zero open error-severity issues.
    pub auto_confirmed: u32,
    pub open_qa_issues: u32,
    /// Manual mode: the review queue. Empty in auto and turbo runs.
    pub proposals: Vec<AgentProposal>,
    pub steps: Vec<AgentStep>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// Payload for the reserved `notify.ai.agent.step` frame emitted while a run
/// is in flight. `runStatus` lets clients notice the terminal transition
/// without polling.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentStepNotification {
    pub run_id: String,
    pub document_id: String,
    pub run_status: AgentRunStatus,
    pub step: AgentStep,
}

// ---------------------------------------------------------------------------
// The whole-document agent harness (`ai.harness.*`).
//
// Where `ai.agent.*` is a segment-batch pipeline (TM pretranslation plus
// per-segment drafting fan-out — the MT shape), the harness runs one LLM
// conversation that drives a tool loop over the whole document: it reads
// segments in windows, looks up TM and terminology, writes drafts through
// the same guards as the batch agent, keeps its own notes, runs QA, and
// optionally fetches web pages. Design: docs/agent-harness.md.

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessStartParams {
    pub document_id: String,
    /// The task brief. Optional: the default brief is "translate this
    /// document" with the project's language pair.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    /// Profile to drive the conversation; the default profile when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    /// Model/tool turns before the honest circuit breaker trips.
    /// Default 24, cap 64.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_turns: Option<u32>,
    /// Enables the `web_fetch` tool for this run. Off by default: network
    /// reach is an explicit human decision, never an ambient capability.
    #[serde(default)]
    pub web_access: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessStatusParams {
    pub harness_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessCancelParams {
    pub harness_id: String,
}

/// Lifecycle of one harness run. Like the batch agent, the run never
/// confirms and never exports: every terminal state leaves drafts (if any)
/// parked at the human review gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum HarnessRunStatus {
    Running,
    /// Terminal: the model finished (or the turn budget ran out); drafts
    /// are in the grid awaiting a human.
    AwaitingReview,
    Failed,
    Canceled,
}

impl HarnessRunStatus {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Running)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum HarnessStepKind {
    /// One model turn (the reply's tool call, or the parse failure).
    Model,
    /// A tool executed on the engine thread (read/lookup/qa/term).
    Tool,
    /// `write_draft` landed (or was refused by a guard).
    Draft,
    /// The model appended to its run notes.
    Note,
    /// A `qa_run` tool call.
    Qa,
    /// A `web_fetch` performed by the worker.
    Web,
    Summary,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessStep {
    pub index: u32,
    pub kind: HarnessStepKind,
    pub status: AgentStepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
    pub detail: String,
}

/// The observable state of one harness run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRunView {
    pub harness_id: String,
    pub project_id: String,
    pub document_id: String,
    pub status: HarnessRunStatus,
    pub instruction: String,
    pub profile_id: String,
    pub provider: AiProviderKind,
    pub model: String,
    pub web_access: bool,
    pub max_turns: u32,
    pub turns_used: u32,
    pub cancel_requested: bool,
    /// Drafts written through `write_draft` (guards passed).
    pub drafted_segments: u32,
    /// Term entries written through `term_add`.
    pub terms_added: u32,
    /// The model's own scratchpad, in order. Never pruned by the budget.
    pub notes: Vec<String>,
    /// Present when terminal via `finish` (or the turn budget note).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Present exactly when `status` is `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub steps: Vec<HarnessStep>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// Payload for the reserved `notify.ai.harness.step` frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HarnessStepNotification {
    pub harness_id: String,
    pub document_id: String,
    pub run_status: HarnessRunStatus,
    pub step: HarnessStep,
}
