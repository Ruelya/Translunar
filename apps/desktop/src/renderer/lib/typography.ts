import { useSyncExternalStore } from "react";

/**
 * User typography overrides: UI font/size and editing-grid font/size.
 *
 * Same shape as the theme store (module store, single writer of document
 * state, localStorage persistence), because the two answer the same kind
 * of question — application-wide presentation the reader chose. The
 * overrides are written as inline custom properties on <html>, which wins
 * over both the base tokens and any theme's own `--tl-font-ui` /
 * `--tl-text-*` declarations: an explicit reader choice outranks a theme.
 * `null` means "no override" — the theme keeps its face and scale.
 */

const STORAGE_KEY = "translunar.typography";

/** Windows-first CJK tail appended to every custom family. */
const CJK_FALLBACKS =
  '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif';

export interface TypographySettings {
  /** UI font family (exact family name); null keeps the theme's face. */
  uiFont: string | null;
  /** Body size in px (the md step); null keeps the theme's scale. */
  uiSize: number | null;
  /** Editing-grid font family; null follows the UI font. */
  editorFont: string | null;
  /** Editing-grid size in px; null follows the UI scale. */
  editorSize: number | null;
}

export const TYPOGRAPHY_DEFAULTS: TypographySettings = {
  uiFont: null,
  uiSize: null,
  editorFont: null,
  editorSize: null,
};

/** Presets the settings dialog offers; free entry stays possible. */
export const UI_FONT_PRESETS: ReadonlyArray<{ value: string; label: string }> =
  [
    { value: "Segoe UI", label: "Segoe UI（Windows 系统）" },
    { value: "Microsoft YaHei UI", label: "微软雅黑 UI" },
    { value: "IBM Plex Sans", label: "IBM Plex Sans（内置）" },
    { value: "Geist", label: "Geist（内置）" },
    { value: "Figtree", label: "Figtree（内置）" },
    { value: "Hanken Grotesk", label: "Hanken Grotesk（内置）" },
  ];

/** Body sizes the dialog offers (px, the md step). */
export const UI_SIZE_CHOICES: readonly number[] = [13, 14, 15, 16];
export const EDITOR_SIZE_CHOICES: readonly number[] = [13, 14, 15, 16, 17, 18];

const UI_SIZE_MIN = 12;
const UI_SIZE_MAX = 20;
const EDITOR_SIZE_MIN = 12;
const EDITOR_SIZE_MAX = 24;

function clampSize(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitize(raw: unknown): TypographySettings {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  // Never trim the live value: a controlled input would lose the space the
  // user is mid-typing ("Segoe UI" would collapse to "SegoeUI"). Trimming
  // happens where the value is consumed (apply).
  const family = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0
      ? value.slice(0, 80)
      : null;
  return {
    uiFont: family(record.uiFont),
    uiSize: clampSize(record.uiSize, UI_SIZE_MIN, UI_SIZE_MAX),
    editorFont: family(record.editorFont),
    editorSize: clampSize(record.editorSize, EDITOR_SIZE_MIN, EDITOR_SIZE_MAX),
  };
}

function read(): TypographySettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...TYPOGRAPHY_DEFAULTS };
  } catch {
    return { ...TYPOGRAPHY_DEFAULTS };
  }
}

function persist(settings: TypographySettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* A choice that cannot be remembered is still worth applying now. */
  }
}

/** Quote a family name for CSS (families with spaces need it). */
function quoteFamily(family: string): string {
  return `"${family.trim().replaceAll('"', "")}"`;
}

/**
 * One writer of the override properties. Only overridden tokens are set;
 * everything else is removed so the theme's own values shine through.
 */
function apply(settings: TypographySettings): void {
  const root = document.documentElement.style;
  if (settings.uiFont) {
    root.setProperty(
      "--tl-font-ui",
      `${quoteFamily(settings.uiFont)}, ${CJK_FALLBACKS}`,
    );
  } else {
    root.removeProperty("--tl-font-ui");
  }
  if (settings.uiSize !== null) {
    const md = settings.uiSize;
    // A fixed ladder around the chosen body size; xs never dips below the
    // 12px CJK rendering floor.
    root.setProperty("--tl-text-xs", `${Math.max(12, md - 2)}px`);
    root.setProperty("--tl-text-sm", `${Math.max(12, md - 1)}px`);
    root.setProperty("--tl-text-md", `${md}px`);
    root.setProperty("--tl-text-lg", `${md + 2}px`);
    root.setProperty("--tl-text-xl", `${md + 6}px`);
  } else {
    for (const step of ["xs", "sm", "md", "lg", "xl"]) {
      root.removeProperty(`--tl-text-${step}`);
    }
  }
  if (settings.editorFont) {
    root.setProperty(
      "--tl-editor-font",
      `${quoteFamily(settings.editorFont)}, ${CJK_FALLBACKS}`,
    );
  } else {
    root.removeProperty("--tl-editor-font");
  }
  if (settings.editorSize !== null) {
    root.setProperty("--tl-editor-size", `${settings.editorSize}px`);
  } else {
    root.removeProperty("--tl-editor-size");
  }
}

let snapshot: TypographySettings = read();
const listeners = new Set<() => void>();

function commit(next: TypographySettings): void {
  snapshot = next;
  persist(snapshot);
  apply(snapshot);
  for (const listener of listeners) {
    listener();
  }
}

export function setTypography(update: Partial<TypographySettings>): void {
  commit(sanitize({ ...snapshot, ...update }));
}

export function resetTypography(): void {
  commit({ ...TYPOGRAPHY_DEFAULTS });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

apply(snapshot);

export interface TypographyControls extends TypographySettings {
  setTypography: (update: Partial<TypographySettings>) => void;
  resetTypography: () => void;
}

export function useTypography(): TypographyControls {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  return { ...state, setTypography, resetTypography };
}
