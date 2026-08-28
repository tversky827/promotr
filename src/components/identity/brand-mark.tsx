/**
 * A brand's mark in the marketplace.
 *
 * Falls back to the brand's initials on a tinted tile when it has no logo, so a
 * campaign card never has a hole in it — an empty square reads as broken, and a
 * generic placeholder icon reads as a stock template.
 *
 * The image is deliberately not next/image: a brand logo is an arbitrary
 * third-party URL, and routing every one of them through the optimiser would
 * make the marketplace's render time depend on other people's servers.
 */
export function BrandMark({
  name,
  logoUrl,
  size = 'md',
  className,
}: {
  name: string;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dimension = size === 'sm' ? 'size-7' : size === 'lg' ? 'size-12' : 'size-9';
  const text = size === 'sm' ? 'text-2xs' : size === 'lg' ? 'text-md' : 'text-xs';

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={`${dimension} shrink-0 rounded-lg border border-border/60 object-cover ${className ?? ''}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${dimension} ${text} grid shrink-0 place-items-center rounded-lg border border-border bg-surface-sunken font-semibold uppercase tracking-tight text-fg-muted ${className ?? ''}`}
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2);
  return `${(words[0] ?? '')[0] ?? ''}${(words[1] ?? '')[0] ?? ''}`;
}
