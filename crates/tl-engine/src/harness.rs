//! Whole-document agent harness: the worker side of the tool loop.
//!
//! One thread owns one LLM conversation. Each turn it calls the provider,
//! parses the reply as a JSON tool call, and either executes the tool
//! locally (network: `web_fetch`) or asks the engine thread to run it
//! (everything touching engine state) and blocks on the run's reply
//! channel. The engine loop stays single-threaded and lock-free: tool
//! requests arrive as [`EngineEvent`]s between protocol frames, exactly
//! like the batch agent's draft events.
//!
//! Honesty rules mirror the rest of the AI surface: an unparseable reply
//! gets one correction turn and then fails the run verbatim; the turn
//! budget is a circuit breaker that ends the run at the review gate with
//! the work done so far; cancellation is observed at every turn boundary
//! and inside the provider call's poll interval.
//!
//! Context management (docs/agent-harness.md §2.4): tool outputs are
//! capped at the source, the conversation lives under a character budget,
//! and when the budget trips the oldest tool turns are dropped behind a
//! visible marker — the model is instructed to persist conclusions through
//! its `note` tool, which the engine keeps outside the conversation.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::time::Duration;

use tl_ai::{AiCoreError, AiMessage, AiMessageRole, AiProviderProfile, SecretString};

use crate::aiops;
use crate::events::{EngineEvent, HarnessTraceKind};

/// Turn budget defaults (docs/agent-harness.md §2.4).
pub const HARNESS_DEFAULT_MAX_TURNS: u32 = 24;
pub const HARNESS_MAX_TURNS_CAP: u32 = 64;
/// Conversation size budget in characters (system prompt excluded).
pub const HARNESS_CHAR_BUDGET: usize = 120_000;
/// `web_fetch` body cap, in bytes of extracted text.
pub const HARNESS_WEB_FETCH_MAX_BYTES: usize = 8 * 1024;

/// One parsed tool call from a model reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolCall {
    pub tool: String,
    pub args: serde_json::Value,
}

/// Extract the tool call from a model reply. Accepts a fenced ```json
/// block, a bare JSON object, or an object embedded in prose (first `{` to
/// last `}`). Requires `{"tool": string}`; `args` defaults to `{}`.
pub fn parse_tool_call(reply: &str) -> Result<ToolCall, String> {
    let text = reply.trim();
    let mut candidates: Vec<&str> = Vec::new();
    if let Some(open) = text.find("```") {
        let after = &text[open + 3..];
        let body_start = after.find('\n').map(|i| i + 1).unwrap_or(0);
        if let Some(close) = after[body_start..].find("```") {
            candidates.push(after[body_start..body_start + close].trim());
        }
    }
    candidates.push(text);
    if let (Some(open), Some(close)) = (text.find('{'), text.rfind('}'))
        && open < close
    {
        candidates.push(text[open..=close].trim());
    }
    for candidate in candidates {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) else {
            continue;
        };
        let Some(object) = value.as_object() else {
            continue;
        };
        let Some(tool) = object.get("tool").and_then(|t| t.as_str()) else {
            continue;
        };
        let args = object
            .get("args")
            .cloned()
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        return Ok(ToolCall {
            tool: tool.to_string(),
            args,
        });
    }
    Err("回复中没有可解析的工具调用 JSON（需要 {\"tool\":…,\"args\":…}）".to_string())
}

/// Marker injected exactly once where pruned turns used to be.
const PRUNED_MARKER: &str = "（早期轮次已因上下文预算被裁剪；此前的关键结论见你写入的笔记。）";

/// Keep the conversation under `budget` characters (system prompt at index
/// 0 excluded) by dropping the oldest turns after the initial task brief.
/// A single visible marker replaces whatever was pruned.
pub fn enforce_budget(messages: &mut Vec<AiMessage>, budget: usize) {
    let total =
        |messages: &[AiMessage]| -> usize { messages.iter().skip(1).map(|m| m.text.len()).sum() };
    if total(messages) <= budget {
        return;
    }
    // Index 0 is the system prompt, index 1 the task brief; both stay.
    let mut pruned = false;
    while messages.len() > 3 && total(messages) > budget {
        messages.remove(2);
        pruned = true;
    }
    if pruned && !messages.iter().any(|m| m.text == PRUNED_MARKER) {
        messages.insert(
            2,
            AiMessage {
                role: AiMessageRole::User,
                text: PRUNED_MARKER.to_string(),
            },
        );
    }
}

pub struct HarnessJob {
    pub harness_id: String,
    /// System prompt + task brief, built on the engine thread from real
    /// project data.
    pub messages: Vec<AiMessage>,
    pub profile: AiProviderProfile,
    pub credential: SecretString,
    pub cancel: Arc<AtomicBool>,
    pub events: Sender<EngineEvent>,
    /// Engine-thread tool results, one JSON string per HarnessTool event.
    pub tool_replies: Receiver<String>,
    pub max_turns: u32,
    pub web_access: bool,
    pub char_budget: usize,
}

