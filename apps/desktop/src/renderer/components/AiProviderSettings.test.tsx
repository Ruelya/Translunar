import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { AiStatusProvider } from "../lib/ai-status.js";
import { AiProviderSettings } from "./AiProviderSettings.js";

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

function renderSettings(): ReturnType<typeof render> {
  return render(
    <AiStatusProvider>
      <AiProviderSettings onStatusMessage={vi.fn()} />
    </AiStatusProvider>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, "tl");
});

describe("AiProviderSettings", () => {
  it("guides every input: endpoint placeholder, path-level hint, model examples", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: true,
        result: { configured: false, provider: null, model: null },
      }),
    );
    renderSettings();
    await waitFor(() => {
      expect(screen.getByLabelText("供应商")).toBeInTheDocument();
    });
    // The reader can see the expected format instead of recalling it
    // (Nielsen: recognition over recall).
    const baseUrl = screen.getByLabelText("Base URL");
    expect(baseUrl).toHaveAttribute("placeholder", "https://api.openai.com/v1");
    expect(
      screen.getByText(/填到 \/v1 一级（不含 \/chat\/completions）/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("模型")).toHaveAttribute(
      "placeholder",
      "gpt-4.1",
    );
    // Switching provider swaps the guidance with it.
    await userEvent.selectOptions(screen.getByLabelText("供应商"), "deepseek");
    expect(screen.getByLabelText("Base URL")).toHaveAttribute(
      "placeholder",
      "https://api.deepseek.com/v1",
    );
  });

  it("reveals and re-masks the API key on demand", async () => {
    installBridge(
      vi.fn().mockResolvedValue({
        ok: true,
        result: { configured: false, provider: null, model: null },
      }),
    );
    renderSettings();
    const key = await screen.findByLabelText("API Key");
    expect(key).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "显示" }));
    expect(key).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "隐藏" }));
    expect(key).toHaveAttribute("type", "password");
  });

  it("adds the first profile through ai.profile.add and never echoes the key", async () => {
    let added = false;
    const profile = {
      profileId: "p1",
      provider: "gemini",
      model: "gemini-2.5-flash",
      label: "Gemini 主力",
      baseUrl: "https://gateway.example/v1beta",
      createdAtMs: 1,
    };
    const invoke = vi.fn(
      (method: string, params: unknown): Promise<EngineInvokeResponse> => {
        if (method === "ai.status") {
          return Promise.resolve(
            added
              ? {
                  ok: true,
                  result: {
                    configured: true,
                    provider: "gemini",
                    model: "gemini-2.5-flash",
                    profileCount: 1,
                  },
                }
              : {
                  ok: true,
                  result: { configured: false, provider: null, model: null },
                },
          );
        }
        if (method === "ai.profile.add") {
          added = true;
          void params;
          return Promise.resolve({
            ok: true,
            result: { profiles: [profile], defaultProfileId: "p1" },
          });
        }
        if (method === "ai.profile.list") {
          return Promise.resolve({
            ok: true,
            result: { profiles: [profile], defaultProfileId: "p1" },
          });
        }
        return Promise.resolve({
          ok: false,
          error: { code: "internal", message: `unexpected ${method}` },
        });
      },
    );
    installBridge(invoke);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByLabelText("供应商")).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByLabelText("供应商"), "gemini");
    await userEvent.type(screen.getByLabelText("模型"), "gemini-2.5-flash");
    await userEvent.type(
      screen.getByLabelText("显示名（可选）"),
      "Gemini 主力",
    );
    await userEvent.type(
      screen.getByLabelText("Base URL"),
      "https://gateway.example/v1beta",
    );
    await userEvent.type(screen.getByLabelText("API Key"), "test-key");
    await userEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.profile.add", {
        provider: "gemini",
        model: "gemini-2.5-flash",
        label: "Gemini 主力",
        baseUrl: "https://gateway.example/v1beta",
        apiKey: "test-key",
      });
    });
    // Save feedback is explicit, and the badge reports the live config.
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已验证并保存");
    });
    expect(screen.getByText(/gemini · gemini-2.5-flash/)).toBeInTheDocument();
    expect(screen.getByText("Gemini 主力")).toBeInTheDocument();
    // The key never comes back: no field or row carries it.
    expect(screen.queryByDisplayValue("test-key")).not.toBeInTheDocument();
    expect(screen.queryByText(/test-key/)).not.toBeInTheDocument();
  });

  it("removes a profile through ai.profile.remove", async () => {
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
    let profiles = [profileA, profileB];
    const invoke = vi.fn((method: string): Promise<EngineInvokeResponse> => {
      if (method === "ai.status") {
        return Promise.resolve({
          ok: true,
          result: {
            configured: true,
            provider: profiles[0]?.provider ?? null,
            model: profiles[0]?.model ?? null,
            profileCount: profiles.length,
          },
        });
      }
      if (method === "ai.profile.list") {
        return Promise.resolve({
          ok: true,
          result: { profiles, defaultProfileId: profiles[0]?.profileId },
        });
      }
      if (method === "ai.profile.remove") {
        profiles = [profileB];
        return Promise.resolve({
          ok: true,
          result: { profiles, defaultProfileId: "p-b" },
        });
      }
      return Promise.resolve({
        ok: false,
        error: { code: "internal", message: `unexpected ${method}` },
      });
    });
    installBridge(invoke);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText("甲")).toBeInTheDocument();
    });
    await userEvent.click(screen.getAllByRole("button", { name: "移除" })[0]!);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("ai.profile.remove", {
        profileId: "p-a",
      });
    });
    // The engine's refreshed list drives the rows; the removed row is gone.
    await waitFor(() => {
      expect(screen.queryByText("甲")).not.toBeInTheDocument();
    });
    expect(screen.getByText("乙")).toBeInTheDocument();
  });
});
