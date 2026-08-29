import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopApi,
  EngineInvokeResponse,
} from "../../shared/desktop-api.js";

import { AiStatusProvider } from "../lib/ai-status.js";
import { resetTypography } from "../lib/typography.js";
import { SettingsDialog } from "./SettingsDialog.js";
import type { SettingsSection } from "./SettingsDialog.js";

function installBridge(): void {
  const api: Partial<DesktopApi> = {
    invoke: (): Promise<EngineInvokeResponse> =>
      Promise.resolve({
        ok: true,
        result: { configured: false, provider: null, model: null },
      }),
  };
  Object.defineProperty(window, "tl", {
    value: api,
    configurable: true,
    writable: true,
  });
}

function Harness({ initial }: { initial: SettingsSection }) {
  return (
    <AiStatusProvider>
      <SettingsHost initial={initial} />
    </AiStatusProvider>
  );
}

function SettingsHost({ initial }: { initial: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initial);
  return (
    <SettingsDialog
      open
      section={section}
      onSectionChange={setSection}
      onClose={vi.fn()}
      onStatusMessage={vi.fn()}
    />
  );
}

afterEach(() => {
  resetTypography();
  Reflect.deleteProperty(window, "tl");
});

describe("SettingsDialog", () => {
  it("switches sections through the rail (外观/字体/AI/快捷键 in one place)", async () => {
    installBridge();
    render(<Harness initial="appearance" />);
    // 外观 hosts the theme picker.
    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "字体" }));
    expect(screen.getByLabelText("界面字体")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "AI 供应商" }));
    expect(await screen.findByLabelText("API Key")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "快捷键" }));
    expect(screen.getByText("确认当前句段")).toBeInTheDocument();
  });

  it("applies font choices immediately as root custom properties", async () => {
    installBridge();
    render(<Harness initial="typography" />);
    const root = document.documentElement.style;
    // No override until the reader chooses one — themes keep their face.
    expect(root.getPropertyValue("--tl-font-ui")).toBe("");
    await userEvent.type(screen.getByLabelText("界面字体"), "Segoe UI");
    expect(root.getPropertyValue("--tl-font-ui")).toContain('"Segoe UI"');
    await userEvent.selectOptions(screen.getByLabelText("界面字号"), "16");
    expect(root.getPropertyValue("--tl-text-md")).toBe("16px");
    expect(root.getPropertyValue("--tl-text-lg")).toBe("18px");
    await userEvent.selectOptions(screen.getByLabelText("编辑区字号"), "18");
    expect(root.getPropertyValue("--tl-editor-size")).toBe("18px");
    // 恢复默认 clears every override.
    await userEvent.click(
      screen.getByRole("button", { name: "恢复默认字体设置" }),
    );
    expect(root.getPropertyValue("--tl-font-ui")).toBe("");
    expect(root.getPropertyValue("--tl-text-md")).toBe("");
    expect(root.getPropertyValue("--tl-editor-size")).toBe("");
  });
});
