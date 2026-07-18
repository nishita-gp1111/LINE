import { NextResponse } from "next/server";
import { acquisitionRouteBySlug, buildLineAcquisitionUrl } from "@/lib/acquisition/routes";
import { getServerEnv } from "@/lib/env/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const route = acquisitionRouteBySlug(slug);
  if (!route) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const basicId = getServerEnv().LINE_EXPECTED_BASIC_ID;
  if (!basicId) {
    return NextResponse.json({ error: "line_account_not_configured" }, { status: 503 });
  }

  try {
    const response = NextResponse.redirect(buildLineAcquisitionUrl(basicId, route), 302);
    response.headers.set("cache-control", "private, no-store, max-age=0");
    return response;
  } catch {
    return NextResponse.json({ error: "line_account_not_configured" }, { status: 503 });
  }
}
