import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopApi,
  EngineInvokeResponse,
  EngineNotificationPayload,
} from "../../shared/desktop-api.js";

import { AiStatusProvider } from "../lib/ai-status.js";
import { HarnessPanel } from "./HarnessPanel.js";

const RUNNING_VIEW = {
  harnessId: "h1",
  projectId: "p1",
  documentId: "d1",
  status: "running",
  instruction: "翻译全文",
  profileId: "default",
  provider: "openaiCompatible",
  model: "fixture-model",
  webAccess: false,
  maxTurns: 24,
  turnsUsed: 0,
  cancelRequested: false,
  draftedSegments: 0,
  termsAdded: 0,
  notes: [],
  steps: [],
  createdAtMs: 1,
  updatedAtMs: 1,
};

function installBridge(
  invoke: (method: string, params: unknown) => Promise<EngineInvokeResponse>,
): {
  emitNotification: (payload: EngineNotificationPayload) => void;
} {
  let listener: ((payload: EngineNotificationPayload) => void) | null = null;
  const api: Partial<DesktopApi> = {
    invoke,
    onNotification(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
  return {
    emitNotification: (payload) => listener?.(payload),
  };
}

function renderPanel(): ReturnType<typeof render> {
  return render(
    <AiStatusProvider>
      <HarnessPanel
        documentId="d1"
        onCompleted={vi.fn()}
        onStatusMessage={vi.fn()}
        onJumpToSegment={vi.fn()}
      />
    </AiStatusProvider>,
  );
}

const CONFIGURED_STATUS: EngineInvokeResponse = {
  ok: true,
  result: {
    configured: true,
    provider: "openaiCompatible",
    model: "fixture-model",
    profileCount: 1,
  },
};

afterEach(() => {
  Reflect.deleteProperty(window, "tl");
});

describe("HarnessPanel", () => {
  it("starts a run with instruction, turn budget, and explicit web access", async () => {
    const invoke = vi.fn(
      (method: string, params: unknown): Promise<EngineInvokeResponse> => {
        if (method === "ai.status") {
          return Promise.resolve(CONFIGURED_STATUS);
        }
        if (method === "ai.harness.start") {
          const request = params as Record<string, unknown>;
          expect(request.documentId).toBe("d1");
          expect(request.instruction).toBe("术语跟从术语库");
          expect(request.maxTurns).toBe(12);
          expect(request.webAccess).toBe(true);
          return Promise.resolve({
            ok: true,
            result: { ...RUNNING_VIEW, maxTurns: 12, webAccess: true },
          });
        }
        if (method === "ai.harness.status") {
          return Promise.resolve({
            ok: true,
            result: { ...RUNNING_VIEW, maxTurns: 12, webAccess: true },
          });
        }
        return Promise.resolve({
          ok: false,
          error: { code: "internal", message: `unexpected ${method}` },
        });
      },
    );
    installBridge(invoke);
    renderPanel();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "启动全文智能体" }),
      ).toBeEnabled();
    });
    await userEvent.type(
      screen.getByLabelText("任务指令（可选）"),
      "术语跟从术语库",
    );
    await userEvent.type(
      screen.getByLabelText("轮次预算（默认 24，上限 64）"),
      "12",
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(
      screen.getByRole("button", { name: "启动全文智能体" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("harness-progress")).toBeInTheDocument();
    });
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith(
      "ai.harness.start",
      expect.objectContaining({ webAccess: true }),
    );
  });

  it("refuses honestly while unconfigured", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: true,
        result: { configured: false, provider: null, model: null },
      }),
    );
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("未配置 AI 供应商")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "启动全文智能体" }),
    ).toBeDisabled();
  });

  it("streams steps from the reserved notification and shows the summary", async () => {
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve(CONFIGURED_STATUS);
      }
      if (method === "ai.harness.start") {
        return Promise.resolve({ ok: true, result: RUNNING_VIEW });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "internal", message: `unexpected ${method}` },
      });
    });
    const bridge = installBridge(invoke);
    renderPanel();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "启动全文智能体" }),
      ).toBeEnabled();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "启动全文智能体" }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("harness-progress")).toBeInTheDocument();
    });
    act(() => {
      bridge.emitNotification({
        method: "notify.ai.harness.step",
        params: {
          harnessId: "h1",
          documentId: "d1",
          runStatus: "running",
          step: {
            index: 0,
            kind: "draft",
            status: "done",
            segmentId: "s1",
            detail: "写入草稿：你好，世界。",
          },
        },
      });
    });
    expect(screen.getByText("写入草稿：你好，世界。")).toBeInTheDocument();
    // The terminal notification flips the badge without waiting for a poll.
    act(() => {
      bridge.emitNotification({
        method: "notify.ai.harness.step",
        params: {
          harnessId: "h1",
          documentId: "d1",
          runStatus: "awaitingReview",
          step: {
            index: 1,
            kind: "summary",
            status: "done",
            detail: "完成 1 段草稿。",
          },
        },
      });
    });
    expect(screen.getByText("等待人工审核")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "去工作台查看草稿" }),
    ).toBeInTheDocument();
  });
});
