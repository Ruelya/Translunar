//! Phase 1 vertical slice: project -> DOCX import -> edit/confirm -> exact TM
//! -> number QA -> DOCX export, plus honest AI degradation without a key and
//! the asynchronous agent run driven end-to-end over a loopback SSE fixture.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tl_engine::{Engine, EngineEvent};
use tl_protocol::{
    AgentRunStatus, AgentRunView, AgentStartParams, AgentStepKind, AiAssistAction, AiAssistParams,
    AiAssistRunStatus, AiAssistRunView, AiProviderKind, AiStatusResult, DocumentExportResult,
    DocumentImportResult, DocumentRemoveResult, HarnessRunStatus, HarnessRunView, HarnessStepKind,
    InitializeResult, PROTOCOL_VERSION, QaRunResult, RpcErrorCode, RpcNotification, RpcRequest,
    SegmentConfirmResult, SegmentListResult, SegmentUpdateResult, SegmentUpdateSourceResult,
    TmLookupResult, methods,
};

fn fixture_docx() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/docx/m0-source.docx")
        .canonicalize()
        .expect("fixture exists")
}

fn call<T: serde::de::DeserializeOwned>(engine: &mut Engine, method: &str, params: Value) -> T {
    let response = engine.handle(
        RpcRequest {
            id: 1,
            method: method.to_string(),
            params,
        },
        &mut |_notification| {},
    );
    assert!(
        response.error.is_none(),
        "{method} failed: {:?}",
        response.error
    );
    serde_json::from_value(response.result.expect("result present")).expect("decode result")
}

fn call_err(engine: &mut Engine, method: &str, params: Value) -> RpcErrorCode {
    let response = engine.handle(
        RpcRequest {
            id: 1,
            method: method.to_string(),
            params,
        },
        &mut |_notification| {},
    );
    response.error.expect("expected an error").code
}

/// Loopback OpenAI-compatible SSE endpoint: every request gets `reply` back
/// as a single streamed delta after `delay`. Serves until the test ends.
fn spawn_sse_server(reply: &'static str, delay: Duration) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind SSE fixture");
    let address = listener.local_addr().expect("fixture address");
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0u8; content_length];
                let _ = reader.read_exact(&mut body);
                thread::sleep(delay);
                let payload = json!({"choices": [{"delta": {"content": reply}}]});
                let body = format!("data: {payload}\n\ndata: [DONE]\n\n");
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            });
        }
    });
    format!("http://{address}")
}

/// Loopback endpoint that walks a scripted list of replies: request N gets
/// reply N (the last reply repeats if the model asks again). Powers the
/// harness tool-loop test, where each turn must see a different tool call.
fn spawn_sequenced_sse_server(replies: Vec<&'static str>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind sequenced fixture");
    let address = listener.local_addr().expect("fixture address");
    let cursor = Arc::new(Mutex::new(0usize));
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let cursor = Arc::clone(&cursor);
            let replies = replies.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0u8; content_length];
                let _ = reader.read_exact(&mut body);
                let reply = {
                    let mut cursor = cursor.lock().expect("fixture cursor");
                    let index = (*cursor).min(replies.len() - 1);
                    *cursor += 1;
                    replies[index]
                };
                let payload = json!({"choices": [{"delta": {"content": reply}}]});
                let body = format!("data: {payload}\n\ndata: [DONE]\n\n");
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            });
        }
    });
    format!("http://{address}")
}

/// Loopback endpoint that answers every request with `body` as an SSE stream
/// and captures the raw request head + body so tests can assert which wire
/// protocol the engine actually spoke (path, auth header, JSON shape).
fn spawn_capturing_sse_server(body: &'static str) -> (String, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind capturing fixture");
    let address = listener.local_addr().expect("fixture address");
    let captured = Arc::new(Mutex::new(String::new()));
    let capture = Arc::clone(&captured);
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let capture = Arc::clone(&capture);
            thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().expect("clone fixture stream"));
                let mut request = String::new();
                let mut content_length = 0usize;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_length = value.trim().parse().unwrap_or(0);
                    }
                    request.push_str(&line);
                }
                let mut payload = vec![0u8; content_length];
                let _ = reader.read_exact(&mut payload);
                request.push_str(&String::from_utf8_lossy(&payload));
                *capture.lock().expect("capture fixture request") = request;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
            });
        }
    });
    (format!("http://{address}"), captured)
}

/// Loopback endpoint that accepts connections, swallows the request, and
/// never replies: the honest way to simulate a hung provider. Sockets stay
/// open until the test process exits.
fn spawn_hanging_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind hanging fixture");
    let address = listener.local_addr().expect("fixture address");
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            thread::spawn(move || {
                let mut sink = [0u8; 4096];
                while stream.read(&mut sink).is_ok_and(|bytes| bytes > 0) {
                    // Hold the socket open, never answer.
                }
            });
        }
    });
    format!("http://{address}")
}

fn configure_loopback_ai(engine: &mut Engine, base_url: &str) {
    let status: AiStatusResult = call(
        engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "openaiCompatible",
            "model": "fixture-model",
            "baseUrl": base_url,
            "apiKey": "fixture-key",
        }),
    );
    assert!(status.configured);
}

fn write_txt(directory: &Path, name: &str, contents: &str) -> PathBuf {
    let path = directory.join(name);
    std::fs::write(&path, contents).expect("write txt fixture");
    path
}

/// Pump agent worker events through the engine until the run leaves
/// `running`, mirroring what the stdio loop does in production.
fn drive_agent_run(
    engine: &mut Engine,
    events: &Receiver<EngineEvent>,
    run_id: &str,
    notifications: &mut Vec<RpcNotification>,
) -> AgentRunView {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let view: AgentRunView = call(engine, methods::AI_AGENT_STATUS, json!({ "runId": run_id }));
        if view.status != AgentRunStatus::Running {
            return view;
        }
        assert!(Instant::now() < deadline, "agent run timed out");
        match events.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => engine
                .handle_engine_event(event, &mut |notification| notifications.push(notification))
                .expect("engine event applies"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => panic!("engine event channel closed"),
        }
    }
}

/// Pump worker events through the engine until the harness run leaves
/// `running`, mirroring what the stdio loop does in production.
fn drive_harness_run(
    engine: &mut Engine,
    events: &Receiver<EngineEvent>,
    harness_id: &str,
    notifications: &mut Vec<RpcNotification>,
) -> HarnessRunView {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let view: HarnessRunView = call(
            engine,
            methods::AI_HARNESS_STATUS,
            json!({ "harnessId": harness_id }),
        );
        if view.status != HarnessRunStatus::Running {
            return view;
        }
        assert!(Instant::now() < deadline, "harness run timed out");
        match events.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => engine
                .handle_engine_event(event, &mut |notification| notifications.push(notification))
                .expect("engine event applies"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => panic!("engine event channel closed"),
        }
    }
}

/// Pump worker events through the engine until the assist run turns
/// terminal, mirroring what the stdio loop does in production.
fn wait_assist_terminal(
    engine: &mut Engine,
    events: &Receiver<EngineEvent>,
    assist_id: &str,
) -> AiAssistRunView {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let view: AiAssistRunView = call(
            engine,
            methods::AI_ASSIST_STATUS,
            json!({ "assistId": assist_id }),
        );
        if view.status.is_terminal() {
            return view;
        }
        assert!(Instant::now() < deadline, "assist run timed out");
        match events.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => engine
                .handle_engine_event(event, &mut |_notification| {})
                .expect("engine event applies"),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => panic!("engine event channel closed"),
        }
    }
}

