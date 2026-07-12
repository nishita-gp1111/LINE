declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_AUTH_MODE?: "auto" | "mock";
    NEXT_PUBLIC_APP_URL?: string;
    APP_ENV?: "development" | "test" | "production";
    APP_TIMEZONE?: string;
    MOCK_LINE_API?: "true" | "false";
    LINE_MANUAL_SEND_ENABLED?: "true" | "false";
    MOCK_LINE_SEND_OUTCOME?: "success" | "409" | "429" | "500" | "timeout";
    HOSTING_COMMERCIAL_USE_CONFIRMED?: "true" | "false";
    LINE_BULK_SEND_ENABLED?: "true" | "false";
    LINE_SCHEDULED_SEND_ENABLED?: "true" | "false";
    LINE_AUTOMATION_SEND_ENABLED?: "true" | "false";
    LINE_AUTO_REPLY_ENABLED?: "true" | "false";
    LINE_MEDIA_SEND_ENABLED?: "true" | "false";
    LINE_RICH_MENU_MUTATION_ENABLED?: "true" | "false";
    LINE_TRACKING_ENABLED?: "true" | "false";
    ADMIN_EMAIL_ALLOWLIST?: string;

    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    SUPABASE_DB_URL?: string;

    LINE_ORGANIZATION_ID?: string;
    LINE_CHANNEL_ID?: string;
    LINE_CHANNEL_SECRET?: string;
    LINE_CHANNEL_ACCESS_TOKEN?: string;
    LINE_ADMIN_USER_ID?: string;
    NEXT_PUBLIC_LIFF_ID?: string;
    LINE_LOGIN_CHANNEL_ID?: string;
    LINE_LOGIN_CHANNEL_SECRET?: string;

    CRON_SECRET?: string;
    SCHEDULER_PROVIDER?: "supabase_cron" | "vercel_cron" | "manual";
    SCHEDULER_STALE_AFTER_MINUTES?: string;
    MAX_CAMPAIGN_RECIPIENTS?: string;
    MAX_MULTICAST_BATCH_SIZE?: string;
    LINE_MEDIA_BUCKET?: string;
    MEDIA_IMAGE_MAX_BYTES?: string;
    MEDIA_VIDEO_MAX_BYTES?: string;
    MEDIA_AUDIO_MAX_BYTES?: string;
    MEDIA_STORAGE_WARNING_BYTES?: string;
    MEDIA_STORAGE_STOP_BYTES?: string;
    TRACKING_SIGNING_SECRET?: string;
    TRACKING_TOKEN_TTL_SECONDS?: string;
    AUTOMATION_MAX_ATTEMPTS?: string;
    AUTOMATION_LEASE_SECONDS?: string;
    CAMPAIGN_DETAIL_RETENTION_DAYS?: string;
    JOB_RETENTION_DAYS?: string;
    ANALYTICS_EVENT_RETENTION_DAYS?: string;
    MEDIA_RETENTION_DAYS?: string;
    WEBHOOK_RETENTION_DAYS?: string;
    MESSAGE_RETENTION_DAYS?: string;
    DB_WARNING_BYTES?: string;
    DB_STOP_BYTES?: string;
    STORAGE_WARNING_BYTES?: string;
    STORAGE_STOP_BYTES?: string;
    LINE_QUOTA_RESERVE_PERCENT?: string;

    SURVEY_DEFAULT_SESSION_TTL_HOURS?: string;
    SURVEY_MAX_QUESTIONS?: string;
    SURVEY_MAX_QUICK_REPLY_OPTIONS?: string;
    SURVEY_POSTBACK_TOKEN_SECRET?: string;
  }
}
