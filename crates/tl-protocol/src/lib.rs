//! Wire protocol between the desktop shell and `tl-engine`.
//!
//! The protocol is split by domain: handshake, project, document, segment,
//! translation memory, QA, and AI. Each module owns its params/result pairs;
//! this crate root owns the envelope, the method registry, and the JSON-schema
//! catalog that feeds the TypeScript contracts package.

use schemars::JsonSchema;

mod envelope;
pub use envelope::*;
pub mod handshake;
pub use handshake::*;
pub mod project;
pub use project::*;
pub mod document;
pub use document::*;
pub mod segment;
pub use segment::*;
pub mod tm;
pub use tm::*;
pub mod memory;
pub use memory::*;
pub mod term;
pub use term::*;
pub mod qa;
pub use qa::*;
pub mod ai;
pub use ai::*;

pub const PROTOCOL_VERSION: u32 = 1;

pub mod methods {
    pub const ENGINE_INITIALIZE: &str = "engine.initialize";
    pub const ENGINE_SHUTDOWN: &str = "engine.shutdown";
    pub const PROJECT_CREATE: &str = "project.create";
    pub const PROJECT_LIST: &str = "project.list";
    pub const PROJECT_GET: &str = "project.get";
    pub const PROJECT_UPDATE: &str = "project.update";
    pub const PROJECT_ARCHIVE: &str = "project.archive";
    pub const DOCUMENT_IMPORT: &str = "document.import";
    pub const DOCUMENT_LIST: &str = "document.list";
    pub const DOCUMENT_REMOVE: &str = "document.remove";
    pub const DOCUMENT_EXPORT: &str = "document.export";
    pub const SEGMENT_LIST: &str = "segment.list";
    pub const SEGMENT_UPDATE: &str = "segment.update";
    pub const SEGMENT_UPDATE_SOURCE: &str = "segment.updateSource";
    pub const SEGMENT_REPLACE: &str = "segment.replace";
    pub const SEGMENT_CONFIRM: &str = "segment.confirm";
    pub const SEGMENT_LOCK: &str = "segment.lock";
    pub const TM_LOOKUP: &str = "tm.lookup";
    pub const TM_LIST: &str = "tm.list";
    pub const TM_UPDATE: &str = "tm.update";
    pub const TM_DELETE: &str = "tm.delete";
    pub const TM_IMPORT: &str = "tm.import";
    pub const TM_EXPORT: &str = "tm.export";
    pub const TM_PRETRANSLATE: &str = "tm.pretranslate";
    pub const MEMORY_CREATE: &str = "memory.create";
    pub const MEMORY_LIST: &str = "memory.list";
    pub const MEMORY_ATTACH: &str = "memory.attach";
    pub const MEMORY_DETACH: &str = "memory.detach";
    pub const MEMORY_UPDATE: &str = "memory.update";
    pub const MEMORY_RENAME: &str = "memory.rename";
    pub const MEMORY_DELETE: &str = "memory.delete";
    pub const TERMBASE_CREATE: &str = "termbase.create";
    pub const TERMBASE_LIST: &str = "termbase.list";
    pub const TERMBASE_ATTACH: &str = "termbase.attach";
    pub const TERMBASE_DETACH: &str = "termbase.detach";
    pub const TERMBASE_UPDATE: &str = "termbase.update";
    pub const TERMBASE_IMPORT: &str = "termbase.import";
    pub const TERMBASE_EXPORT: &str = "termbase.export";
    pub const TERM_ADD: &str = "term.add";
    pub const TERM_UPDATE: &str = "term.update";
    pub const TERM_DELETE: &str = "term.delete";
    pub const TERM_LIST: &str = "term.list";
    pub const TERM_LOOKUP: &str = "term.lookup";
    pub const QA_RUN: &str = "qa.run";
    pub const QA_LIST: &str = "qa.list";
    pub const QA_WAIVE: &str = "qa.waive";
    pub const QA_FIX_LIST: &str = "qa.fix.list";
    pub const QA_FIX_APPLY: &str = "qa.fix.apply";
    pub const QA_PROFILE_GET: &str = "qa.profile.get";
    pub const QA_PROFILE_UPDATE: &str = "qa.profile.update";
    pub const AI_CONFIGURE: &str = "ai.configure";
    pub const AI_STATUS: &str = "ai.status";
    pub const AI_PROFILE_ADD: &str = "ai.profile.add";
    pub const AI_PROFILE_LIST: &str = "ai.profile.list";
    pub const AI_PROFILE_REMOVE: &str = "ai.profile.remove";
    pub const AI_ASSIST_START: &str = "ai.assist.start";
    pub const AI_ASSIST_STATUS: &str = "ai.assist.status";
    pub const AI_ASSIST_CANCEL: &str = "ai.assist.cancel";
    pub const AI_AGENT_START: &str = "ai.agent.start";
    pub const AI_AGENT_STATUS: &str = "ai.agent.status";
    pub const AI_AGENT_REVIEW: &str = "ai.agent.review";
    pub const AI_AGENT_CANCEL: &str = "ai.agent.cancel";
}