/// Start an assist request and drive it to its terminal state.
fn drive_assist(
    engine: &mut Engine,
    events: &Receiver<EngineEvent>,
    params: Value,
) -> AiAssistRunView {
    let started: AiAssistRunView = call(engine, methods::AI_ASSIST_START, params);
    assert_eq!(started.status, AiAssistRunStatus::Running);
    assert!(started.result.is_none(), "start never carries a result");
    wait_assist_terminal(engine, events, &started.assist_id)
}

#[test]
fn vertical_slice_docx_roundtrip() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");

    // Handshake.
    let ready: InitializeResult = call(
        &mut engine,
        methods::ENGINE_INITIALIZE,
        json!({"protocolVersion": PROTOCOL_VERSION, "clientName": "test", "clientVersion": "0"}),
    );
    assert_eq!(ready.protocol_version, PROTOCOL_VERSION);
    assert!(
        ready
            .capabilities
            .filters
            .iter()
            .any(|f| f == "builtin.docx")
    );

    // Project.
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Demo", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );

    // DOCX import.
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": fixture_docx().display().to_string()}),
    );
    assert!(imported.segment_count > 0, "fixture yields segments");
    let document_id = imported.document.id.clone();

    // Grid editing.
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": document_id}),
    );
    let first = listed.segments[0].clone();
    let updated: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": first.id, "targetText": "第一句译文。", "baseRevision": first.revision}),
    );
    assert_eq!(updated.segment.state, tl_domain::SegmentState::Draft);

    // Stale revision is rejected.
    assert_eq!(
        call_err(
            &mut engine,
            methods::SEGMENT_UPDATE,
            json!({"segmentId": first.id, "targetText": "x", "baseRevision": first.revision}),
        ),
        RpcErrorCode::Conflict
    );

    // Confirm writes the exact TM.
    let confirmed: SegmentConfirmResult = call(
        &mut engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": first.id, "baseRevision": updated.segment.revision}),
    );
    assert_eq!(confirmed.segment.state, tl_domain::SegmentState::Confirmed);
    assert_eq!(
        confirmed.tm_entry.expect("confirm writes TM").target_text,
        "第一句译文。"
    );

    // Exact TM lookup hits for the same source text.
    let lookup: TmLookupResult = call(
        &mut engine,
        methods::TM_LOOKUP,
        json!({"projectId": project.id, "sourceText": first.source_text}),
    );
    assert_eq!(lookup.matches.len(), 1);
    assert_eq!(lookup.matches[0].score, 100);

    // Number QA: write a target with a wrong number into a segment that has one.
    let with_number = listed
        .segments
        .iter()
        .find(|segment| !tl_domain::number_tokens(&segment.source_text).is_empty())
        .expect("fixture has a numeric segment")
        .clone();
    if with_number.id != first.id {
        let _: SegmentUpdateResult = call(
            &mut engine,
            methods::SEGMENT_UPDATE,
            json!({"segmentId": with_number.id, "targetText": "保留期为 999 天。", "baseRevision": with_number.revision}),
        );
    }
    let qa: QaRunResult = call(
        &mut engine,
        methods::QA_RUN,
        json!({"documentId": document_id}),
    );
    assert!(qa.open_issues >= 1, "number mismatch is detected");

    // Export.
    let output = workspace.path().join("translated.docx");
    let exported: DocumentExportResult = call(
        &mut engine,
        methods::DOCUMENT_EXPORT,
        json!({"documentId": document_id, "outputPath": output.display().to_string()}),
    );
    assert!(output.is_file(), "export file exists");
    assert!(exported.translated_segments >= 1);

    // Existing output path is refused instead of overwritten.
    assert_eq!(
        call_err(
            &mut engine,
            methods::DOCUMENT_EXPORT,
            json!({"documentId": document_id, "outputPath": output.display().to_string()}),
        ),
        RpcErrorCode::ExportBlocked
    );

    // An explicit overwrite replaces the blocked file (staged sibling temp +
    // atomic rename), still through the real filter pipeline.
    let overwritten: DocumentExportResult = call(
        &mut engine,
        methods::DOCUMENT_EXPORT,
        json!({
            "documentId": document_id,
            "outputPath": output.display().to_string(),
            "overwrite": true,
        }),
    );
    assert_eq!(overwritten.output_path, output.display().to_string());
    assert!(overwritten.translated_segments >= 1);
    assert!(output.is_file(), "overwritten export file exists");

    // Even with overwrite, the engine never replaces a file inside its own
    // data directory: project state lives there.
    assert_eq!(
        call_err(
            &mut engine,
            methods::DOCUMENT_EXPORT,
            json!({
                "documentId": document_id,
                "outputPath": workspace.path().join("data/engine.sqlite").display().to_string(),
                "overwrite": true,
            }),
        ),
        RpcErrorCode::ExportBlocked
    );
}

#[test]
fn segment_source_editing_guards_and_honest_demotion() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Source", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": fixture_docx().display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let first = listed.segments[0].clone();

    // Rewrite the source: revision bumps, state is untouched for an
    // unconfirmed row, and the stored source hash follows the new text.
    let rewritten: SegmentUpdateSourceResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE_SOURCE,
        json!({
            "segmentId": first.id,
            "sourceText": "Corrected source sentence.",
            "baseRevision": first.revision,
        }),
    );
    assert_eq!(rewritten.segment.source_text, "Corrected source sentence.");
    assert_eq!(rewritten.segment.revision, first.revision + 1);
    assert_eq!(rewritten.segment.state, first.state);
    assert_ne!(rewritten.segment.source_hash, first.source_hash);

    // Stale revision conflicts, exactly like segment.update.
    assert_eq!(
        call_err(
            &mut engine,
            methods::SEGMENT_UPDATE_SOURCE,
            json!({
                "segmentId": first.id,
                "sourceText": "Stale write.",
                "baseRevision": first.revision,
            }),
        ),
        RpcErrorCode::Conflict
    );

    // An empty source is meaningless and refused.
    assert_eq!(
        call_err(
            &mut engine,
            methods::SEGMENT_UPDATE_SOURCE,
            json!({
                "segmentId": first.id,
                "sourceText": "   ",
                "baseRevision": rewritten.segment.revision,
            }),
        ),
        RpcErrorCode::InvalidParams
    );

    // Confirm the row, then rewrite the source again: the confirmation
    // covered the old source, so the segment honestly returns to draft.
    let updated: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({
            "segmentId": first.id,
            "targetText": "修正后的译文。",
            "baseRevision": rewritten.segment.revision,
        }),
    );
    let confirmed: SegmentConfirmResult = call(
        &mut engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": first.id, "baseRevision": updated.segment.revision}),
    );
    assert_eq!(confirmed.segment.state, tl_domain::SegmentState::Confirmed);
    let demoted: SegmentUpdateSourceResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE_SOURCE,
        json!({
            "segmentId": first.id,
            "sourceText": "Corrected source sentence, again.",
            "baseRevision": confirmed.segment.revision,
        }),
    );
    assert_eq!(demoted.segment.state, tl_domain::SegmentState::Draft);
    // The target text belongs to the translator; the rewrite keeps it.
    assert_eq!(demoted.segment.target_text, "修正后的译文。");

    // A locked row refuses the rewrite.
    let locked: tl_protocol::SegmentLockResult = call(
        &mut engine,
        methods::SEGMENT_LOCK,
        json!({
            "segmentId": first.id,
            "locked": true,
            "baseRevision": demoted.segment.revision,
        }),
    );
    assert_eq!(
        call_err(
            &mut engine,
            methods::SEGMENT_UPDATE_SOURCE,
            json!({
                "segmentId": first.id,
                "sourceText": "Locked write.",
                "baseRevision": locked.segment.revision,
            }),
        ),
        RpcErrorCode::Conflict
    );
}

