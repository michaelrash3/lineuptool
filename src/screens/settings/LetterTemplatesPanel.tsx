import React, { memo, useMemo, useRef, useState } from "react";
import { Icons } from "../../icons";
import { useConfirm, useTeam, useToast } from "../../contexts";
import { makeOfferLetterContext } from "../../utils/offerContext";
import {
  LETTER_FIELDS,
  LETTER_LIMITS,
  OFFER_LETTER_LABELS,
  defaultLetterTemplate,
  fillLetterTemplate,
  isDefaultLetterTemplate,
  unknownLetterFields,
  type LetterTemplate,
  type LetterTemplates,
  type OfferLetterKind,
} from "../../constants/offerLetters";

// Settings › Letters — the head coach's own wording for every letter families
// get. Each letter starts from the built-in wording; words in [brackets] are
// fill-in fields replaced for each family when a letter is drafted (from the
// Roster, Tryouts, Interest or Advance Season pages). Saving the built-in
// wording unchanged stores nothing, and "Use the standard letter" removes the
// saved copy (team.letterTemplates is a whole-map field, so that's a real
// delete). Head-only, in the UI and in the rules.

// Order the coach meets them in a season: offers, then the hard news, then
// the year-round invite.
const KINDS: OfferLetterKind[] = [
  "returning",
  "newPlayer",
  "notReturning",
  "rejection",
  "interest",
];

const KIND_HINTS: Record<OfferLetterKind, string> = {
  returning: "Inviting a current player back for next season.",
  newPlayer: "Offering a roster spot after tryouts.",
  notReturning: "Telling a current player there's no spot next season.",
  rejection: "Telling a tryout player they didn't make the team.",
  interest: "Inviting a family who asked about the team to tryouts.",
};

// A made-up family for the preview, filled with the team's real fees,
// deposit and contact details so the coach sees the letter as families will.
const SAMPLE_NAME = "Sam Rivera";

const LetterEditor = ({
  kind,
  initial,
  onSave,
  onCancel,
}: {
  kind: OfferLetterKind;
  initial: LetterTemplate;
  onSave: (t: LetterTemplate) => void;
  onCancel: () => void;
}) => {
  const { team, user } = useTeam();
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [showPreview, setShowPreview] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Put a fill-in field where the cursor is (or at the end).
  const insertField = (token: string) => {
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    const next = (body.slice(0, start) + token + body.slice(end)).slice(
      0,
      LETTER_LIMITS.body,
    );
    setBody(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const at = Math.min(start + token.length, next.length);
      el.setSelectionRange(at, at);
    });
  };

  const unknown = useMemo(
    () => unknownLetterFields(`${subject}\n${body}`),
    [subject, body],
  );
  const preview = useMemo(
    () =>
      fillLetterTemplate(
        { subject, body },
        makeOfferLetterContext(team, user, SAMPLE_NAME),
      ),
    [subject, body, team, user],
  );

  return (
    <div className="space-y-3 pt-3">
      <label className="block">
        <span className="block text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1">
          Subject
        </span>
        <input
          type="text"
          value={subject}
          maxLength={LETTER_LIMITS.subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full text-sm font-bold text-ink bg-surface border border-line rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--team-primary)]"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1">
          Message
        </span>
        <textarea
          ref={bodyRef}
          value={body}
          maxLength={LETTER_LIMITS.body}
          onChange={(e) => setBody(e.target.value)}
          rows={14}
          className="w-full p-3 text-sm bg-surface text-ink border border-line rounded-lg outline-none focus:ring-2 focus:ring-[var(--team-primary)] resize-y leading-relaxed"
        />
      </label>
      <div>
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-3 mb-1.5">
          Fill-in fields — tap one to add it where your cursor is
        </div>
        <div className="flex flex-wrap gap-1.5">
          {LETTER_FIELDS.map((f) => (
            <button
              key={f.token}
              type="button"
              title={f.hint}
              onClick={() => insertField(f.token)}
              className="min-h-[36px] px-2.5 rounded-lg border border-line bg-surface-2 text-xs font-bold text-ink hover:bg-surface"
            >
              {f.token}
            </button>
          ))}
        </div>
      </div>
      {unknown.length > 0 && (
        <p
          role="status"
          className="text-xs font-bold text-warnfg bg-warn-bg border border-line rounded-lg px-3 py-2"
        >
          {unknown.join(", ")} {unknown.length === 1 ? "isn't" : "aren't"} a
          fill-in field, so {unknown.length === 1 ? "it" : "they"}'ll be sent
          exactly as typed. Use one of the fields above.
        </p>
      )}
      <div>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          aria-expanded={showPreview}
          className="text-xs font-black uppercase tracking-widest text-team-primary inline-flex items-center gap-1.5"
        >
          <Icons.ChevronDown
            className={`w-4 h-4 transition-transform ${showPreview ? "rotate-180" : ""}`}
          />
          {showPreview ? "Hide preview" : `Preview (as if to ${SAMPLE_NAME})`}
        </button>
        {showPreview && (
          <div
            aria-label="Letter preview"
            className="mt-2 rounded-lg border border-line bg-surface-2 p-3 text-sm text-ink whitespace-pre-wrap leading-relaxed"
          >
            <div className="font-black mb-2">{preview.subject}</div>
            {preview.body}
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 min-h-[44px] text-xs font-black uppercase tracking-widest border border-line rounded-lg text-ink hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!body.trim() || !subject.trim()}
          onClick={() =>
            onSave({
              subject: subject.trim().slice(0, LETTER_LIMITS.subject),
              body: body.replace(/\s+$/, "").slice(0, LETTER_LIMITS.body),
            })
          }
          className="px-4 min-h-[44px] text-xs font-black uppercase tracking-widest rounded-lg shadow-md disabled:opacity-40"
          style={{
            backgroundColor: "var(--team-primary)",
            color: "var(--team-on-primary)",
          }}
        >
          Save wording
        </button>
      </div>
    </div>
  );
};

