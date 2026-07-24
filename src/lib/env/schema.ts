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

const emailRecipients = z
  .string()
  .default("")
  .transform((value) =>
    [...new Set(value
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean))]
  )
  .pipe(z.array(z.string().email()).max(50));

const optionalEmail = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.string().email().optional()
);

const idAllowlist = z
  .string()
  .default("")
  .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean));

const sha256Allowlist = z
  .string()
  .default("")
  .transform((value) => value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))
  .refine((values) => values.every((value) => /^[0-9a-f]{64}$/.test(value)), "SHA-256 hash must be 64 lowercase hexadecimal characters");

const optionalSha256 = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.string().regex(/^[0-9a-f]{64}$/, "SHA-256 hash must be 64 lowercase hexadecimal characters").optional()
);

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
  LINE_RECIPIENT_MODE: z.enum(["controlled", "all_followers"]).default("controlled"),
  LINE_TEST_USER_IDS: idAllowlist,
  LINE_TEST_USER_HASHES: sha256Allowlist,
  LINE_CONTROLLED_LAUNCH_ENROLLMENT_ENABLED: booleanEnv(false),
  LINE_CONTROLLED_LAUNCH_ENROLLMENT_TOKEN_HASH: optionalSha256,
  ADMIN_EMAIL_ALLOWLIST: emailAllowlist,

  INBOUND_EMAIL_NOTIFICATIONS_ENABLED: booleanEnv(false),
  INBOUND_EMAIL_NOTIFICATION_RECIPIENTS: emailRecipients,
  INBOUND_EMAIL_NOTIFICATION_FROM: optionalEmail,
  INBOUND_EMAIL_NOTIFICATION_COOLDOWN_MINUTES: integerEnv(10).refine(
    (value) => value <= 1440,
    "Notification cooldown must be at most 1440 minutes"
  ),
  RESEND_API_KEY: optionalText,

  BOOKING_MANAGEMENT_ENABLED: booleanEnv(true),
  BOOKING_REMINDERS_ENABLED: booleanEnv(false),
  BOOKING_EMAIL_FROM: optionalEmail,
  GOOGLE_CALENDAR_CLIENT_ID: optionalText,
  GOOGLE_CALENDAR_CLIENT_SECRET: optionalText,
  BOOKING_TOKEN_ENCRYPTION_KEY: optionalText,
  BOOKING_OAUTH_STATE_SECRET: optionalText,

  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalText,
  SUPABASE_SERVICE_ROLE_KEY: optionalText,
  SUPABASE_DB_URL: optionalText,

  LINE_ORGANIZATION_ID: optionalText,
  LINE_CHANNEL_ID: optionalText,
  LINE_CHANNEL_SECRET: optionalText,
  LINE_CHANNEL_ACCESS_TOKEN: optionalText,
  LINE_EXPECTED_BASIC_ID: optionalText,
  LINE_EXPECTED_DISPLAY_NAME: optionalText,
  LINE_ADMIN_USER_ID: optionalText,
  NEXT_PUBLIC_LIFF_ID: optionalText,
  LINE_LOGIN_CHANNEL_ID: optionalText,
  LINE_LOGIN_CHANNEL_SECRET: optionalText,


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
}).superRefine((env, context) => {
  if (!env.INBOUND_EMAIL_NOTIFICATIONS_ENABLED) return;

  if (env.INBOUND_EMAIL_NOTIFICATION_RECIPIENTS.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["INBOUND_EMAIL_NOTIFICATION_RECIPIENTS"],
      message: "At least one notification recipient is required when inbound email notifications are enabled"
    });
  }
  if (!env.INBOUND_EMAIL_NOTIFICATION_FROM) {
    context.addIssue({
      code: "custom",
      path: ["INBOUND_EMAIL_NOTIFICATION_FROM"],
      message: "A verified sender address is required when inbound email notifications are enabled"
    });
  }
  if (!env.RESEND_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "RESEND_API_KEY is required when inbound email notifications are enabled"
    });
  }
  if (!env.NEXT_PUBLIC_APP_URL) {
    context.addIssue({
      code: "custom",
      path: ["NEXT_PUBLIC_APP_URL"],
      message: "NEXT_PUBLIC_APP_URL is required when inbound email notifications are enabled"
    });
  }
});

export type AppEnv = z.output<typeof envSchema>;

export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  return envSchema.parse(input);
}
