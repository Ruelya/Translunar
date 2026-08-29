import { describe, expect, it, vi } from "vitest";

import type { MenuItemConstructorOptions } from "electron";

import { MENU_BAR_ITEMS } from "../shared/desktop-api.js";
import type { MenuCommand, MenuContext } from "../shared/desktop-api.js";
import {
  RENDERER_OWNED_ACCELERATORS,
  buildMenuTemplate,
  menuBarSubmenu,
} from "./menu-template.js";
import type { MenuTemplateOptions } from "./menu-template.js";

/**
 * The menu's keymap contract: every command item, which accelerator it
 * shows, whether the renderer owns that chord (accelerator display-only on
 * Windows/Linux), and what state it needs to be enabled. This mirrors the
 * workbench: F3 / F4 / Shift+F4 / Ctrl+Enter / Ctrl+F are renderer keydown
 * handlers; the remaining accelerators have no prior binding and are
 * menu-owned.
 */
const COMMAND_ITEMS: Array<{
  label: string;
  command: MenuCommand;
  accelerator?: string;
  rendererOwned?: boolean;
  needs: "project" | "document" | "none";
}> = [
  { label: "新建项目…", command: "new-project", needs: "none" },
  {
    label: "导入文档…",
    command: "import-document",
    accelerator: "CmdOrCtrl+O",
    needs: "project",
  },
  {
    label: "导出译文…",
    command: "export-document",
    accelerator: "CmdOrCtrl+E",
    needs: "document",
  },
  {
    label: "项目设置…",
    command: "open-project-settings",
    accelerator: "CmdOrCtrl+,",
    needs: "project",
  },
  { label: "应用设置…", command: "open-app-settings", needs: "none" },
  { label: "返回项目列表", command: "close-project", needs: "project" },
  {
    label: "确认当前句段",
    command: "confirm-segment",
    accelerator: "CmdOrCtrl+Enter",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "确认并到下一句段",
    command: "confirm-segment-any",
    accelerator: "CmdOrCtrl+Alt+Enter",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "确认并停留",
    command: "confirm-segment-stay",
    accelerator: "CmdOrCtrl+Alt+Shift+Enter",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "确认但跳过 TM 写入",
    command: "confirm-segment-skip-tm",
    accelerator: "CmdOrCtrl+Shift+Enter",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "锁定/解锁句段",
    command: "toggle-lock-segment",
    accelerator: "CmdOrCtrl+L",
    needs: "document",
  },
  {
    label: "命令面板",
    command: "open-command-palette",
    accelerator: "CmdOrCtrl+Shift+P",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "预览面板",
    command: "toggle-preview",
    accelerator: "CmdOrCtrl+P",
    needs: "document",
  },
  {
    label: "记忆面板",
    command: "show-dock-memory",
    accelerator: "CmdOrCtrl+1",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "术语面板",
    command: "show-dock-term",
    accelerator: "CmdOrCtrl+2",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "QA 面板",
    command: "show-dock-qa",
    accelerator: "CmdOrCtrl+3",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "AI 面板",
    command: "show-dock-ai",
    accelerator: "CmdOrCtrl+4",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "查找…",
    command: "open-find",
    accelerator: "CmdOrCtrl+F",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "替换…",
    command: "open-replace",
    accelerator: "CmdOrCtrl+H",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "查找下一个",
    command: "find-next",
    accelerator: "F4",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "查找上一个",
    command: "find-prev",
    accelerator: "Shift+F4",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "筛选句段",
    command: "focus-filter",
    accelerator: "CmdOrCtrl+Shift+F",
    rendererOwned: true,
    needs: "document",
  },
  {
    label: "检索（取选中文本）",
    command: "open-concordance",
    accelerator: "F3",
    rendererOwned: true,
    needs: "project",
  },
  {
    label: "转到句段…",
    command: "go-to-segment",
    accelerator: "CmdOrCtrl+G",
    rendererOwned: true,
    needs: "document",
  },
  { label: "下一未译句段", command: "next-untranslated", needs: "document" },
  { label: "下一草稿句段", command: "next-draft", needs: "document" },
  {
    label: "下一 QA 句段",
    command: "next-qa",
    accelerator: "F8",
    rendererOwned: true,
    needs: "document",
  },
  { label: "下一锁定句段", command: "next-locked", needs: "document" },
  { label: "折叠左栏", command: "toggle-left", needs: "project" },
  { label: "折叠右栏", command: "toggle-right", needs: "project" },
  { label: "记忆库管理…", command: "open-tm-manage", needs: "project" },
  { label: "术语库管理…", command: "open-term-manage", needs: "project" },
  { label: "归档项目", command: "archive-project", needs: "project" },
  { label: "复制源文到译文", command: "copy-source", needs: "document" },
  { label: "清空译文", command: "clear-target", needs: "document" },
  { label: "编辑源文", command: "edit-source", needs: "document" },
  { label: "预翻译（TM）", command: "pretranslate", needs: "document" },
  { label: "插入记忆匹配", command: "insert-tm", needs: "document" },
  { label: "插入术语", command: "insert-term", needs: "document" },
  { label: "AI 翻译当前句段", command: "ai-translate", needs: "document" },
  { label: "AI 润色当前句段", command: "ai-refine", needs: "document" },
  { label: "Agent 模式…", command: "show-dock-ai", needs: "project" },
  { label: "运行 QA", command: "run-qa", needs: "document" },
  { label: "忽略当前问题", command: "waive", needs: "document" },
  { label: "忽略同类问题", command: "waive-rule", needs: "document" },
  { label: "忽略本句问题", command: "waive-segment", needs: "document" },
  { label: "恢复为未解决", command: "restore", needs: "document" },
  { label: "应用引擎修复", command: "apply-fix", needs: "document" },
  { label: "键盘快捷键…", command: "help-keys", needs: "none" },
];