export const LetterTemplatesPanel = memo(() => {
  const { team, updateTeam } = useTeam();
  const { confirm } = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<OfferLetterKind | null>(null);
  const saved: LetterTemplates = (team?.letterTemplates ||
    {}) as LetterTemplates;

  const write = (next: LetterTemplates) =>
    updateTeam({ letterTemplates: next as Record<string, LetterTemplate> });

  const save = (kind: OfferLetterKind, t: LetterTemplate) => {
    const next: LetterTemplates = { ...saved };
    // Saving the standard wording unchanged stores nothing.
    if (isDefaultLetterTemplate(kind, t)) delete next[kind];
    else next[kind] = t;
    write(next);
    setEditing(null);
    toast.push({
      kind: "success",
      title: `${OFFER_LETTER_LABELS[kind]} saved`,
      message: "New letters you draft will use this wording.",
    });
  };

  const reset = async (kind: OfferLetterKind) => {
    const ok = await confirm({
      title: "Use the standard letter?",
      message: `Your wording for the ${OFFER_LETTER_LABELS[kind]} will be removed and the built-in letter used instead.`,
      confirmLabel: "Use standard letter",
      danger: true,
    });
    if (!ok) return;
    const next: LetterTemplates = { ...saved };
    delete next[kind];
    write(next);
    setEditing(null);
  };

  return (
    <div>
      <h3 className="text-sm font-black uppercase tracking-widest text-ink-3 mb-4 border-b border-line pb-3 flex items-center gap-2">
        <Icons.FileText className="w-4 h-4" /> Letters
      </h3>
      <p className="text-xs text-ink-3 font-medium mb-4 max-w-2xl">
        Put the letters you send families in your own words. Words in [brackets]
        fill in for each family, like their name, your fees and the deposit.
        Your wording is used for every letter you draft from now on, and you can
        still change one letter before you send it.
      </p>
      <div className="space-y-3">
        {KINDS.map((kind) => {
          const custom = saved[kind];
          const isCustom = !!custom && !isDefaultLetterTemplate(kind, custom);
          const open = editing === kind;
          return (
            <section
              key={kind}
              aria-label={OFFER_LETTER_LABELS[kind]}
              className="cc-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-ink">
                      {OFFER_LETTER_LABELS[kind]}
                    </span>
                    <span
                      className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                        isCustom
                          ? "border-[var(--team-primary)] text-team-primary"
                          : "border-line text-ink-3"
                      }`}
                    >
                      {isCustom ? "Your wording" : "Standard"}
                    </span>
                  </div>
                  <p className="text-xs text-ink-3 font-medium mt-0.5">
                    {KIND_HINTS[kind]}
                  </p>
                </div>
                {!open && (
                  <button
                    type="button"
                    onClick={() => setEditing(kind)}
                    className="shrink-0 min-h-[44px] px-3 rounded-lg border border-line text-xs font-black uppercase tracking-widest text-ink hover:bg-surface-2 inline-flex items-center gap-1.5"
                  >
                    <Icons.Edit className="w-4 h-4" /> Edit
                    <span className="sr-only">
                      {" "}
                      {OFFER_LETTER_LABELS[kind]}
                    </span>
                  </button>
                )}
              </div>
              {open && (
                <>
                  <LetterEditor
                    kind={kind}
                    initial={isCustom ? custom! : defaultLetterTemplate(kind)}
                    onSave={(t) => save(kind, t)}
                    onCancel={() => setEditing(null)}
                  />
                  {isCustom && (
                    <button
                      type="button"
                      onClick={() => void reset(kind)}
                      className="mt-2 text-[11px] font-black uppercase tracking-widest text-ink-3 hover:text-ink"
                    >
                      Use the standard letter instead
                    </button>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
});
