/**
 * Centralized AI availability. One provider fetches `ai.status` plus the
 * profile list and every panel reads the same values instead of polling the
 * engine on its own.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  AiProfileListResult,
  AiProfileView,
  AiStatusResult,
} from "@translunar/contracts";

import { callEngine } from "./engine.js";

export interface AiAvailability {
  /** `null` until the first `ai.status` answer arrives. */
  status: AiStatusResult | null;
  /** True only when the engine confirmed a configured provider. */
  configured: boolean;
  /** Every configured profile, in engine order. Credentials never appear. */
  profiles: AiProfileView[];
  /** The profile assist and agent runs use when none is named. */
  defaultProfileId: string | null;
  /** Re-query the engine (e.g. after an engine restart). */
  refresh: () => Promise<void>;
  /** Push a fresh status straight from an `ai.configure` response. */
  setStatus: (status: AiStatusResult) => void;
  /** Push a fresh list straight from an `ai.profile.*` response. */
  setProfiles: (list: AiProfileListResult) => void;
}

const AiStatusContext = createContext<AiAvailability | null>(null);

/**
 * Cross-provider change bus. The settings center and the workbench mount
 * separate provider instances (different subtrees); a config change in one
 * must reach the other, so writers call [`notifyAiStatusChanged`] and every
 * mounted provider re-queries the engine — the engine stays the single
 * source of truth.
 */
const changeListeners = new Set<() => void>();

export function notifyAiStatusChanged(): void {
  for (const listener of changeListeners) {
    listener();
  }
}

export function AiStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AiStatusResult | null>(null);
  const [profileList, setProfileList] = useState<AiProfileListResult>({
    profiles: [],
    defaultProfileId: null,
  });

  const refresh = useCallback(async () => {
    let next: AiStatusResult | null = null;
    try {
      next = await callEngine("ai.status", {});
    } catch {
      // The engine is unreachable; treat AI as unavailable, never pretend.
    }
    setStatus(next);
    let list: AiProfileListResult = { profiles: [], defaultProfileId: null };
    if (next?.configured) {
      try {
        list = await callEngine("ai.profile.list", {});
      } catch {
        // Status still counts; the panels degrade to the default profile.
      }
    }
    setProfileList(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Stay in sync with sibling provider instances (see the change bus above).
  useEffect(() => {
    const listener = () => {
      void refresh();
    };
    changeListeners.add(listener);
    return () => {
      changeListeners.delete(listener);
    };
  }, [refresh]);

  const value = useMemo<AiAvailability>(
    () => ({
      status,
      configured: status?.configured === true,
      profiles: Array.isArray(profileList.profiles) ? profileList.profiles : [],
      defaultProfileId: profileList.defaultProfileId ?? null,
      refresh,
      setStatus,
      setProfiles: setProfileList,
    }),
    [status, profileList, refresh],
  );

  return (
    <AiStatusContext.Provider value={value}>
      {children}
    </AiStatusContext.Provider>
  );
}

export function useAiStatus(): AiAvailability {
  const value = useContext(AiStatusContext);
  if (!value) {
    throw new Error("useAiStatus must be used inside <AiStatusProvider>");
  }
  return value;
}
