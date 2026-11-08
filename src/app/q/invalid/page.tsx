import Link from "next/link";
import { QrCode, ShieldAlert } from "lucide-react";
import { Card, LinkButton } from "@/components/ui";

export const metadata = { title: "QR code not recognised" };

export default function InvalidQrPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink-50 px-5">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          <ShieldAlert className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold text-ink-900">This QR code is not valid</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-500">
          The table code may have been replaced, the table could be closed, or the link was copied incorrectly.
          Ask a member of staff for a current code — they can regenerate one from the dashboard in seconds.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <LinkButton href="/" variant="secondary" fullWidth>
            <QrCode className="size-4" aria-hidden /> Back to MenuPilot
          </LinkButton>
        </div>
        <p className="mt-4 text-[11.5px] text-ink-400">
          If you are staff:{" "}
          <Link href="/login" className="font-medium text-clay-700 hover:underline">
            sign in
          </Link>{" "}
          and open Tables &amp; QR.
        </p>
      </Card>
    </main>
  );
}
