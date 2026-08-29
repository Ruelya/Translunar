---
name: translunar-cli
description: >-
  Drive the Translunar CAT engine from any external agent (Claude Code,
  Codex CLI, opencode, CI scripts) through the tl-cli JSON-RPC bridge.
  Use when the task is to create translation projects, import documents,
  read or write segments, confirm translations into TM, manage terminology,
  run QA, export translations, or launch the whole-document AI harness —
  without the desktop UI.
---

# Translunar CLI（外部 Agent 接入面）

`tl-cli` 把整个 Translunar 引擎暴露为命令行：它 spawn `tl-engine` 并说
与桌面端完全相同的 JSON-RPC 协议，因此能力与桌面/原生 AGENT 等价——
同一个引擎、同一张方法表、同一套守卫。架构与设计见
`docs/agent-harness.md` 与 `docs/architecture.md`。

## 准备

```bash
cargo build -p tl-cli -p tl-engine      # 产物在 target/debug/
tl-cli --data-dir <目录> <子命令>        # 每次调用一个 JSON 结果到 stdout
```

规则：

- **数据目录独占**：同一 `--data-dir` 同时只能有一个引擎进程。桌面应用
  开着时不要指向它的数据目录；给自动化任务用独立目录即可。
- stdout 永远是一个 JSON 值；失败时是 `{"error":{…}}` 且退出码非零。
  `--pretty` 可读化，`--verbose` 把引擎通知以 JSON 行写到 stderr。
- 引擎拥有全部领域规则：乐观锁（`revision`）、锁定/已确认句段拒写、
  占位符完整性、QA 导出门。被拒绝时读错误信息照做，不要绕。

## 标准流程

```bash
DD=/tmp/agent-workdir
# 1. 建项目（BCP-47 语言标签）
tl-cli --data-dir $DD project-create --name Demo --source en-US --target zh-CN
# → {"id":"<projectId>",…}

# 2. 导入文档（DOCX/TXT/Markdown/HTML/XLIFF/XLSX/PPTX）
tl-cli --data-dir $DD import --project <projectId> --path ./manual.docx
# → {"document":{"id":"<documentId>"},"segmentCount":N}

# 3. 读句段（分页；记住每段的 id 与 revision）
tl-cli --data-dir $DD segments --document <documentId> --offset 0 --limit 50

# 4. 写译文草稿（revision 必须是当前值，冲突会被拒绝）
tl-cli --data-dir $DD segment-update --segment <id> --target "译文" --revision 1

# 5. 确认（写入 TM 并向重复句段传播；--skip-tm 跳过 TM 写入）
tl-cli --data-dir $DD segment-confirm --segment <id> --revision 2

# 6. QA 与导出（QA 有 error 且项目开了导出门时导出会被拒绝）
tl-cli --data-dir $DD qa-run --document <documentId>
tl-cli --data-dir $DD export --document <documentId> --out ./out.docx
```

## 万能通道

命名子命令只是常用路径；`rpc` 暴露协议全集（方法表见
`packages/contracts/src/index.ts` 的 `ENGINE_METHODS`）：

```bash
tl-cli --data-dir $DD rpc tm.lookup \
  --params '{"projectId":"…","sourceText":"Hello world."}'
tl-cli --data-dir $DD rpc term.add \
  --params '{"termbaseId":"…","sourceTerm":"server","targetTerm":"服务器","targetLocale":"zh-CN"}'
tl-cli --data-dir $DD rpc segment.updateSource \
  --params '{"segmentId":"…","sourceText":"Fixed source.","baseRevision":3}'
```

## AI 与全文智能体

AI 凭据只存在引擎内存中，每个进程需要重新配置：

```bash
tl-cli --data-dir $DD rpc ai.configure \
  --params '{"provider":"openaiCompatible","model":"…","baseUrl":"…","apiKey":"…"}'
# 全文智能体（工具循环，自动等到人工评审门；--no-wait 立即返回）
tl-cli --data-dir $DD harness --document <documentId> \
  --instruction "翻译全文，术语跟从术语库" --max-turns 24 --verbose
```

harness 终态是 `awaitingReview`：AI 只写草稿，确认与导出必须由你
（或人类）显式执行——这是产品的硬边界，不是限制项。

## 守卫速查

| 现象 | 含义 | 正确动作 |
| --- | --- | --- |
| `conflict: segment revision moved` | 别人先写了 | 重新 `segments` 拿新 revision |
| `conflict: segment is locked` | 锁定行 | 跳过或先 `rpc segment.lock` 解锁 |
| `exportBlocked`（destination exists） | 不覆盖已有文件 | 换路径或 `--overwrite` |
| `exportBlocked`（`data.reason:"qaGate"`） | QA 有 error | 修复问题或显式覆盖门 |
| `aiNotConfigured` | 无 AI 凭据 | 先 `ai.configure`，绝不伪造 |
