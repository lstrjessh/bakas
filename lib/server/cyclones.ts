import { createHmac, randomBytes } from "node:crypto";
import { cachedGet } from "./cache";
import type { LiveResponse, Storm, TrackPoint } from "../types";

type Node = Record<string, unknown>;
function record(value: unknown): value is Node {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function numeric(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function nodeTime(key: string, node: Node): string | null {
  const date = String(node.date || key.split(" ")[0]);
  const time = String(node.time || key.split(" ")[1] || "00:00");
  const raw = `${date}T${time.length === 5 ? time + ":00" : time}+08:00`;
  const epoch = Date.parse(raw);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

/** Port of GAKIT's Panahon parser: zero radius marks observed nodes. */
export function parseCyclones(payload: unknown, now = Date.now()): Storm[] {
  if (!Array.isArray(payload))
    throw new Error("Unexpected cyclone feed format");
  return payload.flatMap((item): Storm[] => {
    if (!record(item) || !record(item.info)) return [];
    const name = String(item.cyclone_name || "Unnamed")
      .replace(/^bagyong\s+/i, "")
      .replace(/\{([^}]+)\}/g, "($1)")
      .trim();
    const track: TrackPoint[] = Object.entries(item.info)
      .flatMap(([key, value]) => {
        if (!record(value)) return [];
        const lat = numeric(value.latitude),
          lon = numeric(value.longitude),
          time = nodeTime(key, value);
        if (
          lat === null ||
          lon === null ||
          !time ||
          Math.abs(lat) > 90 ||
          Math.abs(lon) > 180 ||
          (lat === 0 && lon === 0)
        )
          return [];
        const windKmh = numeric(value.windspeed);
        const pressure = numeric(value.pressure);
        return [
          {
            time,
            lat,
            lon,
            wind: windKmh === null || windKmh < 0 ? null : windKmh / 1.852,
            pressure: pressure !== null && pressure > 0 ? pressure : null,
            agency: "PAGASA",
            averagingMinutes: 10,
            forecast: (numeric(value.radius) || 0) > 0,
            category: String(value.cyclone_type || ""),
          },
        ];
      })
      .sort((a, b) => a.time.localeCompare(b.time));
    const observed = track.filter((p) => !p.forecast);
    const latest = observed.at(-1);
    if (
      !track.length ||
      !latest ||
      now - Date.parse(latest.time) > 36 * 3600_000 ||
      Date.parse(latest.time) > now + 3600_000 ||
      now - Date.parse(track.at(-1)!.time) > 25 * 3600_000
    )
      return [];
    const id = `live-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-$/, "")}`;
    const winds = observed.flatMap((p) => (p.wind === null ? [] : [p.wind]));
    return [
      {
        id,
        name,
        year: Number(track[0].time.slice(0, 4)),
        start: track[0].time,
        end: track.at(-1)!.time,
        peakWind: winds.length ? Math.max(...winds) : null,
        points: track.length,
        source: "DOST-PAGASA Panahon",
        sourceUrl: "https://www.panahon.gov.ph/",
        provisional: true,
        track,
      },
    ];
  });
}

export async function fetchLive(): Promise<LiveResponse> {
  return cachedGet("cyclones", 5 * 60_000, async () => {
    const origin = "https://www.panahon.gov.ph";
    const home = await fetch(origin, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!home.ok) throw new Error(`Panahon homepage returned ${home.status}`);
    const html = await home.text();
    const meta = (name: string) =>
      html.match(
        new RegExp(
          `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
          "i",
        ),
      )?.[1];
    const csrf = meta("csrf-token"),
      key = meta("(?:api-sig|api-sig-handle)");
    if (!csrf) throw new Error("Panahon session could not be established");
    const path = "api/v1/cyclone-track";
    const headers: Record<string, string> = {
      Accept: "application/json",
      Referer: origin + "/",
      "X-Requested-With": "XMLHttpRequest",
    };
    const cookies = home.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    if (cookies) headers.Cookie = cookies;
    if (key) {
      const ts = String(Math.floor(Date.now() / 1000)),
        nonce = randomBytes(16).toString("hex");
      headers["X-Ts"] = ts;
      headers["X-Nonce"] = nonce;
      headers["X-Sig"] = createHmac("sha256", key)
        .update(`GET\n${path}\n${ts}\n${nonce}`)
        .digest("hex");
    }
    const response = await fetch(
      `${origin}/${path}?token=${encodeURIComponent(csrf)}`,
      { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok)
      throw new Error(`Panahon cyclone feed returned ${response.status}`);
    const storms = parseCyclones(await response.json());
    return {
      fetched: new Date().toISOString(),
      source: "DOST-PAGASA Panahon",
      storms,
    };
  });
}
