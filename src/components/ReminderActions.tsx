import React, { memo } from "react";
import { Icons } from "../icons";
import { useToast } from "../contexts";
import {
  buildMailtoUrl,
  draftToText,
  type ReminderDraft,
} from "../utils/reminderDraft";

// Two ways to send a reminder the coach composes themselves (the app never
// sends mail on their behalf — see utils/reminderDraft):
//   - Open in Email: a pre-filled mailto: compose in their own mail client.
//   - Copy draft: the subject + body on the clipboard for any channel.
// Recipients go on bcc when `bcc` is set so a mass family reminder doesn't leak
// everyone's address to everyone.

const BTN =
  "px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2 inline-flex items-center gap-1.5";

interface ReminderActionsProps {
  draft: ReminderDraft;
  recipients?: string[];
  bcc?: boolean;
  emailLabel?: string;
  className?: string;
}

export const ReminderActions = memo(
  ({
    draft,
    recipients = [],
    bcc = false,
    emailLabel = "Open in Email",
    className = "",
  }: ReminderActionsProps) => {
    const toast = useToast();

    const openEmail = () => {
      const to = bcc ? "" : recipients.join(",");
      let url = buildMailtoUrl(to, draft.subject, draft.body);
      if (bcc && recipients.length > 0) {
        url += `&bcc=${encodeURIComponent(recipients.join(","))}`;
      }
      window.location.href = url;
    };

    const copyDraft = async () => {
      const text = draftToText(draft, recipients);
      try {
        await navigator.clipboard.writeText(text);
        toast.push({
          kind: "success",
          title: "Draft copied",
          message: "Paste it into email or a group chat.",
        });
      } catch {
        toast.push({
          kind: "error",
          title: "Couldn't copy",
          message: "Your browser blocked clipboard access.",
        });
      }
    };

    return (
      <div className={`inline-flex flex-wrap gap-2 ${className}`}>
        <button type="button" onClick={openEmail} className={BTN}>
          <Icons.Forward className="w-3.5 h-3.5" /> {emailLabel}
        </button>
        <button type="button" onClick={copyDraft} className={BTN}>
          <Icons.Clipboard className="w-3.5 h-3.5" /> Copy draft
        </button>
      </div>
    );
  },
);

ReminderActions.displayName = "ReminderActions";
