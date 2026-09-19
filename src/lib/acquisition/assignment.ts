import { z } from "zod";
import { SHARED_ACQUISITION_ROUTE_SLUGS } from "@/lib/acquisition/routes";

export const assignmentRuleSchema = z.object({
  routeSlug: z.enum(SHARED_ACQUISITION_ROUTE_SLUGS),
  staffNames: z.array(z.string().trim().min(1).max(40)).max(20),
  enabled: z.boolean()
}).refine(value => !value.enabled || value.staffNames.length > 0, "担当者を1名以上指定してください。")
  .refine(value => new Set(value.staffNames).size === value.staffNames.length, "担当者名が重複しています。");

export type AssignmentRule = z.infer<typeof assignmentRuleSchema>;
export type AssignmentSettings = { rules: AssignmentRule[]; available: boolean };

export function assigneeOptionValue(conversation: { assigneeName?: string | null; assigneeProfileId: string | null }): string {
  return conversation.assigneeName ? `name:${conversation.assigneeName}` : conversation.assigneeProfileId || "";
}

export function assigneeUpdate(value: string): { assigneeName: string | null; assigneeProfileId: string | null } {
  return value.startsWith("name:")
    ? { assigneeName: value.slice(5), assigneeProfileId: null }
    : { assigneeName: null, assigneeProfileId: value || null };
}
