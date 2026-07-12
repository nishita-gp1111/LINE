import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  getAuthMode,
  MOCK_AUTH_COOKIE,
  MOCK_USER
} from "@/lib/auth/config";
import { createSupabaseServerAuthClient } from "@/lib/supabase/server";

export type AuthenticatedUser = Pick<User, "id" | "email"> & {
  name?: string;
};

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  if (getAuthMode() === "mock") {
    const cookieStore = await cookies();
    return cookieStore.get(MOCK_AUTH_COOKIE)?.value === "1" ? MOCK_USER : null;
  }

  const supabase = await createSupabaseServerAuthClient();
  if (!supabase) return null;

  const {
    data: { user }
  } = await supabase.auth.getUser();

  return user
    ? {
        id: user.id,
        email: user.email,
        name: (user.user_metadata?.name as string | undefined) || user.email
      }
    : null;
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}
