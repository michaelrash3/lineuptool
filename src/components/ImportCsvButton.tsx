import React from "react";
import { Icons } from "../icons";

// A labeled CSV file-input styled as a compact action button (matching the
// "Import from GameChanger" button) rather than a boxed drop target — the app
// flows seamlessly, so imports read as buttons, not cards. Used on the Roster,
// Stats, and Schedule tabs so each page owns its own import. The onChange
// handlers come from useImportExportFlows (via the team context) and auto-detect
// the file format. The `hint` rides along as the hover tooltip.
interface Props {
  id: string;
  label: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hint?: string;
  accept?: string;
}

export const ImportCsvButton: React.FC<Props> = ({
  id,
  label,
  onChange,
  hint,
  accept = ".csv,text/csv,application/csv,application/vnd.ms-excel,text/plain",
}) => (
  <label
    htmlFor={id}
    title={hint}
    className="w-full sm:w-auto py-2.5 px-5 inline-flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl shadow-sm whitespace-nowrap bg-surface border border-line-strong text-ink hover:bg-surface-2 cursor-pointer"
  >
    <Icons.Upload className="w-4 h-4" /> {label}
    <input
      id={id}
      type="file"
      className="sr-only"
      accept={accept}
      onChange={onChange}
    />
  </label>
);