#[test]
fn harness_tool_loop_drives_a_whole_document_run() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Harness", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "harness.txt",
        "Hello {count} world.\n\nSecond sentence here.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let document_id = imported.document.id.clone();

    // Honest degradation: no provider, no run.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_HARNESS_START,
            json!({ "documentId": document_id }),
        ),
        RpcErrorCode::AiNotConfigured
    );

    // The scripted conversation: survey → a tag-breaking draft the engine
    // must refuse → the corrected draft → a note → finish (fenced JSON).
    let base_url = spawn_sequenced_sse_server(vec![
        r#"{"tool":"read_segments","args":{"offset":0,"limit":10}}"#,
        r#"{"tool":"write_draft","args":{"ordinal":1,"targetText":"你好，世界。"}}"#,
        r#"{"tool":"write_draft","args":{"ordinal":1,"targetText":"你好 {count} 世界。"}}"#,
        r#"{"tool":"note","args":{"text":"第 1 段含占位符 {count}，已保留。"}}"#,
        "```json\n{\"tool\":\"finish\",\"args\":{\"summary\":\"完成 1 段草稿，第 2 段留待人工。\"}}\n```",
    ]);
    configure_loopback_ai(&mut engine, &base_url);

    let started: HarnessRunView = call(
        &mut engine,
        methods::AI_HARNESS_START,
        json!({ "documentId": document_id, "instruction": "翻译全文", "maxTurns": 10 }),
    );
    assert_eq!(started.status, HarnessRunStatus::Running);
    assert_eq!(started.max_turns, 10);

    let mut notifications = Vec::new();
    let view = drive_harness_run(
        &mut engine,
        &events,
        &started.harness_id,
        &mut notifications,
    );

    // Terminal at the human review gate, with the model's own summary.
    assert_eq!(view.status, HarnessRunStatus::AwaitingReview);
    assert!(
        view.summary
            .as_deref()
            .unwrap_or("")
            .contains("完成 1 段草稿")
    );
    assert_eq!(view.drafted_segments, 1);
    assert_eq!(view.notes.len(), 1);
    assert_eq!(view.turns_used, 5);

    // The tag-breaking draft was refused; the corrected one landed as an
    // aiDraft-stamped draft. The engine never confirmed anything.
    let refused = view.steps.iter().any(|step| {
        step.kind == HarnessStepKind::Draft
            && step.status == tl_protocol::AgentStepStatus::Failed
            && step.detail.contains("占位符")
    });
    assert!(refused, "tag-integrity refusal is an observable step");
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": document_id}),
    );
    let first = &listed.segments[0];
    assert_eq!(first.target_text, "你好 {count} 世界。");
    assert_eq!(first.state, tl_domain::SegmentState::Draft);
    assert_eq!(
        first.origin.as_ref().map(|origin| origin.kind),
        Some(tl_domain::SegmentOriginKind::AiDraft)
    );
    assert_eq!(
        listed.segments[1].state,
        tl_domain::SegmentState::Untranslated
    );

    // Steps streamed over the reserved harness notification.
    assert!(
        notifications
            .iter()
            .any(|notification| notification.method == "notify.ai.harness.step"),
        "harness steps stream as notifications"
    );
}

#[test]
fn state_survives_reopen() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let data_dir = workspace.path().join("data");
    {
        let mut engine = Engine::open(&data_dir).expect("open engine");
        let _: tl_domain::Project = call(
            &mut engine,
            methods::PROJECT_CREATE,
            json!({"name": "Persisted", "sourceLocale": "en-US", "targetLocale": "de-DE"}),
        );
    }
    let mut engine = Engine::open(&data_dir).expect("reopen engine");
    let listed: tl_protocol::ProjectListResult =
        call(&mut engine, methods::PROJECT_LIST, json!({}));
    assert_eq!(listed.projects.len(), 1);
    assert_eq!(listed.projects[0].name, "Persisted");
}

#[test]
fn ai_degrades_honestly_without_credentials() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "AI", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": fixture_docx().display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );

    // Status reports unconfigured.
    let status: AiStatusResult = call(&mut engine, methods::AI_STATUS, json!({}));
    assert!(!status.configured);

    // Assist refuses to start instead of fabricating a translation.
    let params = serde_json::to_value(AiAssistParams {
        segment_id: listed.segments[0].id.clone(),
        action: AiAssistAction::Translate,
        instruction: None,
        profile_id: None,
    })
    .expect("params");
    assert_eq!(
        call_err(&mut engine, methods::AI_ASSIST_START, params),
        RpcErrorCode::AiNotConfigured
    );

    // The agent refuses to start a run it cannot execute.
    let params = serde_json::to_value(AgentStartParams {
        document_id: imported.document.id.clone(),
        instruction: None,
        max_segments: None,
        approval_mode: Default::default(),
        segment_ids: None,
        profile_id: None,
    })
    .expect("params");
    assert_eq!(
        call_err(&mut engine, methods::AI_AGENT_START, params),
        RpcErrorCode::AiNotConfigured
    );

    // A bad key is rejected at configure time, before any provider call.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_CONFIGURE,
            json!({"provider": "openai", "model": "gpt-test", "apiKey": "  "}),
        ),
        RpcErrorCode::InvalidParams
    );
}

#[test]
fn ai_assist_checks_tag_integrity_and_never_touches_confirmed_segments() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "assist.txt",
        "Click {button} to continue.\n\nPlain sentence here.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let tagged = listed
        .segments
        .iter()
        .find(|segment| segment.source_text.contains("{button}"))
        .expect("tagged segment")
        .clone();
    let plain = listed
        .segments
        .iter()
        .find(|segment| segment.source_text.contains("Plain sentence"))
        .expect("plain segment")
        .clone();

    // A proposal that drops the {button} placeholder is flagged as broken.
    let broken_url = spawn_sse_server("点击按钮继续。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &broken_url);
    let broken = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": tagged.id, "action": "translate"}),
    );
    assert_eq!(broken.status, AiAssistRunStatus::Done);
    let broken = broken.result.expect("done run carries the proposal");
    assert!(!broken.tag_check.ok);
    assert_eq!(broken.tag_check.missing, vec!["{button}".to_string()]);
    assert!(broken.tag_check.extra.is_empty());

    // A proposal that carries the placeholder through passes the check.
    let intact_url = spawn_sse_server("点击 {button} 继续。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &intact_url);
    let intact = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": tagged.id, "action": "translate"}),
    );
    assert_eq!(intact.status, AiAssistRunStatus::Done);
    let intact = intact.result.expect("done run carries the proposal");
    assert!(intact.tag_check.ok);
    assert_eq!(intact.draft_target, "点击 {button} 继续。");

    // Refine requires an existing target; the request never starts.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": plain.id, "action": "refine"}),
        ),
        RpcErrorCode::InvalidParams
    );

    // Confirmed segments are off limits for AI assist entirely.
    let updated: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": plain.id, "targetText": "普通句子。", "baseRevision": plain.revision}),
    );
    let confirmed: SegmentConfirmResult = call(
        &mut engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": plain.id, "baseRevision": updated.segment.revision}),
    );
    assert_eq!(confirmed.segment.state, tl_domain::SegmentState::Confirmed);
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": plain.id, "action": "translate"}),
        ),
        RpcErrorCode::Conflict
    );
}

