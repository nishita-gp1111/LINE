import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env/server";
import { launchFlagStatus } from "@/lib/launch/flags";
import {
  ACCEPTANCE_MAX_BODY_BYTES,
  ACCEPTANCE_TIMEOUT_MS,
  acceptanceRuntimeAllowed,
  finishAcceptanceRun,
  safeTokenEqual,
  startAcceptanceRun
} from "@/lib/launch/acceptance";

export const runtime = "nodejs";

const DB_TABLES = ["contacts", "messages", "conversations", "webhook_events"] as const;
const DANGEROUS_FLAGS = [
  "LINE_MANUAL_SEND_ENABLED",
  "LINE_BULK_SEND_ENABLED",
  "LINE_SCHEDULED_SEND_ENABLED",
  "LINE_AUTOMATION_SEND_ENABLED",
  "LINE_AUTO_REPLY_ENABLED",
  "LINE_MEDIA_SEND_ENABLED",
  "LINE_RICH_MENU_MUTATION_ENABLED",
  "HOSTING_COMMERCIAL_USE_CONFIRMED"
] as const;

type AcceptanceBody = { bypassSecret?: unknown };
type SafeResponse = Record<string, unknown>;

function json(data: SafeResponse, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function statusOf(value: boolean): "PASS" | "FAIL" {
  return value ? "PASS" : "FAIL";
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    return await fetch(url, { ...init, redirect: "error", signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function endpointClassification(endpoint: string | undefined, appUrl: string | undefined): string {
  if (!endpoint) return "A: 未設定";
  try {
    const target = new URL(endpoint);
    const preview = appUrl ? new URL(appUrl) : undefined;
    if (preview && target.hostname === preview.hostname && target.pathname === "/api/line/webhook") return "C: CRM Preview";
    if (target.hostname === "line-gp-1111.vercel.app" && target.pathname === "/api/line/webhook") return "B: CRM Production";
    if (target.hostname.endsWith("vercel.app")) return "E: 不明";
    return "D: 第三者・既存外部システム";
  } catch {
    return "E: 不明";
  }
}

async function readCounts(client: ReturnType<typeof createSupabaseAdminClient>): Promise<Record<string, number> | null> {
  if (!client) return null;
  const entries = await Promise.all(DB_TABLES.map(async (table) => {
    const result = await client.from(table).select("id", { count: "exact", head: true });
    return [table, result.error ? null : result.count ?? 0] as const;
  }));
  if (entries.some(([, count]) => count === null)) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function deltas(before: Record<string, number> | null, after: Record<string, number> | null): Record<string, number | null> {
  return Object.fromEntries(DB_TABLES.map((table) => [table, before && after ? after[table] - before[table] : null]));
}

async function runAcceptance(body: AcceptanceBody): Promise<SafeResponse> {
  const env = getServerEnv();
  const environment = {
    status: statusOf(Boolean(env.NEXT_PUBLIC_APP_URL && env.LINE_CHANNEL_ID && env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN && env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)),
    appEnv: env.APP_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    mockLineApi: env.MOCK_LINE_API,
    appUrlConfigured: Boolean(env.NEXT_PUBLIC_APP_URL),
    channelIdConfigured: Boolean(env.LINE_CHANNEL_ID),
    channelSecretConfigured: Boolean(env.LINE_CHANNEL_SECRET),
    channelAccessTokenConfigured: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
    supabaseConfigured: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
  };

  const authorization: Record<string, string> = env.LINE_CHANNEL_ACCESS_TOKEN
    ? { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` }
    : {};
  const botResponse = env.MOCK_LINE_API || !env.LINE_CHANNEL_ACCESS_TOKEN
    ? null
    : await fetchWithTimeout("https://api.line.me/v2/bot/info", { headers: authorization });
  const bot = botResponse ? await readJson(botResponse) : {};
  const botInfo = {
    status: botResponse?.status ?? null,
    displayName: typeof bot.displayName === "string" ? bot.displayName : null,
    basicId: typeof bot.basicId === "string" ? bot.basicId : null,
    premiumIdConfigured: typeof bot.premiumId === "string" && bot.premiumId.length > 0,
    userIdMasked: typeof bot.userId === "string" && bot.userId.length >= 8 ? { prefix: bot.userId.slice(0, 4), suffix: bot.userId.slice(-4) } : null
  };

  const endpointResponse = env.MOCK_LINE_API || !env.LINE_CHANNEL_ACCESS_TOKEN
    ? null
    : await fetchWithTimeout("https://api.line.me/v2/bot/channel/webhook/endpoint", { headers: authorization });
  const endpointBody = endpointResponse ? await readJson(endpointResponse) : {};
  const endpoint = typeof endpointBody.endpoint === "string" ? endpointBody.endpoint : undefined;
  let previewEndpoint: string | null = null;
  if (env.NEXT_PUBLIC_APP_URL && typeof body.bypassSecret === "string") {
    const url = new URL("/api/line/webhook", env.NEXT_PUBLIC_APP_URL);
    url.searchParams.set("x-vercel-protection-bypass", body.bypassSecret);
    previewEndpoint = url.toString();
  }

  const admin = createSupabaseAdminClient();
  const before = await readCounts(admin);
  const webhookTestResponse = env.MOCK_LINE_API || !env.LINE_CHANNEL_ACCESS_TOKEN || !previewEndpoint
    ? null
    : await fetchWithTimeout("https://api.line.me/v2/bot/channel/webhook/test", {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ endpoint: previewEndpoint })
      });
  const webhookTestBody = webhookTestResponse ? await readJson(webhookTestResponse) : {};
  const after = await readCounts(admin);
  const webhookTestPassed = webhookTestResponse?.status === 200 && webhookTestBody.success === true && webhookTestBody.statusCode === 200 && webhookTestBody.reason === "OK";

  const flagValues = launchFlagStatus() as Record<string, boolean>;
  const dangerousFlags = Object.fromEntries(DANGEROUS_FLAGS.map((flag) => [flag, Boolean(env[flag as keyof typeof env])]));
  const flagsStopped = Object.values(dangerousFlags).every((value) => value === false);
  const heartbeat = admin && env.LINE_ORGANIZATION_ID
    ? await admin.from("scheduler_heartbeats").select("status,updated_at").eq("organization_id", env.LINE_ORGANIZATION_ID).eq("provider", env.SCHEDULER_PROVIDER).maybeSingle()
    : null;
  const scheduledJobs = admin ? await admin.from("scheduled_jobs").select("id", { count: "exact", head: true }).limit(1) : null;
  const storage = admin ? await admin.storage.listBuckets() : null;
  const heartbeatHealthy = Boolean(heartbeat?.data?.status === "healthy" && heartbeat.data.updated_at);

  return {
    ok: environment.status === "PASS" && botInfo.status === 200 && botInfo.displayName === "GP PRモニター窓口" && botInfo.basicId === "@612evfuv" && webhookTestPassed && flagsStopped,
    environment,
    botInfo,
    currentWebhook: {
      status: endpointResponse?.status ?? null,
      active: endpointBody.active === true,
      hostname: endpoint ? new URL(endpoint).hostname : null,
      pathname: endpoint ? new URL(endpoint).pathname : null,
      classification: endpointClassification(endpoint, env.NEXT_PUBLIC_APP_URL)
    },
    webhookTest: {
      httpStatus: webhookTestResponse?.status ?? null,
      success: webhookTestBody.success === true,
      statusCode: typeof webhookTestBody.statusCode === "number" ? webhookTestBody.statusCode : null,
      reason: typeof webhookTestBody.reason === "string" ? webhookTestBody.reason : null,
      signatureValidation: webhookTestPassed ? "PASS: LINE署名付きWebhookがHTTP 200" : "FAIL"
    },
    dbDelta: deltas(before, after),
    scheduler: {
      heartbeat: heartbeatHealthy ? "PASS" : "FAIL",
      heartbeatStatus: heartbeat?.data?.status ?? null,
      scheduledJobsTable: scheduledJobs && !scheduledJobs.error ? "PASS" : "FAIL",
      storageBucket: storage && !storage.error && storage.data.some((bucket) => bucket.id === env.LINE_MEDIA_BUCKET) ? "PASS" : "FAIL"
    },
    featureFlags: { ...flagValues, ...dangerousFlags },
    dangerousFlagsStopped: flagsStopped
  };
}

export async function POST(request: Request) {
  if (!acceptanceRuntimeAllowed()) return json({ ok: false, error: "not_found" }, 404);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ ok: false, error: "content_type_required" }, 415);
  const env = getServerEnv();
  if (!safeTokenEqual(request.headers.get("x-launch-acceptance-token"), env.LAUNCH_ACCEPTANCE_TOKEN)) return json({ ok: false, error: "forbidden" }, 403);
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > ACCEPTANCE_MAX_BODY_BYTES) return json({ ok: false, error: "body_too_large" }, 413);
  let body: AcceptanceBody;
  try {
    body = JSON.parse(rawBody) as AcceptanceBody;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (typeof body.bypassSecret !== "string" || body.bypassSecret.length < 32) return json({ ok: false, error: "bypass_secret_required" }, 400);
  const started = startAcceptanceRun();
  if (started === "busy") return json({ ok: false, error: "already_running" }, 409);
  if (started === "rate_limited") return json({ ok: false, error: "rate_limited" }, 429);
  try {
    const result = await Promise.race([
      runAcceptance(body),
      new Promise<SafeResponse>((resolve) => setTimeout(() => resolve({ ok: false, error: "acceptance_timeout" }), ACCEPTANCE_TIMEOUT_MS))
    ]);
    return json(result);
  } catch {
    return json({ ok: false, error: "acceptance_failed" }, 503);
  } finally {
    finishAcceptanceRun();
  }
}
