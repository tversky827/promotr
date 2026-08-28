import Link from 'next/link';

import { brand } from '@/lib/brand';

/**
 * Audicents identity.
 *
 * The mark is a ripple: a solid centre — the creator — with two arcs spreading
 * outward, opened at the lower right so it reads as a signal travelling rather
 * than a closed target. It doubles as the edge of a coin, which is the whole
 * proposition: an audience carries value. Everything is drawn in currentColor
 * so it inverts cleanly on light and dark grounds, and it stays legible at
 * 16px, which is what a favicon has to survive.
 *
 * Swapping the identity means replacing this file (or setting
 * NEXT_PUBLIC_BRAND_LOGO_URL, which takes precedence); nothing else imports the
 * geometry.
 */

/** Ripple geometry, shared by the header mark and the generated favicon. */
export const MARK_PATHS = {
  core: 3,
  inner: 'M13.29 5.94A6.2 6.2 0 1 0 18.06 10.71',
  outer: 'M14 2.61A9.6 9.6 0 1 0 21.39 10',
} as const;

export function AudicentsMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r={MARK_PATHS.core} fill="currentColor" stroke="none" />
      <path d={MARK_PATHS.inner} strokeWidth="2.1" />
      <path d={MARK_PATHS.outer} strokeWidth="1.6" opacity="0.62" />
    </svg>
  );
}

/**
 * The wordmark. Tight tracking and a heavier "AUDI" would be a step too far —
 * the name is stronger set plainly, which is also what keeps it swappable when
 * brand.name is overridden.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.02em] text-fg ${className ?? ''}`}>
      {brand.name}
    </span>
  );
}

export function LogoLockup({
  className,
  markClassName,
  wordmarkClassName,
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logoUrl}
          alt=""
          className={`size-7 rounded-md object-contain ${markClassName ?? ''}`}
          width={28}
          height={28}
        />
      ) : (
        <AudicentsMark className={`size-[26px] text-primary ${markClassName ?? ''}`} />
      )}
      <Wordmark className={`text-md ${wordmarkClassName ?? ''}`} />
    </span>
  );
}

export function Logo({ className, href = '/' }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-md transition-opacity hover:opacity-80 ${className ?? ''}`}
      aria-label={brand.name}
    >
      <LogoLockup />
    </Link>
  );
}
