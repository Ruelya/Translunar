import { useCallback, useEffect, useState } from "react";

import type {
  Memory,
  MemoryMount,
  Project,
  TmEntry,
} from "@translunar/contracts";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  SelectField,
  TextAreaField,
  TextField,
} from "@translunar/ui";

import { callEngine, describeError } from "../lib/engine.js";

export interface TmManageDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

const PAGE_SIZE = 50;

/**
 * Manage the project's memory mounts and browse each memory's entries.
 *
 * Mounts come from memory.list and are edited through memory.attach /
 * memory.detach / memory.update: enable/disable gates the read path
 * (lookup, pretranslate), the single writable mount is the working memory
 * confirm-time TM writes go to, and priority order breaks equal-score ties
 * in merged lookups. Promoting a memory first demotes the current writable
 * one — the engine refuses two writable mounts, so the sequence can never
 * end with a double write path.
 *
 * Entries page through tm.list / tm.update / tm.delete against the memory
 * picked in the entries toolbar. This surface never confirms segments and
 * never exports files — confirmation-time TM writes stay in the workbench,
 * import/export stays in project settings.
 *
 * Memories themselves rename through memory.rename (baseRevision guarded)
 * and delete through memory.delete — deletion is only offered for
 * unmounted memories, and the engine's two honest conflicts surface as-is:
 * mounted anywhere refuses, and remaining entries refuse until the user
 * explicitly picks 连同条目删除 (deleteEntries). A memory whose language
 * pair differs from the project's carries a short factual badge — the
 * engine soft-warns and never refuses the attach.
 */
