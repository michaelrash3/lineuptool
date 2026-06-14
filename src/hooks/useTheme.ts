import { useCallback, useEffect, useState } from "react";

// Light/dark theme manager. Persists the user's choice ("light" | "dark" |
// "system") to localStorage and applies it to <html data-theme>. The actual
// data-theme attribute is also set pre-paint by the inline script in
// public/index.html so there's no flash on load; this hook keeps it in sync
// after hydration and reacts to OS changes when in "system" mode.

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "cc.theme";
const MODES: ThemeMode[] = ["light", "dark", "system"];

const prefersDark = (): boolean =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const readStored = (): ThemeMode => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    // Default to the cinematic dark theme (the app's showcase look) for
    // first-time visitors; anyone who's explicitly chosen a mode keeps it.
    return v && (MODES as string[]).includes(v) ? (v as ThemeMode) : "dark";
  } catch {
    return "dark";
  }
};

// Resolve a mode to the concrete theme and write it to the root element.
const applyTheme = (mode: ThemeMode): void => {
  if (typeof document === "undefined") return;
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  const root = document.documentElement;
  if (dark) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
};

export interface UseThemeResult {
  mode: ThemeMode;
  setMode: React.Dispatch<React.SetStateAction<ThemeMode>>;
  resolved: ResolvedTheme;
  toggle: () => void;
}

export function useTheme(): UseThemeResult {
  const [mode, setMode] = useState<ThemeMode>(readStored);

  // Apply on mount + whenever the mode changes, and persist.
  useEffect(() => {
    applyTheme(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  }, [mode]);

  // When following the OS ("system"), live-update if the OS theme flips.
  useEffect(() => {
    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia)
      return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [mode]);

  // The concrete theme currently showing (resolves "system").
  const resolved: ResolvedTheme =
    mode === "dark" || (mode === "system" && prefersDark()) ? "dark" : "light";

  // Simple toggle for an icon button: light → dark → light. (Long-press / a
  // settings control can still pick "system" explicitly via setMode.)
  const toggle = useCallback(() => {
    setMode((m) => {
      const current =
        m === "dark" || (m === "system" && prefersDark()) ? "dark" : "light";
      return current === "dark" ? "light" : "dark";
    });
  }, []);

  return { mode, setMode, resolved, toggle };
}
