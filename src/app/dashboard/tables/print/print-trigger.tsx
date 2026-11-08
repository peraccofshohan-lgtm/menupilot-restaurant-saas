"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function PrintTrigger() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer className="size-3.5" aria-hidden /> Print
    </Button>
  );
}
