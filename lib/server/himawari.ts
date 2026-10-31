/**
 * Live Himawari-9 full-disk Band 13 ("clean" 10.3-11.2 µm IR) imagery served by
 * CIRA's RAMMB SLIDER, re-rendered server-side into the equirectangular crop the
 * client overlays with `HIMAWARI_COORDINATES` (105-150°E, 0.25°S-29.25°N).
 *
 * Why server-side: SLIDER only ships per-tile geostationary fixed-grid PNGs; a
 * browser would need ~16 tile requests plus GPU-side reprojection per frame,
 * while MapLibre's image source wants one north-up equirectangular image per
 * 10-minute slot. This module therefore fetches the 16 tiles that cover the
 * crop at SLIDER's native full-disk zoom (level 3, ~2 km/px), stitches them,
 * reprojects every output pixel geostationary→equirectangular with bilinear
 * sampling, and encodes a single PNG per slot. Results are cached immutably.
 *
 * Geometry constants and both projection directions are transcribed from CIRA's
 * public client code (`/js/define-products---rammb-slider.js` and
 * `/js/rammb-slider.js`):
 * - `latLonToScanAngles` — lat/lon (geodetic) → satellite scan angles (radians).
 *   Kept verbatim, including CIRA's ellipsoid constants.
 * - The pixel mapping below is the exact inversion of the linear (scan-angle →
 *   big-pixel) half of CIRA's `bigPixels2LatLon`, which converts a click on the
 *   tile grid into scan angles: col grows west→east, row grows north→south, and
 *   the "±0.5 pixel corner artifact" they note near the image center is
 *   reproduced so the two code paths agree to sub-pixel precision.
 * - `bigPixelToLatLon` — verbatim quadratic ray-ellipsoid inverse; used for geo
 *   parity tests and as a compact one-line safety net in test roundtrips.
 *
 * Slot discovery consumes `/data/json/himawari/full_disk/band_13/latest_times.json`
 * (descending 14-digit `timestamps_int`, ~16 h retention, occasional gaps).
 * Every frame is immutable once published, so caches are PK'd on the stamp.
 *
 * Published timestamps drive the client manifest. Temporary upstream failures
 * throw so the route can distinguish service outages from unavailable slots.
 */
import { cachedGet } from "./cache";
import { readStoredFrame, storeFrame } from "./frame-store";

// --- CIRA SAT config (verbatim from define-products---rammb-slider.js) ---

const SLIDER_HOST = "https://slider.cira.colostate.edu";
const SAT_HIMAWARI = "himawari";
const SECTOR_FULL_DISK = "full_disk";
const PRODUCT_BAND_13 = "band_13";
const SUBSAT_LON_DEG = 140.69; // "lon0"
const SAT_ALT_KM = 42171.7; // "sat_alt" (already includes Earth radius)
const MAX_RAD_X = 0.150618; // scan angle (rad) at the disk edge in x
const MAX_RAD_Y = 0.150485; // ... in y
const DISK_RADIUS_X_Z0 = 337; // disk radius in pixels at zoom level 0
const DISK_RADIUS_Y_Z0 = 336;
const TILE_SIZE = 688;
const SAT_MAX_ZOOM_LEVEL = 5; // full_disk sector max zoom
// band_13 declares zoom_level_adjust 2 → product max zoom = 5 − 2 = 3 (2 km/px)
export const BAND13_ZOOM_LEVEL = SAT_MAX_ZOOM_LEVEL - 2;
const BAND13_DATA_FOLDER = `${SAT_HIMAWARI}---${SECTOR_FULL_DISK}/${PRODUCT_BAND_13}`;

// --- Render target (matches client HIMAWARI_COORDINATES crop at ~0.025°/px) ---

export const CROP_WEST_LON = 105;
export const CROP_EAST_LON = 150;
export const CROP_SOUTH_LAT = -0.25;
export const CROP_NORTH_LAT = 29.25;
const RENDER_PIXEL_DEG = 0.025;
export const RENDER_WIDTH = Math.round(
  (CROP_EAST_LON - CROP_WEST_LON) / RENDER_PIXEL_DEG,
);
export const RENDER_HEIGHT = Math.round(
  (CROP_NORTH_LAT - CROP_SOUTH_LAT) / RENDER_PIXEL_DEG,
);

