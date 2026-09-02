import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Where each history entry was scrolled to. A multi-page site gets this from
// the browser for free; a client-side router has to keep the book itself, or
// every Back lands you at the top of a long roster instead of on the player
// you were just looking at — which is a big part of why routed pages can
// still feel like modals.
//
// Keyed by react-router's location.key: stable for the life of an entry, and
// the SAME key comes back when you pop to it. Module-level on purpose, so the
// map survives the component remounting; it is per-session and small (one
// number per visited entry).
const scrollOffsets = new Map<string, number>();

// How many frames to keep re-applying a restored offset. Screens are
// React.lazy, so for a frame or two after a POP the document can still be too
// short to scroll — scrollTo silently clamps to 0 and the restore is lost.
const RESTORE_ATTEMPTS = 20;

export const ScrollRestoration = () => {
  const { key } = useLocation();
  const navigationType = useNavigationType();

  // Take the browser's own (page-reload-oriented) restoration out of the
  // picture so it can't fight the offsets tracked here.
  useEffect(() => {
    if (typeof window === "undefined" || !window.history) return;
    const previous = window.history.scrollRestoration;
    if (previous === undefined) return;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Record this entry's offset as it scrolls. A cleanup-only read would miss
  // it whenever the browser has already reset scrollY by unmount time.
  useEffect(() => {
    let frame = 0;
    const remember = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        scrollOffsets.set(key, window.scrollY);
      });
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", remember);
    };
  }, [key]);

  // Going somewhere new starts at the top; going Back returns to where you
  // left off.
  useEffect(() => {
    const target = navigationType === "POP" ? scrollOffsets.get(key) || 0 : 0;
    if (target <= 0) {
      window.scrollTo(0, 0);
      return;
    }
    let attempts = 0;
    let frame = 0;
    const restore = () => {
      window.scrollTo(0, target);
      // Short by more than a pixel means the lazy screen hasn't painted its
      // full height yet — try again next frame.
      if (window.scrollY < target - 1 && attempts++ < RESTORE_ATTEMPTS) {
        frame = requestAnimationFrame(restore);
      }
    };
    restore();
    return () => cancelAnimationFrame(frame);
  }, [key, navigationType]);

  return null;
};
