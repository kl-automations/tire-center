import type { TFunction } from "i18next";

/**
 * Tyre quality tier offered to the customer.
 *
 * Maps to the `common.qualityTier.*` i18n namespace:
 *  - `chinese`  → סיני (budget)
 *  - `upgraded` → משודרג (mid-range)
 *  - `premium`  → פרימיום (premium)
 *
 * Sourced from `open_orders.car_data.tire_level` (ERP car-lookup response).
 */
export type QualityTier = "chinese" | "upgraded" | "premium";

/**
 * All valid quality tiers in ascending order (budget → premium).
 * Use this array to render tier selectors without hardcoding strings.
 */
export const QUALITY_TIERS: readonly QualityTier[] = ["chinese", "upgraded", "premium"];

/**
 * Returns the localised display label for a quality tier using the current i18n `t` function.
 *
 * Falls back gracefully: if the tier is unknown or the translation key is missing,
 * the raw `tier` string is returned as-is so the UI never shows an empty label.
 *
 * @param t    - The `t` function from `useTranslation()`.
 * @param tier - A `QualityTier` value (or any unknown string from the backend).
 * @returns Localised label string, or the raw tier value if no translation is found.
 *
 * @example
 * translateQualityTier(t, "premium") // → "פרימיום" (in Hebrew)
 */
export function translateQualityTier(t: TFunction, tier: string | undefined): string {
  if (tier == null || tier === "") return "";
  const key = `common.qualityTier.${tier}`;
  const label = t(key);
  return label === key ? tier : label;
}
