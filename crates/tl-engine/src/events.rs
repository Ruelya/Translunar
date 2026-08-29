//! Events streamed from worker threads back into the single-threaded engine
//! loop.
//!
//! Workers (agent drafting, assist requests) own no engine state: they send
//! these messages over a channel and the engine applies them between RPC
//! frames via [`crate::Engine::handle_engine_event`].

/// A successful AI draft produced by the agent worker.
#[derive(Debug, Clone)]
pub struct AgentDraft {
    pub target: String,
    pub model: String,
    pub elapsed_ms: u64,
}

/// A successful completion produced by the assist worker.
#[derive(Debug, Clone)]
pub struct AssistCompletion {
    pub text: String,
    pub elapsed_ms: u64,
}

/// Message from a worker thread back to the engine loop.
#[derive(Debug)]
pub enum EngineEvent {
    AgentDrafted {
        run_id: String,
        segment_id: String,
        outcome: Result<AgentDraft, String>,
    },
    /// All agent work items were attempted; the engine finishes with QA +
    /// summary.
    AgentFinished { run_id: String },
    /// The agent cancellation flag was observed; remaining items were not
    /// touched.
    AgentCanceled { run_id: String },
    /// The assist provider call ended, successfully or not.
    AssistFinished {
        assist_id: String,
        outcome: Result<AssistCompletion, String>,
    },
    /// Harness worker asks the engine to run one local tool. The engine
    /// executes it between loop inputs and answers over the run's reply
    /// channel (see `HarnessRunState.tool_tx`).
    HarnessTool {
        harness_id: String,
        tool: String,
        args: serde_json::Value,
    },
    /// A worker-side step worth surfacing (model turn, web fetch, parse
    /// retry). Pure telemetry: no engine state changes.
    HarnessTrace {
        harness_id: String,
        kind: HarnessTraceKind,
        ok: bool,
        detail: String,
    },
    /// The model called `finish` (or the turn budget ran out with
    /// `exhausted`); drafts stay parked at the human review gate.
    HarnessFinished {
        harness_id: String,
        summary: String,
        exhausted: bool,
    },
    /// The conversation could not continue (provider failure or an
    /// unparseable reply after the retry). Reported verbatim.
    HarnessFailed { harness_id: String, error: String },
    /// The cancel flag was observed; the run turns canceled.
    HarnessCanceled { harness_id: String },
}

/// What a [`EngineEvent::HarnessTrace`] describes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessTraceKind {
    Model,
    Web,
}
