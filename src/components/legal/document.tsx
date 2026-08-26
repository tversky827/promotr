import { brand } from '@/lib/brand';

/**
 * Legal document shell.
 *
 * Every document carries a prominent notice that it is a template requiring
 * review by a qualified lawyer before launch. Shipping plausible-looking legal
 * text without that notice would invite an operator to rely on it.
 */
export function LegalDocument({
  title,
  effectiveDate,
  summary,
  children,
}: {
  title: string;
  effectiveDate: string;
  summary?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <header className="mb-8 border-b border-border pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-fg text-balance">{title}</h1>
        <p className="mt-2 text-sm text-fg-subtle">
          {brand.legalName} · Effective {effectiveDate}
        </p>
        {summary ? <p className="mt-4 text-md text-fg-muted text-pretty">{summary}</p> : null}
      </header>

      <div className="rounded-lg border border-warning/30 bg-warning-soft/40 p-4">
        <h2 className="text-sm font-semibold text-warning">This is a template, not legal advice</h2>
        <p className="mt-1.5 text-sm text-fg-muted text-pretty">
          This document is a starting point, written to describe the mechanics this platform
          actually implements. It has not been reviewed by a lawyer and is not tailored to your
          jurisdiction, your business, or the regulations that apply to you. Have a qualified lawyer
          review and adapt every legal document before accepting real users or real money.
        </p>
      </div>

      <div className="mt-8 space-y-6">{children}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
      <div className="mt-2.5 space-y-3 text-md leading-relaxed text-fg-muted text-pretty">
        {children}
      </div>
    </section>
  );
}

export function List({ items }: { items: string[] }) {
  return (
    <ul className="ml-5 list-disc space-y-1.5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