// Bounds of the 16 BAND13_ZOOM_LEVEL tiles that contain the crop, expressed as
// [first, last] tile row/column indices (rows grow southward, cols eastward).
export const CROP_TILE_ROWS: [number, number] = [1, 4];
export const CROP_TILE_COLS: [number, number] = [1, 4];

// --- Cloud-alpha ramp ("cloud-only" rendering) ---
// CIRA's band-13 grayscale encodes temperature: clear ocean/land is warm
// (dark, the gray bulk ~64-100 of the frame), while cold cloud tops glow
// bright (~110-255, deep convection 200+). Rendering warm air at zero alpha
// keeps every map layer readable wherever the sky is clear, and only actual
// cloud blocks it. A smoothstep (not a hard cut) softens the cloud-edge
// halos bilinear sampling would otherwise reveal. Day/night need no special
// casing: band 13 is thermal emission, so the sea's brightness barely
// changes overnight.
//
// Cold cores, however, are NOT gray: CIRA's palette shades the coldest
// features in color (measured: red convective tops up to ~1.3% of a frame,
// plus cyan/teal cloud shading ~12% colored overall). Their plain luma can
// sit below the clear-air floor, which once erased the red storm cores. So
// alpha is a two-part rule grounded in the palette never colorizing clear
// sea (clear surface air is pure gray):
//   1. the gray ramp evaluated at max(r,g,b) — equal to the previous luma
//      ramp for neutral pixels;
//   2. a chroma boost (max-min channel spread) saturating at
//      CHROMA_FULL_ALPHA, so strongly colored cores (e.g. a (113,0,0)
//      crimson with luma 34) stay fully opaque while faint grays stay
//      transparent.

/** Gray brightness at/below which a pixel is clear surface air (alpha 0). */
export const CLOUD_ALPHA_MIN_BRIGHTNESS = 95;
/** Gray brightness at/above which cloud is rendered fully opaque (alpha 255). */
export const CLOUD_ALPHA_MAX_BRIGHTNESS = 165;
/** Chroma (max-min channel spread) that makes a colored feature fully opaque. */
export const CHROMA_FULL_ALPHA = 60;

/**
 * Per-gray-brightness alpha (0-255) shared by the renderer and the tests so
 * one tuning point drives both.
 */
export function cloudAlphaForBrightness(brightness: number): number {
  const b = Math.min(255, Math.max(0, Math.round(brightness)));
  const x = Math.min(
    1,
    Math.max(
      0,
      (b - CLOUD_ALPHA_MIN_BRIGHTNESS) /
        (CLOUD_ALPHA_MAX_BRIGHTNESS - CLOUD_ALPHA_MIN_BRIGHTNESS),
    ),
  );
  return Math.round(255 * x * x * (3 - 2 * x));
}

const CLOUD_ALPHA_LUT = Uint8Array.from({ length: 256 }, (_, b) =>
  cloudAlphaForBrightness(b),
);

/**
 * Cloud-only alpha for a blended RGB pixel: the gray CIRA ramp evaluated at
 * the brightest channel (equal to the previous luma ramp for neutral
 * pixels), lifted by chroma so the palette's shaded storm cores never fall
 * out the clear-air end of the ramp. Pure-grayscale pixels get exactly the
 * gray ramp (chroma 0 → no boost).
 */
export function cloudAlphaForChannels(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let alpha = CLOUD_ALPHA_LUT[mx];
  if (mx > mn) {
    const saturated = Math.round(
      Math.min(255, ((mx - mn) * 256) / CHROMA_FULL_ALPHA),
    );
    if (saturated > alpha) alpha = saturated;
  }
  return alpha;
}

// --- Verbatim CIRA forward projection (latLonToScanAngles → scan angles) ---
// https://www.star.nesdis.noaa.gov/atmospheric-composition-training/satellite_data_goes_imager_projection.php

