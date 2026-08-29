import { useEffect } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "outline",
  size = "md",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={join("tl-button", className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    />
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** One quiet line under the control: format hints, examples, scope. */
  hint?: ReactNode;
}

export function TextField({ label, hint, className, ...rest }: TextFieldProps) {
  // The hint lives outside the <label> so it never pollutes the control's
  // accessible name — screen readers and tests keep the bare label text.
  return (
    <div className={join("tl-field", className)}>
      <label className="tl-field__body">
        <span className="tl-field__label">{label}</span>
        <input className="tl-field__control" {...rest} />
      </label>
      {hint ? <span className="tl-field__hint">{hint}</span> : null}
    </div>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
}

export function TextAreaField({
  label,
  className,
  ...rest
}: TextAreaFieldProps) {
  return (
    <label className={join("tl-field", className)}>
      <span className="tl-field__label">{label}</span>
      <textarea className="tl-field__control" {...rest} />
    </label>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
  /** One quiet line under the control: format hints, examples, scope. */
  hint?: ReactNode;
}

export function SelectField({
  label,
  hint,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <div className={join("tl-field", className)}>
      <label className="tl-field__body">
        <span className="tl-field__label">{label}</span>
        <select className="tl-field__control" {...rest}>
          {children}
        </select>
      </label>
      {hint ? <span className="tl-field__hint">{hint}</span> : null}
    </div>
  );
}

export type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "danger";

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string | undefined;
}

export function Badge({ tone = "neutral", children, title }: BadgeProps) {
  return (
    <span className="tl-badge" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

export interface PanelProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Floating-card look (border + radius); panels are flat by default. */
  raised?: boolean;
}

export function Panel({
  title,
  actions,
  children,
  className,
  raised,
}: PanelProps) {
  return (
    <section
      className={join("tl-panel", className)}
      data-raised={raised ? "true" : undefined}
    >
      <header className="tl-panel__header">
        <h2 className="tl-panel__title">{title}</h2>
        {actions ? <div className="tl-toolbar">{actions}</div> : null}
      </header>
      <div className="tl-panel__body">{children}</div>
    </section>
  );
}

export type StatusDotState = "ok" | "busy" | "down" | "idle";

export function StatusDot({ state }: { state: StatusDotState }) {
  return <span className="tl-status-dot" data-state={state} />;
}

export interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="tl-empty">
      <p className="tl-empty__title">{title}</p>
      {hint ? <p className="tl-empty__hint">{hint}</p> : null}
      {action}
    </div>
  );
}

export interface DialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Wider layout for document-scale content such as previews. */
  wide?: boolean;
}

export function Dialog({
  title,
  open,
  onClose,
  children,
  footer,
  wide,
}: DialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }
  return (
    <div
      className="tl-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="tl-dialog"
        data-wide={wide ? "true" : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="tl-dialog__header">
          <h2 className="tl-dialog__title">{title}</h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            aria-label="关闭对话框"
          >
            ✕
          </Button>
        </header>
        <div className="tl-dialog__body">{children}</div>
        {footer ? (
          <footer className="tl-dialog__footer">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

export interface MeterProps {
  /** 0..=1 fill ratio; values outside the range are clamped. */
  ratio: number;
  label?: string;
}

export function Meter({ ratio, label }: MeterProps) {
  const clamped = Math.min(1, Math.max(0, ratio));
  return (
    <span
      className="tl-meter"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      aria-label={label}
      title={label}
    >
      <span
        className="tl-meter__fill"
        style={{ width: `${(clamped * 100).toFixed(1)}%` }}
      />
    </span>
  );
}

export interface SegmentProgressProps {
  /** Total segment count; zero renders an empty track. */
  total: number;
  confirmed: number;
  draft: number;
  label?: string;
}

/**
 * Stacked document progress: confirmed leads, drafts trail as visibly
 * provisional work, the untranslated remainder stays sunken. Widths are
 * derived, so a stale prop can never draw more than 100%.
 */
export function SegmentProgress({
  total,
  confirmed,
  draft,
  label,
}: SegmentProgressProps) {
  const safeTotal = Math.max(0, total);
  const confirmedRatio =
    safeTotal > 0 ? Math.min(1, Math.max(0, confirmed) / safeTotal) : 0;
  const draftRatio =
    safeTotal > 0
      ? Math.min(1 - confirmedRatio, Math.max(0, draft) / safeTotal)
      : 0;
  return (
    <span
      className="tl-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(confirmedRatio * 100)}
      aria-label={label}
      title={label}
    >
      <span
        className="tl-progress__confirmed"
        style={{ width: `${(confirmedRatio * 100).toFixed(1)}%` }}
      />
      <span
        className="tl-progress__draft"
        style={{ width: `${(draftRatio * 100).toFixed(1)}%` }}
      />
    </span>
  );
}

export type MatchGrade = "exact" | "inContext" | "fuzzy";

export interface MatchBadgeProps {
  /**
   * 0-100 score as reported by the engine; shown verbatim. Omitted when no
   * real score exists (AI origins) — the chip then shows the label alone
   * instead of inventing a number.
   */
  score?: number | undefined;
  /** Drives the tone (exact green / fuzzy blue); omit for non-TM chips. */
  grade?: MatchGrade | undefined;
  /** Origin abbreviation segment; defaults to "TM". */
  label?: string;
  /**
   * Studio-style pollution signal: the target was edited after the origin
   * write. Drops the tone fill while keeping the value readable.
   */
  muted?: boolean;
  title?: string;
}

/**
 * Score + origin dual-segment chip ("95 TM", "AI"). Exact matches read as
 * settled (green), fuzzy matches as work-to-verify (blue); the numeric
 * score always accompanies the tone so the information is never color-only.
 */
export function MatchBadge({
  score,
  grade,
  label = "TM",
  muted = false,
  title,
}: MatchBadgeProps) {
  const tone: BadgeTone | undefined =
    grade === undefined ? undefined : grade === "fuzzy" ? "accent" : "ok";
  return (
    <span
      className="tl-match"
      data-tone={muted ? undefined : tone}
      data-muted={muted || undefined}
      title={title}
    >
      {typeof score === "number" ? (
        <span className="tl-match__score tl-num">{score}</span>
      ) : null}
      <span className="tl-match__origin">{label}</span>
    </span>
  );
}

/** Inline keyboard-shortcut chip, e.g. Ctrl+Enter in editor hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="tl-kbd">{children}</kbd>;
}

function join(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
