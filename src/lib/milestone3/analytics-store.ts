import "server-only";

import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { foundationCounts } from "@/lib/milestone3/interactive-store";
import { listMockCampaigns } from "@/lib/milestone3/delivery-store";
import { getMockClickCount } from "@/lib/milestone3/tracking-store";

export type AnalyticsResult = { from: string; to: string; dataAvailable: boolean; metrics: Record<string, number | null>; freshness: string };
function dateRange(from?: string, to?: string) { const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date(); const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); return { from: start.toISOString(), to: end.toISOString() }; }
export async function getAnalytics(fromInput?: string, toInput?: string): Promise<AnalyticsResult> {
  const range = dateRange(fromInput, toInput); const env = getServerEnv();
  if (env.MOCK_LINE_API) { const foundation = foundationCounts(); const campaigns = listMockCampaigns(); return { ...range, dataAvailable: foundation.tags + foundation.fields + campaigns.length + getMockClickCount() > 0, freshness: new Date().toISOString(), metrics: { contacts_total: null, contacts_following: null, contacts_blocked: null, new_friends: null, tags: foundation.tags, tag_assignments: foundation.assignments, custom_fields: foundation.fields, campaign_target: campaigns.reduce((sum, item) => sum + item.recipientCount, 0), line_accepted: campaigns.reduce((sum, item) => sum + item.acceptedCount, 0), failures: campaigns.reduce((sum, item) => sum + item.failedCount, 0), clicks: getMockClickCount(), survey_started: null, survey_completed: null, scenario_enrolled: null, scenario_completed: null, conversions: null } }; }
  const client = createSupabaseAdminClient(); const org = env.LINE_ORGANIZATION_ID;
  if (!client || !org) return { ...range, dataAvailable: false, freshness: new Date().toISOString(), metrics: {} };
  const count = async (table: string, filters: Array<[string, string, string]> = []) => { let query = client.from(table).select("id", { count: "exact", head: true }).eq("organization_id", org); for (const [column, operator, value] of filters) { if (operator === "gte") query = query.gte(column, value); else if (operator === "lte") query = query.lte(column, value); else query = query.eq(column, value); } const result = await query; return result.error ? null : result.count ?? 0; };
  const [total, following, blocked, newFriends, tags, assignments, fields, campaignTarget, accepted, failures, clicks, surveyStarted, surveyCompleted, scenarioEnrolled, scenarioCompleted, conversions] = await Promise.all([
    count("contacts"), count("contacts", [["friend_status", "eq", "following"]]), count("contacts", [["friend_status", "eq", "blocked"]]), count("contacts", [["followed_at", "gte", range.from], ["followed_at", "lte", range.to]]), count("tags", [["is_active", "eq", "true"]]), count("contact_tag_assignments", [["assigned_at", "gte", range.from]]), count("custom_field_definitions", [["is_active", "eq", "true"]]), count("campaigns", [["created_at", "gte", range.from]]), count("messages", [["status", "eq", "accepted"], ["accepted_at", "gte", range.from]]), count("campaign_batches", [["status", "eq", "failed"]]), count("link_clicks", [["clicked_at", "gte", range.from], ["clicked_at", "lte", range.to]]), count("survey_sessions", [["started_at", "gte", range.from]]), count("survey_sessions", [["completed_at", "gte", range.from]]), count("automation_enrollments", [["started_at", "gte", range.from]]), count("automation_enrollments", [["completed_at", "gte", range.from]]), count("conversions", [["occurred_at", "gte", range.from], ["occurred_at", "lte", range.to]])
  ]);
  const values = { contacts_total: total, contacts_following: following, contacts_blocked: blocked, new_friends: newFriends, tags, tag_assignments: assignments, custom_fields: fields, campaign_target: campaignTarget, line_accepted: accepted, failures, clicks, survey_started: surveyStarted, survey_completed: surveyCompleted, scenario_enrolled: scenarioEnrolled, scenario_completed: scenarioCompleted, conversions };
  return { ...range, dataAvailable: Object.values(values).some((value) => value !== null), freshness: new Date().toISOString(), metrics: values };
}
