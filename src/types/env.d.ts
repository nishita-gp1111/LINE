declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_AUTH_MODE?: "auto" | "mock";
    NEXT_PUBLIC_APP_URL?: string;
    APP_ENV?: "development" | "test" | "production";
    APP_TIMEZONE?: string;
    MOCK_LINE_API?: "true" | "false";
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
