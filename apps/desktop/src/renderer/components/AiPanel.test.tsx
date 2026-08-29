import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Segment } from "@translunar/contracts";
import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { AiStatusProvider } from "../lib/ai-status.js";
import { AiPanel } from "./AiPanel.js";

const segment: Segment = {
  id: "s1",
  documentId: "d1",
  ordinal: 0,
  structuralPath: "p:0",
  sourceText: "Click {button} to continue.",
  targetText: "",
  state: "untranslated",
  revision: 1,
  sourceHash: "hash",
  contextHash: "context",
  updatedAtMs: 1,
};

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
): void {
  const api: Partial<DesktopApi> = { invoke };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
}

function renderPanel(
  overrides: Partial<Parameters<typeof AiPanel>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <AiStatusProvider>
      <AiPanel
        activeSegment={segment}
        onApplyDraft={vi.fn()}
        onStatusMessage={vi.fn()}
        onOpenSettings={vi.fn()}
        {...overrides}
      />
    </AiStatusProvider>,
  );
}

const CONFIGURED_STATUS: EngineInvokeResponse = {
  ok: true,
  result: {
    configured: true,
    provider: "openai",
    model: "gpt-test",
    profileCount: 1,
  },
};

const RUNNING_ASSIST = {
  assistId: "assist-1",
  segmentId: "s1",
  action: "translate",
  status: "running",
  profileId: "p-default",
  cancelRequested: false,
  createdAtMs: 1,
  updatedAtMs: 1,
};

function doneAssist(result: unknown): unknown {
  return {
    ...RUNNING_ASSIST,
    status: "done",
    result,
    updatedAtMs: 2,
  };
}

afterEach(() => {
  Reflect.deleteProperty(window, "tl");
});

