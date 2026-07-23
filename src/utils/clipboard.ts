// Copy text to the clipboard with a legacy fallback. The async Clipboard API
// needs a secure context (HTTPS/localhost); older in-app webviews and plain
// HTTP get a hidden-textarea + execCommand path instead. Resolves true only
// when a copy actually happened, so callers can toast success/failure honestly
// instead of silently no-opping (the old `if (navigator.clipboard)` guards).
export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied / insecure context — fall through to the legacy path.
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  } catch {
    return false;
  }
};
