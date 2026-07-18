"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main className="flex min-h-screen items-center justify-center bg-background p-6 font-sans text-foreground">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-border p-6 shadow-sm">
            <h1 className="text-xl font-semibold">Application unavailable</h1>
            <p className="text-sm text-muted-foreground">
              A critical error interrupted the application. Retry to recover.
            </p>
            <button
              type="button"
              onClick={unstable_retry}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
