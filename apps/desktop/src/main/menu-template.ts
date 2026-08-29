/**
 * Pure construction of the application menu template. No `electron` value
 * imports so the template (labels, accelerators, enablement, command
 * dispatch) is unit-testable outside an Electron main process; the wiring
 * lives in `menu.ts`.
 *
 * Keymap ownership rule (spec: editor/workbench chords are renderer-owned,
 * main must not swallow them):
 * - Chords the renderer already listens for (F3 concordance, F4/Shift+F4
 *   find next/prev, Ctrl+Enter confirm) and workbench-interaction chords
 *   (Ctrl+F/Ctrl+H find widget, Ctrl+Shift+F filter) are displayed
 *   in the menu but NOT registered as global accelerators on Windows/Linux
 *   (`registerAccelerator: false`), so the raw key events keep reaching the
 *   renderer keymap. Clicking the item dispatches the same command over IPC.
 * - App-level commands with no prior binding (import/export/preview/
 *   settings/dock tabs) get their accelerator from the menu itself, which
 *   is their single owner.
 */

import type { MenuItemConstructorOptions } from "electron";

import { MENU_BAR_ITEMS } from "../shared/desktop-api.js";
import type {
  MenuBarItemId,
  MenuCommand,
  MenuContext,
} from "../shared/desktop-api.js";

export interface MenuTemplateOptions {
  platform: NodeJS.Platform;
  appName: string;
  context: MenuContext;
  onCommand: (command: MenuCommand) => void;
}

/** Accelerators owned by renderer keydown handlers, never by the menu. */
export const RENDERER_OWNED_ACCELERATORS: readonly string[] = [
  "F3",
  "F4",
  "Shift+F4",
  "F8",
  "CmdOrCtrl+Enter",
  "CmdOrCtrl+Alt+Enter",
  "CmdOrCtrl+Alt+Shift+Enter",
  "CmdOrCtrl+Shift+Enter",
  "CmdOrCtrl+F",
  "CmdOrCtrl+G",
  "CmdOrCtrl+H",
  "CmdOrCtrl+Shift+F",
  "CmdOrCtrl+Shift+P",
  // Ctrl+数字: dock switch normally, numbered-TM-match apply while the
  // grid editor has focus — only the renderer can tell the two apart.
  "CmdOrCtrl+1",
  "CmdOrCtrl+2",
  "CmdOrCtrl+3",
  "CmdOrCtrl+4",
];

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

/** The shared menu-bar list is the single owner of the top-level labels. */
function menuBarLabel(id: MenuBarItemId): string {
  const item = MENU_BAR_ITEMS.find((entry) => entry.id === id);
  if (!item) {
    throw new Error(`unknown menu bar id: ${id}`);
  }
  return item.label;
}