pub mod notifications {
    pub const ENGINE_READY: &str = "notify.engine.ready";
    pub const AGENT_STEP: &str = "notify.ai.agent.step";
}

/// A `{ params, result }` pair for one method. Only used for schema export.
#[derive(JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MethodContract<Params, Result> {
    pub params: Params,
    pub result: Result,
}

/// Method-name-keyed catalog. Field renames must match [`methods`] constants;
/// the test below keeps them honest.
#[derive(JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RpcMethodCatalog {
    #[serde(rename = "engine.initialize")]
    pub engine_initialize: MethodContract<InitializeParams, InitializeResult>,
    #[serde(rename = "engine.shutdown")]
    pub engine_shutdown: MethodContract<ProjectListParams, ShutdownResult>,
    #[serde(rename = "project.create")]
    pub project_create: MethodContract<ProjectCreateParams, tl_domain::Project>,
    #[serde(rename = "project.list")]
    pub project_list: MethodContract<ProjectListParams, ProjectListResult>,
    #[serde(rename = "project.get")]
    pub project_get: MethodContract<ProjectGetParams, tl_domain::Project>,
    #[serde(rename = "project.update")]
    pub project_update: MethodContract<ProjectUpdateParams, tl_domain::Project>,
    #[serde(rename = "project.archive")]
    pub project_archive: MethodContract<ProjectArchiveParams, tl_domain::Project>,
    #[serde(rename = "document.import")]
    pub document_import: MethodContract<DocumentImportParams, DocumentImportResult>,
    #[serde(rename = "document.list")]
    pub document_list: MethodContract<DocumentListParams, DocumentListResult>,
    #[serde(rename = "document.remove")]
    pub document_remove: MethodContract<DocumentRemoveParams, DocumentRemoveResult>,
    #[serde(rename = "document.export")]
    pub document_export: MethodContract<DocumentExportParams, DocumentExportResult>,
    #[serde(rename = "segment.list")]
    pub segment_list: MethodContract<SegmentListParams, SegmentListResult>,
    #[serde(rename = "segment.update")]
    pub segment_update: MethodContract<SegmentUpdateParams, SegmentUpdateResult>,
    #[serde(rename = "segment.updateSource")]
    pub segment_update_source: MethodContract<SegmentUpdateSourceParams, SegmentUpdateSourceResult>,
    #[serde(rename = "segment.replace")]
    pub segment_replace: MethodContract<SegmentReplaceParams, SegmentReplaceResult>,
    #[serde(rename = "segment.confirm")]
    pub segment_confirm: MethodContract<SegmentConfirmParams, SegmentConfirmResult>,
    #[serde(rename = "segment.lock")]
    pub segment_lock: MethodContract<SegmentLockParams, SegmentLockResult>,
    #[serde(rename = "tm.lookup")]
    pub tm_lookup: MethodContract<TmLookupParams, TmLookupResult>,
    #[serde(rename = "tm.list")]
    pub tm_list: MethodContract<TmListParams, TmListResult>,
    #[serde(rename = "tm.update")]
    pub tm_update: MethodContract<TmUpdateParams, TmUpdateResult>,
    #[serde(rename = "tm.delete")]
    pub tm_delete: MethodContract<TmDeleteParams, TmDeleteResult>,
    #[serde(rename = "tm.import")]
    pub tm_import: MethodContract<TmImportParams, TmImportResult>,
    #[serde(rename = "tm.export")]
    pub tm_export: MethodContract<TmExportParams, TmExportResult>,
    #[serde(rename = "tm.pretranslate")]
    pub tm_pretranslate: MethodContract<TmPretranslateParams, TmPretranslateResult>,
    #[serde(rename = "memory.create")]
    pub memory_create: MethodContract<MemoryCreateParams, tl_asset::Memory>,
    #[serde(rename = "memory.list")]
    pub memory_list: MethodContract<MemoryListParams, MemoryListResult>,
    #[serde(rename = "memory.attach")]
    pub memory_attach: MethodContract<MemoryAttachParams, MemoryAttachResult>,
    #[serde(rename = "memory.detach")]
    pub memory_detach: MethodContract<MemoryDetachParams, MemoryDetachResult>,
    #[serde(rename = "memory.update")]
    pub memory_update: MethodContract<MemoryUpdateParams, MemoryUpdateResult>,
    #[serde(rename = "memory.rename")]
    pub memory_rename: MethodContract<MemoryRenameParams, MemoryRenameResult>,
    #[serde(rename = "memory.delete")]
    pub memory_delete: MethodContract<MemoryDeleteParams, MemoryDeleteResult>,
    #[serde(rename = "termbase.create")]
    pub termbase_create: MethodContract<TermbaseCreateParams, tl_asset::Termbase>,
    #[serde(rename = "termbase.list")]
    pub termbase_list: MethodContract<TermbaseListParams, TermbaseListResult>,
    #[serde(rename = "termbase.attach")]
    pub termbase_attach: MethodContract<TermbaseAttachParams, TermbaseAttachResult>,
    #[serde(rename = "termbase.detach")]
    pub termbase_detach: MethodContract<TermbaseDetachParams, TermbaseDetachResult>,
    #[serde(rename = "termbase.update")]
    pub termbase_update: MethodContract<TermbaseUpdateParams, TermbaseUpdateResult>,
    #[serde(rename = "termbase.import")]
    pub termbase_import: MethodContract<TermbaseImportParams, TermbaseImportResult>,
    #[serde(rename = "termbase.export")]
    pub termbase_export: MethodContract<TermbaseExportParams, TermbaseExportResult>,
    #[serde(rename = "term.add")]
    pub term_add: MethodContract<TermAddParams, TermAddResult>,
    #[serde(rename = "term.update")]
    pub term_update: MethodContract<TermUpdateParams, TermUpdateResult>,
    #[serde(rename = "term.delete")]
    pub term_delete: MethodContract<TermDeleteParams, TermDeleteResult>,
    #[serde(rename = "term.list")]
    pub term_list: MethodContract<TermListParams, TermListResult>,
    #[serde(rename = "term.lookup")]
    pub term_lookup: MethodContract<TermLookupParams, TermLookupResult>,
    #[serde(rename = "qa.run")]
    pub qa_run: MethodContract<QaRunParams, QaRunResult>,
    #[serde(rename = "qa.list")]
    pub qa_list: MethodContract<QaListParams, QaListResult>,
    #[serde(rename = "qa.waive")]
    pub qa_waive: MethodContract<QaWaiveParams, QaWaiveResult>,
    #[serde(rename = "qa.fix.list")]
    pub qa_fix_list: MethodContract<QaFixListParams, QaFixListResult>,
    #[serde(rename = "qa.fix.apply")]
    pub qa_fix_apply: MethodContract<QaFixApplyParams, QaFixApplyResult>,
    #[serde(rename = "qa.profile.get")]
    pub qa_profile_get: MethodContract<QaProfileGetParams, QaProfileView>,
    #[serde(rename = "qa.profile.update")]
    pub qa_profile_update: MethodContract<QaProfileUpdateParams, QaProfileView>,
    #[serde(rename = "ai.configure")]
    pub ai_configure: MethodContract<AiConfigureParams, AiStatusResult>,
    #[serde(rename = "ai.status")]
    pub ai_status: MethodContract<AiStatusParams, AiStatusResult>,
    #[serde(rename = "ai.profile.add")]
    pub ai_profile_add: MethodContract<AiProfileAddParams, AiProfileListResult>,
    #[serde(rename = "ai.profile.list")]
    pub ai_profile_list: MethodContract<AiProfileListParams, AiProfileListResult>,
    #[serde(rename = "ai.profile.remove")]
    pub ai_profile_remove: MethodContract<AiProfileRemoveParams, AiProfileListResult>,
    #[serde(rename = "ai.assist.start")]
    pub ai_assist_start: MethodContract<AiAssistParams, AiAssistRunView>,
    #[serde(rename = "ai.assist.status")]
    pub ai_assist_status: MethodContract<AiAssistStatusParams, AiAssistRunView>,
    #[serde(rename = "ai.assist.cancel")]
    pub ai_assist_cancel: MethodContract<AiAssistCancelParams, AiAssistRunView>,
    #[serde(rename = "ai.agent.start")]
    pub ai_agent_start: MethodContract<AgentStartParams, AgentRunView>,
    #[serde(rename = "ai.agent.status")]
    pub ai_agent_status: MethodContract<AgentStatusParams, AgentRunView>,
    #[serde(rename = "ai.agent.review")]
    pub ai_agent_review: MethodContract<AgentReviewParams, AgentRunView>,
    #[serde(rename = "ai.agent.cancel")]
    pub ai_agent_cancel: MethodContract<AgentCancelParams, AgentRunView>,
}

