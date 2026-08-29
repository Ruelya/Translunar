//! Translunar CLI: the external-agent doorway into the engine.
//!
//! Spawns `tl-engine --data-dir …` and speaks the same newline-framed
//! JSON-RPC 2.0 the desktop shell speaks — capability parity is structural,
//! not promised: both surfaces call the identical method table on the
//! identical engine. `tl-cli rpc <method>` exposes the whole protocol; the
//! named subcommands are ergonomic spellings of the common flow.
//!
//! One engine process owns a data directory at a time (the engine caches
//! its metadata working set in memory). Use the CLI when the desktop app is
//! closed, or point it at its own `--data-dir`.
//!
//! Output contract: exactly one JSON value on stdout per invocation (the
//! RPC result, or `{"error": …}` with a non-zero exit). Notifications
//! stream to stderr as JSON lines when `--verbose` is set, so scripts can
//! parse stdout without filtering.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use clap::{Parser, Subcommand};
use serde_json::{Value, json};
use tl_protocol::{EngineFrame, PROTOCOL_VERSION, RpcRequest, methods, notifications};

#[derive(Debug, Parser)]
#[command(
    name = "tl-cli",
    version,
    about = "Translunar CAT 引擎的命令行通道（外部 Agent 接入面）"
)]
struct Arguments {
    /// Engine data directory (must not be owned by a running desktop app).
    #[arg(long)]
    data_dir: PathBuf,
    /// Path to the tl-engine binary; defaults to `tl-engine` beside this
    /// binary, then `tl-engine` on PATH.
    #[arg(long)]
    engine_bin: Option<PathBuf>,
    /// Pretty-print the JSON result.
    #[arg(long)]
    pretty: bool,
    /// Stream engine notifications to stderr as JSON lines.
    #[arg(long)]
    verbose: bool,
    #[command(subcommand)]
    command: CliCommand,
}

#[derive(Debug, Subcommand)]
enum CliCommand {
    /// Call any protocol method verbatim: the full engine surface.
    Rpc {
        method: String,
        /// JSON params object; defaults to {}.
        #[arg(long)]
        params: Option<String>,
    },
    /// List projects.
    Projects,
    /// Create a project.
    ProjectCreate {
        #[arg(long)]
        name: String,
        #[arg(long)]
        source: String,
        #[arg(long)]
        target: String,
    },
    /// Import a document into a project.
    Import {
        #[arg(long)]
        project: String,
        #[arg(long)]
        path: PathBuf,
    },
    /// List a document's segments (windowed).
    Segments {
        #[arg(long)]
        document: String,
        #[arg(long, default_value_t = 0)]
        offset: u32,
        #[arg(long)]
        limit: Option<u32>,
    },
    /// Save a segment's draft target (optimistic revision).
    SegmentUpdate {
        #[arg(long)]
        segment: String,
        #[arg(long)]
        target: String,
        #[arg(long)]
        revision: u64,
    },
    /// Confirm a segment (writes TM unless --skip-tm).
    SegmentConfirm {
        #[arg(long)]
        segment: String,
        #[arg(long)]
        revision: u64,
        #[arg(long)]
        skip_tm: bool,
    },
    /// TM lookup (exact + fuzzy) against a project's mounts.
    TmLookup {
        #[arg(long)]
        project: String,
        #[arg(long)]
        text: String,
    },
    /// Run QA over a document.
    QaRun {
        #[arg(long)]
        document: String,
    },
    /// Export a document's translation.
    Export {
        #[arg(long)]
        document: String,
        #[arg(long)]
        out: PathBuf,
        #[arg(long)]
        overwrite: bool,
    },
    /// Start the whole-document harness and wait for the review gate.
    Harness {
        #[arg(long)]
        document: String,
        #[arg(long)]
        instruction: Option<String>,
        #[arg(long)]
        max_turns: Option<u32>,
        /// Enable the web_fetch tool for this run.
        #[arg(long)]
        web: bool,
        /// Return immediately instead of waiting for the terminal state.
        #[arg(long)]
        no_wait: bool,
    },
}

struct EngineClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    verbose: bool,
}

impl EngineClient {
    fn spawn(data_dir: &PathBuf, engine_bin: Option<PathBuf>, verbose: bool) -> Result<Self> {
        let binary = engine_bin.unwrap_or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|path| {
                    let sibling = path.with_file_name(if cfg!(windows) {
                        "tl-engine.exe"
                    } else {
                        "tl-engine"
                    });
                    sibling.is_file().then_some(sibling)
                })
                .unwrap_or_else(|| PathBuf::from("tl-engine"))
        });
        let mut child = Command::new(&binary)
            .arg("--data-dir")
            .arg(data_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .with_context(|| format!("无法启动引擎 {}", binary.display()))?;
        let stdin = child.stdin.take().context("engine stdin")?;
        let stdout = BufReader::new(child.stdout.take().context("engine stdout")?);
        let mut client = Self {
            child,
            stdin,
            stdout,
            next_id: 1,
            verbose,
        };
        // The engine announces readiness before accepting frames.
        client.read_until_notification(notifications::ENGINE_READY)?;
        client.call(
            methods::ENGINE_INITIALIZE,
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "clientName": "tl-cli",
                "clientVersion": env!("CARGO_PKG_VERSION"),
            }),
        )?;
        Ok(client)
    }

    fn read_frame(&mut self) -> Result<EngineFrame> {
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = self.stdout.read_line(&mut line)?;
            if bytes == 0 {
                bail!("引擎进程已退出");
            }
            if line.trim().is_empty() {
                continue;
            }
            return serde_json::from_str(&line).context("无法解析引擎帧");
        }
    }

    fn read_until_notification(&mut self, method: &str) -> Result<()> {
        loop {
            match self.read_frame()? {
                EngineFrame::Notification(notification) if notification.method == method => {
                    return Ok(());
                }
                EngineFrame::Notification(notification) => self.trace(&notification),
                EngineFrame::Response(_) => {}
            }
        }
    }

    fn trace(&self, notification: &tl_protocol::RpcNotification) {
        if self.verbose {
            let line = serde_json::to_string(&json!({
                "method": notification.method,
                "params": notification.params,
            }))
            .unwrap_or_default();
            eprintln!("{line}");
        }
    }

    /// One request, one response; notifications in between are traced.
    fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let request = RpcRequest {
            id,
            method: method.to_string(),
            params,
        };
        let line = serde_json::to_string(&request)?;
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;
        loop {
            match self.read_frame()? {
                EngineFrame::Notification(notification) => self.trace(&notification),
                EngineFrame::Response(response) => {
                    if response.id != Some(id) {
                        continue;
                    }
                    if let Some(error) = response.error {
                        return Err(anyhow!(
                            "{}",
                            serde_json::to_string(&json!({
                                "error": {
                                    "code": error.code,
                                    "message": error.message,
                                    "data": error.data,
                                }
                            }))?
                        ));
                    }
                    return Ok(response.result.unwrap_or(Value::Null));
                }
            }
        }
    }

    fn shutdown(mut self) {
        let _ = self.call(methods::ENGINE_SHUTDOWN, json!({}));
        let _ = self.child.wait();
    }
}

