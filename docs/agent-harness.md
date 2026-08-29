# Agent Harness：MT 流水线与全文智能体的分界

本文档是 AGENT 模式重设计的依据与实现说明。核心论点：**传统 MT 的
正确形态是按句段的批量流水线，LLM 的正确形态是全文感知的工具循环**，
两者必须是两个产品面，而不是同一个面板上的三个档位。

## 1. 为什么要分界

按句段、短上下文、高并发地调用 LLM，是把 LLM 当 MT 用：

- 浪费其全文语境推理能力——这是 LLM 区别于传统 MT 的最重要能力，
  也是高翻译质量的来源；
- 高并发短请求的流量特征易被供应商判为滥用；
- 每段一个独立请求意味着术语一致性、指代衔接、风格统一只能靠
  prompt 里塞邻句，治标不治本。

因此产品分为两个面：

| | 批量预翻（MT 流水线） | AGENT（全文智能体） |
|---|---|---|
| 协议 | `ai.agent.*`（原有） | `ai.harness.*`（新增） |
| 单位 | 句段 | 任务（整篇文档） |
| 并发 | 4 worker 扇出 | 单会话工具循环 |
| 上下文 | 邻句窗口 + TM/术语注入 | 全文地图 + 按需读取 + 笔记 |
| 能力 | TM 预翻 + 逐段起草 | 读全文、查/写术语、写草稿、跑 QA、检索网络、自管记忆 |
| 适用 | 大批量粗翻、传统 MT 心智 | 质量优先、上下文敏感的文档 |

两者共享同一套硬边界（见 §4）。

## 2. 原生 Harness 架构（引擎内）

### 2.1 线程模型

延续引擎既有的单线程 + worker 事件泵设计（`main.rs` 把 stdin 帧与
worker 事件汇入同一循环）：

```text
harness worker 线程                引擎线程（单线程，无锁）
  execute_provider(messages)
  解析模型输出中的工具调用
  ── EngineEvent::HarnessTool ──▶  执行工具（本地 SQLite，快）
  ◀── per-run mpsc 回执 ──────────  推送 notify.ai.harness.step
  把结果拼回对话，进入下一轮
```

- **本地状态工具**（读句段、写草稿、TM/术语、QA、笔记）在引擎线程
  执行——所有领域规则留在引擎，worker 不持任何引擎状态。
- **网络工具**（`web_fetch`）在 worker 线程执行——慢 IO 绝不阻塞
  引擎循环，且直接受 run 的取消旗标约束。

### 2.2 工具协议

