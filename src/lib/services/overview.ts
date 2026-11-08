import { asAuthed, type AppUser } from "@/lib/auth/server";

export interface OverviewData {
  today: {
    orders: number;
    pending: number;
    accepted: number;
    preparing: number;
    ready: number;
    served: number;
    rejected: number;
    revenue: string | number;
    avg_order_value: string | number;
  };
  pending_orders: number;
  active_kitchen: number;
  table_count: number;
  menu_item_count: number;
  unavailable_item_count: number;
  popular_items: { name: string; quantity: number; revenue: string }[];
  recent_orders: {
    id: string;
    order_number: string;
    status: string;
    total: string;
    currency: string;
    created_at: string;
    item_count: number;
    table_label: string | null;
    customer_name: string | null;
  }[];
  tables: { id: string; label: string; zone: string | null; is_active: boolean; open_orders: number }[];
  business_date: string;
  time_zone: string;
}

export async function getOverview(user: AppUser, restaurantId: string): Promise<OverviewData> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ overview: OverviewData }>(
      "select public.restaurant_overview($1) as overview",
      [restaurantId],
    );
    const data = res.rows[0]?.overview;
    if (!data) throw new Error("Overview unavailable");
    return data;
  });
}

export interface AnalyticsData {
  time_zone: string;
  totals: {
    orders: number;
    completed_orders: number;
    rejected_orders: number;
    cancelled_orders: number;
    revenue: string | number;
    avg_order_value: string | number;
    items_sold: number;
  };
  daily: { day: string; orders: number; revenue: string | number }[];
  status_breakdown: Record<string, number>;
  top_items: { name: string; quantity: number; revenue: string }[];
  category_performance: { name: string; quantity: number; revenue: string }[];
}

export async function getAnalytics(
  user: AppUser,
  restaurantId: string,
  from: string,
  to: string,
): Promise<AnalyticsData> {
  return asAuthed(user, async (tx) => {
    const res = await tx.query<{ analytics: AnalyticsData }>(
      "select public.restaurant_analytics($1, $2::date, $3::date) as analytics",
      [restaurantId, from, to],
    );
    const data = res.rows[0]?.analytics;
    if (!data) throw new Error("Analytics unavailable");
    return data;
  });
}
