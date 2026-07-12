import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

// Standard "leave this page" behavior for routed sub-pages (the app-wide
// modal→page conversion): go BACK when in-app history exists so the coach
// returns to wherever they came from, and fall back to the section root on a
// deep link / fresh tab. react-router stamps history.state.idx — 0 means this
// entry started the session, so there is nothing sensible behind it. Mirrors
// the PlayerProfile close() that established the pattern.
export const useBackOrFallback = (fallbackPath: string): (() => void) => {
  const navigate = useNavigate();
  return useCallback(() => {
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate(fallbackPath, { replace: true });
  }, [navigate, fallbackPath]);
};
