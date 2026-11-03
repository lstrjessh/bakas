import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACK_CATEGORIES, trackCategory, trackColor, trackPointStyle } from "../lib/track-style";

test("reported PAGASA categories select their matching icon and colour", () => {
  for (const [category, { color }] of Object.entries(TRACK_CATEGORIES)) {
    assert.equal(trackCategory(category), category);
    assert.equal(trackColor(category), color);
  }
});

test("upstream category names and agency aliases normalize consistently", () => {
  assert.equal(trackCategory(" super typhoon "), "STY");
  assert.equal(trackCategory("Severe Tropical Storm"), "STS");
  assert.equal(trackCategory("Tropical Depression"), "TD");
  assert.equal(trackCategory("LOW"), "LPA");
});

test("missing and unsupported classifications remain neutral", () => {
  for (const category of [undefined, "", "UNKNOWN", "Category 5", "constructor"]) {
    assert.equal(trackCategory(category), null);
    assert.equal(trackColor(category), "#64748b");
  }
});

test("10-minute archive winds use the modern band at each boundary", () => {
  for (const [kmh, expected] of [[39, "TD"], [61, "TD"], [62, "TS"], [88, "TS"], [89, "STS"], [117, "STS"], [118, "TY"], [184, "TY"], [185, "STY"]] as const) {
    assert.equal(trackCategory(undefined, kmh / 1.852, 10), expected);
    assert.equal(trackColor(undefined, kmh / 1.852, 10), TRACK_CATEGORIES[expected].color);
  }
});

test("reported categories take precedence and absent wind is never invented", () => {
  assert.equal(trackCategory("TD", 150, 1), "TD");
  for (const wind of [undefined, null, NaN, Infinity, -1, 0]) {
    assert.equal(trackCategory(undefined, wind, 10), null);
    assert.equal(trackColor(undefined, wind, 10), "#64748b");
  }
});

test("1-, 2-, 3-minute and unknown averaging periods never produce derived icons", () => {
  for (const averagingMinutes of [1, 2, 3, null, undefined]) {
    assert.equal(trackCategory(undefined, 125, averagingMinutes), null);
    assert.equal(trackColor(undefined, 125, averagingMinutes), "#64748b");
    const style = trackPointStyle({ wind: 125, averagingMinutes: averagingMinutes ?? null });
    assert.equal(style.category, "");
    assert.equal(style.classified, false);
    assert.equal(style.derived, false);
  }
});

test("derived styles are marked and explicit classifications retain their provenance", () => {
  const derived = trackPointStyle({ wind: 125, averagingMinutes: 10 });
  assert.equal(derived.categoryLabel, "STY*");
  assert.equal(derived.derived, true);
  assert.equal(derived.classified, true);
  const reported = trackPointStyle({ category: "TY", wind: 125, averagingMinutes: 10 });
  assert.equal(reported.categoryLabel, "TY");
  assert.equal(reported.derived, false);
});

test("non-tropical or unrecognized reported types are not relabelled by wind", () => {
  for (const category of ["EX", "SUBTROPICAL", "UNKNOWN", "PTC"]) {
    assert.equal(trackCategory(category, 125, 10), null);
  }
});
