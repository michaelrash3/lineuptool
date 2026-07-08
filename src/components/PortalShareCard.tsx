import React, { memo, useState } from "react";
import { Icons } from "../icons";
import { useToast } from "../contexts";
import { Modal } from "./shared";
import { QRCodeImg } from "./QRCodeImg";

// Compact share-link button + modal for a public portal page, reusing the
// team's standing share id (mirrors AvailabilityTab's ShareCard so every
// inbox-style tab surfaces its own link where the coach actually works).
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
  }: {
    team: any;
    path: string; // e.g. "tryouts-portal"
    eyebrow: string;
    title: string;
    buttonLabel: string;
    description: string;
    filenameSuffix: string;
    icon?: any;
  }) => {
    const toast = useToast();
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
              <>
                <code className="block text-[11px] text-ink break-all font-mono bg-app border border-line rounded-md p-2">
                  {url}
                </code>
                <div className="flex items-start gap-3 flex-wrap">
                  <QRCodeImg
                    value={url}
                    size={120}
                    downloadable
                    filename={`${team?.name || "team"}-${filenameSuffix}-qr`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(url);
                        toast.push({ kind: "success", title: "Link copied" });
                      }
                    }}
                    className="self-start px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
                  >
                    Copy
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[11px] text-ink-3 font-medium leading-snug">
                Generate your team's share link first in the{" "}
                <strong className="text-ink">Tryouts tab → Tryout setup</strong>
                . This form reuses that same link.
              </p>
            )}
          </div>
        </Modal>
      </>
    );
  },
);
