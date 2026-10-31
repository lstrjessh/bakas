export type TrackPoint = {
  time: string;
  lat: number;
  lon: number;
  wind: number | null;
  pressure: number | null;
  agency: string;
  averagingMinutes: number | null;
  forecast?: boolean;
  category?: string;
};
export type StormSummary = {
  id: string;
  name: string;
  year: number;
  start: string;
  end: string;
  peakWind: number | null;
  points: number;
};
export type Storm = StormSummary & {
  source: string;
  sourceUrl: string;
  provisional?: boolean;
  track: TrackPoint[];
};
export type ArchiveIndex = {
  generated: string;
  source: string;
  version: string;
  storms: StormSummary[];
};
export type LiveResponse = { fetched: string; source: string; storms: Storm[] };
export const PAR = [
  [120, 25],
  [135, 25],
  [135, 5],
  [115, 5],
  [115, 15],
  [120, 21],
  [120, 25],
];
export const SATELLITE_BOUNDS: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [105, 29.25],
  [150, 29.25],
  [150, -0.25],
  [105, -0.25],
];
export function stampISO(stamp: string) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}Z`;
}
