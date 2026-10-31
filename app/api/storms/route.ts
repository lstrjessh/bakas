import { fetchLive } from "@/lib/server/cyclones";
export const runtime = "nodejs";
export async function GET() {
  try {
    return Response.json(await fetchLive(), {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=120" },
    });
  } catch (error) {
    console.error(
      "Cyclone source unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      {
        error:
          "Current advisories are unavailable. Archived tracks are still accessible.",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "60" },
      },
    );
  }
}
