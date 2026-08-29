import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Project } from "@translunar/contracts";
import { Badge, Button, EmptyState, TextField } from "@translunar/ui";

import type { EngineLifecycleState } from "../../shared/desktop-api.js";
import { callEngine, describeError } from "../lib/engine.js";
import { LocaleField } from "../components/LocaleField.js";

export interface ProjectsViewProps {
  engineState: EngineLifecycleState;
  onOpenProject: (project: Project) => void;
  onStatusMessage: (message: string) => void;
  /**
   * 文件 ▸ 新建项目…: focus the create form's name field once. The list's
   * toolbar form is the only create UI; the menu just lands the keyboard
   * in it. Consumed through onCreateConsumed.
   */
  focusCreate?: boolean;
  onCreateConsumed?: () => void;
}

/** localStorage key for the project id this window opened last. */
export const LAST_PROJECT_KEY = "translunar.last-project";

function readLastProjectId(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function ProjectsView({
  engineState,
  onOpenProject,
  onStatusMessage,
  focusCreate,
  onCreateConsumed,
}: ProjectsViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [sourceLocale, setSourceLocale] = useState("en-US");
  const [targetLocale, setTargetLocale] = useState("zh-CN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Archived projects are hidden by default so the list reads as "what am I
  // working on"; the toggle keeps them reachable (archive is reversible in
  // project settings, so hiding them forever would be dishonest).
  const [showArchived, setShowArchived] = useState(false);
  const [lastProjectId] = useState(readLastProjectId);

  // Every open path records the id, so 继续 always points at the truth.
  const openProject = useCallback(
    (project: Project) => {
      try {
        localStorage.setItem(LAST_PROJECT_KEY, project.id);
      } catch {
        // Without storage the 继续 chip simply never appears.
      }
      onOpenProject(project);
    },
    [onOpenProject],
  );

  const refresh = useCallback(async () => {
    try {
      const result = await callEngine("project.list", {});
      setProjects(result.projects);
      setError(null);
    } catch (listError) {
      setError(describeError(listError));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Menu 新建项目…: land the keyboard in the name field of the existing
  // create form (never a second create surface), then consume the flag.
  const createFormRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => {
    if (!focusCreate) {
      return;
    }
    const input = createFormRef.current?.elements.namedItem("project-name");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
    onCreateConsumed?.();
  }, [focusCreate, onCreateConsumed]);

  // If the initial list load happened against a dead engine, refetch when
  // the engine comes back instead of showing a stale empty list.
  const previousEngineStateRef = useRef(engineState);
  useEffect(() => {
    const previous = previousEngineStateRef.current;
    previousEngineStateRef.current = engineState;
    if (engineState === "ready" && previous !== "ready") {
      void refresh();
    }
  }, [engineState, refresh]);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const project = await callEngine("project.create", {
        name,
        sourceLocale,
        targetLocale,
      });
      onStatusMessage(`项目「${project.name}」已创建`);
      setName("");
      await refresh();
      openProject(project);
    } catch (createError) {
      setError(describeError(createError));
    } finally {
      setBusy(false);
    }
  }, [name, sourceLocale, targetLocale, openProject, onStatusMessage, refresh]);

  const activeProjects = useMemo(
    () => projects.filter((project) => project.lifecycle !== "archived"),
    [projects],
  );
  // 继续 only when the remembered project still exists in project.list —
  // a stale id renders nothing rather than a dead chip.
  const lastProject = useMemo(
    () => projects.find((project) => project.id === lastProjectId) ?? null,
    [projects, lastProjectId],
  );
  const archivedCount = projects.length - activeProjects.length;
  const visibleProjects = showArchived ? projects : activeProjects;

  // Full-bleed working surface at workbench density: a create-project
  // toolbar over a flat hairline-separated list — no centered card form.
  return (
    <main className="projects-view">
      <form
        ref={createFormRef}
        className="projects-view__toolbar"
        aria-label="新建项目"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <TextField
          label="项目名称"
          name="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          placeholder="如：TL-900 用户手册"
        />
        <LocaleField
          label="源语言"
          value={sourceLocale}
          onChange={(event) => setSourceLocale(event.target.value)}
          required
        />
        <LocaleField
          label="目标语言"
          value={targetLocale}
          onChange={(event) => setTargetLocale(event.target.value)}
          required
        />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? "创建中…" : "创建项目"}
        </Button>
      </form>

      {error ? (
        <div
          className="honest-note projects-view__error"
          data-tone="danger"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div className="projects-view__head">
        <h2 className="projects-view__caption">
          项目（{activeProjects.length}）
        </h2>
        {lastProject ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => openProject(lastProject)}
          >
            继续「{lastProject.name}」
          </Button>
        ) : null}
        {archivedCount > 0 ? (
          <label className="project-list__archived-toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            显示已归档项目（{archivedCount}）
          </label>
        ) : null}
      </div>

      {projects.length === 0 ? (
        <EmptyState title="还没有项目" />
      ) : visibleProjects.length === 0 ? (
        <EmptyState title="没有进行中的项目" />
      ) : (
        <div className="project-list">
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="project-list__item"
              onClick={() => openProject(project)}
            >
              <span className="project-list__name">
                {project.name}
                {project.lifecycle === "archived" ? (
                  <Badge tone="neutral">已归档</Badge>
                ) : null}
              </span>
              <span className="project-list__locales">
                {project.sourceLocale} → {project.targetLocale}
              </span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
