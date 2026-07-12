import { NextResponse } from "next/server";
import {
  getAuthMode,
  MOCK_AUTH_COOKIE,
  MOCK_USER
} from "@/lib/auth/config";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 7
};

export function POST() {
  if (getAuthMode() !== "mock") {
    return NextResponse.json({ error: "Mock認証は無効です。" }, { status: 409 });
  }

  const response = NextResponse.json({ mode: "mock", user: MOCK_USER });
  response.cookies.set(MOCK_AUTH_COOKIE, "1", cookieOptions);
  return response;
}

export function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(MOCK_AUTH_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
