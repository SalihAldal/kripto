import type { ReactNode } from "react";

export function Panel({ title, right, children }: { title?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass-panel rounded-xl p-5 border border-outline-variant/15">
      {title || right ? (
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-widest text-on-surface-variant">{title}</h3>
          {right}
        </header>
      ) : null}
      {children}
    </section>
  );
}