const RAD = Math.PI / 180;
const R_EQ = 6378.137; // km
const R_POL = 6356.75231414; // km
const E2 = (R_EQ * R_EQ - R_POL * R_POL) / (R_EQ * R_EQ);
const SUBSAT_LON_RAD = SUBSAT_LON_DEG * RAD;

export function himawariLatLonToScanAngles(
  latDeg: number,
  lonDeg: number,
): [number, number] {
  const latRad = latDeg * RAD;
  const lonRad = lonDeg * RAD;

  const a = R_EQ;
  const b = R_POL;
  const H = SAT_ALT_KM;
  const e2 = E2;

  const n = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);

  // geocentric distance to surface point
  const r = Math.sqrt(
    (n * Math.cos(latRad)) ** 2 + (n * (1 - e2) * Math.sin(latRad)) ** 2,
  );
  // geocentric latitude
  const phiC = Math.atan2(
    n * (1 - e2) * Math.sin(latRad),
    n * Math.cos(latRad),
  );

  // In the inverse convention, s_x is distance from satellite, not Earth center
  // so we need the vector FROM satellite TO point:
  const vecX = r * Math.cos(phiC) * Math.cos(lonRad - SUBSAT_LON_RAD) - H;
  const vecY = -r * Math.cos(phiC) * Math.sin(lonRad - SUBSAT_LON_RAD);
  const vecZ = r * Math.sin(phiC);
  const rS = Math.sqrt(vecX ** 2 + vecY ** 2 + vecZ ** 2);

  return [Math.asin(-vecY / rS), Math.atan2(vecZ, -vecX)];
}

/**
 * CIRA's `bigPixels2LatLon` linear part, inverted: scan angles (radians, x
 * eastward, y northward) → pixel coordinates in the full-size level-`zoom`
 * disk image (their "big pixel" space divided down by zoom). Returns the tile
 * image coordinate whose integer-pixel centers sit at k + 0.5 (CIRA convention).
 */
export function himawariScanAnglesToImagePixel(
  zoom: number,
  xRad: number,
  yRad: number,
): { row: number; col: number } {
  const scale = 2 ** zoom;
  const half = (TILE_SIZE / 2) * scale;
  // CIRA's "-0.5 is an artifact because we have an even number of pixels" note
  // (bigPixels2LatLon), divided down from their max-zoom coordinate space.
  const edgeArtifact = 0.5 / 2 ** (SAT_MAX_ZOOM_LEVEL - zoom);
  return {
    col: (xRad / MAX_RAD_X) * DISK_RADIUS_X_Z0 * scale + half + edgeArtifact,
    row: half - (yRad / MAX_RAD_Y) * DISK_RADIUS_Y_Z0 * scale + edgeArtifact,
  };
}

/**
 * CIRA `bigPixels2LatLon` verbatim (their click→lat/lon quadratic inverse),
 * exposed so tests can roundtrip forward+pixel mappings against CIRA's own
 * ground truth.
 */
