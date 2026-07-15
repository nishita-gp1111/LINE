import { afterEach, describe, expect, it } from "vitest";
import {
  getAuthMode,
  isProtectedPath,
  isSupabaseAuthConfigured
} from "../src/lib/auth/config";
import { parseEnv } from "../src/lib/env/schema";

const originalAuthMode = process.env.NEXT_PUBLIC_AUTH_MODE;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  if (originalAuthMode === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_AUTH_MODE");
  else process.env.NEXT_PUBLIC_AUTH_MODE = originalAuthMode;
  if (originalUrl === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_URL");
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalAnonKey === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
});

describe("auth mode", () => {
  it("defaults to mock without Supabase credentials", () => {
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_AUTH_MODE");
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_URL");
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");

    expect(isSupabaseAuthConfigured()).toBe(false);
    expect(getAuthMode()).toBe("mock");
  });

  it("uses Supabase only when both public credentials exist", () => {
    Reflect.deleteProperty(process.env, "NEXT_PUBLIC_AUTH_MODE");
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";

    expect(getAuthMode()).toBe("supabase");
  });

  it("allows explicit mock mode", () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = "mock";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";

    expect(getAuthMode()).toBe("mock");
  });
});

describe("protected paths", () => {
  it("protects admin and nested admin routes", () => {
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/admin/settings")).toBe(true);
  });

  it("keeps public routes outside the boundary", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/api/auth/mock")).toBe(false);
  });
});

describe("environment schema", () => {
  it("supplies safe defaults for local startup", () => {
    const env = parseEnv({});

    expect(env.APP_ENV).toBe("development");
    expect(env.APP_TIMEZONE).toBe("Asia/Tokyo");
    expect(env.MOCK_LINE_API).toBe(true);
    expect(env.LINE_MANUAL_SEND_ENABLED).toBe(false);
    expect(env.LINE_TEST_USER_HASHES).toEqual([]);
    expect(env.LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED).toBe(false);
    expect(env.LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH).toBeUndefined();
    expect(env.ADMIN_EMAIL_ALLOWLIST).toEqual([]);
    expect(env.INBOUND_EMAIL_NOTIFICATIONS_ENABLED).toBe(false);
    expect(env.INBOUND_EMAIL_NOTIFICATION_RECIPIENTS).toEqual([]);
    expect(env.INBOUND_EMAIL_NOTIFICATION_COOLDOWN_MINUTES).toBe(10);
    expect(env.SURVEY_MAX_QUESTIONS).toBe(50);
  });

  it("parses the newly documented runtime settings", () => {
    const env = parseEnv({
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      APP_ENV: "test",
      APP_TIMEZONE: "Asia/Tokyo",
      MOCK_LINE_API: "false",
      LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED: "true",
      LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH: "a".repeat(64),
      ADMIN_EMAIL_ALLOWLIST: "Owner@Example.com, admin@example.com",
      INBOUND_EMAIL_NOTIFICATIONS_ENABLED: "true",
      INBOUND_EMAIL_NOTIFICATION_RECIPIENTS: "s.nishita@growth-path.jp, y.imahuku@growth-path.jp",
      INBOUND_EMAIL_NOTIFICATION_FROM: "notifications@updates.growth-path.jp",
      RESEND_API_KEY: "re_test_secret"
    });

    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3000");
    expect(env.APP_ENV).toBe("test");
    expect(env.MOCK_LINE_API).toBe(false);
    expect(env.LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED).toBe(true);
    expect(env.LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH).toBe("a".repeat(64));
    expect(env.ADMIN_EMAIL_ALLOWLIST).toEqual([
      "owner@example.com",
      "admin@example.com"
    ]);
    expect(env.INBOUND_EMAIL_NOTIFICATION_RECIPIENTS).toEqual([
      "s.nishita@growth-path.jp",
      "y.imahuku@growth-path.jp"
    ]);
  });

  it("rejects an enabled notification setup without server-only provider settings", () => {
    expect(() => parseEnv({ INBOUND_EMAIL_NOTIFICATIONS_ENABLED: "true" })).toThrow();
  });
});
