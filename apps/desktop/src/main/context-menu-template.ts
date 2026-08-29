/**
 * Pure construction of the two native right-click menus. No `electron`
 * value imports, so labels, enablement and command dispatch are
 * unit-testable outside an Electron main process; the wiring lives in
 * `context-menu.ts`.
 *
 * 1. The editable-field menu (every input/textarea app-wide): standard
 *    editing roles driven by Chromium's own `editFlags`, so enablement is
 *    the platform's truth, not a renderer guess.
 * 2. The segment-row menu: the same workbench commands the ⋯ row menu and
 *    the 翻译 application menu dispatch — the context menu is a faster
 *    hand, never a second behavior.
 */

import type { MenuItemConstructorOptions } from "electron";

import type { MenuCommand, SegmentMenuContext } from "../shared/desktop-api.js";

/** The subset of Electron's ContextMenuParams.editFlags this menu reads. */
export interface EditableFlags {
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canSelectAll: boolean;
}

/**
 * Native editing menu for a right-click inside an editable field. Roles
 * only — Chromium performs the edits, the renderer never re-implements
 * clipboard behavior.
 */
export function buildEditableContextTemplate(
  flags: EditableFlags,
): MenuItemConstructorOptions[] {
  return [
    { role: "undo", label: "撤销", enabled: flags.canUndo },
    { role: "redo", label: "重做", enabled: flags.canRedo },
    { type: "separator" },
    { role: "cut", label: "剪切", enabled: flags.canCut },
    { role: "copy", label: "复制", enabled: flags.canCopy },
    { role: "paste", label: "粘贴", enabled: flags.canPaste },
    { type: "separator" },
    { role: "selectAll", label: "全选", enabled: flags.canSelectAll },
  ];
}

/**
 * The renderer payload crosses a trust boundary; coerce to plain values.
 */
export function normalizeSegmentMenuContext(raw: unknown): SegmentMenuContext {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  return {
    ordinal:
      typeof record.ordinal === "number" && Number.isFinite(record.ordinal)
        ? Math.max(0, Math.trunc(record.ordinal))
        : 0,
    locked: record.locked === true,
    hasTarget: record.hasTarget === true,
    sourceEditable: record.sourceEditable === true,
  };
}

/**
 * Native right-click menu for one segment row. Every item dispatches an
 * existing workbench command; the renderer selected the row before popping
 * the menu, so the commands land on the intended segment.
 */
export function buildSegmentContextTemplate(
  context: SegmentMenuContext,
  onCommand: (command: MenuCommand) => void,
): MenuItemConstructorOptions[] {
  const commandItem = (
    label: string,
    command: MenuCommand,
    enabled: boolean,
  ): MenuItemConstructorOptions => ({
    label,
    enabled,
    click: () => onCommand(command),
  });
  const editable = !context.locked;
  return [
    {
      label: `句段 ${context.ordinal + 1}`,
      enabled: false,
    },
    { type: "separator" },
    commandItem("确认句段", "confirm-segment", editable),
    { type: "separator" },
    commandItem("复制源文到译文", "copy-source", editable),
    commandItem("清空译文", "clear-target", editable && context.hasTarget),
    ...(context.sourceEditable
      ? [commandItem("编辑源文", "edit-source", editable)]
      : []),
    { type: "separator" },
    commandItem(
      context.locked ? "解锁句段" : "锁定句段",
      "toggle-lock-segment",
      true,
    ),
  ];
}