export function himawariImagePixelToLatLon(
  zoom: number,
  rowPx: number,
  colPx: number,
): { lat: number; lon: number } {
  const bigPx = 2 ** (SAT_MAX_ZOOM_LEVEL - zoom);
  const pageX = colPx * bigPx;
  const pageY = rowPx * bigPx;

  const rEq = 6378.1;
  const rPo = 6356.8;
  const centeringOffsetX = DISK_RADIUS_X_Z0 * 2 ** SAT_MAX_ZOOM_LEVEL;
  const centeringOffsetY = DISK_RADIUS_Y_Z0 * 2 ** SAT_MAX_ZOOM_LEVEL;
  const imgDiffX = (TILE_SIZE / 2 - DISK_RADIUS_X_Z0) * 2 ** SAT_MAX_ZOOM_LEVEL;
  const imgDiffY = (TILE_SIZE / 2 - DISK_RADIUS_Y_Z0) * 2 ** SAT_MAX_ZOOM_LEVEL;

  const xRad =
    ((pageX - imgDiffX - centeringOffsetX - 0.5) / centeringOffsetX) *
    MAX_RAD_X;
  const yRad =
    -1 *
    ((pageY - imgDiffY - centeringOffsetY - 0.5) / centeringOffsetY) *
    MAX_RAD_Y;

  const a =
    Math.sin(xRad) ** 2 +
    Math.cos(xRad) ** 2 *
      (Math.cos(yRad) ** 2 + ((rEq / rPo) * Math.sin(yRad)) ** 2);
  const b = -2 * SAT_ALT_KM * Math.cos(xRad) * Math.cos(yRad);
  const c = SAT_ALT_KM ** 2 - rEq ** 2; // quadratic; "a", "b", "c" per CIRA

  // The negative root of the quadratic equation
  const rz = (-b - (b ** 2 - 4 * a * c) ** 0.5) / (2 * a);

  const sx = rz * Math.cos(xRad) * Math.cos(yRad);
  const sy = rz * Math.sin(xRad);
  const sz = rz * Math.cos(xRad) * Math.sin(yRad);

  const lat =
    Math.atan(
      ((rEq / rPo) ** 2 * sz) / Math.sqrt((SAT_ALT_KM - sx) ** 2 + sy ** 2),
    ) *
    (180 / Math.PI);
  const lon =
    SUBSAT_LON_DEG + Math.atan(sy / (SAT_ALT_KM - sx)) * (180 / Math.PI);
  return { lat, lon: lon < -180 ? lon + 360 : lon > 180 ? lon - 360 : lon };
}

// --- SLIDER URL builders ---

