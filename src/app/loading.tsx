import { Skeleton } from '@/components/ui/primitives';

/**
 * Route-level loading state. Mirrors the shape of a typical page so the layout
 * does not jump when content arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-3 h-4 w-96" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="mt-4 h-72 rounded-lg" />
    </div>
  );
}
