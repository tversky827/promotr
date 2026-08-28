import { ImageResponse } from 'next/og';

import { MARK_PATHS } from '@/components/identity/logo';
import { brand } from '@/lib/brand';

/**
 * Favicon.
 *
 * Generated rather than shipped as a file so it follows the configured brand
 * colour — a white-labelled deployment gets its own mark without replacing an
 * asset. The geometry is imported from the logo so the tab icon can never
 * drift from the header mark.
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
          background: `hsl(${brand.markHsl})`,
          borderRadius: 7,
        }}
      >
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#F6F1E6" strokeLinecap="round">
          <circle cx="12" cy="12" r={MARK_PATHS.core} fill="#F6F1E6" stroke="none" />
          <path d={MARK_PATHS.inner} strokeWidth="2.3" />
          <path d={MARK_PATHS.outer} strokeWidth="1.8" opacity="0.66" />
        </svg>
      </div>
    ),
    size,
  );
}
