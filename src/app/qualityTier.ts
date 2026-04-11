import type { TFunction } from "i18next";

/** Tire quality tier — matches `common.qualityTier.*` in locales (סיני / משודרג / פרימיום) */
export type QualityTier = "chinese" | "upgraded" | "premium";

export const QUALITY_TIERS: readonly QualityTier[] = ["chinese", "upgraded", "premium"];

export function translateQualityTier(t: TFunction, tier: string | undefined): string {
  if (tier == null || tier === "") return "";
  const key = `common.qualityTier.${tier}`;
  const label = t(key);
  return label === key ? tier : label;
}
