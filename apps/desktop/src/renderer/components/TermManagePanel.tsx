import { useCallback, useEffect, useState } from "react";

import type { TermEntry, Termbase } from "@translunar/contracts";
import { Badge, Button, EmptyState, TextField } from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface TermManagePanelProps {
  termbase: Termbase;
}

interface EditingTarget {
  entryId: string;
  /** Null when the entry has no translations and only the source is edited. */
  translationId: string | null;
}

/**
 * Inline manager for one termbase inside the project settings: lists real
 * entries through `term.list`, edits source/target through `term.update`,
 * and removes entries (or single translations) through `term.delete`.
 * Every state shown here comes from the engine — the list reloads after
 * each mutation and errors surface as-is.
 */
export function TermManagePanel({ termbase }: TermManagePanelProps) {
  const [entries, setEntries] = useState<TermEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [editSource, setEditSource] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    callEngine("term.list", { termbaseId: termbase.id })
      .then((result) => {
        if (!cancelled) {
          setEntries(result.entries);
        }
      })
      .catch((listError: unknown) => {
        if (!cancelled) {
          setError(describeError(listError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [termbase.id, refreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const startEdit = useCallback(
    (entry: TermEntry, translationId: string | null) => {
      setEditing({ entryId: entry.id, translationId });
      setEditSource(entry.sourceTerm);
      setEditTarget(
        translationId === null
          ? ""
          : (entry.translations.find(
              (translation) => translation.id === translationId,
            )?.term ?? ""),
      );
      setConfirmDelete(null);
      setError(null);
    },
    [],
  );

  const saveEdit = useCallback(async () => {
    if (!editing) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await callEngine("term.update", {
        entryId: editing.entryId,
        sourceTerm: editSource.trim(),
        ...(editing.translationId !== null
          ? {
              translationId: editing.translationId,
              targetTerm: editTarget.trim(),
            }
          : {}),
      });
      setEditing(null);
      refresh();
    } catch (updateError) {
      setError(describeError(updateError));
    } finally {
      setBusy(false);
    }
  }, [editing, editSource, editTarget, refresh]);

  const deleteTarget = useCallback(
    async (entryId: string, translationId: string | null) => {
      setBusy(true);
      setError(null);
      try {
        await callEngine("term.delete", {
          entryId,
          ...(translationId !== null ? { translationId } : {}),
        });
        setConfirmDelete(null);
        setEditing(null);
        refresh();
      } catch (deleteError) {
        setError(describeError(deleteError));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const editingSaveDisabled =
    busy ||
    !editSource.trim() ||
    (editing?.translationId !== null && !editTarget.trim());

  return (
    <div className="dock-stack" aria-label={`术语库 ${termbase.name} 的术语`}>
      {entries !== null ? (
        <div className="settings__row">
          <Badge tone="neutral">{entries.length} 条术语</Badge>
        </div>
      ) : null}
      {entries !== null && entries.length === 0 ? (
        <EmptyState title="术语库为空" />
      ) : null}
      {(entries ?? []).map((entry) => (
        <div key={entry.id} className="match-card">
          <div className="match-card__row">
            <span className="match-card__text">{entry.sourceTerm}</span>
            {entry.translations.length === 0 ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`编辑术语 ${entry.sourceTerm}`}
                onClick={() => startEdit(entry, null)}
              >
                编辑
              </Button>
            ) : null}
            {confirmDelete === entry.id ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  aria-label={`确认删除术语 ${entry.sourceTerm}`}
                  onClick={() => void deleteTarget(entry.id, null)}
                >
                  确认删除
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirmDelete(null)}
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`删除术语 ${entry.sourceTerm}`}
                onClick={() => setConfirmDelete(entry.id)}
              >
                删除
              </Button>
            )}
          </div>
          {entry.translations.map((translation) => (
            <div key={translation.id} className="match-card__row">
              <span className="term-hit__target">
                {translation.term}
                {translation.forbidden ? (
                  <Badge tone="danger">禁用</Badge>
                ) : translation.preferred ? (
                  <Badge tone="ok">首选</Badge>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                aria-label={`编辑译文 ${translation.term}`}
                onClick={() => startEdit(entry, translation.id)}
              >
                编辑
              </Button>
              {entry.translations.length > 1 ? (
                confirmDelete === `${entry.id}:${translation.id}` ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy}
                      aria-label={`确认删除译文 ${translation.term}`}
                      onClick={() =>
                        void deleteTarget(entry.id, translation.id)
                      }
                    >
                      确认删除
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmDelete(null)}
                    >
                      取消
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`删除译文 ${translation.term}`}
                    onClick={() =>
                      setConfirmDelete(`${entry.id}:${translation.id}`)
                    }
                  >
                    删除译文
                  </Button>
                )
              ) : null}
            </div>
          ))}
          {editing?.entryId === entry.id ? (
            <form
              className="form-stack"
              aria-label={`编辑术语 ${entry.sourceTerm}`}
              onSubmit={(event) => {
                event.preventDefault();
                void saveEdit();
              }}
            >
              <TextField
                label="源术语"
                value={editSource}
                onChange={(event) => setEditSource(event.target.value)}
                required
                placeholder="源语言术语原文"
              />
              {editing.translationId !== null ? (
                <TextField
                  label="目标术语"
                  value={editTarget}
                  onChange={(event) => setEditTarget(event.target.value)}
                  required
                  placeholder="目标语言的规范译法"
                />
              ) : null}
              <div className="settings__row">
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={editingSaveDisabled}
                >
                  {busy ? "保存中…" : "保存修改"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ))}
      {error ? (
        <div className="honest-note" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