fn main() {
    let arguments = Arguments::parse();
    let pretty = arguments.pretty;
    match run(arguments) {
        Ok(result) => {
            let rendered = if pretty {
                serde_json::to_string_pretty(&result)
            } else {
                serde_json::to_string(&result)
            }
            .unwrap_or_else(|_| "null".to_string());
            println!("{rendered}");
        }
        Err(error) => {
            // Errors are JSON too, so agents can parse either channel.
            let message = error.to_string();
            if message.trim_start().starts_with('{') {
                println!("{message}");
            } else {
                println!("{}", json!({ "error": { "message": message } }));
            }
            std::process::exit(1);
        }
    }
}

fn run(arguments: Arguments) -> Result<Value> {
    let mut client = EngineClient::spawn(
        &arguments.data_dir,
        arguments.engine_bin.clone(),
        arguments.verbose,
    )?;
    let result = dispatch(&mut client, arguments.command);
    client.shutdown();
    result
}

fn dispatch(client: &mut EngineClient, command: CliCommand) -> Result<Value> {
    match command {
        CliCommand::Rpc { method, params } => {
            let params: Value = match params {
                Some(raw) => serde_json::from_str(&raw).context("--params 不是有效 JSON")?,
                None => json!({}),
            };
            client.call(&method, params)
        }
        CliCommand::Projects => client.call(methods::PROJECT_LIST, json!({})),
        CliCommand::ProjectCreate {
            name,
            source,
            target,
        } => client.call(
            methods::PROJECT_CREATE,
            json!({ "name": name, "sourceLocale": source, "targetLocale": target }),
        ),
        CliCommand::Import { project, path } => client.call(
            methods::DOCUMENT_IMPORT,
            json!({ "projectId": project, "sourcePath": path.display().to_string() }),
        ),
        CliCommand::Segments {
            document,
            offset,
            limit,
        } => client.call(
            methods::SEGMENT_LIST,
            json!({ "documentId": document, "offset": offset, "limit": limit }),
        ),
        CliCommand::SegmentUpdate {
            segment,
            target,
            revision,
        } => client.call(
            methods::SEGMENT_UPDATE,
            json!({ "segmentId": segment, "targetText": target, "baseRevision": revision }),
        ),
        CliCommand::SegmentConfirm {
            segment,
            revision,
            skip_tm,
        } => client.call(
            methods::SEGMENT_CONFIRM,
            json!({
                "segmentId": segment,
                "baseRevision": revision,
                "skipTmWrite": if skip_tm { Some(true) } else { None::<bool> },
            }),
        ),
        CliCommand::TmLookup { project, text } => client.call(
            methods::TM_LOOKUP,
            json!({ "projectId": project, "sourceText": text }),
        ),
        CliCommand::QaRun { document } => {
            client.call(methods::QA_RUN, json!({ "documentId": document }))
        }
        CliCommand::Export {
            document,
            out,
            overwrite,
        } => client.call(
            methods::DOCUMENT_EXPORT,
            json!({
                "documentId": document,
                "outputPath": out.display().to_string(),
                "overwrite": if overwrite { Some(true) } else { None::<bool> },
            }),
        ),
        CliCommand::Harness {
            document,
            instruction,
            max_turns,
            web,
            no_wait,
        } => {
            let started = client.call(
                methods::AI_HARNESS_START,
                json!({
                    "documentId": document,
                    "instruction": instruction,
                    "maxTurns": max_turns,
                    "webAccess": web,
                }),
            )?;
            if no_wait {
                return Ok(started);
            }
            let harness_id = started
                .get("harnessId")
                .and_then(|value| value.as_str())
                .context("harnessId missing from start result")?
                .to_string();
            // Poll to the terminal state; steps stream to stderr with
            // --verbose. The engine keeps working between our polls
            // because reading frames pumps its event loop output.
            let deadline = Instant::now() + Duration::from_secs(60 * 60);
            loop {
                let view = client.call(
                    methods::AI_HARNESS_STATUS,
                    json!({ "harnessId": harness_id }),
                )?;
                let status = view.get("status").and_then(|value| value.as_str());
                if status != Some("running") {
                    return Ok(view);
                }
                if Instant::now() > deadline {
                    bail!("harness run 超时（1 小时）");
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
}