function build(
  context: MenuContext,
  overrides: Partial<MenuTemplateOptions> = {},
): {
  template: MenuItemConstructorOptions[];
  onCommand: ReturnType<typeof vi.fn>;
} {
  const onCommand = vi.fn();
  const template = buildMenuTemplate({
    platform: "linux",
    appName: "Translunar CAT",
    context,
    onCommand,
    ...overrides,
  });
  return { template, onCommand };
}

function flatten(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  const all: MenuItemConstructorOptions[] = [];
  const walk = (items: MenuItemConstructorOptions[]) => {
    for (const item of items) {
      all.push(item);
      if (Array.isArray(item.submenu)) {
        walk(item.submenu);
      }
    }
  };
  walk(template);
  return all;
}

function findItem(
  template: MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions {
  const item = flatten(template).find((entry) => entry.label === label);
  if (!item) {
    throw new Error(`menu item not found: ${label}`);
  }
  return item;
}

function click(item: MenuItemConstructorOptions): void {
  (item.click as unknown as () => void)();
}

const NO_PROJECT: MenuContext = {
  projectOpen: false,
  documentOpen: false,
  exportGate: false,
};
const PROJECT_ONLY: MenuContext = {
  projectOpen: true,
  documentOpen: false,
  exportGate: false,
};
const DOCUMENT_OPEN: MenuContext = {
  projectOpen: true,
  documentOpen: true,
  exportGate: false,
};

describe("buildMenuTemplate structure", () => {
  it("lays out 文件/编辑/视图/项目/翻译/QA/帮助 on Linux and Windows", () => {
    for (const platform of ["linux", "win32"] as const) {
      const { template } = build(NO_PROJECT, { platform });
      expect(template.map((item) => item.label)).toEqual([
        "文件",
        "编辑",
        "视图",
        "项目",
        "翻译",
        "QA",
        "帮助",
      ]);
    }
  });

  it("prepends the app menu on macOS and moves quit out of 文件", () => {
    const { template } = build(NO_PROJECT, { platform: "darwin" });
    expect(template[0]?.label).toBe("Translunar CAT");
    const fileMenu = findItem(template, "文件");
    const fileRoles = (fileMenu.submenu as MenuItemConstructorOptions[]).map(
      (item) => item.role,
    );
    expect(fileRoles).not.toContain("quit");
    const appMenu = template[0]?.submenu as MenuItemConstructorOptions[];
    expect(appMenu.some((item) => item.role === "quit")).toBe(true);
  });

  it("keeps the standard edit roles and app-level roles available", () => {
    const { template } = build(NO_PROJECT);
    const roles = flatten(template)
      .map((item) => item.role)
      .filter(Boolean);
    for (const role of [
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
      "quit",
      "reload",
      "toggleDevTools",
      "togglefullscreen",
    ]) {
      expect(roles).toContain(role);
    }
  });
});

describe("buildMenuTemplate honesty (enablement)", () => {
  it("disables every workbench command when no project is open", () => {
    const { template } = build(NO_PROJECT);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).enabled, spec.label).toBe(
        spec.needs === "none",
      );
    }
  });

  it("enables project-level commands but not document-level ones without a document", () => {
    const { template } = build(PROJECT_ONLY);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).enabled, spec.label).toBe(
        spec.needs !== "document",
      );
    }
  });

  it("enables everything once a document is open", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).enabled, spec.label).toBe(true);
    }
  });

  it("never disables role items (edit/zoom/quit stay usable)", () => {
    const { template } = build(NO_PROJECT);
    for (const item of flatten(template)) {
      if (item.role) {
        expect(item.enabled, String(item.role)).not.toBe(false);
      }
    }
  });
});

