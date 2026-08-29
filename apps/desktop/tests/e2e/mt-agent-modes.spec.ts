// Multi-candidate MT and the agent approval tiers against the real engine:
// two in-memory profiles answer through a loopback OpenAI-compatible SSE
// fixture, one click fans out into two candidate cards, the manual tier
// queues proposals for human review, and the turbo tier auto-confirms the
// QA-clean remainder through the real segment.confirm path.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";

const appRoot = resolve(import.meta.dirname, "../..");
const repoRoot = resolve(appRoot, "../..");
const shotsDir = join(appRoot, "test-results", "shots");

let app: ElectronApplication;
let page: Page;
let workDir: string;
let sse: Server;
let sseUrl: string;

/**
 * Loopback OpenAI-compatible endpoint: every POST answers with one SSE
 * delta whose text depends on the requested model, so each profile
 * produces a visibly different candidate.
 */
function startSseFixture(): Promise<string> {
  return new Promise((resolveUrl) => {
    sse = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on("end", () => {
        let model = "";
        try {
          model = (JSON.parse(body) as { model?: string }).model ?? "";
        } catch {
          // Non-JSON probe: answer with the fallback reply.
        }
        const reply =
          model === "model-b" ? "候选乙（模型 B）。" : "候选甲（模型 A）。";
        const payload = JSON.stringify({
          choices: [{ delta: { content: reply } }],
        });
        response.writeHead(200, {
          "content-type": "text/event-stream",
          connection: "close",
        });
        response.end(`data: ${payload}\n\ndata: [DONE]\n\n`);
      });
    });
    sse.listen(0, "127.0.0.1", () => {
      const { port } = sse.address() as AddressInfo;
      resolveUrl(`http://127.0.0.1:${port}`);
    });
  });
}

test.beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "tl-desktop-mt-agent-"));
  mkdirSync(shotsDir, { recursive: true });
  sseUrl = await startSseFixture();
  const sourcePath = join(workDir, "agent-demo.txt");
  writeFileSync(
    sourcePath,
    "Alpha sentence about apples.\n\nBravo sentence about bread.\n\nCharlie sentence about cheese.\n",
  );
  app = await electron.launch({
    args: ["."],
    cwd: appRoot,
    env: {
      ...process.env,
      TL_DATA_DIR: join(workDir, "engine-data"),
      TL_ENGINE_BIN: join(repoRoot, "target", "debug", "tl-engine"),
      TL_FAKE_OPEN_PATH: sourcePath,
      TL_FAKE_SAVE_PATH: join(workDir, "translated.txt"),
    },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
  await new Promise<void>((done) => {
    sse.close(() => done());
  });
});

async function shot(name: string) {
  await page.screenshot({ path: join(shotsDir, name), fullPage: false });
}

async function addProfile(model: string, submitLabel: string) {
  // Provider configuration lives in the application settings center (设置
  // ▸ AI 供应商), not in the dock panel.
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByLabel("供应商").selectOption("openaiCompatible");
  await settings.getByLabel("模型", { exact: true }).fill(model);
  await settings.getByLabel("Base URL").fill(sseUrl);
  await settings.getByLabel("API Key").fill("fixture-key");
  await settings
    .getByRole("button", { name: submitLabel, exact: true })
    .click();
}

