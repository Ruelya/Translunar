import { useCallback, useEffect, useState } from "react";

import type {
  Memory,
  MemoryMount,
  Project,
  QaProfileUpdateParams,
  QaProfileView,
  QaSeverity,
  Termbase,
  TermbaseListResult,
  TermbaseMount,
} from "@translunar/contracts";
import { Badge, Button, Dialog, SelectField, TextField } from "@translunar/ui";

import {
  EngineClientError,
  callEngine,
  describeError,
  isExportBlocked,
} from "../lib/engine.js";
import { ExportOverwriteConfirm } from "./ExportOverwriteConfirm.js";
import { defaultSegmentation, defaultSrxPath } from "./ImportDocumentDialog.js";
import { LocaleField } from "./LocaleField.js";
import { TermManagePanel } from "./TermManagePanel.js";

type SegmentationChoice = "sentence" | "paragraph";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

const SEVERITY_LABEL: Record<QaSeverity, string> = {
  error: "错误",
  warning: "警告",
  info: "提示",
};

/** Drafts of the QA settings knobs; numbers stay text while typing. */
interface QaSettingsDraft {
  cjkPunctuation: boolean;
  cjkSpacing: boolean;
  requireSentenceFinalPunctuation: boolean;
  minLengthRatioPercent: string;
  maxLengthRatioPercent: string;
  /** Empty means no character limit (`maxTargetChars: null`). */
  maxTargetChars: string;
}

/** Parses a knob draft as a non-negative integer; null when it is not one. */
function parseKnob(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  return Number.parseInt(trimmed, 10);
}

/** The change a `qa.profile.update` carries besides project id/revision. */
type QaProfileChange = Omit<
  QaProfileUpdateParams,
  "projectId" | "baseRevision"
>;

export interface ProjectSettingsDialogProps {
  open: boolean;
  project: Project;
  onClose: () => void;
  /** Called with the stored project after project.update / project.archive. */
  onProjectUpdated?: (project: Project) => void;
  /**
   * Reports the stored QA export gate whenever this dialog learns it
   * (fetch on open, toggle), so the shell's menu checkbox stays current.
   */
  onExportGateChange?: (gate: boolean) => void;
}

/**
 * Project settings. Name and language pair save through project.update; the
 * engine rejects a language change once the project holds documents, TM
 * entries, or termbase mounts, and that conflict is surfaced verbatim.
 * The import-defaults section edits the same stored defaults the import
 * dialog pre-fills from (`configuration.segmentation` /
 * `configuration.srxPath`): saving in sentence mode sends the drafted SRX
 * path (or `clearSrxPath` when the draft is empty), while paragraph mode
 * only sends the segmentation so a stored SRX survives a later switch back.
 * Only the SRX path is stored — a missing file fails at import time.
 * Lifecycle moves through project.archive (archive / restore). The termbase
 * section manages real mounts through termbase.list/create/attach/detach,
 * edits mounts through termbase.update (上移/下移 move the mount priority
 * term.lookup and QA read in; 停用 removes a mount from that read path;
 * the per-mount writable switch flips freely — several writable termbase
 * mounts are the normal state), opens a per-termbase entry manager backed
 * by term.list/update/delete, and moves CSV/TSV/TBX files through
 * termbase.import/export. The TM section
 * moves TMX/CSV/TSV files through tm.import/export against an explicitly
 * picked mounted memory (memory.list): the picker defaults to the writable
 * working memory, and the chosen memoryId always rides on the call — the
 * destination or source library is never implicit. All file picks go
 * through dedicated dialog channels in the main process; a canceled pick
 * does nothing and every result message reports the engine's real counts.
 * An export refused with exportBlocked (destination exists) surfaces an
 * inline overwrite confirm; only an explicit 覆盖 retries with
 * overwrite: true, and 取消 leaves the existing file untouched.
 *
 * File and termbase actions each track their own in-flight state (a Set of
 * action ids), so a long TM import never locks the termbase buttons and
 * vice versa. Only import/export against the same resource (the project TM,
 * or one termbase) stay mutually exclusive, because they read and write the
 * same store. Project info save, archive, and detach share a single `busy`
 * flag since they mutate the project record itself.
 */
