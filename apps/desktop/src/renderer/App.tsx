import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Project } from "@translunar/contracts";
import { SegmentProgress, StatusDot } from "@translunar/ui";

import type {
  EngineLifecycleState,
  EngineStatusPayload,
} from "../shared/desktop-api.js";
import { AboutDialog } from "./components/AboutDialog.js";
import { EngineGate } from "./components/EngineGate.js";
import { ProjectSettingsDialog } from "./components/ProjectSettingsDialog.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import type { SettingsSection } from "./components/SettingsDialog.js";
import { ShortcutsDialog } from "./components/ShortcutsDialog.js";
import { TitleBar } from "./components/TitleBar.js";
import { TmManageDialog } from "./components/TmManageDialog.js";
import { useTheme } from "./lib/theme.js";
import { ProjectsView } from "./views/ProjectsView.js";
import { WorkbenchView } from "./views/WorkbenchView.js";
import type { StatJumpTarget, WorkbenchStats } from "./views/WorkbenchView.js";

type EngineDotState = "ok" | "busy" | "down";

function dotState(status: EngineStatusPayload | null): EngineDotState {
  if (!status) {
    return "busy";
  }
  switch (status.state) {
    case "ready":
      return "ok";
    case "down":
      return "down";
    default:
      return "busy";
  }
}

function engineLabel(status: EngineStatusPayload | null): string {
  if (!status) {
    return "engine: 连接中";
  }
  switch (status.state) {
    case "ready":
      return `engine ${status.engineVersion ?? ""} · pid ${status.pid ?? "?"}`;
    case "starting":
      return "engine: 启动中";
    case "restarting":
      return `engine: 重启中 (${status.restarts})`;
    case "down":
      return `engine: 已停止${status.lastError ? `：${status.lastError}` : ""}`;
  }
}

