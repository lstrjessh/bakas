import type { FeatureCollection, Position } from "geojson";
import type { Storm, TrackPoint } from "./types";

export function stormFilename(storm: Storm) {
  return `${storm.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-$/, "")}-${storm.year}`;
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function trackCSV(storm: Storm) {
  const columns = [
    "storm_id",
    "name",
    "time_utc",
    "latitude",
    "longitude",
    "wind_knots",
    "wind_averaging_minutes",
    "pressure_hpa",
    "agency",
    "position_type",
    "source",
    "source_url",
  ];
  return (
    [
      columns.join(","),
      ...storm.track.map((point) =>
        [
          storm.id,
          storm.name,
          point.time,
          point.lat,
          point.lon,
          point.wind,
          point.averagingMinutes,
          point.pressure,
          point.agency,
          point.forecast ? "forecast" : "observed",
          storm.source,
          storm.sourceUrl,
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}

/** Split lines at the antimeridian; measured point coordinates stay untouched. */
export function trackSegments(points: TrackPoint[]): Position[][] {
  const segments: Position[][] = [];
  let segment: Position[] = [];
  for (const point of points) {
    const next: Position = [point.lon, point.lat];
    const previous = segment.at(-1);
    if (previous && Math.abs(next[0] - previous[0]) > 180) {
      const adjusted = next[0] + (next[0] < previous[0] ? 360 : -360);
      const edge = adjusted > previous[0] ? 180 : -180;
      const lat =
        previous[1] +
        ((next[1] - previous[1]) * (edge - previous[0])) /
          (adjusted - previous[0]);
      segment.push([edge, lat]);
      if (segment.length > 1) segments.push(segment);
      segment = [[-edge, lat]];
    }
    segment.push(next);
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

export function trackGeoJSON(storm: Storm): FeatureCollection {
  const common = {
    storm_id: storm.id,
    name: storm.name,
    year: storm.year,
    source: storm.source,
    source_url: storm.sourceUrl,
    provisional: !!storm.provisional,
  };
  const features: FeatureCollection["features"] = storm.track.map((point) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [point.lon, point.lat] },
    properties: {
      ...common,
      time_utc: point.time,
      wind_knots: point.wind,
      wind_averaging_minutes: point.averagingMinutes,
      pressure_hpa: point.pressure,
      agency: point.agency,
      position_type: point.forecast ? "forecast" : "observed",
    },
  }));
  const observed = storm.track.filter((point) => !point.forecast);
  const forecast = storm.track.filter((point) => point.forecast);
  if (forecast.length && observed.length) forecast.unshift(observed.at(-1)!);
  for (const [kind, points] of [
    ["observed", observed],
    ["forecast", forecast],
  ] as const) {
    const lines = trackSegments(points);
    if (!lines.length) continue;
    features.push({
      type: "Feature",
      properties: { ...common, position_type: kind },
      geometry:
        lines.length === 1
          ? { type: "LineString", coordinates: lines[0] }
          : { type: "MultiLineString", coordinates: lines },
    });
  }
  return { type: "FeatureCollection", features };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadTrack(storm: Storm, format: "csv" | "geojson") {
  const content =
    format === "csv"
      ? trackCSV(storm)
      : JSON.stringify(trackGeoJSON(storm), null, 2);
  downloadBlob(
    new Blob([content], {
      type:
        format === "csv" ? "text/csv;charset=utf-8" : "application/geo+json",
    }),
    `${stormFilename(storm)}.${format}`,
  );
}
