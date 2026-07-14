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

const idAllowlist = z
  .string()
  .default("")
  .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean));

export const envSchema = z.object({
  NEXT_PUBLIC_AUTH_MODE: z.enum(["auto", "mock"]).default("auto"),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_TIMEZONE: z.string().default("Asia/Tokyo"),
  MOCK_LINE_API: booleanEnv(true),
  LINE_MANUAL_SEND_ENABLED: booleanEnv(false),
  MOCK_LINE_SEND_OUTCOME: z.enum(["success", "409", "429", "500", "timeout"]).default("success"),
  HOSTING_COMMERCIAL_USE_CONFIRMED: booleanEnv(false),
  LINE_BULK_SEND_ENABLED: booleanEnv(false),
  LINE_SCHEDULED_SEND_ENABLED: booleanEnv(false),
  LINE_AUTOMATION_SEND_ENABLED: booleanEnv(false),
  LINE_AUTO_REPLY_ENABLED: booleanEnv(false),
  LINE_MEDIA_SEND_ENABLED: booleanEnv(false),
  LINE_RICH_MENU_MUTATION_ENABLED: booleanEnv(false),
  LINE_TRACKING_ENABLED: booleanEnv(true),
  LINE_TEST_USER_IDS: idAllowlist,
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

  LAUNCH_ACCEPTANCE_ENABLED: booleanEnv(false),
  LAUNCH_ACCEPTANCE_TOKEN: optionalText,

  CRON_SECRET: optionalText,
  SCHEDULER_PROVIDER: z.enum(["supabase_cron", "vercel_cron", "manual"]).default("supabase_cron"),
  SCHEDULER_STALE_AFTER_MINUTES: integerEnv(5),
  MAX_CAMPAIGN_RECIPIENTS: integerEnv(50000),
  MAX_MULTICAST_BATCH_SIZE: integerEnv(500).refine((value) => value > 0 && value <= 500),
  LINE_MEDIA_BUCKET: z.string().min(1).default("line-media"),
  MEDIA_IMAGE_MAX_BYTES: integerEnv(8388608),
  MEDIA_VIDEO_MAX_BYTES: integerEnv(52428800),
  MEDIA_AUDIO_MAX_BYTES: integerEnv(20971520),
  MEDIA_STORAGE_WARNING_BYTES: integerEnv(734003200),
  MEDIA_STORAGE_STOP_BYTES: integerEnv(943718400),
  TRACKING_SIGNING_SECRET: optionalText,
  TRACKING_TOKEN_TTL_SECONDS: integerEnv(2592000),
  AUTOMATION_MAX_ATTEMPTS: integerEnv(3),
  AUTOMATION_LEASE_SECONDS: integerEnv(120),
  CAMPAIGN_DETAIL_RETENTION_DAYS: integerEnv(90),
  JOB_RETENTION_DAYS: integerEnv(90),
  ANALYTICS_EVENT_RETENTION_DAYS: integerEnv(730),
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
