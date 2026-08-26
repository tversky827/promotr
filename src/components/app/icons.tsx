/**
 * Navigation icons.
 *
 * Inline SVG at a single stroke weight rather than an icon package: the set is
 * small, consistency matters more than breadth, and it keeps the client bundle
 * free of an icon library.
 */

const props = {
  viewBox: '0 0 20 20',
  fill: 'none',
  className: 'size-[18px]',
  'aria-hidden': true,
} as const;

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const Icons = {
  dashboard: (
    <svg {...props}>
      <path d="M3 3h6v6H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 11h6v6H3z" {...stroke} />
    </svg>
  ),
  campaigns: (
    <svg {...props}>
      <path d="M3 7.5 10 4l7 3.5-7 3.5z" {...stroke} />
      <path d="m3 12.5 7 3.5 7-3.5" {...stroke} />
    </svg>
  ),
  link: (
    <svg {...props}>
      <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-1 1" {...stroke} />
      <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 1 0 4.24 4.24l1-1" {...stroke} />
    </svg>
  ),
  earnings: (
    <svg {...props}>
      <path d="M10 2.5v15M13.5 6.2c-.6-1-1.9-1.7-3.5-1.7-2 0-3.3 1-3.3 2.4 0 3.6 7 1.9 7 5.6 0 1.5-1.4 2.7-3.7 2.7-1.8 0-3.2-.8-3.8-1.9" {...stroke} />
    </svg>
  ),
  payouts: (
    <svg {...props}>
      <rect x="2.5" y="5" width="15" height="10" rx="2" {...stroke} />
      <path d="M2.5 8.5h15M5.5 12h3" {...stroke} />
    </svg>
  ),
  analytics: (
    <svg {...props}>
      <path d="M3 17V9M8 17V4M13 17v-6M18 17V7" {...stroke} />
    </svg>
  ),
  users: (
    <svg {...props}>
      <circle cx="8" cy="7" r="2.75" {...stroke} />
      <path d="M2.75 16.5a5.25 5.25 0 0 1 10.5 0M14 5.4a2.75 2.75 0 0 1 0 5.2M15.5 16.5a4.6 4.6 0 0 0-1.6-3.5" {...stroke} />
    </svg>
  ),
  building: (
    <svg {...props}>
      <path d="M4 17V4.5A1.5 1.5 0 0 1 5.5 3h5A1.5 1.5 0 0 1 12 4.5V17M12 8h3.5A1.5 1.5 0 0 1 17 9.5V17M2.5 17h15M6.5 6.5h3M6.5 9.5h3M6.5 12.5h3" {...stroke} />
    </svg>
  ),
  shield: (
    <svg {...props}>
      <path d="M10 2.5 4 5v4.5c0 3.6 2.5 6.8 6 8 3.5-1.2 6-4.4 6-8V5z" {...stroke} />
      <path d="m7.5 10 1.8 1.8L12.8 8" {...stroke} />
    </svg>
  ),
  scale: (
    <svg {...props}>
      <path d="M10 3v14M5 6.5h10M4 6.5 2 12h4zM16 6.5 14 12h4zM6.5 17h7" {...stroke} />
    </svg>
  ),
  bell: (
    <svg {...props}>
      <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1 4-1.5 4.5h12c-.5-.5-1.5-1.5-1.5-4.5A4.5 4.5 0 0 0 10 3ZM8.5 15a1.5 1.5 0 0 0 3 0" {...stroke} />
    </svg>
  ),
  settings: (
    <svg {...props}>
      <circle cx="10" cy="10" r="2.5" {...stroke} />
      <path d="M10 2.5v1.8M10 15.7v1.8M17.5 10h-1.8M4.3 10H2.5M15.3 4.7l-1.3 1.3M6 14l-1.3 1.3M15.3 15.3 14 14M6 6 4.7 4.7" {...stroke} />
    </svg>
  ),
  code: (
    <svg {...props}>
      <path d="m7 6-4 4 4 4M13 6l4 4-4 4" {...stroke} />
    </svg>
  ),
  cursor: (
    <svg {...props}>
      <path d="m4 3 4.5 13 2-5.5 5.5-2z" {...stroke} />
    </svg>
  ),
  check: (
    <svg {...props}>
      <circle cx="10" cy="10" r="7.5" {...stroke} />
      <path d="m6.5 10 2.3 2.3L13.5 7.5" {...stroke} />
    </svg>
  ),
  receipt: (
    <svg {...props}>
      <path d="M4.5 2.5v15l2-1.2 2 1.2 2-1.2 2 1.2 2-1.2 1 .6v-14z" {...stroke} />
      <path d="M7.5 7h5M7.5 10.5h5" {...stroke} />
    </svg>
  ),
  profile: (
    <svg {...props}>
      <circle cx="10" cy="7" r="3" {...stroke} />
      <path d="M4 16.5a6 6 0 0 1 12 0" {...stroke} />
    </svg>
  ),
  activity: (
    <svg {...props}>
      <path d="M2.5 10h3l2-5 4 10 2-5h4" {...stroke} />
    </svg>
  ),
  search: (
    <svg {...props}>
      <circle cx="9" cy="9" r="5.5" {...stroke} />
      <path d="m13.5 13.5 3 3" {...stroke} />
    </svg>
  ),
  download: (
    <svg {...props}>
      <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M3.5 15.5h13" {...stroke} />
    </svg>
  ),
  plus: (
    <svg {...props}>
      <path d="M10 4v12M4 10h12" {...stroke} />
    </svg>
  ),
  external: (
    <svg {...props}>
      <path d="M8 4H4.5v11.5H16V12M11.5 3.5H17V9M17 3.5 9.5 11" {...stroke} />
    </svg>
  ),
} as const;
