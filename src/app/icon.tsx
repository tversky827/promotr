import { ImageResponse } from 'next/og';

import { brand } from '@/lib/brand';

/**
 * Favicon.
 *
 * Generated rather than shipped as a file so it follows the configured brand
 * colour — a white-labelled deployment gets its own mark without replacing an
 * asset. The mark is the same rising-line glyph used in the header.
 */

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `hsl(${brand.primaryHsl})`,
          borderRadius: 7,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 14.5 10.5 9l4 4L20 7"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 7h5v5"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    size,
  );
}
