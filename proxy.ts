import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  getAuthMode,
  isProtectedPath,
  MOCK_AUTH_COOKIE
} from "@/lib/auth/config";

function redirectToLogin(request: NextRequest, response?: NextResponse) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";

  const redirectResponse = NextResponse.redirect(loginUrl);
  response?.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  if (!isProtectedPath(request.nextUrl.pathname)) return NextResponse.next();

  if (getAuthMode() === "mock") {
    return request.cookies.get(MOCK_AUTH_COOKIE)?.value === "1"
      ? NextResponse.next()
      : redirectToLogin(request);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return user ? response : redirectToLogin(request, response);
}

export const config = { matcher: ["/admin/:path*"] };
