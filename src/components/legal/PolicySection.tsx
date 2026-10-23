import type { ReactNode } from "react";

/** A numbered section of a legal page (Privacy Policy, Terms of Service). */
export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl text-white tracking-wider mb-3">{title}</h2>
      <div className="font-body text-sm text-dim leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
