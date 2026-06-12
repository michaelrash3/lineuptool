// Win celebration via canvas-confetti. The library is loaded on first use
// (dynamic import → its own chunk) and every call is best-effort: in jsdom
// or anywhere without a 2d canvas context the catch makes it a no-op, so
// game-finalize logic never depends on it.

let firing = false;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const celebrateWin = async (colors?: string[]) => {
  if (typeof window === "undefined" || firing || reducedMotion()) return;
  firing = true;
  try {
    const confetti = (await import("canvas-confetti")).default;
    const opts = colors && colors.length > 0 ? { colors } : {};
    confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 }, ...opts });
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 },
        ...opts,
      });
      confetti({
        particleCount: 60,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 },
        ...opts,
      });
    }, 200);
  } catch {
    // canvas unavailable (tests) or chunk failed to load — celebration is
    // cosmetic, never block the save.
  } finally {
    setTimeout(() => {
      firing = false;
    }, 1500);
  }
};
