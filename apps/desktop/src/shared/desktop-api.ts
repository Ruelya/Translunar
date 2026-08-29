/** Contract between the preload bridge and the renderer. */

export interface EngineRpcErrorShape {
  code: string;
  message: string;
  /** Structured error payload (`RpcError.data`), passed through verbatim. */
  data?: unknown;
}

export type EngineInvokeResponse =
  { ok: true; result: unknown } | { ok: false; error: EngineRpcErrorShape };

export type EngineLifecycleState = "starting" | "ready" | "restarting" | "down";

export interface EngineStatusPayload {
  state: EngineLifecycleState;
  pid?: number;
  restarts: number;
  engineVersion?: string;
  lastError?: string;
}

export interface EngineNotificationPayload {
  method: string;
  params: unknown;
}

/**
 * Result of rendering the current draft into the real export pipeline:
 * the DOCX bytes are produced by `document.export` against a temp path,
 * so the preview shows exactly what the exported file would contain.
 */
export type DocxPreviewResponse =
  | { ok: true; data: ArrayBuffer; translatedSegments: number }
  | { ok: false; error: EngineRpcErrorShape };

/**
 * Commands the application menu can dispatch to the renderer. Every command
 * maps onto an action the workbench already exposes (button or shortcut);
 * the menu never grows behavior of its own.
 */
export type MenuCommand =
  | "new-project"
  | "import-document"
  | "export-document"
  | "open-project-settings"
  | "close-project"
  | "open-command-palette"
  | "toggle-preview"
  | "toggle-left"
  | "toggle-right"
  | "open-concordance"
  | "focus-filter"
  | "open-find"
  | "open-replace"
  | "find-next"
  | "find-prev"
  | "go-to-segment"
  | "next-untranslated"
  | "next-draft"
  | "next-qa"
  | "next-locked"
  | "confirm-segment"
  | "confirm-segment-any"
  | "confirm-segment-stay"
  | "confirm-segment-skip-tm"
  | "toggle-lock-segment"
  | "copy-source"
  | "clear-target"
  | "edit-source"
  | "pretranslate"
  | "insert-tm"
  | "insert-term"
  | "ai-translate"
  | "ai-refine"
  | "open-tm-manage"
  | "open-term-manage"
  | "archive-project"
  | "run-qa"
  | "waive"
  | "waive-rule"
  | "waive-segment"
  | "restore"
  | "apply-fix"
  | "toggle-gate"
  | "help-keys"
  | "about"
  | "show-dock-memory"
  | "show-dock-term"
  | "show-dock-qa"
  | "show-dock-ai";

/**
 * The seven top-level application menus, in menu-bar order. One list feeds
 * both `menu-template.ts` (the real submenus) and the integrated titlebar's
 * menu buttons, so the strip can never drift from the template.
 */
export type MenuBarItemId =
  "file" | "edit" | "view" | "project" | "translate" | "qa" | "help";

export interface MenuBarItem {
  id: MenuBarItemId;
  label: string;
}

export const MENU_BAR_ITEMS: readonly MenuBarItem[] = [
  { id: "file", label: "文件" },
  { id: "edit", label: "编辑" },
  { id: "view", label: "视图" },
  { id: "project", label: "项目" },
  { id: "translate", label: "翻译" },
  { id: "qa", label: "QA" },
  { id: "help", label: "帮助" },
];

/**
 * Renderer-reported state that drives menu item enablement, so the menu
 * stays honest: items are disabled when no project/document is open.
 */
export interface MenuContext {
  projectOpen: boolean;
  documentOpen: boolean;
  /**
   * The open project's stored QA export gate (`qa.profile.get`'s
   * `blockExportOnError`); the QA menu's 有错误时阻止导出 checkbox mirrors
   * this persisted value. False whenever no project is open.
   */
  exportGate: boolean;
}

/**
 * What the renderer knows about the right-clicked segment row, carried to
 * the native context menu so its items and enablement stay honest. Facts
 * only — the row's stored flags, never re-judged state.
 */
export interface SegmentMenuContext {
  /** 0-based ordinal; the menu shows 句段 N as its header. */
  ordinal: number;
  locked: boolean;
  hasTarget: boolean;
  /** Whether the workbench wired source editing (segment.updateSource). */
  sourceEditable: boolean;
}