export function latestTimesURL(): string {
  return `${SLIDER_HOST}/data/json/${SAT_HIMAWARI}/${SECTOR_FULL_DISK}/${PRODUCT_BAND_13}/latest_times.json`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Tile URL exactly as CIRA serves it, e.g. /data/imagery/2026/10/23/himawari---full_disk/band_13
 *  /20261023004000/03/005_002.png (folder `<zoom 2-digit>/<row>_<col>`, 3-digit). */
export function sliderTileURL(stamp: number, row: number, col: number): string {
  const d = String(stamp);
  const date = `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
  const name = `${pad(row, 3)}_${pad(col, 3)}`;
  return `${SLIDER_HOST}/data/imagery/${date}/${BAND13_DATA_FOLDER}/${d}/${pad(BAND13_ZOOM_LEVEL, 2)}/${name}.png`;
}

// --- Slot (10-minute scan) resolution ---

const DAY_MS = 24 * 60 * 60 * 1000;
const STAMP_MATCH = /^\d{12,14}$/;

/** 14-digit SLIDER stamp (YYYYMMDDHHMMSS) → UTC epoch milliseconds. */
export function stampEpochMs(stamp: number): number {
  const d = String(stamp);
  return Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(d.slice(8, 10)),
    Number(d.slice(10, 12)),
    Number(d.slice(12, 14) || 0),
  );
}

/**
 * Pick the available stamp for a `time` booking as "HHMM" in UTC. The window
 * anchors to the *most recent* occurrence of HHMM relative to `now` (so a
 * request just after UTC midnight pins to yesterday). Gaps that CIRA lists
 * (or everything, when latest_times is unavailable) resolve to null.
 */
export function resolveSlotStamp(
  stamps: number[],
  slotHHMM: string,
  now: Date = new Date(),
): number | null {
  const hh = Number(slotHHMM.slice(0, 2));
  const mm = Number(slotHHMM.slice(2));
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59)
    return null;

  let slot = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hh,
    mm,
  );
  if (slot > now.getTime()) slot -= DAY_MS;

  let best: number | null = null;
  let bestDelta = Infinity;
  for (const stamp of stamps) {
    if (!STAMP_MATCH.test(String(stamp))) continue;
    if (Number(String(stamp).slice(8, 10)) !== hh) continue;
    if (Number(String(stamp).slice(10, 12)) !== mm) continue;
    const delta = Math.abs(stampEpochMs(stamp) - slot);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = stamp;
    }
  }
  return best;
}

// --- Upstream fetches (shared caches; all failures are non-throwing for callers) ---

const FETCH_TIMEOUT_MS = 8_000;
const TILE_TIMEOUT_MS = 30_000;
const TILE_FETCH_RETRIES = 2; // transient SLIDER slowdowns are common
const LATEST_TIMES_TTL_MS = 60_000; // SLIDER publishes roughly every 10 min
const TILE_TTL_MS = 15 * 60_000; // published tiles are immutable
const FRAME_TTL_MS = 30 * 60_000; // rendered frames are immutable per stamp
// Hard ceiling for one cold frame render. Above this the caller gets null and
// the proxy answers 503; the underlying render keeps warming the cache.
const FRAME_DEADLINE_MS = 45_000;
// Cap concurrent upstream imagery fetches so one burst of client batches
// cannot open hundreds of sockets against CIRA. SLIDER empirically throttles
// bursts (~5s for 12 parallel tiles), so a modest ceiling reads best.
const MAX_CONCURRENT_TILE_FETCHES = 8;
/** Tiny FIFO gate around upstream image fetches (limit shared module-wide). */
let inFlightFetches = 0;
const gateWaiters: Array<() => void> = [];

async function withFetchGate<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlightFetches >= MAX_CONCURRENT_TILE_FETCHES) {
    await new Promise<void>((resolve) => gateWaiters.push(resolve));
  } else {
    inFlightFetches++;
  }
  try {
    return await fn();
  } finally {
    const next = gateWaiters.shift();
    if (next)
      next(); // Hand the occupied slot directly to the next waiter.
    else inFlightFetches--;
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Set HIMAWARI_DEBUG=1 in the environment to trace fetch/render failures.
const DEBUG = !!process.env.HIMAWARI_DEBUG;
function debugLog(message: string): void {
  if (DEBUG) console.error("[himawari-slider] " + message);
}

export const MAX_FRAME_AGE_MS = 2 * 60 * 60_000;

/** Reject corrupt dates, future scans and imagery older than two hours. */
export function selectAvailableStamps(
  stamps: unknown[],
  now = Date.now(),
): number[] {
  return [
    ...new Set(
      stamps.filter((stamp): stamp is number => {
        if (typeof stamp !== "number" || !/^\d{14}$/.test(String(stamp)))
          return false;
        const epoch = stampEpochMs(stamp);
        if (
          !Number.isFinite(epoch) ||
          epoch > now ||
          now - epoch > MAX_FRAME_AGE_MS
        )
          return false;
        return (
          new Date(epoch).toISOString().replace(/\D/g, "").slice(0, 14) ===
          String(stamp)
        );
      }),
    ),
  ].sort((a, b) => b - a);
}

let lastPublishedStamps: number[] = [];

async function loadLatestTimes(): Promise<number[]> {
  try {
    return await cachedGet(
      "himawari-slider:latest-times",
      LATEST_TIMES_TTL_MS,
      async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(latestTimesURL(), {
              cache: "no-store",
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!res.ok)
              throw new Error(`SLIDER metadata returned ${res.status}`);
            const body = (await res.json()) as { timestamps_int?: unknown };
            if (!Array.isArray(body.timestamps_int))
              throw new Error("Invalid SLIDER metadata");
            const stamps = selectAvailableStamps(body.timestamps_int);
            if (!stamps.length)
              throw new Error("No recent published SLIDER scans");
            lastPublishedStamps = stamps;
            return stamps;
          } catch (error) {
            lastError = error;
            if (attempt === 0)
              await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
        // Do not cache an outage as an empty list for the whole success TTL.
        throw lastError;
      },
    );
  } catch (error) {
    const usable = selectAvailableStamps(lastPublishedStamps);
    if (usable.length) return usable;
    throw error;
  }
}

/** Newest published candidates, independent of the browser clock. */
export async function getHimawariAvailableStamps(): Promise<number[]> {
  return selectAvailableStamps(await loadLatestTimes()).slice(0, 8);
}

async function fetchTile(
  stamp: number,
  row: number,
  col: number,
): Promise<Buffer> {
  return cachedGet(
    `himawari-slider:tile:${stamp}:${row}:${col}`,
    TILE_TTL_MS,
    () =>
      withFetchGate(async () => {
        let lastError: unknown = new Error(
          `SLIDER tile fetch never ran (row ${row} col ${col})`,
        );
        for (let attempt = 1; attempt <= TILE_FETCH_RETRIES; attempt++) {
          try {
            const res = await fetch(sliderTileURL(stamp, row, col), {
              // Fetch directly from CIRA's canonical host.
              signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
            });
            if (!res.ok)
              throw new Error(
                `SLIDER tile ${res.status} for row ${row} col ${col}`,
              );
            const buf = Buffer.from(await res.arrayBuffer());
            if (
              buf.length < 8 ||
              !PNG_SIGNATURE.every((byte, i) => buf[i] === byte)
            ) {
              throw new Error(
                `SLIDER tile for row ${row} col ${col} is not a PNG`,
              );
            }
            return buf;
          } catch (error) {
            lastError = error;
            // Spaced retries give a throttled upstream room to breathe.
            if (attempt < TILE_FETCH_RETRIES)
              await new Promise((resolve) =>
                setTimeout(resolve, 300 * attempt),
              );
          }
        }
        debugLog(
          `tile ${stamp} r${row}c${col} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
        );
        throw lastError;
      }),
  );
}

