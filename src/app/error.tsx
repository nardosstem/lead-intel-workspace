"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ErrorBoundary({
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
    <div className="mx-auto flex w-full max-w-lg items-center">
      <Card className="w-full">
        <CardHeader>
          <TriangleAlert className="size-6 text-destructive" aria-hidden="true" />
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The page could not be loaded. Retry the request, and contact support
            if the problem continues.
          </p>
          <Button type="button" onClick={unstable_retry}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
