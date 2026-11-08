/**
 * Localised *restaurant data*.
 *
 * The dictionary covers interface text. This file covers the other half of a
 * Bengali product: dish names, dish descriptions, category names and the
 * restaurant's own profile text — data that lives in the database and differs
 * per tenant.
 *
 * Every helper follows one rule: **Bangla when it exists, English otherwise.**
 * A restaurant that has not translated its menu yet sees English names, which is
 * strictly better than a blank row or a guessed translation, and means adding a
 * dish never requires a migration.
 */
import { defaultLocale, type Locale } from "./config";

interface HasBangla {
  name?: string | null;
  name_bn?: string | null;
  description?: string | null;
  description_bn?: string | null;
}

function pick(locale: Locale, bangla: string | null | undefined, english: string | null | undefined): string {
  const bn = bangla?.trim();
  const en = english?.trim();
  if (locale === defaultLocale && bn) return bn;
  return en || bn || "";
}

/** The name to show for a dish or category. */
export function localizedName(row: HasBangla, locale: Locale = defaultLocale): string {
  return pick(locale, row.name_bn, row.name);
}

/** The description to show, or null when there is genuinely none. */
export function localizedDescription(row: HasBangla, locale: Locale = defaultLocale): string | null {
  const value = pick(locale, row.description_bn, row.description);
  return value.length > 0 ? value : null;
}

/** The restaurant profile, localised the same way. */
export function localizedRestaurant(
  restaurant: {
    name?: string | null;
    tagline?: string | null;
    tagline_bn?: string | null;
    description?: string | null;
    description_bn?: string | null;
    address?: string | null;
    address_bn?: string | null;
    city?: string | null;
  },
  locale: Locale = defaultLocale,
): { name: string; tagline: string | null; description: string | null; address: string | null; city: string | null } {
  return {
    name: restaurant.name?.trim() ?? "",
    tagline: pick(locale, restaurant.tagline_bn, restaurant.tagline) || null,
    description: pick(locale, restaurant.description_bn, restaurant.description) || null,
    address: pick(locale, restaurant.address_bn, restaurant.address) || null,
    // A city name is a place, not marketing copy; leave it as stored.
    city: restaurant.city?.trim() ?? null,
  };
}
