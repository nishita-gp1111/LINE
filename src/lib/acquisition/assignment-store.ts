import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthMode } from "@/lib/auth/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assignmentRuleSchema, type AssignmentRule, type AssignmentSettings } from "@/lib/acquisition/assignment";

const mockState = globalThis as typeof globalThis & { __lineCrmMockAssignmentRules?: Map<string, AssignmentRule[]> };
function mockRules() {
  mockState.__lineCrmMockAssignmentRules ??= new Map<string, AssignmentRule[]>();
  return mockState.__lineCrmMockAssignmentRules;
}

export async function getAssignmentSettings(organizationId: string): Promise<AssignmentSettings> {
  if (getAuthMode() === "mock") return { rules: mockRules().get(organizationId) || [], available: true };
  const client = createSupabaseAdminClient();
  if (!client) return { rules: [], available: false };
  const { data, error } = await client.from("acquisition_assignment_rules").select("route_slug, staff_names, enabled").eq("organization_id", organizationId);
  if (error) return { rules: [], available: false };
  const rules = (data || []).map(value => assignmentRuleSchema.parse({ routeSlug: value.route_slug, staffNames: value.staff_names, enabled: value.enabled }));
  return { rules, available: true };
}

export async function saveAssignmentRule(organizationId: string, actorId: string, rule: AssignmentRule): Promise<void> {
  const parsed = assignmentRuleSchema.parse(rule);
  if (getAuthMode() === "mock") {
    const rules = mockRules().get(organizationId) || [];
    mockRules().set(organizationId, [...rules.filter(item => item.routeSlug !== parsed.routeSlug), parsed]);
    return;
  }
  const client = createSupabaseAdminClient();
  if (!client) throw new Error("担当者設定を保存できませんでした。");
  const { error } = await client.rpc("save_acquisition_assignment_rule", {
    target_organization_id: organizationId, target_actor_id: actorId,
    target_route_slug: parsed.routeSlug, target_staff_names: parsed.staffNames, target_enabled: parsed.enabled
  });
  if (error) throw new Error("担当者設定を保存できませんでした。DB設定と権限を確認してください。");
}

export async function assignAcquisitionContact(client: SupabaseClient, organizationId: string, contactId: string, routeSlug: string): Promise<void> {
  const { error } = await client.rpc("assign_acquisition_contact", {
    target_organization_id: organizationId, target_contact_id: contactId, target_route_slug: routeSlug
  });
  if (error) throw new Error("流入経路の担当者を割り当てできませんでした。");
}