export function App() {
  const [engineStatus, setEngineStatus] = useState<EngineStatusPayload | null>(
    null,
  );
  const [relaunching, setRelaunching] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [tmManageOpen, setTmManageOpen] = useState(false);
  // The application settings center (外观/字体/AI 供应商/快捷键). Openers
  // land on the section they promise: the statusbar theme chip on 外观,
  // the AI dock's 打开设置 on AI 供应商.
  const [appSettings, setAppSettings] = useState<{
    open: boolean;
    section: SettingsSection;
  }>({ open: false, section: "appearance" });
  // 帮助 dialogs are shell chrome: they open with or without a project.
  const [helpDialog, setHelpDialog] = useState<"keys" | "about" | null>(null);
  // The stored QA export gate, reported by the workbench (and by the
  // settings dialog's checkbox) so the menu checkbox mirrors reality.
  const [exportGate, setExportGate] = useState(false);
  // 文件 ▸ 新建项目… returns to the list with the create form focused; the
  // flag is consumed by ProjectsView exactly once.
  const [focusCreate, setFocusCreate] = useState(false);
  const { theme } = useTheme();
  const [statusMessage, setStatusMessage] =
    useState<string>("Translunar CAT 就绪");
  // Live document stats reported by the workbench; the status bar shows
  // them as first-class chrome so progress never hides inside a panel.
  const [workbenchStats, setWorkbenchStats] = useState<WorkbenchStats | null>(
    null,
  );
  // The workbench registers this jump so the 草稿/QA readouts can apply
  // the matching grid filter; cleared (null) when the workbench unmounts.
  const statJumpRef = useRef<((target: StatJumpTarget) => void) | null>(null);
  const registerStatJump = useCallback(
    (jump: ((target: StatJumpTarget) => void) | null) => {
      statJumpRef.current = jump;
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    void window.tl.engineStatus().then((status) => {
      if (!disposed) {
        setEngineStatus(status);
      }
    });
    const unsubscribe = window.tl.onEngineStatus((status) => {
      setEngineStatus(status);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // Single writer of the menu context: the application menu enables items
  // only for state that is actually open (no project -> almost everything
  // disabled; workbench reports document state via onDocumentOpenChange).
  useEffect(() => {
    window.tl.setMenuContext({
      projectOpen: project !== null,
      documentOpen: project !== null && documentOpen,
      exportGate: project !== null && exportGate,
    });
  }, [project, documentOpen, exportGate]);

  // Window title reports the working object: project — document — langs.
  // Real data only: the project in memory and the workbench-reported
  // document name; no project means the bare app name. document.title
  // (taskbar, Alt+Tab) and the integrated titlebar show the same string.
  const documentName = workbenchStats?.documentName;
  const windowTitle = useMemo(() => {
    if (!project) {
      return "Translunar";
    }
    const langs = `(${project.sourceLocale} → ${project.targetLocale})`;
    return documentName
      ? `${project.name} — ${documentName} ${langs}`
      : `${project.name} ${langs}`;
  }, [project, documentName]);
  useEffect(() => {
    document.title = windowTitle;
  }, [windowTitle]);

  // Shell actions shared by the application menu and the workbench command
  // palette: one handler each so both surfaces run the identical path.
  const handleNewProject = useCallback(() => {
    // Back to the list with the create form's name field focused —
    // the list's own form is the only create UI.
    setSettingsOpen(false);
    setTmManageOpen(false);
    setProject(null);
    setFocusCreate(true);
  }, []);
  const handleOpenShortcuts = useCallback(() => setHelpDialog("keys"), []);
  const handleOpenAbout = useCallback(() => setHelpDialog("about"), []);
  const handleOpenAppSettings = useCallback(
    (section: SettingsSection = "appearance") =>
      setAppSettings({ open: true, section }),
    [],
  );

  // Shell-level menu commands; workbench-level ones are handled inside
  // WorkbenchView. Both go through the same actions as the ribbon buttons.
  // The menu disables these without a project, but guard anyway so a stray
  // command can never queue a settings dialog for a future project.
  useEffect(() => {
    return window.tl.onMenuCommand((command) => {
      if (command === "open-project-settings") {
        if (project) {
          setSettingsOpen(true);
        }
      } else if (command === "close-project") {
        setSettingsOpen(false);
        setProject(null);
      } else if (command === "new-project") {
        handleNewProject();
      } else if (command === "open-app-settings") {
        handleOpenAppSettings();
      } else if (command === "help-keys") {
        handleOpenShortcuts();
      } else if (command === "about") {
        handleOpenAbout();
      }
    });
  }, [
    project,
    handleNewProject,
    handleOpenAppSettings,
    handleOpenShortcuts,
    handleOpenAbout,
  ]);

  const handleStatusMessage = useCallback((message: string) => {
    setStatusMessage(message);
  }, []);

  const handleRelaunch = useCallback(async () => {
    setRelaunching(true);
    try {
      const status = await window.tl.relaunchEngine();
      setEngineStatus(status);
    } finally {
      setRelaunching(false);
    }
  }, []);

  const handleOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const handleOpenAppearance = useCallback(
    () => handleOpenAppSettings("appearance"),
    [handleOpenAppSettings],
  );
  const handleOpenAiSettings = useCallback(
    () => handleOpenAppSettings("ai"),
    [handleOpenAppSettings],
  );
  const handleOpenTmManage = useCallback(() => setTmManageOpen(true), []);
  const handleCloseProject = useCallback(() => {
    setSettingsOpen(false);
    setTmManageOpen(false);
    setProject(null);
  }, []);

  // Before the first status fetch resolves, assume the engine is still
  // starting rather than pretending it is ready.
  const engineState: EngineLifecycleState = engineStatus?.state ?? "starting";
  const engineReady = engineState === "ready";

  // Fixed for the process lifetime: integrated hosts (Windows/Linux) draw
  // the titlebar strip in here; macOS keeps the system frame and menu bar.
  const windowChrome =
    window.tl?.windowChrome === "integrated" ? "integrated" : "system";

  return (
    <div className="app-shell" data-window-chrome={windowChrome}>
      {windowChrome === "integrated" ? <TitleBar title={windowTitle} /> : null}
      {/* display:contents wrapper: keeps the grid layout intact while
          `inert` blocks focus and input in the whole surface whenever the
          engine cannot acknowledge writes. */}
      <div className="app-main" inert={!engineReady}>
        {project ? (
          <WorkbenchView
            project={project}
            engineState={engineState}
            onStatusMessage={handleStatusMessage}
            onDocumentOpenChange={setDocumentOpen}
            onProjectUpdated={setProject}
            onStatsChange={setWorkbenchStats}
            onRegisterStatJump={registerStatJump}
            onOpenSettings={handleOpenSettings}
            onOpenAppearance={handleOpenAppearance}
            onOpenAiSettings={handleOpenAiSettings}
            onOpenTmManage={handleOpenTmManage}
            onCloseProject={handleCloseProject}
            onNewProject={handleNewProject}
            onOpenShortcuts={handleOpenShortcuts}
            onOpenAbout={handleOpenAbout}
            onExportGateChange={setExportGate}
          />
        ) : (
          <ProjectsView
            engineState={engineState}
            onOpenProject={setProject}
            onStatusMessage={handleStatusMessage}
            focusCreate={focusCreate}
            onCreateConsumed={() => setFocusCreate(false)}
          />
        )}

        {project ? (
          <ProjectSettingsDialog
            open={settingsOpen}
            project={project}
            onClose={() => setSettingsOpen(false)}
            onProjectUpdated={setProject}
            onExportGateChange={setExportGate}
          />
        ) : null}
        {project ? (
          <TmManageDialog
            open={tmManageOpen}
            project={project}
            onClose={() => setTmManageOpen(false)}
          />
        ) : null}
      </div>

      <footer className="app-statusbar">
        {/* Messages replace silently; a readout strip never animates. */}
        <span className="app-statusbar__message">{statusMessage}</span>
        <span className="app-statusbar__stats">
          {workbenchStats ? (
            <>
              <span className="app-statusbar__stat" title="当前句段 / 总句段">
                句段{" "}
                <span className="tl-num">
                  {workbenchStats.activeOrdinal !== null
                    ? `${workbenchStats.activeOrdinal + 1}/${workbenchStats.counts.total}`
                    : workbenchStats.counts.total}
                </span>
              </span>
              <span className="app-statusbar__stat" title="已确认句段">
                已确认{" "}
                <span className="tl-num">
                  {workbenchStats.counts.confirmed}
                </span>
              </span>
              {workbenchStats.counts.draft > 0 ? (
                // Readouts double as filters (PRD §3.8): clicking 草稿
                // jumps the grid to the draft filter.
                <button
                  type="button"
                  className="app-statusbar__stat app-statusbar__jump"
                  title="筛选草稿句段"
                  onClick={() => statJumpRef.current?.("draft")}
                >
                  草稿{" "}
                  <span className="tl-num">{workbenchStats.counts.draft}</span>
                </button>
              ) : null}
              <span className="app-statusbar__stat" title="未译句段">
                剩余{" "}
                <span className="tl-num">
                  {workbenchStats.counts.untranslated}
                </span>
              </span>
              {workbenchStats.sourceWords !== null ? (
                // Engine-computed only (口径 documented on the RPC field);
                // an engine that reports no count renders no readout.
                <span
                  className="app-statusbar__stat"
                  title="源文词数 · CJK 按字"
                >
                  字数{" "}
                  <span className="tl-num">
                    {workbenchStats.sourceWords.toLocaleString("en-US")}
                  </span>
                </span>
              ) : null}
              {workbenchStats.counts.openIssues > 0 ? (
                <button
                  type="button"
                  className="app-statusbar__stat app-statusbar__jump"
                  data-tone="danger"
                  title="筛选 QA 问题句段"
                  onClick={() => statJumpRef.current?.("qa")}
                >
                  QA{" "}
                  <span className="tl-num">
                    {workbenchStats.counts.openIssues}
                  </span>
                </button>
              ) : null}
              <span className="app-statusbar__progress">
                <SegmentProgress
                  total={workbenchStats.counts.total}
                  confirmed={workbenchStats.counts.confirmed}
                  draft={workbenchStats.counts.draft}
                  label={`已确认 ${workbenchStats.counts.confirmed}/${workbenchStats.counts.total}`}
                />
                {/* No placeholder glyphs: an empty total renders nothing. */}
                {workbenchStats.counts.total > 0 ? (
                  <span className="tl-num">
                    {Math.round(
                      (workbenchStats.counts.confirmed /
                        workbenchStats.counts.total) *
                        100,
                    )}
                    %
                  </span>
                ) : null}
              </span>
              {workbenchStats.caret ? (
                // Editor local facts (PRD §3.8): caret line:column and the
                // input mode. The editor only has insert mode, so INS is
                // the truthful readout — no fake OVR toggle.
                <>
                  <span className="app-statusbar__stat" title="行:列">
                    行列{" "}
                    <span className="tl-num">
                      {workbenchStats.caret.line}:{workbenchStats.caret.column}
                    </span>
                  </span>
                  <span className="app-statusbar__stat" title="插入模式">
                    INS
                  </span>
                </>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            className="app-statusbar__stat app-statusbar__jump"
            title="外观与主题"
            onClick={handleOpenAppearance}
          >
            主题 <span className="app-statusbar__theme">{theme.label}</span>
          </button>
          <span className="app-statusbar__engine">
            <StatusDot state={dotState(engineStatus)} />
            {engineLabel(engineStatus)}
          </span>
        </span>
      </footer>

      <SettingsDialog
        open={appSettings.open}
        section={appSettings.section}
        onSectionChange={(section) =>
          setAppSettings((current) => ({ ...current, section }))
        }
        onClose={() =>
          setAppSettings((current) => ({ ...current, open: false }))
        }
        onStatusMessage={handleStatusMessage}
      />

      <ShortcutsDialog
        open={helpDialog === "keys"}
        onClose={() => setHelpDialog(null)}
      />
      <AboutDialog
        open={helpDialog === "about"}
        onClose={() => setHelpDialog(null)}
      />

      {engineReady ? null : (
        <EngineGate
          status={engineStatus}
          onRelaunch={() => void handleRelaunch()}
          relaunching={relaunching}
        />
      )}
    </div>
  );
}
