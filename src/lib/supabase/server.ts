import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isSupabaseAuthConfigured } from "@/lib/auth/config";

export async function createSupabaseServerAuthClient() {
  if (!isSupabaseAuthConfigured()) return null;

  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always write cookies. The proxy refreshes
            // the session on the next request when this happens.
          }
        }
      }
    }
  );
}
