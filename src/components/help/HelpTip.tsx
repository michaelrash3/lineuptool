import React from "react";
import { useNavigate } from "react-router-dom";
import { Icons } from "../../icons";

// Inline "?" button that deep-links to one Help article (/help/:topicId).
// Drop it next to a heading — it renders inline with no wrapper of its own.
export const HelpTip = ({
  topicId,
  label,
}: {
  topicId: string;
  label?: string;
}) => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/help/${topicId}`)}
      className="text-ink-3 hover:text-ink transition-colors"
      aria-label={label || "Help"}
    >
      <Icons.Help className="w-4 h-4" />
    </button>
  );
};
