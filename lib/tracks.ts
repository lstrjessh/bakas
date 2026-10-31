import type { TrackPoint } from "./types";
/** Keep a dateline crossing local instead of drawing across the globe. */
export function unwrapTrack(track: TrackPoint[]): [number, number][] {
  const points: [number, number][] = [];
  for (const p of track) {
    let lon = p.lon;
    const previous = points.at(-1)?.[0];
    if (previous !== undefined) {
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
    }
    points.push([lon, p.lat]);
  }
  return points;
}
export function windLabel(wind: number | null) {
  return wind === null ? "Not reported" : `${Math.round(wind * 1.852)} km/h`;
}
export function timeLabel(time: string, zone = "Asia/Manila") {
  return (
    new Date(time).toLocaleString("en-GB", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: zone,
    }) + (zone === "UTC" ? " UTC" : " PHT")
  );
}
