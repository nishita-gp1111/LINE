import { z } from "zod";

export const sourceTypeSchema = z.enum(["manual", "survey", "automation", "campaign", "form", "import", "system"]);
export const marketingStatusSchema = z.enum(["eligible", "suppressed", "transactional_only"]);
export const fieldTypeSchema = z.enum(["text", "long_text", "number", "date", "datetime", "boolean", "single_select", "multi_select"]);

export const tagDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  colorToken: z.string().regex(/^[a-z0-9-]{1,40}$/).default("moss"),
  tagGroupId: z.string().uuid().nullable().default(null),
  isExclusive: z.boolean().default(false)
});

export const customFieldDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  fieldType: fieldTypeSchema,
  description: z.string().trim().max(500).default(""),
  options: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  isRequired: z.boolean().default(false),
  isSegmentable: z.boolean().default(true)
}).superRefine((value, ctx) => {
  if ((value.fieldType === "single_select" || value.fieldType === "multi_select") && value.options.length === 0) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "select項目には選択肢が必要です。" });
  }
});

const conditionFieldSchema = z.enum([
  "friend_status", "marketing_status", "followed_at", "last_message_at", "conversation_status",
  "assignee", "tag", "custom_field", "survey_answered", "survey_completed", "source", "clicked", "conversion", "automation"
]);
const conditionOperatorSchema = z.enum([
  "equals", "not_equals", "contains", "not_contains", "greater_than", "greater_or_equal", "less_than",
  "less_or_equal", "before", "after", "between", "is_null", "is_not_null", "in", "not_in", "has_tag", "not_has_tag"
]);

export const segmentConditionSchema = z.object({
  field: conditionFieldSchema,
  operator: conditionOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional()
});

export const segmentGroupSchema: z.ZodType<SegmentGroup> = z.lazy(() => z.object({
  conjunction: z.enum(["and", "or"]),
  conditions: z.array(segmentConditionSchema).max(20).default([]),
  groups: z.array(segmentGroupSchema).max(20).default([])
}));

export type SegmentCondition = z.infer<typeof segmentConditionSchema>;
export type SegmentGroup = { conjunction: "and" | "or"; conditions: SegmentCondition[]; groups: SegmentGroup[] };

export function validateSegmentDsl(input: unknown): SegmentGroup {
  const parsed = segmentGroupSchema.parse(input);
  let depth = 0;
  let count = 0;
  const visit = (group: SegmentGroup, level: number) => {
    depth = Math.max(depth, level);
    count += group.conditions.length;
    group.groups.forEach((child) => visit(child, level + 1));
  };
  visit(parsed, 1);
  if (depth > 3) throw new Error("セグメント条件のネストは3階層以内です。");
  if (count > 20) throw new Error("セグメント条件は20件以内です。");
  return parsed;
}

export function compileSafeCondition(condition: SegmentCondition): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const field = condition.field === "tag" ? "tag_id" : condition.field === "custom_field" ? "custom_field_value" : condition.field;
  if (!["friend_status", "marketing_status", "followed_at", "last_message_at", "conversation_status", "assignee", "tag", "custom_field", "survey_answered", "survey_completed", "source", "clicked", "conversion", "automation"].includes(condition.field)) throw new Error("許可されていないsegment fieldです。");
  const operatorMap: Record<string, string> = { equals: "=", not_equals: "<>", greater_than: ">", greater_or_equal: ">=", less_than: "<", less_or_equal: "<=", before: "<", after: ">" };
  if (condition.operator in operatorMap) return { sql: `${field} ${operatorMap[condition.operator]} ${add(condition.value)}`, params };
  if (condition.operator === "contains" || condition.operator === "not_contains") return { sql: `${field} ${condition.operator === "contains" ? "ILIKE" : "NOT ILIKE"} ${add(`%${String(condition.value ?? "").replace(/[\\%_]/g, "\\$&")}%`)}`, params };
  if (condition.operator === "is_null" || condition.operator === "is_not_null") return { sql: `${field} IS ${condition.operator === "is_null" ? "NULL" : "NOT NULL"}`, params };
  if (condition.operator === "in" || condition.operator === "not_in") { const values = Array.isArray(condition.value) ? condition.value : []; return { sql: `${field} ${condition.operator === "in" ? "=" : "<>"} ANY(${add(values)})`, params }; }
  if (condition.operator === "has_tag" || condition.operator === "not_has_tag") return { sql: `${condition.operator === "has_tag" ? "EXISTS" : "NOT EXISTS"} (SELECT 1 FROM contact_tag_assignments WHERE tag_id = ${add(condition.value)} AND removed_at IS NULL)`, params };
  throw new Error("許可されていないsegment operatorです。");
}

export function activeTagAssignmentKey(contactId: string, tagId: string, sourceType: string, sourceId: string | null): string {
  return `${contactId}:${tagId}:${sourceType}:${sourceId ?? "none"}`;
}

export function csvSafeCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function isSuppressed(friendStatus: string, marketingStatus: string): boolean {
  return friendStatus === "blocked" || marketingStatus !== "eligible";
}