// --- Stitching + reprojection ---

export type StitchedCrop = {
  /** Raw RGBA pixel data of the stitched crop window (RGB tiles turned opaque). */
  data: Buffer;
  /** z3 image-space pixel at data's top-left corner. */
  originCol: number;
  originRow: number;
  width: number;
  height: number;
};

async function fetchStitchedCrop(stamp: number): Promise<Buffer> {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;
  const rows = CROP_TILE_ROWS[1] - CROP_TILE_ROWS[0] + 1;
  const cols = CROP_TILE_COLS[1] - CROP_TILE_COLS[0] + 1;
  const canvasWidth = cols * TILE_SIZE;
  const canvasHeight = rows * TILE_SIZE;
  const canvas = Buffer.allocUnsafe(canvasWidth * canvasHeight * 4);

  // Fetch with a bounded pool; any single tile failure voids the frame (the
  // route then answers 503) because a geo-registered crop must be seamless.
  const tiles = await Promise.all(
    Array.from({ length: rows * cols }, async (_, index) => {
      const tileRow = CROP_TILE_ROWS[0] + Math.floor(index / cols);
      const tileCol = CROP_TILE_COLS[0] + (index % cols);
      return {
        tileRow,
        tileCol,
        buffer: await fetchTile(stamp, tileRow, tileCol),
      };
    }),
  );

  for (const { tileRow, tileCol, buffer } of tiles) {
    const tileData = await sharp(buffer).ensureAlpha().raw().toBuffer();
    const destY = (tileRow - CROP_TILE_ROWS[0]) * TILE_SIZE;
    const destX = (tileCol - CROP_TILE_COLS[0]) * TILE_SIZE;
    for (let y = 0; y < TILE_SIZE; y++) {
      const srcOffset = y * TILE_SIZE * 4;
      const destOffset = ((destY + y) * canvasWidth + destX) * 4;
      tileData.copy(canvas, destOffset, srcOffset, srcOffset + TILE_SIZE * 4);
    }
  }
  return canvas;
}

/**
 * Reproject the stitched fixed-grid crop into the client's north-up
 * equirectangular output grid and return raw RGBA bytes of size
 * RENDER_WIDTH × RENDER_HEIGHT (top row = north), ready for sharp PNG encode.
 *
 * Output pixel (i, j) centers on lon = WEST + (i+0.5)·stepLon and
 * lat = NORTH − (j+0.5)·stepLat, eliminating the geostationary radial
 * distortion that would otherwise shrink the southern tropics.
 */
