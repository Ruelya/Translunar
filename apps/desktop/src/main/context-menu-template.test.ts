import { describe, expect, it, vi } from "vitest";

import type { MenuItemConstructorOptions } from "electron";

import {
  buildEditableContextTemplate,
  buildSegmentContextTemplate,
  normalizeSegmentMenuContext,
} from "./context-menu-template.js";
import type { EditableFlags } from "./context-menu-template.js";

const ALL_FLAGS: EditableFlags = {
  canUndo: true,
  canRedo: true,
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
};

function labels(
  template: MenuItemConstructorOptions[],
): (string | undefined)[] {
  return template
    .filter((item) => item.type !== "separator")
    .map((item) => item.label);
}

function find(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions {
  const item = template.find((entry) => entry.label === label);
  if (!item) {
    throw new Error(`item not found: ${label}`);
  }
  return item;
}

describe("buildEditableContextTemplate", () => {
  it("offers the standard editing roles with Chinese labels", () => {
    const template = buildEditableContextTemplate(ALL_FLAGS);
    expect(labels(template)).toEqual([
      "撤销",
      "重做",
      "剪切",
      "复制",
      "粘贴",
      "全选",
    ]);
    for (const item of template) {
      if (item.type !== "separator") {
        expect(item.role, String(item.label)).toBeDefined();
        expect(item.enabled).toBe(true);
      }
    }
  });

  it("honors Chromium's edit flags for enablement", () => {
    const template = buildEditableContextTemplate({
      ...ALL_FLAGS,
      canUndo: false,
      canPaste: false,
    });
    expect(find(template, "撤销").enabled).toBe(false);
    expect(find(template, "粘贴").enabled).toBe(false);
    expect(find(template, "复制").enabled).toBe(true);
  });
});

describe("buildSegmentContextTemplate", () => {
  const baseContext = {
    ordinal: 47,
    locked: false,
    hasTarget: true,
    sourceEditable: true,
  };

  it("shows the row header and dispatches workbench commands on click", () => {
    const onCommand = vi.fn();
    const template = buildSegmentContextTemplate(baseContext, onCommand);
    expect(find(template, "句段 48").enabled).toBe(false);
    for (const [label, command] of [
      ["确认句段", "confirm-segment"],
      ["复制源文到译文", "copy-source"],
      ["清空译文", "clear-target"],
      ["编辑源文", "edit-source"],
      ["锁定句段", "toggle-lock-segment"],
    ] as const) {
      onCommand.mockClear();
      (find(template, label).click as unknown as () => void)();
      expect(onCommand).toHaveBeenCalledWith(command);
    }
  });

  it("disables writes on a locked row but keeps unlock available", () => {
    const template = buildSegmentContextTemplate(
      { ...baseContext, locked: true },
      vi.fn(),
    );
    expect(find(template, "确认句段").enabled).toBe(false);
    expect(find(template, "复制源文到译文").enabled).toBe(false);
    expect(find(template, "清空译文").enabled).toBe(false);
    expect(find(template, "编辑源文").enabled).toBe(false);
    const unlock = find(template, "解锁句段");
    expect(unlock.enabled).toBe(true);
  });

  it("drops 清空译文 for an empty target and 编辑源文 when not wired", () => {
    const template = buildSegmentContextTemplate(
      { ...baseContext, hasTarget: false, sourceEditable: false },
      vi.fn(),
    );
    expect(find(template, "清空译文").enabled).toBe(false);
    expect(template.some((item) => item.label === "编辑源文")).toBe(false);
  });
});

describe("normalizeSegmentMenuContext", () => {
  it("coerces untrusted payloads to plain facts", () => {
    expect(
      normalizeSegmentMenuContext({
        ordinal: 3.9,
        locked: "yes",
        hasTarget: true,
        sourceEditable: 1,
      }),
    ).toEqual({
      ordinal: 3,
      locked: false,
      hasTarget: true,
      sourceEditable: false,
    });
    expect(normalizeSegmentMenuContext(null)).toEqual({
      ordinal: 0,
      locked: false,
      hasTarget: false,
      sourceEditable: false,
    });
  });
});
