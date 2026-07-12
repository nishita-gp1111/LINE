import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.string().url().optional()
);

const optionalText = z.string().optional();

const booleanEnv = (defaultValue: boolean) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === "") return undefined;
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    },
    z.boolean().default(defaultValue)
  );

const integerEnv = (defaultValue: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? undefined : value),
    z.coerce.number().int().nonnegative().default(defaultValue)
  );

const emailAllowlist = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

export const envSchema = z.object({
  NEXT_PUBLIC_AUTH_MODE: z.enum(["auto", "mock"]).default("auto"),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_TIMEZONE: z.string().default("Asia/Tokyo"),
  MOCK_LINE_API: booleanEnv(true),
  ADMIN_EMAIL_ALLOWLIST: emailAllowlist,

  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalText,
  SUPABASE_SERVICE_ROLE_KEY: optionalText,
  SUPABASE_DB_URL: optionalText,

  LINE_ORGANIZATION_ID: optionalText,
  LINE_CHANNEL_ID: optionalText,
  LINE_CHANNEL_SECRET: optionalText,
  LINE_CHANNEL_ACCESS_TOKEN: optionalText,
  LINE_ADMIN_USER_ID: optionalText,
  NEXT_PUBLIC_LIFF_ID: optionalText,
  LINE_LOGIN_CHANNEL_ID: optionalText,
  LINE_LOGIN_CHANNEL_SECRET: optionalText,

  CRON_SECRET: optionalText,
  MEDIA_RETENTION_DAYS: integerEnv(30),
  WEBHOOK_RETENTION_DAYS: integerEnv(30),
  MESSAGE_RETENTION_DAYS: integerEnv(365),
  DB_WARNING_BYTES: integerEnv(367001600),
  DB_STOP_BYTES: integerEnv(471859200),
  STORAGE_WARNING_BYTES: integerEnv(734003200),
  STORAGE_STOP_BYTES: integerEnv(943718400),
  LINE_QUOTA_RESERVE_PERCENT: integerEnv(3),

  SURVEY_DEFAULT_SESSION_TTL_HOURS: integerEnv(24),
  SURVEY_MAX_QUESTIONS: integerEnv(50),
  SURVEY_MAX_QUICK_REPLY_OPTIONS: integerEnv(13),
  SURVEY_POSTBACK_TOKEN_SECRET: optionalText
});

export type AppEnv = z.output<typeof envSchema>;

export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  return envSchema.parse(input);
}
