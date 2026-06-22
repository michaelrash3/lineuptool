import React from "react";
import { Icons } from "../icons";

// A labeled CSV file-input styled as a dashed drop target. Used at the bottom
// of the Roster, Stats, and Schedule tabs so each page owns its own import,
// instead of burying them all under Settings. The onChange handlers come from
// useImportExportFlows (via the team context) and auto-detect the file format.
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
    className="flex flex-col items-center justify-center w-full p-6 border-2 border-dashed border-line-strong rounded-2xl cursor-pointer bg-surface hover:bg-surface-2 transition-all group shadow-sm hover:shadow-md text-center"
  >
    <Icons.Upload className="w-6 h-6 text-ink-3 group-hover:text-[var(--info-fg)] mb-3 transition-colors" />
    <span className="text-[11px] font-black uppercase tracking-widest text-ink-2 leading-snug">
      {label}
    </span>
    {hint && <span className="mt-1 text-[10px] text-ink-3">{hint}</span>}
    <input
      id={id}
      type="file"
      className="sr-only"
      accept={accept}
      onChange={onChange}
    />
  </label>
);