#[test]
fn ai_assist_runs_off_the_rpc_thread_and_other_calls_answer_meanwhile() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Async assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "async-assist.txt",
        "Assist must not block the grid.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let segment = listed.segments[0].clone();

    // The provider sleeps before answering; a blocking assist would freeze
    // every call below for the whole delay.
    let delay = Duration::from_millis(1_500);
    let base_url = spawn_sse_server("异步草稿。", delay);
    configure_loopback_ai(&mut engine, &base_url);

    let clock = Instant::now();
    let started: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate"}),
    );
    assert_eq!(started.status, AiAssistRunStatus::Running);

    // Unrelated RPC traffic keeps flowing while the provider call is in
    // flight: project listing, grid reads, TM lookups, status polls.
    let projects: tl_protocol::ProjectListResult =
        call(&mut engine, methods::PROJECT_LIST, json!({}));
    assert_eq!(projects.projects.len(), 1);
    let grid: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(grid.segments.len(), 1);
    let lookup: TmLookupResult = call(
        &mut engine,
        methods::TM_LOOKUP,
        json!({"projectId": project.id, "sourceText": segment.source_text}),
    );
    assert_eq!(lookup.total_matches, 0);
    let polled: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_STATUS,
        json!({"assistId": started.assist_id}),
    );
    assert_eq!(polled.status, AiAssistRunStatus::Running);
    assert!(
        clock.elapsed() < delay,
        "RPC calls answered while the provider was still sleeping ({:?})",
        clock.elapsed()
    );

    // A second assist for the same segment is refused while one is running.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": segment.id, "action": "translate"}),
        ),
        RpcErrorCode::Conflict
    );

    let finished = wait_assist_terminal(&mut engine, &events, &started.assist_id);
    assert_eq!(finished.status, AiAssistRunStatus::Done);
    let result = finished.result.expect("done run carries the proposal");
    assert_eq!(result.draft_target, "异步草稿。");
    assert!(result.tag_check.ok);

    // Assist only proposes: the segment itself was never written.
    let after: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(
        after.segments[0].state,
        tl_domain::SegmentState::Untranslated
    );
    assert!(after.segments[0].target_text.is_empty());
}

#[test]
fn ai_assist_cancel_discards_late_results_and_frees_the_segment() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Cancel assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(workspace.path(), "cancel-assist.txt", "One sentence.\n");
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let segment = listed.segments[0].clone();

    let base_url = spawn_sse_server("慢速候选。", Duration::from_millis(600));
    configure_loopback_ai(&mut engine, &base_url);

    let first: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate"}),
    );
    let canceled: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_CANCEL,
        json!({"assistId": first.assist_id}),
    );
    assert!(canceled.cancel_requested);

    // A cancel-requested run no longer blocks a retry on the same segment.
    let second: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate"}),
    );
    assert_eq!(second.status, AiAssistRunStatus::Running);

    // Even if the first provider call completes, its result is discarded.
    let first_finished = wait_assist_terminal(&mut engine, &events, &first.assist_id);
    assert_eq!(first_finished.status, AiAssistRunStatus::Canceled);
    assert!(first_finished.result.is_none());

    let second_finished = wait_assist_terminal(&mut engine, &events, &second.assist_id);
    assert_eq!(second_finished.status, AiAssistRunStatus::Done);
    assert_eq!(
        second_finished
            .result
            .expect("second run result")
            .draft_target,
        "慢速候选。"
    );

    // Unknown assist runs are a NotFound, not a silent success.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_STATUS,
            json!({"assistId": "missing"}),
        ),
        RpcErrorCode::NotFound
    );
}

#[test]
fn ai_assist_reports_provider_failure_honestly() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Failing assist", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(workspace.path(), "failing-assist.txt", "A sentence.\n");
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );

    // Bind a port, then drop the listener: connections are refused.
    let dead_url = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind dead port");
        format!("http://{}", listener.local_addr().expect("dead address"))
    };
    configure_loopback_ai(&mut engine, &dead_url);

    let finished = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[0].id, "action": "translate"}),
    );
    assert_eq!(finished.status, AiAssistRunStatus::Failed);
    assert!(finished.result.is_none(), "failed runs carry no proposal");
    let message = finished.error_message.expect("failure reason");
    assert!(
        message.contains("unavailable"),
        "honest provider error, got: {message}"
    );
}

#[test]
fn agent_run_pretranslates_drafts_and_parks_at_the_human_gate() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Agent", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );

    // Seed the project TM through the normal human confirm path.
    let seed = write_txt(workspace.path(), "seed.txt", "Shared sentence here.\n");
    let seeded: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": seed.display().to_string()}),
    );
    let seed_segments: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": seeded.document.id}),
    );
    let seed_segment = seed_segments.segments[0].clone();
    let updated: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": seed_segment.id, "targetText": "这里是共享句子。", "baseRevision": seed_segment.revision}),
    );
    let _: SegmentConfirmResult = call(
        &mut engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": seed_segment.id, "baseRevision": updated.segment.revision}),
    );

    // The work document: one TM hit, one plain miss, one numeric miss.
    let work = write_txt(
        workspace.path(),
        "work.txt",
        "Shared sentence here.\n\nUnique alpha sentence.\n\nNumbers 42 stay intact.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    assert_eq!(imported.segment_count, 3);

    // The fixture reply carries no numbers, so number QA must flag the
    // numeric segment afterwards.
    let base_url = spawn_sse_server("机器草稿译文。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &base_url);

    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "instruction": "保持术语一致", "approvalMode": "auto"}),
    );
    assert_eq!(run.status, AgentRunStatus::Running);
    assert_eq!(run.planned_segments, 3);
    assert_eq!(run.tm_applied, 1, "exact TM hit is applied at start");
    assert!(run.steps.iter().any(|step| step.kind == AgentStepKind::Tm));

    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);

    // The run parks at the human gate: drafts exist, nothing is confirmed,
    // nothing is exported.
    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished.ai_drafted, 2);
    assert_eq!(finished.failed_segments, 0);
    assert!(finished.open_qa_issues >= 1, "number QA flags the fixture");
    let kinds: Vec<AgentStepKind> = finished.steps.iter().map(|step| step.kind).collect();
    assert_eq!(kinds[0], AgentStepKind::Plan);
    assert!(kinds.contains(&AgentStepKind::Qa));
    assert_eq!(*kinds.last().expect("steps"), AgentStepKind::Summary);

    let segments: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    for segment in &segments.segments {
        assert_eq!(
            segment.state,
            tl_domain::SegmentState::Draft,
            "agent leaves drafts, never confirms"
        );
        assert!(!segment.target_text.trim().is_empty());
    }

    // Step notifications stream while the worker runs and carry the run
    // status so clients can observe the terminal transition.
    assert!(!notifications.is_empty());
    let last = notifications.last().expect("last notification");
    assert_eq!(last.method, "notify.ai.agent.step");
    assert_eq!(last.params["runStatus"], "awaitingReview");
}

#[test]
fn agent_runs_on_different_documents_proceed_concurrently() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Concurrent", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let first_doc = write_txt(
        workspace.path(),
        "concurrent-a.txt",
        "Alpha sentence one.\n\nAlpha sentence two.\n",
    );
    let second_doc = write_txt(
        workspace.path(),
        "concurrent-b.txt",
        "Beta sentence one.\n\nBeta sentence two.\n",
    );
    let imported_a: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": first_doc.display().to_string()}),
    );
    let imported_b: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": second_doc.display().to_string()}),
    );

    // Slow fixture so the first run is still in flight when the second starts.
    let base_url = spawn_sse_server("并发草稿。", Duration::from_millis(400));
    configure_loopback_ai(&mut engine, &base_url);

    let run_a: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported_a.document.id, "approvalMode": "auto"}),
    );
    assert_eq!(run_a.status, AgentRunStatus::Running);

    // Same document while running: honest Conflict.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_START,
            json!({"documentId": imported_a.document.id, "approvalMode": "auto"}),
        ),
        RpcErrorCode::Conflict
    );

    // A different document does not fight: the second run starts at once.
    let run_b: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported_b.document.id, "approvalMode": "auto"}),
    );
    assert_eq!(run_b.status, AgentRunStatus::Running);
    assert_ne!(run_a.run_id, run_b.run_id, "each job has its own run id");

    // Both runs park at the human gate; status stays addressable per run id.
    let mut notifications = Vec::new();
    let finished_a = drive_agent_run(&mut engine, &events, &run_a.run_id, &mut notifications);
    let finished_b = drive_agent_run(&mut engine, &events, &run_b.run_id, &mut notifications);
    assert_eq!(finished_a.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished_b.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished_a.ai_drafted, 2);
    assert_eq!(finished_b.ai_drafted, 2);

    // Both documents got drafts, nothing was confirmed anywhere.
    for document_id in [&imported_a.document.id, &imported_b.document.id] {
        let segments: SegmentListResult = call(
            &mut engine,
            methods::SEGMENT_LIST,
            json!({"documentId": document_id}),
        );
        for segment in &segments.segments {
            assert_eq!(segment.state, tl_domain::SegmentState::Draft);
        }
    }

    // Once the first run is terminal, its document is free again.
    let rerun: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported_a.document.id, "approvalMode": "auto"}),
    );
    assert_eq!(rerun.planned_segments, 0, "nothing left to draft");
}