pub fn spawn_worker(job: HarnessJob) {
    std::thread::spawn(move || run_conversation(job));
}

fn run_conversation(job: HarnessJob) {
    let HarnessJob {
        harness_id,
        mut messages,
        profile,
        credential,
        cancel,
        events,
        tool_replies,
        max_turns,
        web_access,
        char_budget,
    } = job;
    let mut parse_failures_in_a_row = 0u32;
    for _turn in 0..max_turns {
        if cancel.load(Ordering::Relaxed) {
            let _ = events.send(EngineEvent::HarnessCanceled { harness_id });
            return;
        }
        let completion =
            aiops::run_completion(&profile, &credential, messages.clone(), "", "", "", &cancel);
        let reply = match completion {
            Err(AiCoreError::Canceled) => {
                let _ = events.send(EngineEvent::HarnessCanceled { harness_id });
                return;
            }
            Err(error) => {
                let _ = events.send(EngineEvent::HarnessFailed {
                    harness_id,
                    error: error.to_string(),
                });
                return;
            }
            Ok(completion) => completion.text,
        };
        match parse_tool_call(&reply) {
            Err(parse_error) => {
                parse_failures_in_a_row += 1;
                let _ = events.send(EngineEvent::HarnessTrace {
                    harness_id: harness_id.clone(),
                    kind: HarnessTraceKind::Model,
                    ok: false,
                    detail: format!("模型输出无法解析为工具调用：{parse_error}"),
                });
                if parse_failures_in_a_row >= 2 {
                    let _ = events.send(EngineEvent::HarnessFailed {
                        harness_id,
                        error: format!("连续两轮无法解析工具调用：{parse_error}"),
                    });
                    return;
                }
                messages.push(AiMessage {
                    role: AiMessageRole::Assistant,
                    text: truncate(&reply, 2_000),
                });
                messages.push(AiMessage {
                    role: AiMessageRole::User,
                    text: format!(
                        "上一条回复不是有效的工具调用。{parse_error}。请只输出一个 JSON 对象。"
                    ),
                });
                continue;
            }
            Ok(call) => {
                parse_failures_in_a_row = 0;
                let _ = events.send(EngineEvent::HarnessTrace {
                    harness_id: harness_id.clone(),
                    kind: HarnessTraceKind::Model,
                    ok: true,
                    detail: format!("调用工具 {}", call.tool),
                });
                if call.tool == "finish" {
                    let summary = call
                        .args
                        .get("summary")
                        .and_then(|s| s.as_str())
                        .unwrap_or("（模型未提供总结）")
                        .to_string();
                    let _ = events.send(EngineEvent::HarnessFinished {
                        harness_id,
                        summary,
                        exhausted: false,
                    });
                    return;
                }
                let result = if call.tool == "web_fetch" {
                    // Network IO stays on the worker so the engine loop
                    // never blocks on a slow host.
                    let result = web_fetch(&call.args, web_access, &cancel);
                    let ok = !result.contains("\"error\"");
                    let _ = events.send(EngineEvent::HarnessTrace {
                        harness_id: harness_id.clone(),
                        kind: HarnessTraceKind::Web,
                        ok,
                        detail: format!(
                            "web_fetch {}",
                            call.args.get("url").and_then(|u| u.as_str()).unwrap_or("?")
                        ),
                    });
                    result
                } else {
                    if events
                        .send(EngineEvent::HarnessTool {
                            harness_id: harness_id.clone(),
                            tool: call.tool.clone(),
                            args: call.args.clone(),
                        })
                        .is_err()
                    {
                        return;
                    }
                    match tool_replies.recv() {
                        Ok(result) => result,
                        // The engine dropped the run (cancel/prune): stop.
                        Err(_) => return,
                    }
                };
                messages.push(AiMessage {
                    role: AiMessageRole::Assistant,
                    text: truncate(&reply, 4_000),
                });
                messages.push(AiMessage {
                    role: AiMessageRole::User,
                    text: format!("TOOL_RESULT {}:\n{}", call.tool, result),
                });
                enforce_budget(&mut messages, char_budget);
            }
        }
    }
    // Turn budget exhausted: an honest circuit breaker, not a failure —
    // drafts written so far stay parked at the review gate.
    let _ = events.send(EngineEvent::HarnessFinished {
        harness_id,
        summary: format!("已达到 {max_turns} 轮预算上限，运行在人工评审门停止；已写入的草稿保留。"),
        exhausted: true,
    });
}

fn truncate(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let cut: String = text.chars().take(max_chars).collect();
    format!("{cut}…（截断）")
}

