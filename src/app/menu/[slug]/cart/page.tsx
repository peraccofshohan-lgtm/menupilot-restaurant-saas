import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getMenuForQrToken } from "@/lib/services/orders";
import { CartCheckout } from "@/components/customer/cart-checkout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "আপনার ঝুড়ি", robots: { index: false } };

export default async function CartPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t } = await searchParams;

  // Checkout always requires a live QR token: without one there is no table and
  // no authorized way to create an order.
  const menu = t ? await getMenuForQrToken(t) : null;
  if (!menu || menu.restaurant.slug !== slug) notFound();

  return <CartCheckout menu={menu} qrToken={t!} />;
}
