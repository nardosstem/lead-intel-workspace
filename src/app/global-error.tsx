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
      <body>
        <main className="flex min-h-screen items-center justify-center bg-white p-6 font-sans text-neutral-950">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-neutral-200 p-6 shadow-sm">
            <h1 className="text-xl font-semibold">Application unavailable</h1>
            <p className="text-sm text-neutral-600">
              A critical error interrupted the application. Retry to recover.
            </p>
            <button
              type="button"
              onClick={unstable_retry}
              className="rounded-md bg-neutral-950 px-3 py-2 text-sm font-medium text-white"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