`tl-ai` 的 provider 通道是纯文本 chat（无统一 function-calling），
v1 采用**结构化文本协议**，对所有 OpenAI 兼容端点通用：模型每轮输出
一个 JSON 工具调用（允许 ```json 围栏），例如：

```json
{ "tool": "read_segments", "args": { "offset": 40, "limit": 30 } }
```

解析失败时把错误原样回给模型并要求重试一次；连续两次无法解析即
`failed`（诚实熔断，绝不猜测意图）。

### 2.3 工具集（v1）

| 工具 | 语义 | 执行侧 |
|---|---|---|
| `overview` | 项目卡片：语言对、句段统计、挂载的记忆库/术语库、文档地图首页 | 引擎 |
| `read_segments` | 按 ordinal 窗口读句段（源/译/状态/锁定/来源），每次 ≤50 段 | 引擎 |
| `write_draft` | 写一段译文草稿。守卫：句段存在、未锁定、未确认、占位符完整性硬闸（破坏即拒绝并回报 missing/extra）；origin 记 `aiDraft`；段级 QA 同事务刷新 | 引擎 |
| `tm_lookup` | 精确+模糊 TM 查询（项目启用的挂载） | 引擎 |
| `term_lookup` | 源文内术语命中 | 引擎 |
| `term_add` | 向指定挂载术语库写词条（人工可改可删） | 引擎 |
| `qa_run` | 运行文档 QA，返回未解决问题摘要 | 引擎 |
| `note` | 追加运行笔记（scratchpad，见 §2.4） | 引擎 |
| `web_fetch` | 抓取 URL 正文（≤8 KB 文本）。默认关闭，启动参数显式开启 | worker |
| `finish` | 结束运行并给出总结 | — |

**TM 写入路径的说明**：TM 是人工确认过的语料库。harness 的译文经
`write_draft` 落为草稿，由人工确认（或批量预翻的 turbo QA 门）写入
TM——评审门本身就是 TM 写入流程的一部分，这与「每次 agent 运行都
停在人工评审门」的硬边界一致。术语库不同：词条是可回滚的参考数据，
`term_add` 允许直接写入。

### 2.4 上下文管理

对齐当代 coding harness 的通行做法（结构化压缩、scratchpad 剥离、
工具输出限幅、预算熔断——参考 Claude Code 的 compaction 层级公开
分析），在纯文本协议约束下做的 v1 实现：

- **系统提示**：身份 + 硬规则（占位符保真、术语跟从术语库、没把握
  就跳过并记笔记）+ 项目卡片 + 文档地图（分页，首页内联）+ 工具
  协议说明。
- **工具输出限幅**：每个工具有自己的输出上限（`read_segments`
  ≤50 段、`web_fetch` ≤8 KB…），超限截断并明说。
- **会话预算**：对话总量按字符预算（默认 120 K 字符）控制；超预算
  时从最旧的工具轮开始丢弃，并注入一条「早期轮次已裁剪，关键结论
  见笔记」的提示。模型被明确要求用 `note` 把阶段性结论写进笔记——
  笔记永不被裁剪（scratchpad 模式：把要保留的信息从对话流里搬进
  结构化存储）。
- **轮次熔断**：`maxTurns`（默认 24，上限 64）用尽即终止；已写的
  草稿保留在网格并明示。

### 2.5 生命周期与诚实性

- `ai.harness.start` 校验 profile 与文档后立即返回 `running`；
  无凭据即 `aiNotConfigured`，绝不伪装。
- `ai.harness.status` 轮询；`notify.ai.harness.step` 流式推送每一步
  （模型轮、工具调用、草稿落格、笔记、QA）。
- `ai.harness.cancel` 置取消旗标：worker 在下一次轮询点放弃 HTTP
  调用，已落草稿保留。
- 终态：`awaitingReview`（正常完成或轮次耗尽——草稿等人审）、
  `failed`（协议失败/供应商失败，错误原样透出）、`canceled`。
  **确认与导出永远是人工动作。**

## 3. CLI + skills（外部代理接入）

第二条通道让 Translunar 成为外部 Agent（Claude Code、Codex CLI、
opencode 等）的一个工具：

- **`tl-cli`**（`crates/tl-cli`）：spawn `tl-engine --data-dir …`，
  走同一条 JSON-RPC stdio 协议。能力与原生面等价，因为它们调用的
  是同一个引擎、同一套方法表。
  - `tl-cli rpc <method> --params '<json>'`：协议全集的万能通道。
  - 便捷子命令：`project list/create`、`document import/export`、
    `segment list/update/confirm`、`tm lookup`、`term add`、
    `qa run`、`harness start/status`。全部输出 JSON（`--pretty`
    可读化），退出码即成败。
- **技能文件** `.agents/skills/translunar-cli/SKILL.md`：教外部
  agent 完整流程（建项目→导入→翻译→确认→QA→导出），以及守卫语义
  （revision 乐观锁、锁定行为、QA 导出门）。
- **数据目录独占（v1 限制）**：引擎的元数据工作集在进程内缓存，
  同一数据目录同一时刻只允许一个引擎进程。CLI 用于桌面应用未运行
  时，或指向独立的 `--data-dir`。

## 4. 不变的硬边界

1. 引擎拥有一切领域规则与持久写入；harness 工具只是 RPC 语义的
   内部复用，渲染器与 CLI 不实现任何领域逻辑。
2. 没有凭据就诚实拒绝；任何路径都不伪装成功。
3. 每次运行停在人工评审门：AI 只写草稿，确认、TM 写入（经确认）、
   导出都是人工决定。
4. 占位符完整性是硬闸：破坏 tag 的译文永远不落格。
