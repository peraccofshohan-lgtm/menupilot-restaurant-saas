import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getMenuBySlug, getMenuForQrToken } from "@/lib/services/orders";
import { GuestMenu } from "@/components/customer/guest-menu";
import { getTranslator } from "@/lib/i18n/server";
import { localizedRestaurant } from "@/lib/i18n/content";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [menu, { t }] = await Promise.all([getMenuBySlug(slug), getTranslator()]);
  if (!menu) return { title: t("error.notFound") };
  const brand = localizedRestaurant(menu.restaurant);
  return {
    title: `${brand.name} · ${t("menu.title")}`,
    description: brand.tagline ?? brand.description ?? t("app.description"),
  };
}

export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string; table?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;

  // A QR token always wins: it carries the authoritative restaurant + table.
  const qrMenu = t ? await getMenuForQrToken(t) : null;
  const menu = qrMenu ?? (await getMenuBySlug(slug));

  if (!menu) notFound();
  if (qrMenu && qrMenu.restaurant.slug !== slug) {
    // Token belongs to a different restaurant than the URL claims: trust the token.
    notFound();
  }

  return <GuestMenu menu={menu} qrToken={qrMenu ? t! : null} />;
}
