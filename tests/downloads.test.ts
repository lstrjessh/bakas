import { test } from "node:test";
import assert from "node:assert/strict";
import { trackCSV, trackGeoJSON, trackSegments } from "../lib/downloads";
import type { Storm, TrackPoint } from "../lib/types";

const point = (lon: number, time: string, forecast = false): TrackPoint => ({
  lon,
  lat: 15,
  time,
  wind: null,
  pressure: null,
  agency: "tokyo",
  averagingMinutes: 10,
  forecast,
});
const storm: Storm = {
  id: "test",
  name: 'Storm, "Test"',
  year: 2026,
  start: "2026-10-30T00:00:00Z",
  end: "2026-10-30T12:00:00Z",
  peakWind: 80,
  points: 3,
  source: "Test agency",
  sourceUrl: "https://example.com/",
  track: [
    { ...point(179, "2026-10-30T00:00:00Z"), wind: 80, pressure: 970 },
    point(-179, "2026-10-30T06:00:00Z"),
    point(-177, "2026-10-30T12:00:00Z", true),
  ],
};
test("CSV escapes names, retains missing measurements and identifies forecasts", () => {
  const csv = trackCSV(storm);
  assert.ok(csv.includes('"Storm, ""Test"""'));
  assert.ok(csv.includes("wind_knots,wind_averaging_minutes,pressure_hpa"));
  assert.ok(csv.includes(',80,10,970,"tokyo","observed"'));
  assert.ok(csv.includes(',-177,,10,,"tokyo","forecast"'));
  assert.equal(csv.trim().split("\r\n").length, 4);
});
test("GeoJSON separates observed and forecast tracks without altering observations", () => {
  const result = trackGeoJSON(storm);
  const points = result.features.filter((f) => f.geometry.type === "Point");
  assert.equal(points.length, 3);
  assert.equal(points[1].properties?.wind_knots, null);
  assert.equal(points[0].properties?.wind_averaging_minutes, 10);
  const observed = result.features.find(
    (f) => f.geometry.type === "MultiLineString",
  );
  assert.ok(observed);
  assert.equal(observed.properties?.position_type, "observed");
  const forecast = result.features.find(
    (f) => f.geometry.type === "LineString",
  );
  assert.ok(forecast && forecast.geometry.type === "LineString");
  assert.deepEqual(forecast.geometry.coordinates, [
    [-179, 15],
    [-177, 15],
  ]);
});
test("dateline export uses short segments on both sides of 180 degrees", () => {
  assert.deepEqual(trackSegments(storm.track.slice(0, 2)), [
    [
      [179, 15],
      [180, 15],
    ],
    [
      [-180, 15],
      [-179, 15],
    ],
  ]);
  assert.deepEqual(trackSegments([point(-179, ""), point(179, "")]), [
    [
      [-179, 15],
      [-180, 15],
    ],
    [
      [180, 15],
      [179, 15],
    ],
  ]);
});
test("a single position exports as a point without an invalid one-point line", () => {
  assert.equal(
    trackGeoJSON({ ...storm, points: 1, track: storm.track.slice(0, 1) })
      .features.length,
    1,
  );
});
test("untrusted textual CSV cells cannot become spreadsheet formulas", () => {
  assert.ok(trackCSV({ ...storm, name: "=1+1" }).includes('"\'=1+1"'));
});
