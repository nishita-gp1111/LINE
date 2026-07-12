import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env/server";
import { validateTrackingDestination } from "@/lib/milestone3/tracking";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const env = getServerEnv();
  if (!env.LINE_TRACKING_ENABLED) return NextResponse.json({ error: "tracking_disabled" }, { status: 404 });
  const { slug } = await context.params;
  // Persistent link lookup and click insert are intentionally server-owned. The route never
  // accepts a destination URL from the browser and does not put LINE user IDs in a URL.
  if (!slug || slug.length > 100) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try { validateTrackingDestination("https://placeholder.invalid"); } catch { return NextResponse.json({ error: "not_found" }, { status: 404 }); }
  return NextResponse.json({ error: "tracked_link_not_configured", slug }, { status: 404 });
}
