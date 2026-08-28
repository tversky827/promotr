'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * Share a tracking link.
 *
 * Two of these targets can genuinely receive a link from a web page — X and
 * Facebook both take a share intent — so they do. The rest cannot: Instagram,
 * TikTok and YouTube have no web share endpoint, and a button that pretended
 * otherwise would be a button that does nothing. For those the link is copied
 * and the panel says where to paste it, which is what a publisher does anyway.
 *
 * On a device with the native share sheet, that is offered first, because it
 * reaches every app installed rather than the five listed here.
 */

interface Target {
  key: string;
  label: string;
  /** Absent when the platform has no way to receive a link from the web. */
  intent?: (url: string, text: string) => string;
  hint?: string;
  icon: React.ReactNode;
}

const TARGETS: Target[] = [
  {
    key: 'instagram',
    label: 'Instagram',
    hint: 'Copied — paste it into your bio or story link.',
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
        <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    hint: 'Copied — paste it into your profile link or a comment.',
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
        <path
          d="M14 3v10.5a3.5 3.5 0 1 1-3-3.46"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M14 3c.4 2.4 2 4 4.5 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: 'youtube',
    label: 'YouTube',
    hint: 'Copied — paste it into your video description.',
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
        <rect x="2.5" y="5.5" width="19" height="13" rx="4" stroke="currentColor" strokeWidth="1.7" />
        <path d="m10.5 9.5 4.5 2.5-4.5 2.5z" fill="currentColor" />
      </svg>
    ),
  },
  {
    key: 'x',
    label: 'X',
    intent: (url, text) =>
      `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
        <path d="M17.7 3h3.3l-7.2 8.2L22 21h-6.6l-5.2-6.7L4.3 21H1l7.7-8.8L1.4 3H8l4.7 6.2zm-1.2 16h1.8L7.6 4.9H5.7z" />
      </svg>
    ),
  },
  {
    key: 'facebook',
    label: 'Facebook',
    intent: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    icon: (
      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
        <path d="M13.5 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.5-1.5h1.7V3.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.5-4 4.1V10H7.5v3h2.8v8z" />
      </svg>
    ),
  },
];

export function ShareMenu({
  url,
  suggestedText,
  className,
}: {
  url: string;
  suggestedText: string;
  className?: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Feature-detected after mount: navigator.share does not exist on the server,
  // and rendering the button conditionally during hydration would mismatch.
  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const announce = (message: string) => {
    setStatus(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(null), 4000);
  };

  const copy = async (message: string) => {
    try {
      await navigator.clipboard.writeText(url);
      announce(message);
    } catch {
      announce('Copying was blocked — select the link above and copy it.');
    }
  };

  const share = async (target: Target) => {
    if (target.intent) {
      window.open(target.intent(url, suggestedText), '_blank', 'noopener,noreferrer,width=600,height=540');
      announce(`Opened ${target.label} with your link attached.`);
      return;
    }
    await copy(target.hint ?? 'Tracking link copied.');
  };

  return (
    <div className={className}>
      <p className="text-2xs font-medium uppercase tracking-wide text-fg-subtle">Share it</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {canNativeShare ? (
          <ShareButton
            onClick={() => {
              void navigator
                .share({ url, text: suggestedText })
                .then(() => announce('Shared.'))
                .catch(() => undefined);
            }}
            icon={
              <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
                <path
                  d="M12 16V4m0 0L8.5 7.5M12 4l3.5 3.5M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            }
            label="Share"
          />
        ) : null}

        {TARGETS.map((target) => (
          <ShareButton
            key={target.key}
            onClick={() => void share(target)}
            icon={target.icon}
            label={target.label}
          />
        ))}

        <ShareButton
          onClick={() => void copy('Tracking link copied.')}
          icon={
            <svg viewBox="0 0 24 24" className="size-4" fill="none" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
          }
          label="Copy link"
        />
      </div>

      {/* role=status so the confirmation is announced, not just seen. */}
      <p
        role="status"
        className={cn(
          'mt-2.5 text-xs transition-opacity',
          status ? 'text-primary opacity-100' : 'opacity-0',
        )}
      >
        {status ?? ' '}
      </p>
    </div>
  );
}

function ShareButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55"
    >
      <span className="text-fg-subtle">{icon}</span>
      {label}
    </button>
  );
}