/// Fetch one URL and return extracted text as a JSON tool result. Honest
/// refusals: web access off, non-http(s) scheme, transport errors.
fn web_fetch(args: &serde_json::Value, web_access: bool, cancel: &AtomicBool) -> String {
    if !web_access {
        return r#"{"error":"本次运行未开启网络访问（web_access=false）"}"#.to_string();
    }
    if cancel.load(Ordering::Relaxed) {
        return r#"{"error":"canceled"}"#.to_string();
    }
    let Some(url) = args.get("url").and_then(|u| u.as_str()) else {
        return r#"{"error":"缺少 args.url"}"#.to_string();
    };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return r#"{"error":"只支持 http/https URL"}"#.to_string();
    }
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return serde_json::json!({ "error": error.to_string() }).to_string();
        }
    };
    match client.get(url).send().and_then(|response| response.text()) {
        Ok(body) => {
            let text = extract_text(&body);
            let truncated = text.len() > HARNESS_WEB_FETCH_MAX_BYTES;
            let mut slice = &text[..];
            if truncated {
                let mut end = HARNESS_WEB_FETCH_MAX_BYTES;
                while end > 0 && !text.is_char_boundary(end) {
                    end -= 1;
                }
                slice = &text[..end];
            }
            serde_json::json!({ "url": url, "text": slice, "truncated": truncated }).to_string()
        }
        Err(error) => serde_json::json!({ "error": error.to_string() }).to_string(),
    }
}

/// Crude but honest HTML-to-text: strips tags, scripts, and styles. The
/// goal is reference material for the model, not a rendering.
fn extract_text(body: &str) -> String {
    let mut out = String::with_capacity(body.len() / 2);
    let mut chars = body.char_indices().peekable();
    let mut skip_until: Option<&str> = None;
    let lower = body.to_lowercase();
    while let Some((index, character)) = chars.next() {
        if let Some(end_tag) = skip_until {
            if lower[index..].starts_with(end_tag) {
                for _ in 0..end_tag.len().saturating_sub(1) {
                    chars.next();
                }
                skip_until = None;
            }
            continue;
        }
        if character == '<' {
            if lower[index..].starts_with("<script") {
                skip_until = Some("</script>");
                continue;
            }
            if lower[index..].starts_with("<style") {
                skip_until = Some("</style>");
                continue;
            }
            // Skip to the closing '>'.
            for (_, tag_char) in chars.by_ref() {
                if tag_char == '>' {
                    break;
                }
            }
            out.push(' ');
            continue;
        }
        out.push(character);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_fenced_bare_and_embedded_tool_calls() {
        let fenced =
            "先想一想。\n```json\n{\"tool\":\"read_segments\",\"args\":{\"offset\":0}}\n```";
        assert_eq!(
            parse_tool_call(fenced).expect("fenced").tool,
            "read_segments"
        );
        let bare = r#"{"tool":"finish","args":{"summary":"done"}}"#;
        assert_eq!(parse_tool_call(bare).expect("bare").tool, "finish");
        let embedded = r#"我将调用 {"tool":"qa_run","args":{}} 来检查。"#;
        assert_eq!(parse_tool_call(embedded).expect("embedded").tool, "qa_run");
        assert!(parse_tool_call("没有任何 JSON").is_err());
        assert!(parse_tool_call(r#"{"args":{}}"#).is_err());
    }

    #[test]
    fn budget_prunes_oldest_turns_behind_one_marker() {
        let message = |role: AiMessageRole, text: &str| AiMessage {
            role,
            text: text.to_string(),
        };
        let mut messages = vec![
            message(AiMessageRole::System, "system"),
            message(AiMessageRole::User, "brief"),
        ];
        for index in 0..20 {
            messages.push(message(AiMessageRole::Assistant, &format!("call {index}")));
            messages.push(message(
                AiMessageRole::User,
                &format!("TOOL_RESULT {index}: {}", "x".repeat(400)),
            ));
        }
        enforce_budget(&mut messages, 2_000);
        let total: usize = messages.iter().skip(1).map(|m| m.text.len()).sum();
        assert!(total <= 2_000 + PRUNED_MARKER.len());
        // System and brief survive; the marker appears exactly once.
        assert_eq!(messages[0].text, "system");
        assert_eq!(messages[1].text, "brief");
        assert_eq!(
            messages.iter().filter(|m| m.text == PRUNED_MARKER).count(),
            1
        );
        // The newest turns survive.
        assert!(
            messages
                .iter()
                .any(|m| m.text.starts_with("TOOL_RESULT 19"))
        );
    }

    #[test]
    fn web_fetch_refuses_without_access_and_extracts_text() {
        let refusal = web_fetch(
            &serde_json::json!({"url": "https://example.com"}),
            false,
            &AtomicBool::new(false),
        );
        assert!(refusal.contains("web_access=false"));
        assert_eq!(
            extract_text("<html><script>var x=1;</script><p>Hello <b>world</b></p></html>"),
            "Hello world"
        );
    }
}
