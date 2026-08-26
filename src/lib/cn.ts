/**
 * Class-name joiner.
 *
 * Hand-rolled rather than clsx + tailwind-merge: components here compose
 * classes by variant lookup, so there are no conflicting utilities to merge.
 * It accepts `unknown` so `cond && 'class'` expressions type-check regardless
 * of what `cond` is, and keeps only real strings.
 */
export function cn(...values: unknown[]): string {
  let result = '';
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      result = result === '' ? value : `${result} ${value}`;
    }
  }
  return result;
}
