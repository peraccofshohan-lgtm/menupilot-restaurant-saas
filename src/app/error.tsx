"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Card } from "@/components/ui";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Technical detail stays in the server logs; guests see a calm message.
    console.error("[menupilot] unhandled error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <Card className="max-w-md p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-ink-900">Something interrupted that</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
          We could not finish loading this screen. Your data is safe — try again, and if it keeps happening the
          restaurant can reach us at support.
        </p>
        <div className="mt-6">
          <Button onClick={reset} fullWidth>Try again</Button>
        </div>
      </Card>
    </main>
  );
}