export function TmManageDialog({
  open,
  project,
  onClose,
}: TmManageDialogProps) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [mounts, setMounts] = useState<MemoryMount[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [attachChoice, setAttachChoice] = useState("");
  const [newMemoryName, setNewMemoryName] = useState("");
  const [entries, setEntries] = useState<TmEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  // Inline memory rename: the mount row being renamed and its draft name.
  const [renamingMemoryId, setRenamingMemoryId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // memory.delete two-step: the plain confirm, then — only after the engine
  // refused because entries remain — the explicit cascade offer carrying
  // the engine's own message.
  const [confirmingMemoryDeleteId, setConfirmingMemoryDeleteId] = useState<
    string | null
  >(null);
  const [cascadePrompt, setCascadePrompt] = useState<{
    memoryId: string;
    message: string;
  } | null>(null);

  const memoryName = useCallback(
    (memoryId: string) =>
      memories.find((memory) => memory.id === memoryId)?.name ?? memoryId,
    [memories],
  );

  const memoryById = useCallback(
    (memoryId: string) => memories.find((memory) => memory.id === memoryId),
    [memories],
  );

  /**
   * Short factual pair note when a memory's locales differ from the
   * project's — the soft warning the multi-TM proposal asks for. Attaching
   * is never refused over it.
   */
  const localeMismatch = useCallback(
    (memoryId: string): string | null => {
      const memory = memoryById(memoryId);
      if (
        !memory ||
        (memory.sourceLocale === project.sourceLocale &&
          memory.targetLocale === project.targetLocale)
      ) {
        return null;
      }
      return `语言对 ${memory.sourceLocale} → ${memory.targetLocale}（项目 ${project.sourceLocale} → ${project.targetLocale}）`;
    },
    [memoryById, project.sourceLocale, project.targetLocale],
  );

  const refreshMounts = useCallback(async () => {
    const result = await callEngine("memory.list", { projectId: project.id });
    setMemories(result.memories);
    setMounts(result.mounts);
    setSelectedMemoryId((current) => {
      if (
        current &&
        result.mounts.some((mount) => mount.memoryId === current)
      ) {
        return current;
      }
      const writable = result.mounts.find((mount) => mount.writable);
      return writable?.memoryId ?? result.mounts[0]?.memoryId ?? null;
    });
  }, [project.id]);

  const refresh = useCallback(async () => {
    if (!selectedMemoryId) {
      setEntries([]);
      setTotal(null);
      return;
    }
    const result = await callEngine("tm.list", {
      projectId: project.id,
      memoryId: selectedMemoryId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(appliedQuery ? { query: appliedQuery } : {}),
    });
    if (result.entries.length === 0 && result.total > 0 && page > 0) {
      // The page emptied out (for example after a delete); step back onto
      // the last page that still exists instead of showing a fake blank.
      setPage(Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1));
      return;
    }
    setEntries(result.entries);
    setTotal(result.total);
  }, [project.id, selectedMemoryId, page, appliedQuery]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    refreshMounts().catch((listError: unknown) => {
      setError(describeError(listError));
    });
  }, [open, refreshMounts]);

  useEffect(() => {
    if (!open) {
      return;
    }
    refresh().catch((listError: unknown) => {
      setError(describeError(listError));
    });
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setMemories([]);
      setMounts([]);
      setSelectedMemoryId(null);
      setAttachChoice("");
      setNewMemoryName("");
      setQueryInput("");
      setAppliedQuery("");
      setPage(0);
      setNotice(null);
      setError(null);
      setEditingId(null);
      setConfirmingDeleteId(null);
      setRenamingMemoryId(null);
      setRenameDraft("");
      setConfirmingMemoryDeleteId(null);
      setCascadePrompt(null);
      setEntries([]);
      setTotal(null);
    }
  }, [open]);

  /** One mount mutation: run, then re-read the engine's real mount state. */
  const runMountAction = useCallback(
    async (action: () => Promise<void>, done: string | null) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        await refreshMounts();
        if (done) {
          setNotice(done);
        }
      } catch (actionError) {
        setError(describeError(actionError));
        // A failed sequence (for example promote after demote) may still
        // have changed state; show what the engine really holds now.
        await refreshMounts().catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [refreshMounts],
  );

  const moveMount = useCallback(
    (mount: MemoryMount, delta: number) =>
      runMountAction(async () => {
        await callEngine("memory.update", {
          projectId: project.id,
          memoryId: mount.memoryId,
          priority: Math.max(0, mount.priority + delta),
        });
      }, null),
    [project.id, runMountAction],
  );

  const toggleEnabled = useCallback(
    (mount: MemoryMount) =>
      runMountAction(async () => {
        await callEngine("memory.update", {
          projectId: project.id,
          memoryId: mount.memoryId,
          enabled: !mount.enabled,
        });
      }, null),
    [project.id, runMountAction],
  );

  const makeWritable = useCallback(
    (mount: MemoryMount) =>
      runMountAction(
        async () => {
          // The engine allows at most one writable mount: demote the current
          // one first, then promote. If the second step fails, the refresh
          // shows the honest in-between state (no writable mount).
          const current = mounts.find(
            (candidate) =>
              candidate.writable && candidate.memoryId !== mount.memoryId,
          );
          if (current) {
            await callEngine("memory.update", {
              projectId: project.id,
              memoryId: current.memoryId,
              writable: false,
            });
          }
          await callEngine("memory.update", {
            projectId: project.id,
            memoryId: mount.memoryId,
            writable: true,
          });
        },
        `已设为可写：${memoryName(mount.memoryId)}`,
      ),
    [project.id, mounts, memoryName, runMountAction],
  );

  const detachMount = useCallback(
    (mount: MemoryMount) =>
      runMountAction(
        async () => {
          await callEngine("memory.detach", {
            projectId: project.id,
            memoryId: mount.memoryId,
          });
        },
        `已卸载：${memoryName(mount.memoryId)}（条目保留）`,
      ),
    [project.id, memoryName, runMountAction],
  );

  const attachExisting = useCallback(() => {
    // The factual pair note rides along on the attach status when the
    // memory's locales differ from the project's; never a refusal.
    const mismatch = localeMismatch(attachChoice);
    return runMountAction(
      async () => {
        await callEngine("memory.attach", {
          projectId: project.id,
          memoryId: attachChoice,
        });
        setAttachChoice("");
        setConfirmingMemoryDeleteId(null);
        setCascadePrompt(null);
      },
      `已挂载：${memoryName(attachChoice)}（只读${mismatch ? `，${mismatch}` : ""}）`,
    );
  }, [project.id, attachChoice, memoryName, localeMismatch, runMountAction]);

  const renameMemory = useCallback(async () => {
    if (!renamingMemoryId) {
      return;
    }
    const memory = memoryById(renamingMemoryId);
    if (!memory) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await callEngine("memory.rename", {
        memoryId: memory.id,
        name: renameDraft.trim(),
        baseRevision: memory.revision,
      });
      setRenamingMemoryId(null);
      setRenameDraft("");
      await refreshMounts();
      setNotice(`已重命名为：${result.memory.name}`);
    } catch (renameError) {
      setError(describeError(renameError));
      // A conflict means the stored revision moved; re-read so the retry
      // is based on reality.
      await refreshMounts().catch(() => {});
    } finally {
      setBusy(false);
    }
  }, [renamingMemoryId, renameDraft, memoryById, refreshMounts]);

  /**
   * memory.delete, honestly staged: the first call never cascades. When
   * the engine refuses because entries remain, its message is shown and
   * only an explicit 连同条目删除 retries with deleteEntries.
   */
  const deleteMemory = useCallback(
    async (memoryId: string, deleteEntries: boolean) => {
      const name = memoryName(memoryId);
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await callEngine("memory.delete", {
          memoryId,
          ...(deleteEntries ? { deleteEntries: true } : {}),
        });
        setConfirmingMemoryDeleteId(null);
        setCascadePrompt(null);
        setAttachChoice("");
        await refreshMounts();
        setNotice(
          result.deletedEntries > 0
            ? `已删除记忆库「${name}」（连同 ${result.deletedEntries} 条条目）`
            : `已删除记忆库「${name}」`,
        );
      } catch (deleteError) {
        const message = describeError(deleteError);
        setConfirmingMemoryDeleteId(null);
        if (!deleteEntries && /\d+ TM entr/.test(message)) {
          // Entries remain: hand the engine's count to the user and let
          // them decide about the cascade.
          setCascadePrompt({ memoryId, message });
        } else {
          setCascadePrompt(null);
          setError(message);
        }
      } finally {
        setBusy(false);
      }
    },
    [memoryName, refreshMounts],
  );

  const createAndAttach = useCallback(
    () =>
      runMountAction(async () => {
        const memory = await callEngine("memory.create", {
          name: newMemoryName.trim(),
          sourceLocale: project.sourceLocale,
          targetLocale: project.targetLocale,
        });
        await callEngine("memory.attach", {
          projectId: project.id,
          memoryId: memory.id,
        });
        setNewMemoryName("");
      }, `已新建并挂载：${newMemoryName.trim()}（只读）`),
    [project, newMemoryName, runMountAction],
  );

  const beginEdit = useCallback((entry: TmEntry) => {
    setEditingId(entry.id);
    setEditSource(entry.sourceText);
    setEditTarget(entry.targetText);
    setConfirmingDeleteId(null);
    setNotice(null);
    setError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await callEngine("tm.update", {
        entryId: editingId,
        sourceText: editSource,
        targetText: editTarget,
      });
      setEntries((current) =>
        current.map((entry) =>
          entry.id === result.entry.id ? result.entry : entry,
        ),
      );
      setEditingId(null);
      setNotice("条目已保存。");
    } catch (updateError) {
      setError(describeError(updateError));
    } finally {
      setBusy(false);
    }
  }, [editingId, editSource, editTarget]);

  const deleteEntry = useCallback(
    async (entry: TmEntry) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await callEngine("tm.delete", { entryId: entry.id });
        setConfirmingDeleteId(null);
        setNotice(`已删除条目：${result.entry.sourceText}`);
        await refresh();
      } catch (deleteError) {
        setError(describeError(deleteError));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const unmounted = memories.filter(
    (memory) => !mounts.some((mount) => mount.memoryId === memory.id),
  );
  const pageCount =
    total === null ? 0 : Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Dialog
      title={`TM 管理 — ${project.name}`}
      open={open}
      onClose={onClose}
      wide
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="tm-manage">
        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="honest-note" data-tone="ok" role="status">
            {notice}
          </div>
        ) : null}

        <section className="tm-manage__mounts">
          <h3 className="tm-manage__heading">挂载的记忆库</h3>
          {mounts.length === 0 ? (
            <EmptyState title="未挂载记忆库" />
          ) : (
            mounts.map((mount, index) => {
              const name = memoryName(mount.memoryId);
              const mismatch = localeMismatch(mount.memoryId);
              if (renamingMemoryId === mount.memoryId) {
                return (
                  <div className="tm-manage__mount" key={mount.memoryId}>
                    <TextField
                      label={`重命名记忆库 ${name}`}
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                    />
                    <div className="tm-manage__actions">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || !renameDraft.trim()}
                        onClick={() => void renameMemory()}
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setRenamingMemoryId(null);
                          setRenameDraft("");
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="tm-manage__mount" key={mount.memoryId}>
                  <span className="tm-manage__mount-name">{name}</span>
                  <Badge tone={mount.writable ? "ok" : "neutral"}>
                    {mount.writable ? "可写" : "只读"}
                  </Badge>
                  {mount.enabled ? null : <Badge tone="warn">已停用</Badge>}
                  {mismatch ? (
                    // Factual pair note — the engine soft-warns, never
                    // refuses, so the badge just states the pairs.
                    <Badge tone="warn">{mismatch}</Badge>
                  ) : null}
                  <div className="tm-manage__actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || index === 0}
                      aria-label={`上移记忆库 ${name}`}
                      onClick={() => void moveMount(mount, -1)}
                    >
                      上移
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || index === mounts.length - 1}
                      aria-label={`下移记忆库 ${name}`}
                      onClick={() => void moveMount(mount, 1)}
                    >
                      下移
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={
                        mount.enabled
                          ? `停用记忆库 ${name}`
                          : `启用记忆库 ${name}`
                      }
                      onClick={() => void toggleEnabled(mount)}
                    >
                      {mount.enabled ? "停用" : "启用"}
                    </Button>
                    {mount.writable ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`设为可写记忆库 ${name}`}
                        onClick={() => void makeWritable(mount)}
                      >
                        设为可写
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`重命名记忆库 ${name}`}
                      onClick={() => {
                        setRenamingMemoryId(mount.memoryId);
                        setRenameDraft(name);
                        setNotice(null);
                        setError(null);
                      }}
                    >
                      重命名
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`卸载记忆库 ${name}`}
                      onClick={() => void detachMount(mount)}
                    >
                      卸载
                    </Button>
                  </div>
                </div>
              );
            })
          )}
          <div className="tm-manage__attach">
            {unmounted.length > 0 ? (
              <div className="tm-manage__attach-row">
                <SelectField
                  label="挂载已有记忆库"
                  value={attachChoice}
                  onChange={(event) => setAttachChoice(event.target.value)}
                >
                  <option value="">选择记忆库…</option>
                  {unmounted.map((memory) => (
                    <option key={memory.id} value={memory.id}>
                      {memory.name}
                    </option>
                  ))}
                </SelectField>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !attachChoice}
                  onClick={() => void attachExisting()}
                >
                  挂载
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !attachChoice}
                  aria-label={
                    attachChoice
                      ? `删除记忆库 ${memoryName(attachChoice)}`
                      : "删除记忆库"
                  }
                  onClick={() => {
                    setConfirmingMemoryDeleteId(attachChoice);
                    setCascadePrompt(null);
                    setNotice(null);
                    setError(null);
                  }}
                >
                  删除
                </Button>
              </div>
            ) : null}
            {confirmingMemoryDeleteId ? (
              <div className="tm-manage__attach-row">
                <span className="tm-manage__confirm">
                  确认删除记忆库「{memoryName(confirmingMemoryDeleteId)}」？
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  aria-label={`确认删除记忆库 ${memoryName(confirmingMemoryDeleteId)}`}
                  onClick={() =>
                    void deleteMemory(confirmingMemoryDeleteId, false)
                  }
                >
                  确认删除
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirmingMemoryDeleteId(null)}
                >
                  取消
                </Button>
              </div>
            ) : null}
            {cascadePrompt ? (
              // The engine refused because entries remain; its message
              // (with the real count) is shown verbatim, and only this
              // explicit choice retries with the cascade.
              <div className="tm-manage__attach-row">
                <span className="tm-manage__confirm">
                  {cascadePrompt.message}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  aria-label={`连同条目删除记忆库 ${memoryName(cascadePrompt.memoryId)}`}
                  onClick={() =>
                    void deleteMemory(cascadePrompt.memoryId, true)
                  }
                >
                  连同条目删除
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setCascadePrompt(null)}
                >
                  取消
                </Button>
              </div>
            ) : null}
            <div className="tm-manage__attach-row">
              <TextField
                label="新建记忆库"
                value={newMemoryName}
                onChange={(event) => setNewMemoryName(event.target.value)}
                placeholder="如：医疗器械主库"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !newMemoryName.trim()}
                onClick={() => void createAndAttach()}
              >
                新建并挂载
              </Button>
            </div>
          </div>
        </section>

        <section className="tm-manage__entries">
          <h3 className="tm-manage__heading">条目</h3>
          {selectedMemoryId === null ? (
            <EmptyState title="未挂载记忆库" />
          ) : (
            <>
              <form
                className="tm-manage__toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPage(0);
                  setAppliedQuery(queryInput.trim());
                }}
              >
                <SelectField
                  label="记忆库"
                  value={selectedMemoryId}
                  onChange={(event) => {
                    setSelectedMemoryId(event.target.value);
                    setPage(0);
                  }}
                >
                  {mounts.map((mount) => (
                    <option key={mount.memoryId} value={mount.memoryId}>
                      {memoryName(mount.memoryId)}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="搜索源文或译文"
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="输入片段，双语都会匹配"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                >
                  搜索
                </Button>
              </form>
              <p className="tm-manage__count">
                {total === null
                  ? "加载中…"
                  : appliedQuery
                    ? `匹配「${appliedQuery}」共 ${total} 条`
                    : `记忆库「${memoryName(selectedMemoryId)}」共 ${total} 条`}
              </p>

              {total === 0 ? (
                appliedQuery ? (
                  <EmptyState title="无匹配条目" />
                ) : (
                  <EmptyState title="记忆库暂无条目" />
                )
              ) : (
                <div className="dock-stack">
                  {entries.map((entry) =>
                    editingId === entry.id ? (
                      <div className="match-card" key={entry.id}>
                        <TextAreaField
                          label="源文"
                          rows={2}
                          value={editSource}
                          onChange={(event) =>
                            setEditSource(event.target.value)
                          }
                        />
                        <TextAreaField
                          label="译文"
                          rows={2}
                          value={editTarget}
                          onChange={(event) =>
                            setEditTarget(event.target.value)
                          }
                        />
                        <div className="tm-manage__actions">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={
                              busy || !editSource.trim() || !editTarget.trim()
                            }
                            onClick={() => void saveEdit()}
                          >
                            保存
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setEditingId(null)}
                          >
                            取消
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="match-card" key={entry.id}>
                        <span className="match-card__origin">
                          源：{entry.sourceText}
                        </span>
                        <p className="match-card__text">{entry.targetText}</p>
                        <div className="tm-manage__actions">
                          {confirmingDeleteId === entry.id ? (
                            <>
                              <span className="tm-manage__confirm">
                                确认删除该条目？
                              </span>
                              <Button
                                size="sm"
                                variant="danger"
                                disabled={busy}
                                aria-label={`确认删除条目 ${entry.sourceText}`}
                                onClick={() => void deleteEntry(entry)}
                              >
                                确认删除
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => setConfirmingDeleteId(null)}
                              >
                                取消
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                aria-label={`编辑条目 ${entry.sourceText}`}
                                onClick={() => beginEdit(entry)}
                              >
                                编辑
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                aria-label={`删除条目 ${entry.sourceText}`}
                                onClick={() => {
                                  setConfirmingDeleteId(entry.id);
                                  setEditingId(null);
                                  setNotice(null);
                                }}
                              >
                                删除
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ),
                  )}
                </div>
              )}

              {pageCount > 1 ? (
                <div className="tm-manage__pager">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || page === 0}
                    onClick={() => setPage(page - 1)}
                  >
                    上一页
                  </Button>
                  <span>
                    第 {page + 1} / {pageCount} 页
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || page >= pageCount - 1}
                    onClick={() => setPage(page + 1)}
                  >
                    下一页
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}
