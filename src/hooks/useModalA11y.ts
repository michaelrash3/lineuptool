import { useEffect, useRef } from "react";

// Selector for everything keyboard-reachable inside a dialog. Visibility
// filtering is deliberately skipped — jsdom reports offsetParent as null for
// everything, and our dialogs don't render hidden focusable controls.
const FOCUSABLE =
  "a[href], button:not([disabled]), textarea:not([disabled]), " +
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

// Open-dialog stack: when dialogs nest (stat trend over player profile,
// confirm over settings), only the top-most one may handle Escape and trap
// Tab — otherwise the bottom dialog's document-level listener fires first
// and closes the wrong layer.
const openDialogs: symbol[] = [];

/**
 * Baseline dialog accessibility for the app's hand-rolled modals:
 *  - Escape closes (capture phase, so it wins over page-level shortcuts)
 *  - focus moves into the dialog on open ([data-autofocus] > first focusable
 *    > the dialog node itself, which should carry tabIndex={-1})
 *  - Tab / Shift+Tab cycle inside the dialog instead of escaping to the page
 *  - focus returns to the previously-focused element on close
 *
 * Pair with role="dialog" aria-modal="true" aria-labelledby on the dialog
 * node — this hook handles behavior, the markup handles semantics.
 */
export function useModalA11y(
  ref: React.RefObject<HTMLElement | null>,
  { onClose, enabled = true }: { onClose?: () => void; enabled?: boolean } = {},
) {
  // Keep the latest onClose without re-running the effect (callers often
  // pass inline closures).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;

    const token = Symbol("dialog");
    openDialogs.push(token);
    const isTop = () => openDialogs[openDialogs.length - 1] === token;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    if (!node.contains(document.activeElement)) {
      const initial =
        node.querySelector<HTMLElement>("[data-autofocus]") ||
        node.querySelector<HTMLElement>(FOCUSABLE) ||
        node;
      initial.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isTop()) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!node.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      const i = openDialogs.indexOf(token);
      if (i !== -1) openDialogs.splice(i, 1);
      document.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [ref, enabled]);
}
