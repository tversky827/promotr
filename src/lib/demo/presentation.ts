import { cookies } from 'next/headers';

import { demoEnabled } from '@/lib/demo/mode';

/**
 * Presentation mode.
 *
 * A walkthrough has a different job from a working session. The screens that
 * make the product good to *use* — export panels, developer credentials,
 * secondary breakdowns, advanced link options — are the ones that make it hard
 * to *follow*, because every one of them is something an audience has to be
 * told to ignore. Turning this on hides them, leaving the path a viewer is
 * being walked along.
 *
 * Nothing is disabled and nothing is faked: the same pages render, with fewer
 * panels on them. It is a presentation aid, so it lives in a cookie on the
 * presenter's browser and affects nobody else.
 */

export const PRESENTATION_COOKIE = 'audicents_presentation';

export async function presentationMode(): Promise<boolean> {
  if (!demoEnabled) return false;
  const jar = await cookies();
  return jar.get(PRESENTATION_COOKIE)?.value === '1';
}