#[test]
fn agent_drafts_segments_in_parallel_within_one_run() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Parallel", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "parallel.txt",
        "Parallel one.\n\nParallel two.\n\nParallel three.\n\nParallel four.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    assert_eq!(imported.segment_count, 4);

    // 4 segments x 600 ms: serial drafting needs >= 2.4 s, the worker pool
    // finishes in roughly one round trip.
    let delay = Duration::from_millis(600);
    let base_url = spawn_sse_server("并行草稿。", delay);
    configure_loopback_ai(&mut engine, &base_url);

    let clock = Instant::now();
    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "approvalMode": "auto"}),
    );
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    let elapsed = clock.elapsed();

    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished.ai_drafted, 4);
    assert_eq!(finished.failed_segments, 0);
    assert!(
        elapsed < delay * 4,
        "worker pool drafts segments concurrently; serial would need >= {:?}, got {elapsed:?}",
        delay * 4
    );
}

#[test]
fn agent_cancel_aborts_in_flight_provider_calls_without_waiting_for_the_timeout() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Abort", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "abort.txt",
        "Hang one.\n\nHang two.\n\nHang three.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );

    // The provider never answers; the runtime profile timeout is 60 s. A
    // cooperative-only cancel would leave the run "running" for the whole
    // timeout; the abortive cancel must turn it terminal within seconds.
    let base_url = spawn_hanging_server();
    configure_loopback_ai(&mut engine, &base_url);

    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "approvalMode": "auto"}),
    );
    assert_eq!(run.status, AgentRunStatus::Running);

    // Let the workers actually enter their provider calls before canceling.
    std::thread::sleep(Duration::from_millis(300));
    let clock = Instant::now();
    let canceled: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_CANCEL,
        json!({"runId": run.run_id}),
    );
    assert!(canceled.cancel_requested);

    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::Canceled);
    assert_eq!(finished.ai_drafted, 0, "hung calls never produce drafts");
    assert!(
        clock.elapsed() < Duration::from_secs(5),
        "cancel aborted in-flight HTTP in {:?}, far below the 60 s provider timeout",
        clock.elapsed()
    );

    // The canceled run frees its document for a fresh start.
    let rerun: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "approvalMode": "auto"}),
    );
    assert_eq!(rerun.status, AgentRunStatus::Running);
    let _: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_CANCEL,
        json!({"runId": rerun.run_id}),
    );
    let finished_rerun = drive_agent_run(&mut engine, &events, &rerun.run_id, &mut notifications);
    assert_eq!(finished_rerun.status, AgentRunStatus::Canceled);
}

#[test]
fn agent_run_cancels_mid_run_and_same_document_run_conflicts() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Cancel", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "cancel.txt",
        "First sentence one.\n\nSecond sentence two.\n\nThird sentence three.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );

    // Slow fixture so cancellation lands while drafting is still in flight.
    let base_url = spawn_sse_server("慢速草稿。", Duration::from_millis(400));
    configure_loopback_ai(&mut engine, &base_url);

    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "approvalMode": "auto"}),
    );
    assert_eq!(run.status, AgentRunStatus::Running);

    // A second run on the same document cannot start while one is in flight.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_START,
            json!({"documentId": imported.document.id, "approvalMode": "auto"}),
        ),
        RpcErrorCode::Conflict
    );

    // Removing the document out from under the live run is refused the same
    // honest way — its workers still land drafts on these segments.
    assert_eq!(
        call_err(
            &mut engine,
            methods::DOCUMENT_REMOVE,
            json!({"documentId": imported.document.id}),
        ),
        RpcErrorCode::Conflict
    );

    let canceled: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_CANCEL,
        json!({"runId": run.run_id}),
    );
    assert!(canceled.cancel_requested);

    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::Canceled);
    assert!(
        finished.ai_drafted < 3,
        "cancellation stops before the whole document is drafted"
    );
    assert!(
        finished
            .steps
            .iter()
            .any(|step| step.kind == AgentStepKind::Cancel),
        "cancel step is observable"
    );

    // Unknown runs are a NotFound, not a silent success.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_STATUS,
            json!({"runId": "missing"})
        ),
        RpcErrorCode::NotFound
    );

    // Once the run is terminal the document can be removed.
    let removed: DocumentRemoveResult = call(
        &mut engine,
        methods::DOCUMENT_REMOVE,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(removed.document.id, imported.document.id);
}

/// The `ai.configure` provider selector is real: `gemini` speaks the native
/// Google Generative Language API and `anthropic` speaks the Messages API.
/// Both run against loopback mocks — no real key or endpoint is involved —
/// and the captured wire traffic proves the protocol switch, not just the
/// label in `ai.status`.
#[test]
fn ai_configure_routes_native_gemini_and_anthropic_protocols() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Providers", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "providers.txt",
        "First provider sentence.\n\nSecond provider sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert!(listed.segments.len() >= 2, "two segments to assist");

    // Gemini: streamGenerateContent with the key in the query string, and a
    // candidates/parts SSE payload instead of the OpenAI delta shape.
    let gemini_body = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"双子座草稿。\"}]}}]}\n\n",
        "data: {\"usageMetadata\":{\"promptTokenCount\":7,\"candidatesTokenCount\":3}}\n\n"
    );
    let (gemini_url, gemini_captured) = spawn_capturing_sse_server(gemini_body);
    let status: AiStatusResult = call(
        &mut engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "gemini",
            "model": "gemini-fixture",
            "baseUrl": gemini_url,
            "apiKey": "fixture-gemini-key",
        }),
    );
    assert!(status.configured);
    assert_eq!(status.provider, Some(AiProviderKind::Gemini));
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[0].id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    let result = done.result.expect("gemini run carries the proposal");
    assert_eq!(result.draft_target, "双子座草稿。");
    assert_eq!(result.provider, AiProviderKind::Gemini);
    assert_eq!(result.model, "gemini-fixture");
    let request = gemini_captured
        .lock()
        .expect("captured gemini request")
        .clone();
    assert!(
        request.contains("/models/gemini-fixture:streamGenerateContent"),
        "gemini speaks the native generateContent route, got: {request}"
    );
    assert!(request.contains("alt=sse"), "gemini asks for SSE framing");
    assert!(
        request.contains("key=fixture-gemini-key"),
        "gemini carries the key as a query parameter"
    );
    assert!(
        !request.contains("chat/completions"),
        "gemini must not fall back to the OpenAI route"
    );
    assert!(
        request.contains("\"contents\""),
        "gemini body uses contents/parts, got: {request}"
    );

    // Anthropic: /v1/messages with the x-api-key header and the Messages
    // API event stream. Reconfiguring swaps the runtime wholesale.
    let anthropic_body = concat!(
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":5}}}\n\n",
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"人择草稿。\"}}\n\n",
        "data: {\"type\":\"message_stop\"}\n\n"
    );
    let (anthropic_url, anthropic_captured) = spawn_capturing_sse_server(anthropic_body);
    let status: AiStatusResult = call(
        &mut engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "anthropic",
            "model": "claude-fixture",
            "baseUrl": anthropic_url,
            "apiKey": "fixture-anthropic-key",
        }),
    );
    assert!(status.configured);
    assert_eq!(status.provider, Some(AiProviderKind::Anthropic));
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[1].id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    let result = done.result.expect("anthropic run carries the proposal");
    assert_eq!(result.draft_target, "人择草稿。");
    assert_eq!(result.provider, AiProviderKind::Anthropic);
    let request = anthropic_captured
        .lock()
        .expect("captured anthropic request")
        .clone();
    assert!(
        request.contains("POST /v1/messages"),
        "anthropic speaks the Messages API, got: {request}"
    );
    assert!(
        request
            .to_ascii_lowercase()
            .contains("x-api-key: fixture-anthropic-key"),
        "anthropic authenticates via x-api-key"
    );
    assert!(
        request.to_ascii_lowercase().contains("anthropic-version:"),
        "anthropic pins its API version header"
    );
    assert!(
        !request.contains("chat/completions"),
        "anthropic must not fall back to the OpenAI route"
    );
}

