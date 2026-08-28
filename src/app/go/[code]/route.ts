/**
 * The previous shape of a tracking link.
 *
 * Links live in video descriptions, podcast show notes and printed cards; they
 * outlive any decision about what the path should be called. This re-exports
 * the handler rather than redirecting, so an old link costs a visitor nothing —
 * a 308 to /r/ would add a round trip to the hottest path in the product.
 */
export { GET, runtime, dynamic } from '../../r/[code]/route';