// Projection geometry never changes between scans. Keep double-precision
// source coordinates (~32 MiB per process) so every later frame only samples
// pixels; the original bilinear interpolation and cloud alpha stay identical.
let sourceCoordinates: Float64Array | undefined;
function getSourceCoordinates(): Float64Array {
  if (sourceCoordinates) return sourceCoordinates;
  const coordinates = new Float64Array(RENDER_WIDTH * RENDER_HEIGHT * 2);

  const stepLon = (CROP_EAST_LON - CROP_WEST_LON) / RENDER_WIDTH;
  const stepLat = (CROP_NORTH_LAT - CROP_SOUTH_LAT) / RENDER_HEIGHT;

  // Per-column trig of the longitude offset from the sub-satellite meridian.
  const cosLonOffset: number[] = [];
  const sinLonOffset: number[] = [];
  for (let i = 0; i < RENDER_WIDTH; i++) {
    const lonOffset =
      (CROP_WEST_LON + (i + 0.5) * stepLon) * RAD - SUBSAT_LON_RAD;
    cosLonOffset.push(Math.cos(lonOffset));
    sinLonOffset.push(Math.sin(lonOffset));
  }

  for (let j = 0; j < RENDER_HEIGHT; j++) {
    const latDeg = CROP_NORTH_LAT - (j + 0.5) * stepLat;
    const latRad = latDeg * RAD;
    const n = R_EQ / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
    const r = Math.sqrt(
      (n * Math.cos(latRad)) ** 2 + (n * (1 - E2) * Math.sin(latRad)) ** 2,
    );
    const phiC = Math.atan2(
      n * (1 - E2) * Math.sin(latRad),
      n * Math.cos(latRad),
    );
    const horizontal = r * Math.cos(phiC); // |vec_xy| term for this row
    const vecZ = r * Math.sin(phiC); // ground point's z component

    for (let i = 0; i < RENDER_WIDTH; i++) {
      const vecX = horizontal * cosLonOffset[i] - SAT_ALT_KM;
      const vecY = -horizontal * sinLonOffset[i];
      const rS = Math.sqrt(vecX * vecX + vecY * vecY + vecZ * vecZ);
      const xRad = Math.asin(-vecY / rS);
      const yRad = Math.atan2(vecZ, -vecX);

      const pix = himawariScanAnglesToImagePixel(BAND13_ZOOM_LEVEL, xRad, yRad);
      const offset = (j * RENDER_WIDTH + i) * 2;
      coordinates[offset] = pix.col - 0.5;
      coordinates[offset + 1] = pix.row - 0.5;
    }
  }
  sourceCoordinates = coordinates;
  return coordinates;
}

export function reprojectCropToEquirectangular(cropped: StitchedCrop): Buffer {
  const { data, originRow, originCol } = cropped;
  const canvasWidth = cropped.width;
  const canvasHeight = cropped.height;
  const output = Buffer.allocUnsafe(RENDER_WIDTH * RENDER_HEIGHT * 4);
  const coordinates = getSourceCoordinates();
  for (let j = 0; j < RENDER_HEIGHT; j++) {
    const rowDestOffset = j * RENDER_WIDTH * 4;
    for (let i = 0; i < RENDER_WIDTH; i++) {
      const offset = (j * RENDER_WIDTH + i) * 2;
      let u = coordinates[offset] - originCol;
      let v = coordinates[offset + 1] - originRow;
      if (u < 0) u = 0;
      if (v < 0) v = 0;
      if (u > canvasWidth - 1) u = canvasWidth - 1;
      if (v > canvasHeight - 1) v = canvasHeight - 1;

      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const x1 = x0 < canvasWidth - 1 ? x0 + 1 : x0;
      const y1 = y0 < canvasHeight - 1 ? y0 + 1 : y0;
      const wx = u - x0;
      const wy = v - y0;

      const p00 = (y0 * canvasWidth + x0) * 4;
      const p10 = (y0 * canvasWidth + x1) * 4;
      const p01 = (y1 * canvasWidth + x0) * 4;
      const p11 = (y1 * canvasWidth + x1) * 4;
      const destOffset = rowDestOffset + i * 4;
      for (let ch = 0; ch < 4; ch++) {
        output[destOffset + ch] = Math.round(
          data[p00 + ch] * (1 - wx) * (1 - wy) +
            data[p10 + ch] * wx * (1 - wy) +
            data[p01 + ch] * (1 - wx) * wy +
            data[p11 + ch] * wx * wy,
        );
      }
      // Cloud-only alpha (one table lookup + chroma guard; see the
      // CLOUD_ALPHA_* block above).
      output[destOffset + 3] = cloudAlphaForChannels(
        output[destOffset],
        output[destOffset + 1],
        output[destOffset + 2],
      );
    }
  }
  return output;
}

