import React, { ComponentType, CSSProperties } from "react";

// Same section chrome the Stats tab uses, kept local to the Finances screen.
export const SectionCard = ({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  title: React.ReactNode;
  subtitle?: string;
  children?: React.ReactNode;
}) => (
  <section>
    <div className="pb-3 mb-1 border-b border-line-strong flex items-center gap-3">
      <Icon className="w-5 h-5 shrink-0" style={{ color: "var(--team-ink)" }} />
      <div className="min-w-0">
        <h2 className="t-h2">{title}</h2>
        {subtitle && <p className="t-eyebrow text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {children}
  </section>
);
