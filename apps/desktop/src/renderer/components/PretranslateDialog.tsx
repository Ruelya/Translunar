import { useEffect, useState } from "react";

import { Button, Dialog, TextField } from "@translunar/ui";

/** The engine's default pretranslation threshold (tm.pretranslate). */
export const PRETRANSLATE_DEFAULT_MIN_SCORE = 75;

export interface PretranslateDialogProps {
  open: boolean;
  /** A run is already in flight; the submit stays disabled. */
  busy: boolean;
  onClose: () => void;
  /** Start tm.pretranslate with the chosen fuzzy threshold (1–100). */
  onRun: (minScore: number) => void;
}

/**
 * Pretranslation options: the fuzzy score threshold a TM match must reach
 * to fill an untranslated segment as a draft. Defaults to the engine's 75;
 * exact matches always apply. The value goes to the engine verbatim — the
 * dialog only constrains it to the contract's 1–100 range.
 */
export function PretranslateDialog({
  open,
  busy,
  onClose,
  onRun,
}: PretranslateDialogProps) {
  const [raw, setRaw] = useState(String(PRETRANSLATE_DEFAULT_MIN_SCORE));

  useEffect(() => {
    if (open) {
      setRaw(String(PRETRANSLATE_DEFAULT_MIN_SCORE));
    }
  }, [open]);

  const parsed = Number.parseInt(raw, 10);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 100;

  return (
    <Dialog
      title="预翻译（TM）"
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={busy || !valid}
            onClick={() => {
              if (valid) {
                onRun(parsed);
              }
            }}
          >
            {busy ? "预翻译中…" : "开始预翻译"}
          </Button>
        </>
      }
    >
      <div className="import-form">
        <TextField
          label="模糊匹配阈值（%）"
          type="number"
          min={1}
          max={100}
          value={raw}
          disabled={busy}
          hint="只回填得分不低于该阈值的 TM 匹配；100 表示仅精确匹配"
          onChange={(event) => setRaw(event.target.value)}
        />
        <p className="settings__note">
          达到阈值的模糊匹配填充为草稿，精确匹配始终填充；已锁定与已有译文的句段保持原样。
        </p>
        {valid ? null : (
          <div className="honest-note" data-tone="danger" role="alert">
            阈值需为 1–100 的整数
          </div>
        )}
      </div>
    </Dialog>
  );
}
