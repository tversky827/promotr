/**
 * The previous shape of a tracking link.
 *
 * Links live in video descriptions, podcast show notes and printed cards; they
 * outlive any decision about what the path should be called. This re-exports
 * the handler rather than redirecting, so an old link costs a visitor nothing —
 * a 308 to /r/ would add a round trip to the hottest path in the product.
 *
 * The segment config is declared here rather than re-exported: Next.js parses
 * `runtime` and `dynamic` statically at build time and cannot follow them
 * through another module.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export { GET } from '../../r/[code]/route';