/// Notification-name-keyed catalog for the reserved notification frames.
#[derive(JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct NotificationCatalog {
    #[serde(rename = "notify.engine.ready")]
    pub engine_ready: EngineReadyNotification,
    #[serde(rename = "notify.ai.agent.step")]
    pub agent_step: AgentStepNotification,
}

/// Root schema exported for the TypeScript contracts package.
///
/// The runtime stdout frame is `EngineFrame` (an internally tagged enum); its
/// constituent parts are exported here individually so the generated
/// TypeScript keeps their full field lists.
#[derive(JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolCatalog {
    pub request: RpcRequest,
    pub response: RpcResponse,
    pub notification: RpcNotification,
    pub error: RpcError,
    pub methods: RpcMethodCatalog,
    pub notifications: NotificationCatalog,
}

#[cfg(test)]
mod tests {
    use super::*;
    use schemars::schema_for;

    #[test]
    fn catalog_keys_match_method_constants() {
        let schema = schema_for!(RpcMethodCatalog);
        let value = serde_json::to_value(&schema).expect("schema to value");
        let properties = value["properties"].as_object().expect("properties");
        let expected = [
            methods::ENGINE_INITIALIZE,
            methods::ENGINE_SHUTDOWN,
            methods::PROJECT_CREATE,
            methods::PROJECT_LIST,
            methods::PROJECT_GET,
            methods::PROJECT_UPDATE,
            methods::PROJECT_ARCHIVE,
            methods::DOCUMENT_IMPORT,
            methods::DOCUMENT_LIST,
            methods::DOCUMENT_REMOVE,
            methods::DOCUMENT_EXPORT,
            methods::SEGMENT_LIST,
            methods::SEGMENT_UPDATE,
            methods::SEGMENT_UPDATE_SOURCE,
            methods::SEGMENT_REPLACE,
            methods::SEGMENT_CONFIRM,
            methods::SEGMENT_LOCK,
            methods::TM_LOOKUP,
            methods::TM_LIST,
            methods::TM_UPDATE,
            methods::TM_DELETE,
            methods::TM_IMPORT,
            methods::TM_EXPORT,
            methods::TM_PRETRANSLATE,
            methods::MEMORY_CREATE,
            methods::MEMORY_LIST,
            methods::MEMORY_ATTACH,
            methods::MEMORY_DETACH,
            methods::MEMORY_UPDATE,
            methods::MEMORY_RENAME,
            methods::MEMORY_DELETE,
            methods::TERMBASE_CREATE,
            methods::TERMBASE_LIST,
            methods::TERMBASE_ATTACH,
            methods::TERMBASE_DETACH,
            methods::TERMBASE_UPDATE,
            methods::TERMBASE_IMPORT,
            methods::TERMBASE_EXPORT,
            methods::TERM_ADD,
            methods::TERM_UPDATE,
            methods::TERM_DELETE,
            methods::TERM_LIST,
            methods::TERM_LOOKUP,
            methods::QA_RUN,
            methods::QA_LIST,
            methods::QA_WAIVE,
            methods::QA_FIX_LIST,
            methods::QA_FIX_APPLY,
            methods::QA_PROFILE_GET,
            methods::QA_PROFILE_UPDATE,
            methods::AI_CONFIGURE,
            methods::AI_STATUS,
            methods::AI_PROFILE_ADD,
            methods::AI_PROFILE_LIST,
            methods::AI_PROFILE_REMOVE,
            methods::AI_ASSIST_START,
            methods::AI_ASSIST_STATUS,
            methods::AI_ASSIST_CANCEL,
            methods::AI_AGENT_START,
            methods::AI_AGENT_STATUS,
            methods::AI_AGENT_REVIEW,
            methods::AI_AGENT_CANCEL,
        ];
        assert_eq!(properties.len(), expected.len());
        for method in expected {
            assert!(
                properties.contains_key(method),
                "missing catalog key {method}"
            );
        }
    }

    #[test]
    fn notification_keys_match_constants() {
        let schema = schema_for!(NotificationCatalog);
        let value = serde_json::to_value(&schema).expect("schema to value");
        let properties = value["properties"].as_object().expect("properties");
        assert!(properties.contains_key(notifications::ENGINE_READY));
        assert!(properties.contains_key(notifications::AGENT_STEP));
    }
}
