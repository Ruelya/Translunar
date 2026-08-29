/**
 * Native context-menu wiring.
 *
 * - Every editable field app-wide gets the standard editing menu straight
 *   from Chromium's `context-menu` event (`editFlags` drive enablement),
 *   restoring the platform behavior a frameless Electron window loses.
 * - Segment rows pop a semantic menu through IPC: the renderer reports the
 *   row's stored facts, the pure template builds the items, and clicks come
 *   back as ordinary workbench menu commands — the same dispatch channel
 *   the application menu uses.
 */

import { BrowserWindow, Menu, ipcMain } from "electron";

import { IPC_CHANNELS } from "../shared/desktop-api.js";
import type { MenuCommand } from "../shared/desktop-api.js";
import {
  buildEditableContextTemplate,
  buildSegmentContextTemplate,
  normalizeSegmentMenuContext,
} from "./context-menu-template.js";

export function installContextMenus(): void {
  ipcMain.handle(
    IPC_CHANNELS.segmentMenuPopup,
    (event, rawContext: unknown, x: unknown, y: unknown): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        return Promise.resolve();
      }
      const dispatch = (command: MenuCommand): void => {
        event.sender.send(IPC_CHANNELS.menuCommand, command);
      };
      const menu = Menu.buildFromTemplate(
        buildSegmentContextTemplate(
          normalizeSegmentMenuContext(rawContext),
          dispatch,
        ),
      );
      return new Promise((resolve) => {
        menu.popup({
          window,
          x: typeof x === "number" && Number.isFinite(x) ? Math.round(x) : 0,
          y: typeof y === "number" && Number.isFinite(y) ? Math.round(y) : 0,
          callback: resolve,
        });
      });
    },
  );
}

/**
 * Hook one window's web contents: right-clicking any editable field shows
 * the native editing menu. Non-editable clicks are left alone — the
 * renderer owns those surfaces (segment rows pop their own menu above).
 */
export function attachEditableContextMenu(window: BrowserWindow): void {
  window.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable) {
      return;
    }
    const menu = Menu.buildFromTemplate(
      buildEditableContextTemplate({
        canUndo: params.editFlags.canUndo,
        canRedo: params.editFlags.canRedo,
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        canSelectAll: params.editFlags.canSelectAll,
      }),
    );
    menu.popup({ window });
  });
}
