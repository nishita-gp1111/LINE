import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env/server";
import { resolveTrackedLink, recordTrackedClick } from "@/lib/milestone3/tracking-store";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const env = getServerEnv();
  if (!env.LINE_TRACKING_ENABLED) return NextResponse.json({ error: "tracking_disabled" }, { status: 404 });
  const { slug } = await context.params;
  if (!slug || slug.length > 100) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const link = await resolveTrackedLink(slug);
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    await recordTrackedClick({ link, token: new URL(request.url).searchParams.get("t") });
  } catch {
    // Redirect remains useful if analytics storage is temporarily unavailable; the failure is not exposed to visitors.
  }
  return NextResponse.redirect(link.destinationUrl, 302);
}
