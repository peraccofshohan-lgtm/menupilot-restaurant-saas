import { getCurrentUser } from "@/lib/auth/server";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingHeader signedIn={Boolean(user)} />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
