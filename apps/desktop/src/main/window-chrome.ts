/**
 * Pure construction of the window chrome options: which platforms get the
 * integrated titlebar (prototype chrome: brand, the seven application menus,
 * the document title, and the native window buttons on one 32px strip) and
 * which keep the OS-native frame. No `electron` value imports, so the
 * decision is unit-testable outside an Electron main process.
 *
 * Windows/Linux: `titleBarStyle: "hidden"` removes the DWM caption while
 * `titleBarOverlay` keeps the native min/max/close buttons — Snap Layouts,
 * double-click-maximize, and Alt+Space stay system-owned. The renderer draws
 * the rest of the strip (`TitleBar.tsx`) and repaints the overlay through
 * `IPC_CHANNELS.titlebarOverlay` whenever the theme changes.
 *
 * macOS keeps its native frame and system menu bar (platform convention);
 * traffic lights are untouched.
 */

import type { BrowserWindowConstructorOptions } from "electron";

import type {
  TitlebarOverlayColors,
  WindowChromeMode,
} from "../shared/desktop-api.js";

/** One height for the CSS strip (`--tl-titlebar-h`) and the native overlay. */
export const TITLEBAR_HEIGHT = 32;

/**
 * Overlay colors for the first frame, before the renderer reports the real
 * theme: the default theme (terra) chrome and text values.
 */
export const TITLEBAR_OVERLAY_DEFAULTS: TitlebarOverlayColors = {
  color: "#ecebe3",
  symbolColor: "#2e2a23",
};

export function windowChromeMode(platform: NodeJS.Platform): WindowChromeMode {
  return platform === "darwin" ? "system" : "integrated";
}

/**
 * Options merged into `new BrowserWindow(...)`. `autoHideMenuBar` keeps the
 * classic Windows/Linux menu bar off the client area — the application menu
 * stays installed for accelerators, and a plain Alt press still summons the
 * classic bar transiently for keyboard menu access.
 */
export function windowChromeOptions(
  platform: NodeJS.Platform,
): BrowserWindowConstructorOptions {
  if (windowChromeMode(platform) === "system") {
    return {};
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: {
      height: TITLEBAR_HEIGHT,
      color: TITLEBAR_OVERLAY_DEFAULTS.color,
      symbolColor: TITLEBAR_OVERLAY_DEFAULTS.symbolColor,
    },
    autoHideMenuBar: true,
  };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The renderer-reported overlay payload crosses a trust boundary; accept
 * only plain 6-digit hex colors (what `TitleBar.tsx` sends).
 */
export function normalizeOverlayColors(
  raw: unknown,
): TitlebarOverlayColors | null {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const { color, symbolColor } = record;
  if (
    typeof color !== "string" ||
    !HEX_COLOR.test(color) ||
    typeof symbolColor !== "string" ||
    !HEX_COLOR.test(symbolColor)
  ) {
    return null;
  }
  return { color, symbolColor };
}
