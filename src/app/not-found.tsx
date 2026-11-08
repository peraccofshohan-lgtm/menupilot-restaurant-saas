import { Compass } from "lucide-react";
import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-ink-100 text-ink-500">
          <Compass className="size-5" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold text-ink-900">That page is not here</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
          The link may have expired, or the restaurant you are looking for is not published on MenuPilot yet.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <LinkButton href="/" variant="secondary">Go to MenuPilot</LinkButton>
          <LinkButton href="/login">Sign in</LinkButton>
        </div>
      </div>
    </main>
  );
}
