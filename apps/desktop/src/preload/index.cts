import electron = require("electron");

import type {
  DesktopApi,
  DocxPreviewResponse,
  EngineInvokeResponse,
  EngineNotificationPayload,
  EngineStatusPayload,
  MenuBarItemId,
  MenuCommand,
  MenuContext,
  NativeScheme,
  SegmentMenuContext,
  TitlebarOverlayColors,
} from "../shared/desktop-api.js";

const CHANNELS = {
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

const api: DesktopApi = {
  invoke(method, params): Promise<EngineInvokeResponse> {
    return electron.ipcRenderer.invoke(
      CHANNELS.invoke,
      method,
      params,
    ) as Promise<EngineInvokeResponse>;
  },
  engineStatus(): Promise<EngineStatusPayload> {
    return electron.ipcRenderer.invoke(
      CHANNELS.statusGet,
    ) as Promise<EngineStatusPayload>;
  },
  relaunchEngine(): Promise<EngineStatusPayload> {
    return electron.ipcRenderer.invoke(
      CHANNELS.relaunch,
    ) as Promise<EngineStatusPayload>;
  },
  onEngineStatus(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: EngineStatusPayload,
    ) => listener(status);
    electron.ipcRenderer.on(CHANNELS.statusEvent, handler);
    return () => electron.ipcRenderer.off(CHANNELS.statusEvent, handler);
  },
  onNotification(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      notification: EngineNotificationPayload,
    ) => listener(notification);
    electron.ipcRenderer.on(CHANNELS.notification, handler);
    return () => electron.ipcRenderer.off(CHANNELS.notification, handler);
  },
  chooseSourceFile(): Promise<string | null> {
    return electron.ipcRenderer.invoke(CHANNELS.chooseSource) as Promise<
      string | null
    >;
  },
  chooseExportPath(defaultName: string): Promise<string | null> {
    return electron.ipcRenderer.invoke(
      CHANNELS.chooseExport,
      defaultName,
    ) as Promise<string | null>;
  },
  chooseTmImportFile(): Promise<string | null> {
    return electron.ipcRenderer.invoke(CHANNELS.chooseTmImport) as Promise<
      string | null
    >;
  },
  chooseTmExportPath(defaultName: string): Promise<string | null> {
    return electron.ipcRenderer.invoke(
      CHANNELS.chooseTmExport,
      defaultName,
    ) as Promise<string | null>;
  },
  chooseTermbaseImportFile(): Promise<string | null> {
    return electron.ipcRenderer.invoke(
      CHANNELS.chooseTermbaseImport,
    ) as Promise<string | null>;
  },
  chooseTermbaseExportPath(defaultName: string): Promise<string | null> {
    return electron.ipcRenderer.invoke(
      CHANNELS.chooseTermbaseExport,
      defaultName,
    ) as Promise<string | null>;
  },
  chooseSrxFile(): Promise<string | null> {
    return electron.ipcRenderer.invoke(CHANNELS.chooseSrx) as Promise<
      string | null
    >;
  },
  renderDocxPreview(documentId: string): Promise<DocxPreviewResponse> {
    return electron.ipcRenderer.invoke(
      CHANNELS.previewDocx,
      documentId,
    ) as Promise<DocxPreviewResponse>;
  },
  onMenuCommand(listener) {
    const handler = (_event: Electron.IpcRendererEvent, command: MenuCommand) =>
      listener(command);
    electron.ipcRenderer.on(CHANNELS.menuCommand, handler);
    return () => electron.ipcRenderer.off(CHANNELS.menuCommand, handler);
  },
  setMenuContext(context: MenuContext): void {
    electron.ipcRenderer.send(CHANNELS.menuContext, context);
  },
  setNativeScheme(scheme: NativeScheme): void {
    electron.ipcRenderer.send(CHANNELS.nativeScheme, scheme);
  },
  // Same platform split as window-chrome.ts: macOS keeps the system frame
  // and menu bar; everything else runs the integrated titlebar.
  windowChrome: process.platform === "darwin" ? "system" : "integrated",
  popupAppMenu(menuId: MenuBarItemId, x: number, y: number): Promise<void> {
    return electron.ipcRenderer.invoke(
      CHANNELS.menuPopup,
      menuId,
      x,
      y,
    ) as Promise<void>;
  },
  popupSegmentMenu(
    context: SegmentMenuContext,
    x: number,
    y: number,
  ): Promise<void> {
    return electron.ipcRenderer.invoke(
      CHANNELS.segmentMenuPopup,
      context,
      x,
      y,
    ) as Promise<void>;
  },
  setTitlebarOverlay(colors: TitlebarOverlayColors): void {
    electron.ipcRenderer.send(CHANNELS.titlebarOverlay, colors);
  },
};

electron.contextBridge.exposeInMainWorld("tl", api);