describe("buildMenuTemplate zoom accelerators (Windows Ctrl+= regression)", () => {
  it("binds plain CmdOrCtrl+= as the visible zoom-in accelerator", () => {
    const { template } = build(NO_PROJECT, { platform: "win32" });
    const visible = flatten(template).find(
      (item) => item.role === "zoomIn" && item.visible !== false,
    );
    // The role default is CmdOrCtrl+Shift+= on Windows, which leaves the
    // reported Ctrl+= dead. The explicit accelerator is the fix.
    expect(visible?.accelerator).toBe("CmdOrCtrl+=");
    expect(visible?.label).toBe("放大");
  });

  it("keeps hidden aliases so Shift+= and the numpad keys also zoom", () => {
    const { template } = build(NO_PROJECT, { platform: "win32" });
    const accelerators = flatten(template)
      .filter((item) => item.role === "zoomIn" || item.role === "zoomOut")
      .map((item) => item.accelerator);
    expect(accelerators).toContain("CmdOrCtrl+Plus");
    expect(accelerators).toContain("CmdOrCtrl+numadd");
    expect(accelerators).toContain("CmdOrCtrl+numsub");
    expect(accelerators).toContain("CmdOrCtrl+-");
  });
});

describe("buildMenuTemplate QA export gate checkbox", () => {
  it("mirrors the stored gate value and dispatches toggle-gate on click", () => {
    for (const exportGate of [true, false]) {
      const { template, onCommand } = build({
        ...DOCUMENT_OPEN,
        exportGate,
      });
      const item = findItem(template, "有错误时阻止导出");
      expect(item.type).toBe("checkbox");
      expect(item.checked).toBe(exportGate);
      expect(item.enabled).toBe(true);
      click(item);
      expect(onCommand).toHaveBeenCalledWith("toggle-gate");
    }
  });

  it("disables the gate checkbox without a project", () => {
    const { template } = build(NO_PROJECT);
    const item = findItem(template, "有错误时阻止导出");
    expect(item.enabled).toBe(false);
    expect(item.checked).toBe(false);
  });
});

describe("buildMenuTemplate about entry", () => {
  it("dispatches the about dialog command on Windows/Linux", () => {
    for (const platform of ["linux", "win32"] as const) {
      const { template, onCommand } = build(NO_PROJECT, { platform });
      const item = findItem(template, "关于 Translunar CAT");
      expect(item.enabled).toBe(true);
      click(item);
      expect(onCommand).toHaveBeenCalledWith("about");
    }
  });

  it("keeps the native about role on macOS instead of a help item", () => {
    const { template } = build(NO_PROJECT, { platform: "darwin" });
    expect(
      flatten(template).some((item) => item.label === "关于 Translunar CAT"),
    ).toBe(false);
    const appMenu = template[0]?.submenu as MenuItemConstructorOptions[];
    expect(appMenu.some((item) => item.role === "about")).toBe(true);
  });
});

