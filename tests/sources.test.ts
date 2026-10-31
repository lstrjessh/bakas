import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCyclones } from "../lib/server/cyclones";
import { unwrapTrack } from "../lib/tracks";
import { cachedGet } from "../lib/server/cache";
import {
  himawariLatLonToScanAngles,
  himawariScanAnglesToImagePixel,
  himawariImagePixelToLatLon,
  selectAvailableStamps,
} from "../lib/server/himawari";

const now = Date.parse("2026-10-30T08:00:00Z");
const sample = [
  {
    cyclone_name: "BAGYONG TEST {INTERNATIONAL}",
    info: {
      "1": {
        date: "2026-10-30",
        time: "11:00",
        latitude: "15.2",
        longitude: "130.1",
        windspeed: "120",
        pressure: "960",
        radius: 0,
      },
      "2": {
        date: "2026-10-30",
        time: "14:00",
        latitude: 16,
        longitude: 129,
        windspeed: 130,
        radius: 0,
      },
      "3": {
        date: "2026-10-30",
        time: "20:00",
        latitude: 17,
        longitude: 128,
        windspeed: 140,
        radius: 50,
      },
    },
  },
];
test("Panahon retains observed and forecast positions, converts PHT and wind units", () => {
  const [storm] = parseCyclones(sample, now);
  assert.equal(storm.name, "TEST (INTERNATIONAL)");
  assert.equal(storm.track.length, 3);
  assert.equal(storm.track[0].time, "2026-10-30T03:00:00.000Z");
  assert.equal(storm.track[0].wind! * 1.852, 120);
  assert.equal(storm.track[0].forecast, false);
  assert.equal(storm.track[2].forecast, true);
  assert.equal(storm.track[1].pressure, null);
});
test("stale data does not become an active storm; malformed feed fails visibly", () => {
  assert.equal(parseCyclones(sample, now + 7 * 86400_000).length, 0);
  assert.throws(() => parseCyclones({ error: "blocked" }, now));
  assert.equal(parseCyclones([], now).length, 0);
});
test("dateline crossings stay local", () => {
  const points = [179, -179, -175].map((lon) => ({
    lon,
    lat: 20,
    time: "",
    wind: null,
    pressure: null,
    agency: "tokyo",
    averagingMinutes: 10,
  }));
  assert.deepEqual(unwrapTrack(points), [
    [179, 20],
    [181, 20],
    [185, 20],
  ]);
});
test("concurrent satellite callers share a successful cached request", async () => {
  let calls = 0;
  const load = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return "frame";
  };
  assert.deepEqual(
    await Promise.all([
      cachedGet("test-frame", 1000, load),
      cachedGet("test-frame", 1000, load),
    ]),
    ["frame", "frame"],
  );
  assert.equal(calls, 1);
});
test("cache does not preserve a failed upstream request", async () => {
  await assert.rejects(
    cachedGet("test-failure", 1000, async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(
    await cachedGet("test-failure", 1000, async () => "recovered"),
    "recovered",
  );
});
test("Himawari rejects future, stale and invalid scans", () => {
  const time = Date.parse("2026-10-30T08:00:00Z");
  assert.deepEqual(
    selectAvailableStamps(
      [20261030075000, 20261030075000, 20261030081000, 20261029000000, 123],
      time,
    ),
    [20261030075000],
  );
});
test("Himawari projection round-trips the Philippines", () => {
  const [x, y] = himawariLatLonToScanAngles(14.6, 121);
  const pixel = himawariScanAnglesToImagePixel(3, x, y);
  const ll = himawariImagePixelToLatLon(3, pixel.row, pixel.col);
  assert.ok(ll);
  assert.ok(Math.abs(ll!.lat - 14.6) < 0.05);
  assert.ok(Math.abs(ll!.lon - 121) < 0.05);
});
