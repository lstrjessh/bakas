import type { TrackPoint } from "./types";

/** Palette and official symbols shared with GAKIT's PAGASA track display. */
export const TRACK_CATEGORIES = {
  LPA: { color: "#0284c7", label: "Low Pressure Area" },
  TD: { color: "#22c55e", label: "Tropical Depression" },
  TS: { color: "#eab308", label: "Tropical Storm" },
  STS: { color: "#f97316", label: "Severe Tropical Storm" },
  TY: { color: "#ef4444", label: "Typhoon" },
  STY: { color: "#a855f7", label: "Super Typhoon" },
} as const;
export type TrackCategory = keyof typeof TRACK_CATEGORIES;

/** Modern visual bands may only be derived from positive, recorded 10-minute winds. */
export function trackCategory(
  value?: string,
  windKnots?: number | null,
  averagingMinutes?: number | null,
): TrackCategory | null {
  const category = value?.trim().toUpperCase();
  if (category && Object.hasOwn(TRACK_CATEGORIES, category)) return category as TrackCategory;
  const aliases = {
    "LOW PRESSURE AREA": "LPA", "TROPICAL DEPRESSION": "TD",
    "TROPICAL STORM": "TS", "SEVERE TROPICAL STORM": "STS",
    TYPHOON: "TY", "SUPER TYPHOON": "STY", SUPERTYPHOON: "STY",
    AA: "LPA", LOW: "LPA",
  } as Record<string, TrackCategory>;
  if (category && Object.hasOwn(aliases, category)) return aliases[category];
  // Do not override an unfamiliar/non-tropical reported classification.
  if (category || averagingMinutes !== 10 || windKnots == null || !Number.isFinite(windKnots) || windKnots <= 0)
    return null;
  if (windKnots >= 185 / 1.852) return "STY";
  if (windKnots >= 118 / 1.852) return "TY";
  if (windKnots >= 89 / 1.852) return "STS";
  if (windKnots >= 62 / 1.852) return "TS";
  return "TD";
}
export function trackColor(value?: string, windKnots?: number | null, averagingMinutes?: number | null): string {
  const category = trackCategory(value, windKnots, averagingMinutes);
  return category ? TRACK_CATEGORIES[category].color : "#64748b";
}

export function trackPointStyle(point: Pick<TrackPoint, "category" | "wind" | "averagingMinutes">) {
  const category = trackCategory(point.category, point.wind, point.averagingMinutes);
  const derived = category !== null && trackCategory(point.category) === null;
  return {
    category: category ?? "",
    categoryLabel: category ? category + (derived ? "*" : "") : "",
    color: category ? TRACK_CATEGORIES[category].color : "#64748b",
    classified: category !== null,
    derived,
  };
}