export function ProjectSettingsDialog({
  open,
  project,
  onClose,
  onProjectUpdated,
  onExportGateChange,
}: ProjectSettingsDialogProps) {
  const [termbases, setTermbases] = useState<TermbaseListResult | null>(null);
  const [newTermbaseName, setNewTermbaseName] = useState("");
  const [pending, setPending] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [nameDraft, setNameDraft] = useState(project.name);
  const [sourceDraft, setSourceDraft] = useState(project.sourceLocale);
  const [targetDraft, setTargetDraft] = useState(project.targetLocale);
  const [segmentationDraft, setSegmentationDraft] =
    useState<SegmentationChoice>(() => defaultSegmentation(project));
  const [srxDraft, setSrxDraft] = useState<string | null>(() =>
    defaultSrxPath(project),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [managedTermbaseId, setManagedTermbaseId] = useState<string | null>(
    null,
  );
  // The project's effective QA profile (qa.profile.get); carries the
  // revision the next qa.profile.update must be based on.
  const [qaProfile, setQaProfile] = useState<QaProfileView | null>(null);
  // Editable copies of the stored QA settings knobs, resynced from every
  // stored view (open fetch, update result, conflict refetch).
  const [qaSettingsDraft, setQaSettingsDraft] =
    useState<QaSettingsDraft | null>(null);
  // An export the engine refused because the destination exists. Kept until
  // the user explicitly picks 覆盖 (retry with overwrite) or 取消 (leave the
  // existing file untouched).
  const [overwritePrompt, setOverwritePrompt] = useState<
    | { kind: "tm"; path: string; memoryId: string }
    | { kind: "termbase"; termbase: Termbase; path: string }
    | null
  >(null);
  // Mounted memories for the TM import/export picker. The choice defaults
  // to the writable working memory but any mounted memory can be the
  // import destination or export source.
  const [tmMemories, setTmMemories] = useState<Memory[]>([]);
  const [tmMounts, setTmMounts] = useState<MemoryMount[]>([]);
  const [tmMemoryChoice, setTmMemoryChoice] = useState("");

  const beginAction = useCallback((actionId: string) => {
    setPending((previous) => {
      const next = new Set(previous);
      next.add(actionId);
      return next;
    });
  }, []);

  const endAction = useCallback((actionId: string) => {
    setPending((previous) => {
      const next = new Set(previous);
      next.delete(actionId);
      return next;
    });
  }, []);

  const refreshTermbases = useCallback(async () => {
    const result = await callEngine("termbase.list", {
      projectId: project.id,
    });
    setTermbases(result);
  }, [project.id]);

  const refreshMemories = useCallback(async () => {
    const result = await callEngine("memory.list", { projectId: project.id });
    setTmMemories(result.memories);
    setTmMounts(result.mounts);
    // Runs on every open: the pick re-defaults to the current writable
    // working memory, so a promotion between visits is always reflected.
    const writable = result.mounts.find((mount) => mount.writable);
    setTmMemoryChoice(writable?.memoryId ?? result.mounts[0]?.memoryId ?? "");
  }, [project.id]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // Resync the drafts whenever the dialog opens or the stored project
    // changes (e.g. right after a successful save).
    setNameDraft(project.name);
    setSourceDraft(project.sourceLocale);
    setTargetDraft(project.targetLocale);
    setSegmentationDraft(defaultSegmentation(project));
    setSrxDraft(defaultSrxPath(project));
    setOverwritePrompt(null);
    refreshTermbases().catch((listError: unknown) => {
      setError(describeError(listError));
    });
    refreshMemories().catch((listError: unknown) => {
      setError(describeError(listError));
    });
    setQaProfile(null);
    callEngine("qa.profile.get", { projectId: project.id })
      .then(setQaProfile)
      .catch((profileError: unknown) => {
        setError(describeError(profileError));
      });
  }, [open, project, refreshTermbases, refreshMemories]);

  // Every stored view of the gate (open fetch, toggle, conflict refetch)
  // goes up to the shell so the QA menu checkbox never trails this dialog.
  useEffect(() => {
    if (qaProfile) {
      onExportGateChange?.(qaProfile.blockExportOnError);
    }
  }, [qaProfile, onExportGateChange]);

  // The knob drafts always mirror the latest stored view — an update from
  // any control in this section (gate, remap, settings) re-seeds them. A
  // view without settings (older engine) renders the unloaded note instead.
  useEffect(() => {
    const settings = qaProfile?.settings;
    if (!settings) {
      setQaSettingsDraft(null);
      return;
    }
    setQaSettingsDraft({
      cjkPunctuation: settings.cjkPunctuation,
      cjkSpacing: settings.cjkSpacing,
      requireSentenceFinalPunctuation: settings.requireSentenceFinalPunctuation,
      minLengthRatioPercent: String(settings.minLengthRatioPercent),
      maxLengthRatioPercent: String(settings.maxLengthRatioPercent),
      maxTargetChars:
        settings.maxTargetChars == null ? "" : String(settings.maxTargetChars),
    });
  }, [qaProfile]);

  // Every write to the stored QA profile goes through here. The stored
  // view's revision is the optimistic-concurrency base; on `conflict` the
  // change is rebased once on a refetched view and retried, and any other
  // refusal (or a second conflict) surfaces the engine's message verbatim.
  const applyQaProfileUpdate = useCallback(
    async (
      change: (profile: QaProfileView) => QaProfileChange,
      notice: string,
    ) => {
      if (!qaProfile) {
        return;
      }
      beginAction("qa.profile");
      setError(null);
      setNotice(null);
      try {
        let updated: QaProfileView;
        try {
          updated = await callEngine("qa.profile.update", {
            projectId: project.id,
            baseRevision: qaProfile.revision,
            ...change(qaProfile),
          });
        } catch (firstError) {
          if (
            !(firstError instanceof EngineClientError) ||
            firstError.code !== "conflict"
          ) {
            throw firstError;
          }
          const fresh = await callEngine("qa.profile.get", {
            projectId: project.id,
          });
          setQaProfile(fresh);
          updated = await callEngine("qa.profile.update", {
            projectId: project.id,
            baseRevision: fresh.revision,
            ...change(fresh),
          });
        }
        setQaProfile(updated);
        setNotice(notice);
      } catch (updateError) {
        setError(describeError(updateError));
        // The stored revision may have moved; refetch so the next write is
        // based on reality.
        try {
          setQaProfile(
            await callEngine("qa.profile.get", { projectId: project.id }),
          );
        } catch {
          // The error banner already reports the failure.
        }
      } finally {
        endAction("qa.profile");
      }
    },
    [qaProfile, project.id, beginAction, endAction],
  );

  const setExportGate = useCallback(
    (blocked: boolean) =>
      applyQaProfileUpdate(
        () => ({ blockExportOnError: blocked }),
        blocked ? "已开启导出前 QA 检查" : "已关闭导出前 QA 检查",
      ),
    [applyQaProfileUpdate],
  );

  // One remap row changed. The table replaces wholesale (`{}` clears every
  // remap — the contract), so the full table is rebuilt from the stored
  // view plus this single change; a conflict retry rebuilds it from the
  // refetched view, never replaying a stale table.
  const setRuleSeverity = useCallback(
    (ruleId: string, value: "default" | QaSeverity) =>
      applyQaProfileUpdate(
        (profile) => {
          const overrides = { ...profile.severityOverrides };
          if (value === "default") {
            delete overrides[ruleId];
          } else {
            overrides[ruleId] = value;
          }
          return { severityOverrides: overrides };
        },
        value === "default"
          ? `已清除严重度覆写：${ruleId}`
          : `严重度已更新：${ruleId} → ${SEVERITY_LABEL[value]}`,
      ),
    [applyQaProfileUpdate],
  );

  const qaKnobsValid =
    qaSettingsDraft !== null &&
    parseKnob(qaSettingsDraft.minLengthRatioPercent) !== null &&
    parseKnob(qaSettingsDraft.maxLengthRatioPercent) !== null &&
    (qaSettingsDraft.maxTargetChars.trim() === "" ||
      parseKnob(qaSettingsDraft.maxTargetChars) !== null);

  const saveQaSettings = useCallback(() => {
    if (!qaSettingsDraft) {
      return;
    }
    const min = parseKnob(qaSettingsDraft.minLengthRatioPercent);
    const max = parseKnob(qaSettingsDraft.maxLengthRatioPercent);
    if (min === null || max === null) {
      return;
    }
    const cap = qaSettingsDraft.maxTargetChars.trim();
    return applyQaProfileUpdate(
      () => ({
        settings: {
          cjkPunctuation: qaSettingsDraft.cjkPunctuation,
          cjkSpacing: qaSettingsDraft.cjkSpacing,
          requireSentenceFinalPunctuation:
            qaSettingsDraft.requireSentenceFinalPunctuation,
          minLengthRatioPercent: min,
          maxLengthRatioPercent: max,
          maxTargetChars: cap === "" ? null : parseKnob(cap),
        },
      }),
      "QA 规则参数已保存",
    );
  }, [qaSettingsDraft, applyQaProfileUpdate]);

  // Drops the project-level settings replacement (`clearSettings`), back
  // to the base profile's values.
  const clearQaSettings = useCallback(
    () =>
      applyQaProfileUpdate(
        () => ({ clearSettings: true }),
        "QA 规则参数已恢复默认",
      ),
    [applyQaProfileUpdate],
  );

  const saveProjectInfo = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await callEngine("project.update", {
        projectId: project.id,
        name: nameDraft,
        sourceLocale: sourceDraft,
        targetLocale: targetDraft,
      });
      setNotice(
        `项目设置已保存：${updated.name}（${updated.sourceLocale} → ${updated.targetLocale}）`,
      );
      onProjectUpdated?.(updated);
    } catch (saveError) {
      setError(describeError(saveError));
    } finally {
      setBusy(false);
    }
  }, [project.id, nameDraft, sourceDraft, targetDraft, onProjectUpdated]);

  const chooseDefaultSrx = useCallback(async () => {
    const path = await window.tl.chooseSrxFile();
    if (path) {
      setSrxDraft(path);
      setError(null);
    }
  }, []);

  const saveImportDefaults = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Sentence mode sends the drafted SRX path or clears the stored one;
      // paragraph mode only sends the segmentation (the engine keeps a
      // stored SRX for a later switch back and rejects a new one).
      const updated = await callEngine(
        "project.update",
        segmentationDraft === "paragraph"
          ? { projectId: project.id, segmentation: segmentationDraft }
          : srxDraft
            ? {
                projectId: project.id,
                segmentation: segmentationDraft,
                srxPath: srxDraft,
              }
            : {
                projectId: project.id,
                segmentation: segmentationDraft,
                clearSrxPath: true,
              },
      );
      setNotice(
        updated.configuration.segmentation === "paragraph"
          ? "导入默认已保存：段落分段。"
          : `导入默认已保存：句子分段（${
              updated.configuration.srxPath
                ? `SRX：${baseName(updated.configuration.srxPath)}`
                : "内置 SRX 规则"
            }）。`,
      );
      onProjectUpdated?.(updated);
    } catch (saveError) {
      setError(describeError(saveError));
    } finally {
      setBusy(false);
    }
  }, [project.id, segmentationDraft, srxDraft, onProjectUpdated]);

  const setArchived = useCallback(
    async (archived: boolean) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const updated = await callEngine("project.archive", {
          projectId: project.id,
          archived,
        });
        setNotice(archived ? "项目已归档" : "项目已恢复为进行中");
        onProjectUpdated?.(updated);
      } catch (archiveError) {
        setError(describeError(archiveError));
      } finally {
        setBusy(false);
      }
    },
    [project.id, onProjectUpdated],
  );

  const createAndAttach = useCallback(async () => {
    beginAction("termbase.create");
    setError(null);
    try {
      const termbase = await callEngine("termbase.create", {
        name: newTermbaseName.trim(),
        sourceLocale: project.sourceLocale,
      });
      await callEngine("termbase.attach", {
        projectId: project.id,
        termbaseId: termbase.id,
      });
      setNewTermbaseName("");
      await refreshTermbases();
    } catch (createError) {
      setError(describeError(createError));
    } finally {
      endAction("termbase.create");
    }
  }, [
    beginAction,
    endAction,
    newTermbaseName,
    project.id,
    project.sourceLocale,
    refreshTermbases,
  ]);

  const attachExisting = useCallback(
    async (termbaseId: string) => {
      beginAction(`termbase.attach:${termbaseId}`);
      setError(null);
      try {
        await callEngine("termbase.attach", {
          projectId: project.id,
          termbaseId,
        });
        await refreshTermbases();
      } catch (attachError) {
        setError(describeError(attachError));
      } finally {
        endAction(`termbase.attach:${termbaseId}`);
      }
    },
    [beginAction, endAction, project.id, refreshTermbases],
  );

  const detachTermbase = useCallback(
    async (termbase: Termbase) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await callEngine("termbase.detach", {
          projectId: project.id,
          termbaseId: termbase.id,
        });
        setNotice(`术语库「${termbase.name}」已卸载`);
        await refreshTermbases();
      } catch (detachError) {
        setError(describeError(detachError));
      } finally {
        setBusy(false);
      }
    },
    [project.id, refreshTermbases],
  );

  // One mount edit (priority move, enable/disable, writable switch): run
  // termbase.update, then re-read the engine's real mount state. A priority
  // move renumbers siblings, so the refetch is never optional.
  const updateTermbaseMount = useCallback(
    async (
      termbaseId: string,
      change: { enabled?: boolean; writable?: boolean; priority?: number },
    ) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await callEngine("termbase.update", {
          projectId: project.id,
          termbaseId,
          ...change,
        });
        await refreshTermbases();
      } catch (updateError) {
        setError(describeError(updateError));
        await refreshTermbases().catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [project.id, refreshTermbases],
  );

  const tmMemoryName = useCallback(
    (memoryId: string) =>
      tmMemories.find((memory) => memory.id === memoryId)?.name ?? memoryId,
    [tmMemories],
  );

  const importTm = useCallback(async () => {
    if (!tmMemoryChoice) {
      return;
    }
    const path = await window.tl.chooseTmImportFile();
    if (!path) {
      return;
    }
    beginAction("tm.import");
    setError(null);
    setNotice(null);
    try {
      const result = await callEngine("tm.import", {
        projectId: project.id,
        path,
        memoryId: tmMemoryChoice,
      });
      setNotice(
        `外部 TM 导入完成（库「${tmMemoryName(tmMemoryChoice)}」）：读取 ${result.imported} 条，新增 ${result.added}，更新 ${result.updated}`,
      );
    } catch (importError) {
      setError(describeError(importError));
    } finally {
      endAction("tm.import");
    }
  }, [beginAction, endAction, project.id, tmMemoryChoice, tmMemoryName]);

  const exportTm = useCallback(async () => {
    if (!tmMemoryChoice) {
      return;
    }
    const path = await window.tl.chooseTmExportPath(`${project.name}-tm.tmx`);
    if (!path) {
      return;
    }
    beginAction("tm.export");
    setError(null);
    setNotice(null);
    setOverwritePrompt(null);
    try {
      const result = await callEngine("tm.export", {
        projectId: project.id,
        path,
        memoryId: tmMemoryChoice,
      });
      setNotice(
        `TM 导出完成（库「${tmMemoryName(tmMemoryChoice)}」）：${result.exported} 条 → ${result.outputPath}`,
      );
    } catch (exportError) {
      if (isExportBlocked(exportError)) {
        // The engine never clobbers silently; hand the decision to the
        // user. The retry must hit the same memory the refusal did.
        setOverwritePrompt({ kind: "tm", path, memoryId: tmMemoryChoice });
      } else {
        setError(describeError(exportError));
      }
    } finally {
      endAction("tm.export");
    }
  }, [
    beginAction,
    endAction,
    project.id,
    project.name,
    tmMemoryChoice,
    tmMemoryName,
  ]);

  const importTermbase = useCallback(
    async (termbase: Termbase) => {
      const path = await window.tl.chooseTermbaseImportFile();
      if (!path) {
        return;
      }
      beginAction(`termbase.import:${termbase.id}`);
      setError(null);
      setNotice(null);
      try {
        const result = await callEngine("termbase.import", {
          termbaseId: termbase.id,
          path,
          targetLocale: project.targetLocale,
        });
        setNotice(
          `术语库「${termbase.name}」导入完成：读取 ${result.imported} 条，新增 ${result.added}，合并 ${result.merged}`,
        );
      } catch (importError) {
        setError(describeError(importError));
      } finally {
        endAction(`termbase.import:${termbase.id}`);
      }
    },
    [beginAction, endAction, project.targetLocale],
  );

  const exportTermbase = useCallback(
    async (termbase: Termbase) => {
      const path = await window.tl.chooseTermbaseExportPath(
        `${termbase.name}.csv`,
      );
      if (!path) {
        return;
      }
      beginAction(`termbase.export:${termbase.id}`);
      setError(null);
      setNotice(null);
      setOverwritePrompt(null);
      try {
        const result = await callEngine("termbase.export", {
          termbaseId: termbase.id,
          path,
        });
        setNotice(
          `术语库「${termbase.name}」导出完成：${result.exported} 条 → ${result.outputPath}`,
        );
      } catch (exportError) {
        if (isExportBlocked(exportError)) {
          setOverwritePrompt({ kind: "termbase", termbase, path });
        } else {
          setError(describeError(exportError));
        }
      } finally {
        endAction(`termbase.export:${termbase.id}`);
      }
    },
    [beginAction, endAction],
  );

  // 覆盖: retry the blocked export with the explicit overwrite flag.
  const confirmOverwriteExport = useCallback(async () => {
    if (!overwritePrompt) {
      return;
    }
    const actionId =
      overwritePrompt.kind === "tm"
        ? "tm.export"
        : `termbase.export:${overwritePrompt.termbase.id}`;
    beginAction(actionId);
    setError(null);
    setNotice(null);
    try {
      if (overwritePrompt.kind === "tm") {
        const result = await callEngine("tm.export", {
          projectId: project.id,
          path: overwritePrompt.path,
          memoryId: overwritePrompt.memoryId,
          overwrite: true,
        });
        setNotice(
          `TM 导出完成（已覆盖，库「${tmMemoryName(overwritePrompt.memoryId)}」）：${result.exported} 条 → ${result.outputPath}`,
        );
      } else {
        const result = await callEngine("termbase.export", {
          termbaseId: overwritePrompt.termbase.id,
          path: overwritePrompt.path,
          overwrite: true,
        });
        setNotice(
          `术语库「${overwritePrompt.termbase.name}」导出完成（已覆盖）：${result.exported} 条 → ${result.outputPath}`,
        );
      }
      setOverwritePrompt(null);
    } catch (retryError) {
      setOverwritePrompt(null);
      setError(describeError(retryError));
    } finally {
      endAction(actionId);
    }
  }, [overwritePrompt, beginAction, endAction, project.id, tmMemoryName]);

  // 取消: nothing was written and the existing file stays as it is.
  const cancelOverwriteExport = useCallback(() => {
    setOverwritePrompt(null);
    setNotice("已取消导出");
  }, []);

  const tmImportPending = pending.has("tm.import");
  const tmExportPending = pending.has("tm.export");
  const overwritePending =
    overwritePrompt === null
      ? false
      : pending.has(
          overwritePrompt.kind === "tm"
            ? "tm.export"
            : `termbase.export:${overwritePrompt.termbase.id}`,
        );
  // Import and export hit the same project TM, so they exclude each other;
  // everything else runs independently.
  const tmFileBusy = tmImportPending || tmExportPending;
  const createPending = pending.has("termbase.create");

  // Mounted rows in mount priority order (termbase.list returns mounts
  // sorted by priority) — the order term.lookup and QA read the mounts in.
  const termbaseMounts = termbases?.mounts ?? [];
  const mounted = termbaseMounts
    .map((mount) => {
      const termbase = (termbases?.termbases ?? []).find(
        (item) => item.id === mount.termbaseId,
      );
      return termbase ? { mount, termbase } : null;
    })
    .filter(
      (row): row is { mount: TermbaseMount; termbase: Termbase } =>
        row !== null,
    );
  const unmounted = (termbases?.termbases ?? []).filter(
    (termbase) =>
      !termbaseMounts.some((mount) => mount.termbaseId === termbase.id),
  );

  return (
    <Dialog
      title={`项目设置 — ${project.name}`}
      open={open}
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="settings">
        <section className="settings__section">
          <h3 className="settings__heading">项目信息</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveProjectInfo();
            }}
          >
            <TextField
              label="项目名称"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              required
              placeholder="如：TL-900 用户手册"
            />
            <div className="form-row">
              <LocaleField
                label="源语言"
                value={sourceDraft}
                onChange={(event) => setSourceDraft(event.target.value)}
                required
              />
              <LocaleField
                label="目标语言"
                value={targetDraft}
                onChange={(event) => setTargetDraft(event.target.value)}
                required
              />
            </div>
            <div className="settings__row">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={
                  busy ||
                  !nameDraft.trim() ||
                  !sourceDraft.trim() ||
                  !targetDraft.trim()
                }
              >
                保存项目信息
              </Button>
            </div>
          </form>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">导入默认</h3>
          <SelectField
            label="默认分段方式"
            value={segmentationDraft}
            disabled={busy}
            onChange={(event) =>
              setSegmentationDraft(event.target.value as SegmentationChoice)
            }
          >
            <option value="sentence">句子（SRX 规则）</option>
            <option value="paragraph">段落</option>
          </SelectField>
          <div className="settings__row">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || segmentationDraft !== "sentence"}
              onClick={() => void chooseDefaultSrx()}
            >
              选择默认 SRX 规则…
            </Button>
            {srxDraft ? (
              <>
                <span className="import-form__path">{baseName(srxDraft)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setSrxDraft(null)}
                >
                  清除
                </Button>
              </>
            ) : (
              <span className="import-form__path">
                内置规则（{project.sourceLocale}）
              </span>
            )}
          </div>
          <div className="settings__row">
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void saveImportDefaults()}
            >
              保存导入默认
            </Button>
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">质量检查</h3>
          {qaProfile && qaSettingsDraft ? (
            <>
              <p className="settings__note">
                基础配置：<code>{qaProfile.baseProfileId}</code>
              </p>
              <label className="settings__row">
                <input
                  type="checkbox"
                  checked={qaProfile.blockExportOnError}
                  disabled={pending.has("qa.profile")}
                  onChange={(event) => void setExportGate(event.target.checked)}
                />
                有错误时阻止导出
              </label>
              <h4 className="settings__subheading">规则参数</h4>
              <div className="settings__row">
                {(
                  [
                    ["cjkPunctuation", "CJK 标点"],
                    ["cjkSpacing", "CJK 间距"],
                    ["requireSentenceFinalPunctuation", "句末标点"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="settings__row" key={key}>
                    <input
                      type="checkbox"
                      checked={qaSettingsDraft[key]}
                      disabled={pending.has("qa.profile")}
                      onChange={(event) =>
                        setQaSettingsDraft({
                          ...qaSettingsDraft,
                          [key]: event.target.checked,
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="form-row">
                <TextField
                  label="最短比（%）"
                  inputMode="numeric"
                  value={qaSettingsDraft.minLengthRatioPercent}
                  disabled={pending.has("qa.profile")}
                  placeholder="如 30"
                  hint="译文长度低于源文的该百分比时报长度问题"
                  onChange={(event) =>
                    setQaSettingsDraft({
                      ...qaSettingsDraft,
                      minLengthRatioPercent: event.target.value,
                    })
                  }
                />
                <TextField
                  label="最长比（%）"
                  inputMode="numeric"
                  value={qaSettingsDraft.maxLengthRatioPercent}
                  disabled={pending.has("qa.profile")}
                  placeholder="如 250"
                  hint="译文长度超过源文的该百分比时报长度问题"
                  onChange={(event) =>
                    setQaSettingsDraft({
                      ...qaSettingsDraft,
                      maxLengthRatioPercent: event.target.value,
                    })
                  }
                />
                <TextField
                  label="字数上限"
                  inputMode="numeric"
                  value={qaSettingsDraft.maxTargetChars}
                  disabled={pending.has("qa.profile")}
                  placeholder="0 表示不限"
                  hint="单句译文的字符数硬上限"
                  onChange={(event) =>
                    setQaSettingsDraft({
                      ...qaSettingsDraft,
                      maxTargetChars: event.target.value,
                    })
                  }
                />
              </div>
              <div className="settings__row">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending.has("qa.profile") || !qaKnobsValid}
                  onClick={() => void saveQaSettings()}
                >
                  保存规则参数
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending.has("qa.profile")}
                  onClick={() => void clearQaSettings()}
                >
                  恢复默认
                </Button>
              </div>
              <h4 className="settings__subheading">严重度</h4>
              {/* The rows are the compiled profile's own static rule ids
                  (qa.profile.get enabledRuleIds) — never a hand-kept copy.
                  Parameterized findings (qa.term-*:<id>, qa.regex:<id>)
                  exist per term/regex definition and get no static row. */}
              <div className="qa-rule-grid">
                {qaProfile.enabledRuleIds.map((ruleId) => {
                  const override = qaProfile.severityOverrides[ruleId];
                  return (
                    <SelectField
                      key={ruleId}
                      label={ruleId}
                      className="qa-rule-grid__row"
                      value={override ?? "default"}
                      disabled={pending.has("qa.profile")}
                      onChange={(event) =>
                        void setRuleSeverity(
                          ruleId,
                          event.target.value as "default" | QaSeverity,
                        )
                      }
                    >
                      <option value="default">默认</option>
                      <option value="error">错误</option>
                      <option value="warning">警告</option>
                      <option value="info">提示</option>
                    </SelectField>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="settings__note">配置未加载。</p>
          )}
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">生命周期</h3>
          <div className="settings__row">
            <span>
              {project.lifecycle === "archived" ? "已归档" : "进行中"}
            </span>
            <Badge tone={project.lifecycle === "archived" ? "neutral" : "ok"}>
              {project.lifecycle === "archived" ? "archived" : "active"}
            </Badge>
            {project.lifecycle === "archived" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void setArchived(false)}
              >
                恢复项目
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void setArchived(true)}
              >
                归档项目
              </Button>
            )}
          </div>
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">翻译记忆</h3>
          {tmMounts.length === 0 ? (
            <p className="settings__note">
              未挂载记忆库，无法导入或导出。请先在 TM 管理中挂载。
            </p>
          ) : (
            <div className="settings__row">
              <SelectField
                label="记忆库"
                value={tmMemoryChoice}
                disabled={tmFileBusy}
                onChange={(event) => setTmMemoryChoice(event.target.value)}
              >
                {tmMounts.map((mount) => (
                  <option key={mount.memoryId} value={mount.memoryId}>
                    {tmMemoryName(mount.memoryId)}
                    {mount.writable ? "（可写）" : ""}
                  </option>
                ))}
              </SelectField>
              <Button
                size="sm"
                variant="outline"
                disabled={tmFileBusy || !tmMemoryChoice}
                onClick={() => void importTm()}
              >
                {tmImportPending ? "导入中…" : "导入外部 TM…"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={tmFileBusy || !tmMemoryChoice}
                onClick={() => void exportTm()}
              >
                {tmExportPending ? "导出中…" : "导出 TM…"}
              </Button>
            </div>
          )}
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">术语库</h3>
          {mounted.length === 0 ? (
            <p className="settings__note">尚未挂载术语库。</p>
          ) : (
            mounted.map(({ mount, termbase }, index) => {
              const importPending = pending.has(
                `termbase.import:${termbase.id}`,
              );
              const exportPending = pending.has(
                `termbase.export:${termbase.id}`,
              );
              // Same-termbase import and export exclude each other; other
              // termbases and the TM buttons stay usable.
              const fileBusy = importPending || exportPending;
              return (
                <div key={termbase.id}>
                  <div className="settings__row">
                    <span>{termbase.name}</span>
                    <Badge tone="ok">已挂载</Badge>
                    {mount.enabled ? null : <Badge tone="warn">已停用</Badge>}
                    {mount.writable ? null : <Badge tone="neutral">只读</Badge>}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || index === 0}
                      aria-label={`上移术语库 ${termbase.name}`}
                      onClick={() =>
                        void updateTermbaseMount(termbase.id, {
                          priority: Math.max(0, mount.priority - 1),
                        })
                      }
                    >
                      上移
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || index === mounted.length - 1}
                      aria-label={`下移术语库 ${termbase.name}`}
                      onClick={() =>
                        void updateTermbaseMount(termbase.id, {
                          priority: mount.priority + 1,
                        })
                      }
                    >
                      下移
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={
                        mount.enabled
                          ? `停用术语库 ${termbase.name}`
                          : `启用术语库 ${termbase.name}`
                      }
                      onClick={() =>
                        void updateTermbaseMount(termbase.id, {
                          enabled: !mount.enabled,
                        })
                      }
                    >
                      {mount.enabled ? "停用" : "启用"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={
                        mount.writable
                          ? `设为只读术语库 ${termbase.name}`
                          : `设为可写术语库 ${termbase.name}`
                      }
                      onClick={() =>
                        void updateTermbaseMount(termbase.id, {
                          writable: !mount.writable,
                        })
                      }
                    >
                      {mount.writable ? "设为只读" : "设为可写"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`管理术语库 ${termbase.name} 的术语`}
                      onClick={() =>
                        setManagedTermbaseId((current) =>
                          current === termbase.id ? null : termbase.id,
                        )
                      }
                    >
                      {managedTermbaseId === termbase.id
                        ? "收起术语"
                        : "管理术语"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={fileBusy}
                      aria-label={`导入术语到 ${termbase.name}`}
                      onClick={() => void importTermbase(termbase)}
                    >
                      {importPending ? "导入中…" : "导入 CSV/TBX…"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={fileBusy}
                      aria-label={`导出术语库 ${termbase.name}`}
                      onClick={() => void exportTermbase(termbase)}
                    >
                      {exportPending ? "导出中…" : "导出…"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || fileBusy}
                      aria-label={`卸载术语库 ${termbase.name}`}
                      onClick={() => void detachTermbase(termbase)}
                    >
                      卸载
                    </Button>
                  </div>
                  {managedTermbaseId === termbase.id ? (
                    <TermManagePanel termbase={termbase} />
                  ) : null}
                </div>
              );
            })
          )}
          {unmounted.map((termbase) => {
            const attachPending = pending.has(`termbase.attach:${termbase.id}`);
            return (
              <div className="settings__row" key={termbase.id}>
                <span>{termbase.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={attachPending}
                  onClick={() => void attachExisting(termbase.id)}
                >
                  {attachPending ? "挂载中…" : "挂载"}
                </Button>
              </div>
            );
          })}
          <form
            className="settings__row"
            onSubmit={(event) => {
              event.preventDefault();
              void createAndAttach();
            }}
          >
            <TextField
              label="新术语库名称"
              value={newTermbaseName}
              onChange={(event) => setNewTermbaseName(event.target.value)}
              placeholder="如：产品术语库"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={createPending || !newTermbaseName.trim()}
            >
              {createPending ? "新建中…" : "新建并挂载"}
            </Button>
          </form>
        </section>

        {overwritePrompt ? (
          <ExportOverwriteConfirm
            path={overwritePrompt.path}
            busy={overwritePending}
            onOverwrite={() => void confirmOverwriteExport()}
            onCancel={cancelOverwriteExport}
          />
        ) : null}

        {notice ? (
          <div className="honest-note" data-tone="ok" role="status">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="honest-note" data-tone="danger" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
