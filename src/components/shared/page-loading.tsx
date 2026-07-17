import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-6"
      role="status"
      aria-label="Loading page"
    >
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-48 rounded-xl" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
