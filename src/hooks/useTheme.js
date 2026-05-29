import { useCallback, useEffect, useState } from "react";

// Light/dark theme manager. Persists the user's choice ("light" | "dark" |
// "system") to localStorage and applies it to <html data-theme>. The actual
// data-theme attribute is also set pre-paint by the inline script in
// public/index.html so there's no flash on load; this hook keeps it in sync
// after hydration and reacts to OS changes when in "system" mode.

const STORAGE_KEY = "cc.theme";
const MODES = ["light", "dark", "system"];

const prefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;

const readStored = () => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(v) ? v : "system";
  } catch {
    return "system";
  }
};

// Resolve a mode to the concrete theme and write it to the root element.
const applyTheme = (mode) => {
  if (typeof document === "undefined") return;
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  const root = document.documentElement;
  if (dark) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
};

export function useTheme() {
  const [mode, setMode] = useState(readStored);

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
  const resolved =
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