test("multi-candidate MT and approval tiers against the real engine", async () => {
  await expect(page.locator(".app-statusbar__engine")).toContainText("pid", {
    timeout: 30_000,
  });

  // Project + txt import: three untranslated segments.
  await page.getByLabel("项目名称").fill("审批演示");
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("button", { name: "导入", exact: true }).click();
  const importDialog = page.locator(".tl-dialog");
  await importDialog.getByRole("button", { name: "选择文件…" }).click();
  await expect(importDialog).toContainText("agent-demo.txt");
  await importDialog.getByRole("button", { name: "导入", exact: true }).click();
  const rows = page.locator(".segment-grid tbody tr");
  await expect(rows).toHaveCount(3, { timeout: 30_000 });

  // Two profiles through the settings center: the unconfigured AI dock
  // routes there, and the loopback fixture answers both models.
  await page.getByRole("button", { name: "AI", exact: true }).click();
  const dock = page.locator(".workbench__dock");
  await dock.getByRole("button", { name: "打开 AI 设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(settings).toBeVisible();
  await addProfile("model-a", "保存配置");
  await expect(settings.getByTestId("ai-profiles")).toContainText("model-a");
  await addProfile("model-b", "添加模型");
  await expect(settings.getByTestId("ai-profiles")).toContainText("model-b");
  // Close the dialog; the dock badge mirrors the live status.
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(page.locator(".tl-panel__header .tl-badge").first()).toHaveText(
    "2 个模型",
  );

  // One click on AI 翻译 fans out across both profiles: two candidate
  // cards, each with its engine-reported provider · model, no scores.
  // Completion order follows the providers, so the cards are matched by
  // content instead of position.
  await rows.first().click();
  await dock.getByRole("button", { name: "AI 翻译" }).click();
  const candidates = dock.getByTestId("ai-candidate");
  await expect(candidates).toHaveCount(2, { timeout: 15_000 });
  const candidateA = candidates.filter({ hasText: "候选甲（模型 A）。" });
  const candidateB = candidates.filter({ hasText: "候选乙（模型 B）。" });
  await expect(candidateA).toContainText("openaiCompatible · model-a");
  await expect(candidateB).toContainText("openaiCompatible · model-b");
  await shot("20-mt-two-candidates.png");

  // The human picks candidate B; the draft lands through segment.update.
  await candidateB.getByRole("button", { name: "应用为草稿" }).click();
  await expect(page.getByLabel("句段 1 译文")).toHaveValue(
    "候选乙（模型 B）。",
  );
  await expect(
    rows.first().locator('.segment-grid__chip[data-state="draft"]'),
  ).toBeVisible();

  // Manual tier (the default): the run parks candidates as proposals and
  // writes nothing until a human decides.
  await expect(dock.getByRole("tab", { name: "手动" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await dock.getByRole("button", { name: "创建任务单并运行" }).click();
  await expect(dock.getByText("待审候选 2")).toBeVisible({ timeout: 20_000 });
  await expect(dock.getByTestId("agent-progress")).toContainText(
    "已处理 2 / 2",
  );
  await dock.getByTestId("agent-proposals").scrollIntoViewIfNeeded();
  await shot("21-agent-manual-proposals.png");

  // Approve the Bravo proposal, reject the rest: the approved row turns
  // into a draft, the rejected row stays untranslated. Proposal order
  // follows worker completion, so the card is matched by its source text.
  await dock
    .locator(".agent-proposal", { hasText: "Bravo sentence" })
    .getByRole("button", { name: "批准" })
    .click();
  await expect(dock.getByText("已写入")).toBeVisible();
  await expect(
    rows.nth(1).locator('.segment-grid__chip[data-state="draft"]'),
  ).toBeVisible();
  await dock.getByRole("button", { name: "全部拒绝" }).click();
  await expect(dock.getByText("已拒绝")).toBeVisible();
  await shot("22-agent-manual-reviewed.png");

  // Turbo tier on the remaining untranslated row: the draft lands and the
  // QA-clean segment is confirmed through the real segment.confirm (the
  // status line carries the real counters).
  await dock.getByRole("tab", { name: "Turbo" }).click();
  await expect(
    dock.getByText("草稿写入后，QA 无错误的句段自动确认并写入 TM"),
  ).toBeVisible();
  await dock.getByRole("button", { name: "创建任务单并运行" }).click();
  await expect(dock.getByTestId("agent-run-summary")).toContainText(
    "自动确认 1",
    { timeout: 20_000 },
  );
  await expect(
    rows.nth(2).locator('.segment-grid__chip[data-state="confirmed"]'),
  ).toBeVisible();
  await shot("23-agent-turbo-confirmed.png");
});