/// `openaiResponses` speaks the OpenAI Responses API: `POST {base}/responses`
/// with an `input` item list, streamed `response.output_text.delta` events,
/// and usage on the terminal `response.completed` envelope. The captured
/// loopback wire proves the route — the existing `openaiCompatible`
/// chat-completions path stays untouched.
#[test]
fn ai_configure_routes_openai_responses_protocol() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Responses", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "responses.txt",
        "Responses provider sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert!(!listed.segments.is_empty(), "one segment to assist");

    let responses_body = concat!(
        "data: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"应答草稿。\"}\n\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"应答草稿。\"}]}],\"usage\":{\"input_tokens\":9,\"output_tokens\":4}}}\n\n"
    );
    let (responses_url, responses_captured) = spawn_capturing_sse_server(responses_body);
    let status: AiStatusResult = call(
        &mut engine,
        methods::AI_CONFIGURE,
        json!({
            "provider": "openaiResponses",
            "model": "responses-fixture",
            "baseUrl": format!("{responses_url}/v1"),
            "apiKey": "fixture-responses-key",
        }),
    );
    assert!(status.configured);
    assert_eq!(status.provider, Some(AiProviderKind::OpenaiResponses));
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": listed.segments[0].id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    let result = done.result.expect("responses run carries the proposal");
    assert_eq!(result.draft_target, "应答草稿。");
    assert_eq!(result.provider, AiProviderKind::OpenaiResponses);
    assert_eq!(result.model, "responses-fixture");
    let request = responses_captured
        .lock()
        .expect("captured responses request")
        .clone();
    assert!(
        request.contains("POST /v1/responses HTTP"),
        "openaiResponses speaks the Responses route, got: {request}"
    );
    assert!(
        !request.contains("chat/completions"),
        "openaiResponses must not fall back to the chat-completions route"
    );
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer fixture-responses-key"),
        "openaiResponses authenticates with the bearer key"
    );
    assert!(
        request.contains("\"input\""),
        "Responses body carries input items, got: {request}"
    );
    assert!(
        !request.contains("\"messages\""),
        "Responses body must not reuse the chat-completions messages field"
    );
}

#[test]
fn ready_notification_reports_engine_identity() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let RpcNotification { method, params } = engine.ready_notification();
    assert_eq!(method, tl_protocol::notifications::ENGINE_READY);
    assert_eq!(params["engineName"], "tl-engine");
    assert_eq!(params["protocolVersion"], PROTOCOL_VERSION);
}

/// Locked segments are invisible to the AI surfaces: the agent never plans
/// or drafts them, and assist on a locked row is an honest conflict.
#[test]
fn agent_and_assist_leave_locked_segments_alone() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Locked", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "locked.txt",
        "Locked alpha sentence.\n\nFree bravo sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    let segments: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let locked_row = segments.segments[0].clone();
    let _: Value = call(
        &mut engine,
        methods::SEGMENT_LOCK,
        json!({"segmentId": locked_row.id, "locked": true, "baseRevision": locked_row.revision}),
    );

    let base_url = spawn_sse_server("机器草稿译文。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &base_url);

    // Assist on the locked row: conflict before any provider call.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": locked_row.id, "action": "translate"}),
        ),
        RpcErrorCode::Conflict
    );

    // The agent plans only the unlocked row and drafts exactly it.
    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "approvalMode": "auto"}),
    );
    assert_eq!(run.planned_segments, 1, "locked row is never planned");
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished.ai_drafted, 1);

    let after: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert!(after.segments[0].locked);
    assert_eq!(after.segments[0].target_text, "", "locked row stays empty");
    assert_eq!(
        after.segments[0].state,
        tl_domain::SegmentState::Untranslated
    );
    assert_eq!(after.segments[1].target_text, "机器草稿译文。");
    assert_eq!(after.segments[1].state, tl_domain::SegmentState::Draft);
}

/// Manual mode (the default) queues AI candidates as proposals and writes
/// nothing until `ai.agent.review`: apply lands the draft through the same
/// guards as auto mode, reject records the decision, and a row a human
/// touched meanwhile turns stale — human state wins.
#[test]
fn agent_manual_mode_queues_proposals_until_a_human_reviews_them() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Manual", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "manual.txt",
        "Alpha sentence.\n\nBravo sentence.\n\nCharlie sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    let base_url = spawn_sse_server("人工审批候选。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &base_url);

    // No approvalMode in the params: manual is the wire default.
    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(run.approval_mode, tl_protocol::AgentApprovalMode::Manual);
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);

    // Nothing was written: candidates are proposals, the grid is untouched.
    assert_eq!(finished.ai_drafted, 0);
    assert_eq!(finished.proposals.len(), 3);
    assert!(
        finished
            .proposals
            .iter()
            .all(|proposal| proposal.status == tl_protocol::AgentProposalStatus::Pending)
    );
    assert_eq!(finished.processed_segments, finished.planned_segments);
    let untouched: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    for segment in &untouched.segments {
        assert_eq!(segment.state, tl_domain::SegmentState::Untranslated);
        assert_eq!(segment.target_text, "");
    }
    let first = untouched.segments[0].clone();
    let second = untouched.segments[1].clone();
    let third = untouched.segments[2].clone();

    // A human edits the third row before its proposal is applied.
    let _: SegmentUpdateResult = call(
        &mut engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": third.id, "targetText": "人工译文。", "baseRevision": third.revision}),
    );

    // Approve the first: the draft lands with an aiDraft origin.
    let reviewed: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_REVIEW,
        json!({"runId": run.run_id, "segmentIds": [first.id], "decision": "apply"}),
    );
    assert_eq!(reviewed.ai_drafted, 1);
    // Reject the second: recorded, nothing written.
    let reviewed: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_REVIEW,
        json!({"runId": run.run_id, "segmentIds": [second.id], "decision": "reject"}),
    );
    assert_eq!(reviewed.ai_drafted, 1);
    // Apply on the human-edited row: stale, the human text survives.
    let reviewed: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_REVIEW,
        json!({"runId": run.run_id, "segmentIds": [third.id], "decision": "apply"}),
    );
    let status_of = |view: &AgentRunView, id: &str| {
        view.proposals
            .iter()
            .find(|proposal| proposal.segment_id == id)
            .expect("proposal exists")
            .status
    };
    assert_eq!(
        status_of(&reviewed, &first.id),
        tl_protocol::AgentProposalStatus::Applied
    );
    assert_eq!(
        status_of(&reviewed, &second.id),
        tl_protocol::AgentProposalStatus::Rejected
    );
    assert_eq!(
        status_of(&reviewed, &third.id),
        tl_protocol::AgentProposalStatus::Stale
    );

    let after: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(after.segments[0].target_text, "人工审批候选。");
    assert_eq!(after.segments[0].state, tl_domain::SegmentState::Draft);
    let origin = after.segments[0].origin.clone().expect("aiDraft origin");
    assert_eq!(origin.kind, tl_domain::SegmentOriginKind::AiDraft);
    assert_eq!(
        after.segments[1].target_text, "",
        "rejected row stays empty"
    );
    assert_eq!(after.segments[2].target_text, "人工译文。");

    // Unknown segment id: invalidParams, no partial mutation.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_AGENT_REVIEW,
            json!({"runId": run.run_id, "segmentIds": ["missing"], "decision": "apply"}),
        ),
        RpcErrorCode::InvalidParams
    );
}

