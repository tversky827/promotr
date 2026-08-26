import { cn } from '@/lib/cn';

/**
 * Documentation primitives.
 *
 * Code blocks are plain `<pre>` rather than a syntax highlighter: highlighting
 * would add a client-side dependency to a page that is otherwise entirely
 * static, for a marginal readability gain on short snippets.
 */
export function CodeBlock({
  children,
  language,
  filename,
  className,
}: {
  children: string;
  language?: string;
  filename?: string;
  className?: string;
}) {
  return (
    <figure className={cn('overflow-hidden rounded-lg border border-border', className)}>
      {filename || language ? (
        <figcaption className="flex items-center justify-between border-b border-border bg-surface-sunken px-3.5 py-2">
          <span className="font-mono text-xs text-fg-muted">{filename ?? language}</span>
          {filename && language ? (
            <span className="text-2xs uppercase tracking-wide text-fg-subtle">{language}</span>
          ) : null}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto bg-surface p-3.5">
        <code className="font-mono text-xs leading-relaxed text-fg">{children}</code>
      </pre>
    </figure>
  );
}

export function DocSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
      <div className="mt-3 space-y-4 text-md leading-relaxed text-fg-muted text-pretty">
        {children}
      </div>
    </section>
  );
}

export function ParamTable({
  params,
}: {
  params: Array<{ name: string; type: string; required?: boolean; description: string }>;
}) {
  return (
    <div className="scroll-x">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left">
          <thead className="bg-surface-sunken">
            <tr>
              <th className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                Field
              </th>
              <th className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                Type
              </th>
              <th className="px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                Description
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {params.map((param) => (
              <tr key={param.name}>
                <td className="whitespace-nowrap px-3.5 py-2.5 align-top">
                  <code className="font-mono text-xs text-fg">{param.name}</code>
                  {param.required ? (
                    <span className="ml-1.5 text-2xs font-medium text-danger">required</span>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3.5 py-2.5 align-top font-mono text-2xs text-fg-muted">
                  {param.type}
                </td>
                <td className="px-3.5 py-2.5 align-top text-sm text-fg-muted text-pretty">
                  {param.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