/**
 * The light/dark cast of the active renderer theme. The OS frame is not
 * themeable, so the most it can do is agree with the workbench underneath it.
 */
export type NativeScheme = "light" | "dark";

/**
 * Which window chrome this host runs: `integrated` draws the prototype
 * titlebar (menus + title + native overlay buttons on one strip) inside the
 * web contents on Windows/Linux; `system` keeps the OS frame and the system
 * menu bar on macOS.
 */
export type WindowChromeMode = "integrated" | "system";

/**
 * Colors for the native window-button overlay, resolved by the renderer
 * from the active theme's titlebar. Plain `#rrggbb` only.
 */
export interface TitlebarOverlayColors {
  color: string;
  symbolColor: string;
}

export interface DesktopApi {
  invoke(method: string, params: unknown): Promise<EngineInvokeResponse>;
  engineStatus(): Promise<EngineStatusPayload>;
  /**
   * Manual relaunch after the engine parked in `down` (crash budget
   * exhausted, spawn failure, or failed handshake). Resolves with the
   * status right after the new spawn attempt; readiness still arrives
   * through onEngineStatus.
   */
  relaunchEngine(): Promise<EngineStatusPayload>;
  onEngineStatus(listener: (status: EngineStatusPayload) => void): () => void;
  onNotification(
    listener: (notification: EngineNotificationPayload) => void,
  ): () => void;
  chooseSourceFile(): Promise<string | null>;
  chooseExportPath(defaultName: string): Promise<string | null>;
  /** TM exchange files (TMX/CSV/TSV) — dedicated filter, not the document one. */
  chooseTmImportFile(): Promise<string | null>;
  chooseTmExportPath(defaultName: string): Promise<string | null>;
  /** Termbase exchange files (CSV/TSV/TBX). */
  chooseTermbaseImportFile(): Promise<string | null>;
  chooseTermbaseExportPath(defaultName: string): Promise<string | null>;
  /** SRX segmentation ruleset for document.import. */
  chooseSrxFile(): Promise<string | null>;
  renderDocxPreview(documentId: string): Promise<DocxPreviewResponse>;
  /** Application menu clicks arrive here as workbench commands. */
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
  /** Report open-project/document state so menu enablement stays honest. */
  setMenuContext(context: MenuContext): void;
  /** Report the active theme's cast so the native frame matches it. */
  setNativeScheme(scheme: NativeScheme): void;
  /** Which chrome this host runs; fixed for the process lifetime. */
  windowChrome: WindowChromeMode;
  /**
   * Pop the named application menu (the same `menu-template.ts` submenu the
   * menu bar uses) at window coordinates; resolves when the menu closes.
   */
  popupAppMenu(menuId: MenuBarItemId, x: number, y: number): Promise<void>;
  /**
   * Pop the native right-click menu for one segment row at window
   * coordinates. Item clicks come back as ordinary menu commands over
   * `onMenuCommand` — the renderer selected the row before popping, so the
   * commands operate on the intended segment. Resolves when the menu
   * closes.
   */
  popupSegmentMenu(
    context: SegmentMenuContext,
    x: number,
    y: number,
  ): Promise<void>;
  /** Repaint the native window-button overlay to match the active theme. */
  setTitlebarOverlay(colors: TitlebarOverlayColors): void;
}

export const IPC_CHANNELS = {
  invoke: "tl:engine:invoke",
  statusGet: "tl:engine:status:get",
  statusEvent: "tl:engine:status",
  relaunch: "tl:engine:relaunch",
  notification: "tl:engine:notification",
  chooseSource: "tl:dialog:choose-source",
  chooseExport: "tl:dialog:choose-export",
  chooseTmImport: "tl:dialog:choose-tm-import",
  chooseTmExport: "tl:dialog:choose-tm-export",
  chooseTermbaseImport: "tl:dialog:choose-termbase-import",
  chooseTermbaseExport: "tl:dialog:choose-termbase-export",
  chooseSrx: "tl:dialog:choose-srx",
  previewDocx: "tl:preview:docx",
  menuCommand: "tl:menu:command",
  menuContext: "tl:menu:context",
  menuPopup: "tl:menu:popup",
  segmentMenuPopup: "tl:menu:segment-popup",
  nativeScheme: "tl:window:native-scheme",
  titlebarOverlay: "tl:window:titlebar-overlay",
} as const;

declare global {
  interface Window {
    tl: DesktopApi;
  }
}
