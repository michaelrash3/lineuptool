import React, { memo, useState } from "react";
import { Icons } from "../icons";
import { useToast } from "../contexts";
import { Modal } from "./shared";
import { QRCodeImg } from "./QRCodeImg";
import { copyTextToClipboard } from "../utils/clipboard";

// Copy button with honest feedback: a success toast only when a copy actually
// happened (the clipboard helper falls back to execCommand off HTTPS).
const CopyLinkButton = ({ text }: { text: string }) => {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyTextToClipboard(text);
        toast.push(
          ok
            ? { kind: "success", title: "Link copied" }
            : {
                kind: "error",
                title: "Couldn't copy",
                message: "Select the link text and copy it manually.",
              },
        );
      }}
      className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
    >
      Copy
    </button>
  );
};

// The link + QR + copy block every share surface renders. `actions` slots
// extra buttons beside Copy (e.g. the Tryouts panel's Regenerate); `hint` is
// the small explainer under them. Parents of this fragment provide vertical
// spacing (space-y-*).
export const ShareLinkBlock = ({
  url,
  filename,
  hint,
  actions,
}: {
  url: string;
  filename: string;
  hint?: string;
  actions?: React.ReactNode;
}) => (
  <>
    <code className="block text-[11px] text-ink break-all font-mono bg-app border border-line rounded-md p-2">
      {url}
    </code>
    <div className="flex items-start gap-3 flex-wrap">
      <QRCodeImg value={url} size={120} downloadable filename={filename} />
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <div className="flex gap-2">
          <CopyLinkButton text={url} />
          {actions}
        </div>
        {hint && (
          <p className="text-[10px] font-medium text-ink-3 leading-snug">
            {hint}
          </p>
        )}
      </div>
    </div>
  </>
);

// Compact share-link button + modal for a public portal page, reusing the
// team's standing share id. The one share widget every inbox-style tab uses
// (Interest, Availability, Player Info on both its tab and the Roster page),
// so the link/QR/copy behavior can't drift per screen again. Stays an overlay
// Modal per the approved share-link/QR popover exception to the app-wide
// modals→pages rule.
export const PortalShareCard = memo(
  ({
    team,
    path,
    eyebrow,
    title,
    buttonLabel,
    description,
    filenameSuffix,
    icon: Icon = Icons.Clipboard,
    hint,
    children,
  }: {
    team: any;
    path: string; // e.g. "tryouts-portal"
    eyebrow: string;
    title: string;
    buttonLabel: string;
    description: string;
    filenameSuffix: string;
    icon?: any;
    // Small explainer under the Copy button inside the modal.
    hint?: string;
    // Extra actions below the share block (e.g. the Roster card's
    // parent-email tools). Rendered whether or not the link exists yet.
    children?: React.ReactNode;
  }) => {
    const [open, setOpen] = useState(false);
    const shareId = team?.tryoutShareId;
    const url =
      shareId && typeof window !== "undefined"
        ? `${window.location.origin}/${path}/${shareId}`
        : null;
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full sm:w-auto py-2.5 px-5 inline-flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-sm whitespace-nowrap bg-surface border border-line-strong text-ink hover:bg-surface-2"
        >
          <Icon className="w-4 h-4" /> {buttonLabel}
        </button>
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          eyebrow={eyebrow}
          title={title}
          size="md"
        >
          <p className="t-meta text-ink-3 mb-4">{description}</p>
          <div className="space-y-3">
            {url ? (
              <ShareLinkBlock
                url={url}
                filename={`${team?.name || "team"}-${filenameSuffix}-qr`}
                hint={hint}
              />
            ) : (
              <p className="text-[11px] text-ink-3 font-medium leading-snug">
                Generate your team's share link first in the{" "}
                <strong className="text-ink">Tryouts tab → Tryout setup</strong>
                . This form reuses that same link.
              </p>
            )}
            {children}
          </div>
        </Modal>
      </>
    );
  },
);