describe("AiPanel", () => {
  it("shows the honest unconfigured state and routes to the settings center", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: true,
        result: { configured: false, provider: null, model: null },
      }),
    );
    const onOpenSettings = vi.fn();
    renderPanel({ onOpenSettings });
    await waitFor(() => {
      expect(screen.getByText("未配置")).toBeInTheDocument();
    });
    // Configuration lives in the settings center now — the dock carries no
    // credential form and no fake output.
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByText("AI 翻译")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "打开 AI 设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("blocks Apply when the candidate breaks placeholders", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start") {
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      if (method === "ai.assist.status") {
        return Promise.resolve({
          ok: true,
          result: doneAssist({
            draftTarget: "点击按钮继续。",
            provider: "openai",
            model: "gpt-test",
            elapsedMs: 12,
            tagCheck: { ok: false, missing: ["{button}"], extra: [] },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "internal", message: `unexpected ${method}` },
      });
    });
    installBridge(invoke);
    const onApplyDraft = vi.fn();
    renderPanel({ onApplyDraft });
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(screen.getByTestId("ai-candidate")).toBeInTheDocument();
    });
    expect(screen.getByText("标签破损")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("缺失：{button}");
    expect(screen.getByRole("button", { name: "应用为草稿" })).toBeDisabled();
    // Reject stays available so the human can throw the proposal away.
    await userEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(screen.queryByTestId("ai-candidate")).not.toBeInTheDocument();
    expect(onApplyDraft).not.toHaveBeenCalled();
  });

  it("applies an intact candidate as a draft", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start") {
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      return Promise.resolve({
        ok: true,
        result: doneAssist({
          draftTarget: "点击 {button} 继续。",
          provider: "openai",
          model: "gpt-test",
          elapsedMs: 9,
          tagCheck: { ok: true, missing: [], extra: [] },
        }),
      });
    });
    installBridge(invoke);
    const onApplyDraft = vi.fn();
    renderPanel({ onApplyDraft });
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(screen.getByText("标签完整")).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai.assist.start",
      expect.objectContaining({ segmentId: "s1", action: "translate" }),
    );
    expect(invoke).toHaveBeenCalledWith("ai.assist.status", {
      assistId: "assist-1",
    });
    await userEvent.click(screen.getByRole("button", { name: "应用为草稿" }));
    // The provider model travels with the text so the segment.update can
    // stamp an honest aiDraft origin.
    expect(onApplyDraft).toHaveBeenCalledWith(
      "点击 {button} 继续。",
      "gpt-test",
    );
  });

  it("surfaces a failed assist run instead of pretending", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start") {
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      return Promise.resolve({
        ok: true,
        result: {
          ...RUNNING_ASSIST,
          status: "failed",
          errorMessage: "AI call failed: AI provider is unavailable",
          updatedAtMs: 2,
        },
      });
    });
    installBridge(invoke);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "AI provider is unavailable",
      );
    });
    expect(screen.queryByTestId("ai-candidate")).not.toBeInTheDocument();
  });

  it("cancels an in-flight assist and frees the buttons", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start" || method === "ai.assist.status") {
        // The provider never answers: the run stays in flight.
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      if (method === "ai.assist.cancel") {
        return Promise.resolve({
          ok: true,
          result: { ...RUNNING_ASSIST, cancelRequested: true },
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "internal", message: `unexpected ${method}` },
      });
    });
    installBridge(invoke);
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "取消请求" }),
      ).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "取消请求" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.assist.cancel", {
        assistId: "assist-1",
      });
    });
    // The panel frees up without a candidate; no result is faked.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "AI 翻译" })).toBeEnabled();
    });
    expect(screen.queryByTestId("ai-candidate")).not.toBeInTheDocument();
  });

  it("refuses to touch confirmed segments", async () => {
    installBridge(vi.fn().mockResolvedValue(CONFIGURED_STATUS));
    renderPanel({
      activeSegment: { ...segment, state: "confirmed", targetText: "已确认" },
    });
    await waitFor(() => {
      expect(screen.getByText("该句段已确认")).toBeInTheDocument();
    });
    expect(screen.queryByText("AI 翻译")).not.toBeInTheDocument();
  });

  it("runs a menu-driven assist request exactly once", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.assist.start") {
        return Promise.resolve({ ok: true, result: RUNNING_ASSIST });
      }
      return Promise.resolve({
        ok: true,
        result: doneAssist({
          draftTarget: "点击 {button} 继续。",
          provider: "openai",
          model: "gpt-test",
          elapsedMs: 9,
          tagCheck: { ok: true, missing: [], extra: [] },
        }),
      });
    });
    installBridge(invoke);
    const onRequestConsumed = vi.fn();
    const view = renderPanel({
      request: { action: "translate", token: 1 },
      onRequestConsumed,
    });
    // The menu request runs the same assist the panel button runs.
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai.assist.start",
        expect.objectContaining({ segmentId: "s1", action: "translate" }),
      );
    });
    expect(onRequestConsumed).toHaveBeenCalled();

    // The same token never replays across re-renders.
    const startCalls = () =>
      invoke.mock.calls.filter(([method]) => method === "ai.assist.start")
        .length;
    const before = startCalls();
    view.rerender(
      <AiStatusProvider>
        <AiPanel
          activeSegment={segment}
          onApplyDraft={vi.fn()}
          onStatusMessage={vi.fn()}
          onOpenSettings={vi.fn()}
          request={{ action: "translate", token: 1 }}
          onRequestConsumed={onRequestConsumed}
        />
      </AiStatusProvider>,
    );
    expect(startCalls()).toBe(before);
  });

  it("drops the menu request while unconfigured instead of faking a run", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      result: { configured: false, provider: null, model: null },
    });
    installBridge(invoke);
    const onRequestConsumed = vi.fn();
    renderPanel({
      request: { action: "translate", token: 1 },
      onRequestConsumed,
    });
    await waitFor(() => {
      expect(screen.getByText("未配置")).toBeInTheDocument();
    });
    // Consumed but never started: the panel already shows why it refuses.
    await waitFor(() => {
      expect(onRequestConsumed).toHaveBeenCalled();
    });
    expect(
      invoke.mock.calls.some(([method]) => method === "ai.assist.start"),
    ).toBe(false);
  });

  it("fans one request out across profiles and shows one card per model", async () => {
    const profileA = {
      profileId: "p-a",
      provider: "openai",
      model: "gpt-a",
      label: "甲",
      baseUrl: "",
      createdAtMs: 1,
    };
    const profileB = {
      profileId: "p-b",
      provider: "deepseek",
      model: "ds-b",
      label: "乙",
      baseUrl: "",
      createdAtMs: 2,
    };
    const doneFor = (profileId: string) => ({
      assistId: `assist-${profileId}`,
      segmentId: "s1",
      action: "translate",
      status: "done",
      profileId,
      cancelRequested: false,
      createdAtMs: 1,
      updatedAtMs: 2,
      result:
        profileId === "p-a"
          ? {
              draftTarget: "点击 {button} 甲。",
              provider: "openai",
              model: "gpt-a",
              elapsedMs: 11,
              tagCheck: { ok: true, missing: [], extra: [] },
            }
          : {
              draftTarget: "点击 {button} 乙。",
              provider: "deepseek",
              model: "ds-b",
              elapsedMs: 22,
              tagCheck: { ok: true, missing: [], extra: [] },
            },
    });
    const invoke = vi.fn(
      (method: string, params: unknown): Promise<EngineInvokeResponse> => {
        if (method === "ai.status") {
          return Promise.resolve({
            ok: true,
            result: {
              configured: true,
              provider: "openai",
              model: "gpt-a",
              profileCount: 2,
            },
          });
        }
        if (method === "ai.profile.list") {
          return Promise.resolve({
            ok: true,
            result: { profiles: [profileA, profileB], defaultProfileId: "p-a" },
          });
        }
        if (method === "ai.assist.start") {
          const { profileId } = params as { profileId: string };
          return Promise.resolve({ ok: true, result: doneFor(profileId) });
        }
        return Promise.resolve({
          ok: false,
          error: { code: "internal", message: `unexpected ${method}` },
        });
      },
    );
    installBridge(invoke);
    const onApplyDraft = vi.fn();
    renderPanel({ onApplyDraft });
    await waitFor(() => {
      expect(screen.getByText("AI 翻译")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "AI 翻译" }));

    // One start per profile: the engine runs them in parallel per profile.
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "ai.assist.start",
        expect.objectContaining({ segmentId: "s1", profileId: "p-a" }),
      );
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai.assist.start",
      expect.objectContaining({ segmentId: "s1", profileId: "p-b" }),
    );

    // Two cards, each carrying its own engine-reported provider/model and
    // elapsed time — no scores, no ranking.
    await waitFor(() => {
      expect(screen.getAllByTestId("ai-candidate")).toHaveLength(2);
    });
    const cards = screen.getAllByTestId("ai-candidate");
    expect(cards[0]).toHaveTextContent("openai · gpt-a");
    expect(cards[0]).toHaveTextContent("11ms");
    expect(cards[1]).toHaveTextContent("deepseek · ds-b");
    expect(cards[1]).toHaveTextContent("22ms");
    expect(screen.queryByText(/最佳/)).not.toBeInTheDocument();
    expect(screen.queryByText(/排名/)).not.toBeInTheDocument();

    // 拒绝 clears one card, the other stays.
    await userEvent.click(screen.getAllByRole("button", { name: "拒绝" })[0]!);
    expect(screen.getAllByTestId("ai-candidate")).toHaveLength(1);

    // Applying hands the chosen candidate's text and model to the write.
    await userEvent.click(screen.getByRole("button", { name: "应用为草稿" }));
    expect(onApplyDraft).toHaveBeenCalledWith("点击 {button} 乙。", "ds-b");
    expect(screen.queryByTestId("ai-candidate")).not.toBeInTheDocument();
  });

  it("drops a menu refine request when the target is empty", async () => {
    const invoke = vi.fn().mockResolvedValue(CONFIGURED_STATUS);
    installBridge(invoke);
    const onRequestConsumed = vi.fn();
    renderPanel({
      activeSegment: { ...segment, targetText: "" },
      request: { action: "refine", token: 1 },
      onRequestConsumed,
    });
    await waitFor(() => {
      expect(onRequestConsumed).toHaveBeenCalled();
    });
    expect(
      invoke.mock.calls.some(([method]) => method === "ai.assist.start"),
    ).toBe(false);
  });
});