// --- Public entry point ---

export type HimawariSliderFrame = {
  /** Encoded PNG of the regridded crop. */
  png: Buffer;
  /** 14-digit SLIDER stamp the imagery belongs to (YYYYMMDDHHMMSS, UTC). */
  stamp: number;
  /** RFC 7231 date string for the stamp; the proxy echoes it as Last-Modified. */
  lastModified: string;
  timings: Record<string, number>;
};

/** Shared render core, memoized per immutable stamp.
 *  Bounded by a hard deadline so a pathological upstream stall can never tie
 *  the route up for minutes. */
function renderFrameStampCached(stamp: number): Promise<HimawariSliderFrame> {
  const render = async (): Promise<HimawariSliderFrame> => {
    const started = performance.now();
    const stored = await readStoredFrame(stamp);
    if (stored)
      return {
        png: stored,
        stamp,
        lastModified: new Date(stampEpochMs(stamp)).toUTCString(),
        timings: { cacheRead: Math.round(performance.now() - started) },
      };
    const cropData = await fetchStitchedCrop(stamp);
    const stitched = performance.now();
    const rows = CROP_TILE_ROWS[1] - CROP_TILE_ROWS[0] + 1;
    const cols = CROP_TILE_COLS[1] - CROP_TILE_COLS[0] + 1;
    const equirect = reprojectCropToEquirectangular({
      data: cropData,
      originCol: CROP_TILE_COLS[0] * TILE_SIZE,
      originRow: CROP_TILE_ROWS[0] * TILE_SIZE,
      width: cols * TILE_SIZE,
      height: rows * TILE_SIZE,
    });
    const projected = performance.now();
    const sharpModule = await import("sharp");
    const png = await sharpModule
      .default(equirect, {
        raw: { width: RENDER_WIDTH, height: RENDER_HEIGHT, channels: 4 },
      })
      // Palette-quantized: the tiles arrive through CIRA's discrete color table,
      // so 256 entries are visually lossless while roughly halving the PNG
      // bytes the client must pull for every 10-minute frame.
      .png({ palette: true, effort: 1, compressionLevel: 3 })
      .toBuffer();
    await storeFrame(stamp, png);
    return {
      png,
      stamp,
      lastModified: new Date(stampEpochMs(stamp)).toUTCString(),
      timings: {
        tiles: Math.round(stitched - started),
        projection: Math.round(projected - stitched),
        encoding: Math.round(performance.now() - projected),
      },
    };
  };
  // Cache the underlying work, not the request deadline. If a slow render
  // outlives its caller, it still warms the cache for the automatic retry.
  const pending = cachedGet(
    `himawari-slider:frame:${stamp}`,
    FRAME_TTL_MS,
    render,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`SLIDER frame ${stamp} exceeded ${FRAME_DEADLINE_MS}ms`),
        ),
      FRAME_DEADLINE_MS,
    );
  });
  return Promise.race([pending, deadline]).finally(() => clearTimeout(timer));
}

/** Full stamps identify immutable frames; HHMM remains supported for older clients. */
export async function getHimawariSliderPng(
  time: string,
): Promise<HimawariSliderFrame | null> {
  let stamp: number | null;
  if (/^\d{14}$/.test(time)) {
    // A manifest-issued URL keeps working through a later metadata outage.
    stamp = selectAvailableStamps([Number(time)])[0] ?? null;
  } else if (/^([01]\d|2[0-3])[0-5]\d$/.test(time)) {
    stamp = resolveSlotStamp(await loadLatestTimes(), time);
  } else {
    return null;
  }
  if (stamp == null) return null;
  return renderFrameStampCached(stamp);
}