/// Turbo mode lands drafts like auto and then walks each one through the
/// segment-scoped QA gate: clean segments are confirmed through the real
/// `segment.confirm` path (TM write included), segments with error-severity
/// QA stay drafts for a human.
#[test]
fn agent_turbo_mode_confirms_qa_clean_segments_and_holds_error_segments() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Turbo", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    // The fixture reply carries no numbers: the numeric segment must fail
    // the number QA gate and stay a draft.
    let work = write_txt(
        workspace.path(),
        "turbo.txt",
        "Clean alpha sentence.\n\nNumbers 42 stay intact.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    let base_url = spawn_sse_server("极速草稿。", Duration::ZERO);
    configure_loopback_ai(&mut engine, &base_url);

    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "approvalMode": "turbo"}),
    );
    assert_eq!(run.approval_mode, tl_protocol::AgentApprovalMode::Turbo);
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.status, AgentRunStatus::AwaitingReview);
    assert_eq!(finished.ai_drafted, 2);
    assert_eq!(finished.auto_confirmed, 1, "only the QA-clean segment");
    assert!(
        finished
            .steps
            .iter()
            .any(|step| step.kind == AgentStepKind::Confirm)
    );

    let after: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    assert_eq!(after.segments[0].state, tl_domain::SegmentState::Confirmed);
    assert_eq!(
        after.segments[1].state,
        tl_domain::SegmentState::Draft,
        "number-mismatch error holds the confirm"
    );

    // The confirm was the real one: the TM now answers for the clean source.
    let lookup: TmLookupResult = call(
        &mut engine,
        methods::TM_LOOKUP,
        json!({"projectId": project.id, "sourceText": "Clean alpha sentence."}),
    );
    assert!(
        lookup
            .matches
            .iter()
            .any(|hit| hit.entry.target_text == "极速草稿。"),
        "segment.confirm wrote the TM"
    );
}

/// The multi-candidate path: profiles are an in-memory list, assist runs for
/// the same segment through different profiles proceed in parallel, and the
/// per-(segment, profile) guard still rejects a duplicate. Credentials never
/// appear in any profile view.
#[test]
fn ai_profiles_power_parallel_candidates_per_segment() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Profiles", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(workspace.path(), "profiles.txt", "Candidate sentence.\n");
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let segment = listed.segments[0].clone();

    let url_a = spawn_sse_server("候选甲。", Duration::from_millis(200));
    let url_b = spawn_sse_server("候选乙。", Duration::from_millis(200));
    let profiles: tl_protocol::AiProfileListResult = call(
        &mut engine,
        methods::AI_PROFILE_ADD,
        json!({"provider": "openaiCompatible", "model": "model-a", "baseUrl": url_a, "apiKey": "fixture-key-alpha"}),
    );
    assert_eq!(profiles.profiles.len(), 1);
    let profiles: tl_protocol::AiProfileListResult = call(
        &mut engine,
        methods::AI_PROFILE_ADD,
        json!({"provider": "openaiCompatible", "model": "model-b", "baseUrl": url_b, "apiKey": "fixture-key-beta"}),
    );
    assert_eq!(profiles.profiles.len(), 2);
    let profile_a = profiles.profiles[0].clone();
    let profile_b = profiles.profiles[1].clone();
    assert_eq!(
        profiles.default_profile_id.as_deref(),
        Some(profile_a.profile_id.as_str()),
        "first profile becomes the default"
    );

    // Status reports the profile count; the list never leaks a credential.
    let status: AiStatusResult = call(&mut engine, methods::AI_STATUS, json!({}));
    assert!(status.configured);
    assert_eq!(status.profile_count, 2);
    let raw = engine.handle(
        tl_protocol::RpcRequest {
            id: 9,
            method: methods::AI_PROFILE_LIST.to_string(),
            params: json!({}),
        },
        &mut |_notification| {},
    );
    let raw_text = serde_json::to_string(&raw.result).expect("serialize list");
    assert!(!raw_text.contains("fixture-key-alpha"));
    assert!(!raw_text.contains("fixture-key-beta"));

    // Fan-out: the same segment accepts one run per profile in parallel.
    let run_a: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate", "profileId": profile_a.profile_id}),
    );
    let run_b: AiAssistRunView = call(
        &mut engine,
        methods::AI_ASSIST_START,
        json!({"segmentId": segment.id, "action": "translate", "profileId": profile_b.profile_id}),
    );
    assert_eq!(run_a.profile_id, profile_a.profile_id);
    assert_eq!(run_b.profile_id, profile_b.profile_id);
    // Duplicate through the same profile: honest Conflict.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": segment.id, "action": "translate", "profileId": profile_a.profile_id}),
        ),
        RpcErrorCode::Conflict
    );
    // Unknown profile id: NotFound, never a silent fallback.
    assert_eq!(
        call_err(
            &mut engine,
            methods::AI_ASSIST_START,
            json!({"segmentId": segment.id, "action": "translate", "profileId": "missing"}),
        ),
        RpcErrorCode::NotFound
    );

    // Both candidates come back with their own real provider/model.
    let done_a = wait_assist_terminal(&mut engine, &events, &run_a.assist_id);
    let done_b = wait_assist_terminal(&mut engine, &events, &run_b.assist_id);
    let result_a = done_a.result.expect("candidate A");
    let result_b = done_b.result.expect("candidate B");
    assert_eq!(result_a.model, "model-a");
    assert_eq!(result_b.model, "model-b");
    assert_eq!(result_a.draft_target, "候选甲。");
    assert_eq!(result_b.draft_target, "候选乙。");

    // Removing the default hands the default to the remaining profile.
    let profiles: tl_protocol::AiProfileListResult = call(
        &mut engine,
        methods::AI_PROFILE_REMOVE,
        json!({"profileId": profile_a.profile_id}),
    );
    assert_eq!(profiles.profiles.len(), 1);
    assert_eq!(
        profiles.default_profile_id.as_deref(),
        Some(profile_b.profile_id.as_str())
    );
}

