import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/server";
import { getAnalytics } from "@/lib/milestone3/analytics-store";
export async function GET(request: Request) { if (!await getAuthenticatedUser()) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); const params = new URL(request.url).searchParams; return NextResponse.json(await getAnalytics(params.get("from") || undefined, params.get("to") || undefined), { headers: { "cache-control": "no-store" } }); }