export function buildMenuTemplate(
  options: MenuTemplateOptions,
): MenuItemConstructorOptions[] {
  const { platform, appName, context, onCommand } = options;
  const isMac = platform === "darwin";

  const commandItem = (
    label: string,
    command: MenuCommand,
    enabled: boolean,
    accelerator?: string,
    rendererOwned = false,
  ): MenuItemConstructorOptions => ({
    label,
    enabled,
    ...(accelerator ? { accelerator } : {}),
    ...(rendererOwned ? { registerAccelerator: false } : {}),
    click: () => onCommand(command),
  });

  const fileMenu: MenuItemConstructorOptions = {
    label: menuBarLabel("file"),
    submenu: [
      // Always enabled: creating a project needs no open project — from
      // inside one it returns to the list with the create form focused.
      commandItem("新建项目…", "new-project", true),
      commandItem(
        "导入文档…",
        "import-document",
        context.projectOpen,
        "CmdOrCtrl+O",
      ),
      commandItem(
        "导出译文…",
        "export-document",
        context.documentOpen,
        "CmdOrCtrl+E",
      ),
      SEPARATOR,
      commandItem(
        "项目设置…",
        "open-project-settings",
        context.projectOpen,
        "CmdOrCtrl+,",
      ),
      commandItem("返回项目列表", "close-project", context.projectOpen),
      ...(isMac ? [] : [SEPARATOR, { role: "quit", label: "退出" } as const]),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: menuBarLabel("edit"),
    submenu: [
      { role: "undo", label: "撤销" },
      { role: "redo", label: "重做" },
      SEPARATOR,
      { role: "cut", label: "剪切" },
      { role: "copy", label: "复制" },
      { role: "paste", label: "粘贴" },
      { role: "selectAll", label: "全选" },
      SEPARATOR,
      // Renderer-owned Ctrl+F summons the floating find widget (find row);
      // Ctrl+H summons it with the replace row revealed. Find jumps the
      // selection and never hides rows — hiding is the filter channel.
      commandItem(
        "查找…",
        "open-find",
        context.documentOpen,
        "CmdOrCtrl+F",
        true,
      ),
      commandItem(
        "替换…",
        "open-replace",
        context.documentOpen,
        "CmdOrCtrl+H",
        true,
      ),
      // Renderer-owned F4 / Shift+F4 jump the selection through segments
      // matching the find query without hiding any rows.
      commandItem("查找下一个", "find-next", context.documentOpen, "F4", true),
      commandItem(
        "查找上一个",
        "find-prev",
        context.documentOpen,
        "Shift+F4",
        true,
      ),
      // Renderer-owned Ctrl+Shift+F focuses the grid filter input (display
      // filter: hides rows, chips on the grid toolbar).
      commandItem(
        "筛选句段",
        "focus-filter",
        context.documentOpen,
        "CmdOrCtrl+Shift+F",
        true,
      ),
      // Renderer-owned F3 seeds concordance from the current selection.
      commandItem(
        "检索（取选中文本）",
        "open-concordance",
        context.projectOpen,
        "F3",
        true,
      ),
      SEPARATOR,
      // Go-to family: jumps the selection without hiding rows (the display
      // filter is a separate channel). Renderer-owned Ctrl+G opens the
      // segment-number dialog; renderer-owned plain F8 (never Alt+F4-adjacent
      // chords) jumps to the next open QA finding.
      commandItem(
        "转到句段…",
        "go-to-segment",
        context.documentOpen,
        "CmdOrCtrl+G",
        true,
      ),
      commandItem("下一未译句段", "next-untranslated", context.documentOpen),
      commandItem("下一草稿句段", "next-draft", context.documentOpen),
      commandItem("下一 QA 句段", "next-qa", context.documentOpen, "F8", true),
      commandItem("下一锁定句段", "next-locked", context.documentOpen),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: menuBarLabel("view"),
    submenu: [
      // Renderer-owned Ctrl+Shift+P (with Ctrl+K as a synonym chord the
      // renderer also listens for) summons the command palette.
      commandItem(
        "命令面板",
        "open-command-palette",
        context.projectOpen,
        "CmdOrCtrl+Shift+P",
        true,
      ),
      SEPARATOR,
      // Toggles the collapsible bottom preview pane (PRD §7.4).
      commandItem(
        "预览面板",
        "toggle-preview",
        context.documentOpen,
        "CmdOrCtrl+P",
      ),
      // Same layout bits the splitter chevrons flip, persisted per project.
      commandItem("折叠左栏", "toggle-left", context.projectOpen),
      commandItem("折叠右栏", "toggle-right", context.projectOpen),
      SEPARATOR,
      // Four dock groups (记忆/术语/QA/AI). Renderer-owned chords: while
      // the grid editor has focus, Ctrl+数字 applies the numbered TM match
      // instead (memoQ semantics), so the renderer must see the raw keys.
      commandItem(
        "记忆面板",
        "show-dock-memory",
        context.projectOpen,
        "CmdOrCtrl+1",
        true,
      ),
      commandItem(
        "术语面板",
        "show-dock-term",
        context.projectOpen,
        "CmdOrCtrl+2",
        true,
      ),
      commandItem(
        "QA 面板",
        "show-dock-qa",
        context.projectOpen,
        "CmdOrCtrl+3",
        true,
      ),
      commandItem(
        "AI 面板",
        "show-dock-ai",
        context.projectOpen,
        "CmdOrCtrl+4",
        true,
      ),
      SEPARATOR,
      { role: "resetZoom", label: "实际大小" },
      { role: "zoomIn", label: "放大" },
      { role: "zoomOut", label: "缩小" },
      SEPARATOR,
      { role: "togglefullscreen", label: "切换全屏" },
    ],
  };

  // Project-scoped resources. 项目设置/导入/返回列表 also live in 文件 —
  // deliberate duplicates (prototype IA); the accelerator stays on the
  // 文件 instance so each chord keeps a single owner.
  const projectMenu: MenuItemConstructorOptions = {
    label: menuBarLabel("project"),
    submenu: [
      commandItem("项目设置…", "open-project-settings", context.projectOpen),
      commandItem("记忆库管理…", "open-tm-manage", context.projectOpen),
      commandItem("术语库管理…", "open-term-manage", context.projectOpen),
      SEPARATOR,
      commandItem("导入文档…", "import-document", context.projectOpen),
      commandItem("归档项目", "archive-project", context.projectOpen),
      SEPARATOR,
      commandItem("返回项目列表", "close-project", context.projectOpen),
    ],
  };

  const translateMenu: MenuItemConstructorOptions = {
    label: menuBarLabel("translate"),
    submenu: [
      // Studio confirm chord family. Same commands as the grid editor's
      // chords; display-only accelerators so the textarea handler stays
      // the owner. All three run the same segment.confirm — only the
      // navigation afterwards differs.
      commandItem(
        "确认当前句段",
        "confirm-segment",
        context.documentOpen,
        "CmdOrCtrl+Enter",
        true,
      ),
      commandItem(
        "确认并到下一句段",
        "confirm-segment-any",
        context.documentOpen,
        "CmdOrCtrl+Alt+Enter",
        true,
      ),
      commandItem(
        "确认并停留",
        "confirm-segment-stay",
        context.documentOpen,
        "CmdOrCtrl+Alt+Shift+Enter",
        true,
      ),
      commandItem(
        "确认但跳过 TM 写入",
        "confirm-segment-skip-tm",
        context.documentOpen,
        "CmdOrCtrl+Shift+Enter",
        true,
      ),
      SEPARATOR,
      // Studio's Ctrl+L. Menu-owned: no renderer keydown handler exists for
      // it, and it must fire even while the target editor has focus.
      commandItem(
        "锁定/解锁句段",
        "toggle-lock-segment",
        context.documentOpen,
        "CmdOrCtrl+L",
      ),
      commandItem("复制源文到译文", "copy-source", context.documentOpen),
      commandItem("清空译文", "clear-target", context.documentOpen),
      commandItem("编辑源文", "edit-source", context.documentOpen),
      SEPARATOR,
      commandItem("预翻译（TM）", "pretranslate", context.documentOpen),
      // The editor's Ctrl+1…9 family applies numbered matches; the menu
      // item applies match #1 and shows no accelerator (a chord range is
      // not one accelerator, and Ctrl+1 already belongs to the dock).
      commandItem("插入记忆匹配", "insert-tm", context.documentOpen),
      commandItem("插入术语", "insert-term", context.documentOpen),
      SEPARATOR,
      commandItem("AI 翻译当前句段", "ai-translate", context.documentOpen),
      commandItem("AI 润色当前句段", "ai-refine", context.documentOpen),
      commandItem("Agent 模式…", "show-dock-ai", context.projectOpen),
    ],
  };

  const qaMenu: MenuItemConstructorOptions = {
    label: menuBarLabel("qa"),
    submenu: [
      commandItem("运行 QA", "run-qa", context.documentOpen),
      commandItem("QA 面板", "show-dock-qa", context.projectOpen),
      SEPARATOR,
      commandItem("忽略当前问题", "waive", context.documentOpen),
      commandItem("忽略同类问题", "waive-rule", context.documentOpen),
      commandItem("忽略本句问题", "waive-segment", context.documentOpen),
      commandItem("恢复为未解决", "restore", context.documentOpen),
      SEPARATOR,
      commandItem("应用引擎修复", "apply-fix", context.documentOpen),
      // Checkbox mirrors the stored qa.profile gate; clicking toggles the
      // real setting through the same RPC as project settings.
      {
        label: "有错误时阻止导出",
        type: "checkbox",
        checked: context.exportGate,
        enabled: context.projectOpen,
        click: () => onCommand("toggle-gate"),
      },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: menuBarLabel("help"),
    submenu: [
      commandItem("键盘快捷键…", "help-keys", true),
      SEPARATOR,
      { role: "reload", label: "重新加载窗口" },
      { role: "toggleDevTools", label: "开发者工具" },
      // macOS keeps the native About in the app menu; elsewhere the help
      // menu opens the in-app dialog.
      ...(isMac
        ? []
        : [SEPARATOR, commandItem(`关于 ${appName}`, "about", true)]),
    ],
  };

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: "about" },
      SEPARATOR,
      { role: "quit", label: `退出 ${appName}` },
    ],
  };

  return [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    projectMenu,
    translateMenu,
    qaMenu,
    helpMenu,
  ];
}

/**
 * The named top-level submenu out of the same template the application menu
 * is built from — the integrated titlebar pops these, so a titlebar menu and
 * the classic menu bar can never disagree. Null for an unknown id.
 */
export function menuBarSubmenu(
  options: MenuTemplateOptions,
  menuId: string,
): MenuItemConstructorOptions[] | null {
  const index = MENU_BAR_ITEMS.findIndex((item) => item.id === menuId);
  if (index < 0) {
    return null;
  }
  const template = buildMenuTemplate(options);
  // macOS prepends the app menu; the menu-bar list starts at 文件 either way.
  const top = template[options.platform === "darwin" ? index + 1 : index];
  const submenu = top?.submenu;
  return Array.isArray(submenu) ? submenu : null;
}
