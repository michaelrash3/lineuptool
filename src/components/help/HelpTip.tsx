import React from "react";
import { Icons } from "../../icons";
import { useUI } from "../../contexts";

// Inline "?" button that deep-links the Help Center to one topic. Drop it
// next to a heading — it renders inline with no wrapper of its own.
export const HelpTip = ({
  topicId,
  label,
}: {
  topicId: string;
  label?: string;
}) => {
  const { openHelp } = useUI();
  return (
    <button
      type="button"
      onClick={() => openHelp(topicId)}
      className="text-ink-3 hover:text-ink transition-colors"
      aria-label={label || "Help"}
    >
      <Icons.Help className="w-4 h-4" />
    </button>
  );
};