/// Scope and failure bookkeeping: `segmentIds` narrows the plan to the
/// intersection with the untranslated set, `eligibleSegments` makes the
/// `maxSegments` cap explicit, and `failedSegmentIds` powers a precise rerun
/// that plans exactly the failed rows.
#[test]
fn agent_scope_and_failed_segment_ids_power_precise_reruns() {
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Scope", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let work = write_txt(
        workspace.path(),
        "scope.txt",
        "Alpha sentence.\n\nBravo sentence.\n\nCharlie sentence.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": work.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );

    // An empty SSE reply drafts nothing: every planned segment fails.
    let base_url = spawn_sse_server("", Duration::ZERO);
    configure_loopback_ai(&mut engine, &base_url);

    // maxSegments caps the plan while eligibleSegments reports the scope.
    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({"documentId": imported.document.id, "approvalMode": "auto", "maxSegments": 2}),
    );
    assert_eq!(run.eligible_segments, 3);
    assert_eq!(run.planned_segments, 2);
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.failed_segments, 2);
    assert_eq!(finished.failed_segment_ids.len(), 2);
    assert_eq!(finished.processed_segments, 2);

    // Precise rerun: the failed ids become the scope of a fresh run.
    let rerun: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({
            "documentId": imported.document.id,
            "approvalMode": "auto",
            "segmentIds": finished.failed_segment_ids,
        }),
    );
    assert_eq!(rerun.eligible_segments, 2);
    assert_eq!(rerun.planned_segments, 2);
    assert_ne!(rerun.run_id, finished.run_id, "a rerun is a new task order");
    let rerun_finished = drive_agent_run(&mut engine, &events, &rerun.run_id, &mut notifications);
    assert_eq!(rerun_finished.status, AgentRunStatus::AwaitingReview);

    // A single-segment scope plans exactly that segment.
    let solo: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({
            "documentId": imported.document.id,
            "approvalMode": "auto",
            "segmentIds": [listed.segments[2].id],
        }),
    );
    assert_eq!(solo.eligible_segments, 1);
    assert_eq!(solo.planned_segments, 1);
    let _ = drive_agent_run(&mut engine, &events, &solo.run_id, &mut notifications);
}

/// Confirm one segment through the ordinary path (update then confirm),
/// starting from the revision the caller holds.
fn confirm_with_target(engine: &mut Engine, segment: &tl_domain::Segment, target: &str) {
    let updated: SegmentUpdateResult = call(
        engine,
        methods::SEGMENT_UPDATE,
        json!({"segmentId": segment.id, "targetText": target, "baseRevision": segment.revision}),
    );
    let confirmed: SegmentConfirmResult = call(
        engine,
        methods::SEGMENT_CONFIRM,
        json!({"segmentId": segment.id, "baseRevision": updated.segment.revision}),
    );
    assert_eq!(confirmed.segment.state, tl_domain::SegmentState::Confirmed);
}

/// The context-awareness contract: every drafting prompt that leaves the
/// engine carries real TM examples, real neighbour segments (untranslated
/// targets stay honestly empty), and a confirmed-pair sample from beyond the
/// neighbour window — and none of those sections when the data is absent.
#[test]
fn drafting_prompts_ground_in_real_tm_neighbours_and_document_pairs() {
    const DRAFT_BODY: &str = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"蓝色阀门控制水流。\"}}]}\n\n",
        "data: [DONE]\n\n"
    );
    let workspace = tempfile::tempdir().expect("tempdir");
    let mut engine = Engine::open(&workspace.path().join("data")).expect("open engine");
    let events = engine.take_engine_events();
    let project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Grounded", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let source = write_txt(
        workspace.path(),
        "grounded.txt",
        "Read the manual first.\n\nKeep the area clean.\n\nThe pump starts automatically.\n\n\
         The red valve controls water flow.\n\nThe blue valve controls water flow.\n\n\
         Check the pressure gauge daily.\n\nWear protective gloves at all times.\n\n\
         Store tools in the cabinet.\n",
    );
    let imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": project.id, "sourcePath": source.display().to_string()}),
    );
    let listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": imported.document.id}),
    );
    let find = |needle: &str| {
        listed
            .segments
            .iter()
            .find(|segment| segment.source_text.contains(needle))
            .expect("segment present")
            .clone()
    };
    let far_confirmed = find("Read the manual");
    let neighbour_confirmed = find("red valve");
    let active = find("blue valve");

    // Real data only: one confirmed pair beyond the neighbour window and one
    // inside it (which doubles as a strong fuzzy TM example for the active
    // segment).
    confirm_with_target(&mut engine, &far_confirmed, "先阅读手册。");
    confirm_with_target(&mut engine, &neighbour_confirmed, "红色阀门控制水流。");

    // Assist path.
    let (assist_url, assist_captured) = spawn_capturing_sse_server(DRAFT_BODY);
    configure_loopback_ai(&mut engine, &assist_url);
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": active.id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    assert_eq!(
        done.result.expect("assist proposal").draft_target,
        "蓝色阀门控制水流。"
    );
    let request = assist_captured.lock().expect("captured assist").clone();
    assert!(
        request.contains("Translation memory examples"),
        "assist prompt carries the TM section, got: {request}"
    );
    assert!(
        request.contains("红色阀门控制水流。"),
        "the TM example is the real confirmed pair"
    );
    assert!(
        request.contains("Document context"),
        "assist prompt carries the neighbour section"
    );
    assert!(
        request.contains("Check the pressure gauge daily."),
        "the untranslated following neighbour appears with its real source"
    );
    assert!(
        request.contains("Confirmed pairs from this document"),
        "assist prompt carries the document sample section"
    );
    assert!(
        request.contains("先阅读手册。"),
        "the document sample is the real confirmed pair beyond the window"
    );
    assert!(
        request.contains("The blue valve controls water flow."),
        "the active segment source is the user payload"
    );

    // Agent path: the same grounding sections reach the worker's request.
    let (agent_url, agent_captured) = spawn_capturing_sse_server(DRAFT_BODY);
    configure_loopback_ai(&mut engine, &agent_url);
    let run: AgentRunView = call(
        &mut engine,
        methods::AI_AGENT_START,
        json!({
            "documentId": imported.document.id,
            "approvalMode": "auto",
            "segmentIds": [active.id],
        }),
    );
    assert_eq!(run.planned_segments, 1);
    let mut notifications = Vec::new();
    let finished = drive_agent_run(&mut engine, &events, &run.run_id, &mut notifications);
    assert_eq!(finished.ai_drafted, 1);
    let request = agent_captured.lock().expect("captured agent").clone();
    assert!(
        request.contains("Translation memory examples"),
        "agent prompt carries the TM section, got: {request}"
    );
    assert!(request.contains("红色阀门控制水流。"));
    assert!(request.contains("Document context"));
    assert!(request.contains("Confirmed pairs from this document"));
    assert!(request.contains("先阅读手册。"));

    // Honest absence: a fresh project with a single-segment document and an
    // empty TM produces a prompt with none of those sections.
    let bare_project: tl_domain::Project = call(
        &mut engine,
        methods::PROJECT_CREATE,
        json!({"name": "Bare", "sourceLocale": "en-US", "targetLocale": "zh-CN"}),
    );
    let bare_source = write_txt(workspace.path(), "bare.txt", "A single lonely sentence.\n");
    let bare_imported: DocumentImportResult = call(
        &mut engine,
        methods::DOCUMENT_IMPORT,
        json!({"projectId": bare_project.id, "sourcePath": bare_source.display().to_string()}),
    );
    let bare_listed: SegmentListResult = call(
        &mut engine,
        methods::SEGMENT_LIST,
        json!({"documentId": bare_imported.document.id}),
    );
    let (bare_url, bare_captured) = spawn_capturing_sse_server(DRAFT_BODY);
    configure_loopback_ai(&mut engine, &bare_url);
    let done = drive_assist(
        &mut engine,
        &events,
        json!({"segmentId": bare_listed.segments[0].id, "action": "translate"}),
    );
    assert_eq!(done.status, AiAssistRunStatus::Done);
    let request = bare_captured.lock().expect("captured bare").clone();
    assert!(
        !request.contains("Translation memory examples"),
        "no TM data means no TM section, got: {request}"
    );
    assert!(!request.contains("Document context"));
    assert!(!request.contains("Confirmed pairs from this document"));
    assert!(request.contains("A single lonely sentence."));
}
