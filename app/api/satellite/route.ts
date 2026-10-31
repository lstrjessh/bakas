import { NextResponse } from "next/server";
import {
  getHimawariAvailableStamps,
  getHimawariSliderPng,
} from "@/lib/server/himawari";

export const runtime = "nodejs";
export const maxDuration = 60;

const unavailable = () =>
  NextResponse.json(
    { error: "satellite imagery temporarily unavailable" },
    {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    },
  );

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("manifest") === "1") {
    try {
      const frames = await getHimawariAvailableStamps();
      if (!frames.length) return unavailable();
      return NextResponse.json(
        { frames: frames.map(String) },
        {
          headers: { "Cache-Control": "public, max-age=0, s-maxage=30" },
        },
      );
    } catch {
      return unavailable();
    }
  }

  const time = searchParams.get("time");
  if (!time || !/^(?:([01]\d|2[0-3])[0-5]\d|\d{14})$/.test(time)) {
    return NextResponse.json(
      { error: "time (UTC stamp or HHMM) required" },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  try {
    const started = performance.now();
    const frame = await getHimawariSliderPng(time);
    if (!frame) {
      return NextResponse.json(
        { error: "satellite frame not published" },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    return new NextResponse(new Uint8Array(frame.png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(frame.png.byteLength),
        "Last-Modified": frame.lastModified,
        "Server-Timing": `frame;dur=${Math.round(performance.now() - started)}`,
        "Cache-Control":
          time.length === 14
            ? "public, max-age=86400, s-maxage=86400, immutable"
            : "public, max-age=540, s-maxage=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return unavailable();
  }
}