describe("buildMenuTemplate command dispatch", () => {
  it("clicking each command item dispatches exactly that command", () => {
    const { template, onCommand } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS) {
      onCommand.mockClear();
      click(findItem(template, spec.label));
      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onCommand).toHaveBeenCalledWith(spec.command);
    }
  });
});

describe("menuBarSubmenu (integrated titlebar popups)", () => {
  it("the seven titlebar menus are exactly the template's top level", () => {
    const { template } = build(NO_PROJECT, { platform: "win32" });
    expect(template.map((item) => item.label)).toEqual(
      MENU_BAR_ITEMS.map((item) => item.label),
    );
  });

  it("pops the same submenu object the application menu carries", () => {
    const onCommand = vi.fn();
    const options: MenuTemplateOptions = {
      platform: "win32",
      appName: "Translunar CAT",
      context: DOCUMENT_OPEN,
      onCommand,
    };
    for (const [index, item] of MENU_BAR_ITEMS.entries()) {
      const submenu = menuBarSubmenu(options, item.id);
      const top = buildMenuTemplate(options)[index];
      expect(submenu, item.id).not.toBeNull();
      expect(top?.label).toBe(item.label);
      expect(submenu?.map((entry) => entry.label)).toEqual(
        (top?.submenu as MenuItemConstructorOptions[]).map(
          (entry) => entry.label,
        ),
      );
    }
  });

  it("honors the macOS app-menu offset", () => {
    const onCommand = vi.fn();
    const options: MenuTemplateOptions = {
      platform: "darwin",
      appName: "Translunar CAT",
      context: NO_PROJECT,
      onCommand,
    };
    const submenu = menuBarSubmenu(options, "file");
    expect(submenu?.some((entry) => entry.label === "新建项目…")).toBe(true);
  });

  it("returns null for an unknown menu id", () => {
    const onCommand = vi.fn();
    expect(
      menuBarSubmenu(
        {
          platform: "win32",
          appName: "Translunar CAT",
          context: NO_PROJECT,
          onCommand,
        },
        "settings",
      ),
    ).toBeNull();
  });

  it("popup items dispatch through the same onCommand as the menu bar", () => {
    const onCommand = vi.fn();
    const submenu = menuBarSubmenu(
      {
        platform: "win32",
        appName: "Translunar CAT",
        context: DOCUMENT_OPEN,
        onCommand,
      },
      "qa",
    );
    const runQa = submenu?.find((entry) => entry.label === "运行 QA");
    expect(runQa).toBeDefined();
    click(runQa!);
    expect(onCommand).toHaveBeenCalledWith("run-qa");
  });
});

describe("buildMenuTemplate keymap (single owner per chord)", () => {
  it("shows the workbench accelerators exactly as specified", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS) {
      expect(findItem(template, spec.label).accelerator, spec.label).toBe(
        spec.accelerator,
      );
    }
  });

  it("displays renderer-owned chords without registering them", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const spec of COMMAND_ITEMS.filter((entry) => entry.rendererOwned)) {
      const item = findItem(template, spec.label);
      expect(item.registerAccelerator, spec.label).toBe(false);
      expect(RENDERER_OWNED_ACCELERATORS).toContain(spec.accelerator);
    }
  });

  it("never registers a menu accelerator over a renderer-owned chord", () => {
    const { template } = build(DOCUMENT_OPEN);
    for (const item of flatten(template)) {
      if (item.accelerator && item.registerAccelerator !== false) {
        expect(
          RENDERER_OWNED_ACCELERATORS,
          `${String(item.label)} must not swallow ${item.accelerator}`,
        ).not.toContain(item.accelerator);
      }
    }
  });

  it("assigns each accelerator to exactly one menu item", () => {
    const { template } = build(DOCUMENT_OPEN);
    const accelerators = flatten(template)
      .map((item) => item.accelerator)
      .filter((accelerator): accelerator is string => Boolean(accelerator));
    expect(new Set(accelerators).size).toBe(accelerators.length);
  });
});
