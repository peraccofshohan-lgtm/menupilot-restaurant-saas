import QRCode from "qrcode";
import { asAuthed, type AppUser } from "@/lib/auth/server";

export interface DiningTable {
  id: string;
  label: string;
  zone: string | null;
  seats: number;
  is_active: boolean;
  sort_order: number;
  qr_id: string | null;
  qr_token: string | null;
  qr_active: boolean | null;
  open_orders: number;
}

/**
 * Table + QR service.
 *
 * Rows come from the tenant-scoped tables behind RLS (owner/manager only). The QR
 * payload is `<origin>/q/<token>`; the token itself is never presented as a table
 * number, and it is validated server-side on arrival.
 */
export async function getTables(user: AppUser, restaurantId: string): Promise<DiningTable[]> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<DiningTable>(
      `select d.id, d.label, d.zone, d.seats, d.is_active, d.sort_order,
              q.id as qr_id, q.token as qr_token, q.is_active as qr_active,
              (select count(*) from orders o
                where o.table_id = d.id and o.status in ('pending','accepted','preparing','ready'))::int as open_orders
         from dining_tables d
         left join lateral (
           select id, token, is_active from qr_tokens
            where table_id = d.id and is_active
            order by created_at desc limit 1
         ) q on true
        where d.restaurant_id = $1
        order by d.sort_order, d.label`,
      [restaurantId],
    );
    return res.rows;
  });
}

export async function buildQrSvg(url: string, size = 320): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: size,
    errorCorrectionLevel: "M",
    color: { dark: "#181814", light: "#ffffff" },
  });
}

export async function buildQrPngDataUrl(url: string, size = 640): Promise<string> {
  return QRCode.toDataURL(url, {
    type: "image/png",
    margin: 2,
    width: size,
    errorCorrectionLevel: "M",
    color: { dark: "#181814", light: "#ffffff" },
  });
}
