/**
 * Workspace Mode — Phase 7
 *
 * Global context for Simplified vs Advanced mode.
 * Simplified: hides technical complexity, focuses on outcomes.
 * Advanced: full operational visibility, graphs, governance analytics.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type WorkspaceMode = "simplified" | "advanced";

interface WorkspaceModeContextValue {
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  isSimplified: boolean;
  isAdvanced: boolean;
  toggle: () => void;
}

const WorkspaceModeContext = createContext<WorkspaceModeContextValue>({
  mode: "simplified",
  setMode: () => {},
  isSimplified: true,
  isAdvanced: false,
  toggle: () => {},
});

const STORAGE_KEY = "te_workspace_mode";

export function WorkspaceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<WorkspaceMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "simplified" || stored === "advanced") return stored;
    } catch {}
    return "simplified";
  });

  const setMode = (next: WorkspaceMode) => {
    setModeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  };

  const toggle = () => setMode(mode === "simplified" ? "advanced" : "simplified");

  return (
    <WorkspaceModeContext.Provider value={{
      mode, setMode, toggle,
      isSimplified: mode === "simplified",
      isAdvanced: mode === "advanced",
    }}>
      {children}
    </WorkspaceModeContext.Provider>
  );
}

export function useWorkspaceMode() {
  return useContext(WorkspaceModeContext);
}

/** Render children only in the specified mode */
export function AdvancedOnly({ children }: { children: ReactNode }) {
  const { isAdvanced } = useWorkspaceMode();
  return isAdvanced ? <>{children}</> : null;
}

export function SimplifiedOnly({ children }: { children: ReactNode }) {
  const { isSimplified } = useWorkspaceMode();
  return isSimplified ? <>{children}</> : null;
}
