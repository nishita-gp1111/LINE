import { z } from "zod";

export const tagMatchModeSchema = z.literal("all");

const requiredTagIdsSchema = z.array(z.string().uuid()).min(1, "タグを1つ以上選択してください。").max(20, "対象タグは20個まで選択できます。")
  .refine((values) => new Set(values).size === values.length, "同じ対象タグが重複しています。");

const excludedTagIdsSchema = z.array(z.string().uuid()).max(20, "除外タグは20個まで選択できます。")
  .refine((values) => new Set(values).size === values.length, "同じ除外タグが重複しています。")
  .default([]);

const tagAudienceSelectionShape = {
  tagIds: requiredTagIdsSchema,
  excludeTagIds: excludedTagIdsSchema,
  matchMode: tagMatchModeSchema
};

function rejectOverlappingTags(value: { tagIds: string[]; excludeTagIds: string[] }, context: z.RefinementCtx) {
  if (value.tagIds.some((tagId) => value.excludeTagIds.includes(tagId))) {
    context.addIssue({ code: "custom", path: ["excludeTagIds"], message: "対象タグと除外タグに同じタグは選択できません。" });
  }
}

export const tagAudienceSelectionSchema = z.object(tagAudienceSelectionShape).superRefine(rejectOverlappingTags);

export const tagCampaignSendSchema = z.object({
  ...tagAudienceSelectionShape,
  name: z.string().trim().min(1, "配信名を入力してください。").max(150, "配信名は150文字以内です。"),
  text: z.string().trim().min(1, "本文を入力してください。").max(5_000, "本文は5000文字以内です。"),
  expectedRecipientCount: z.number().int().nonnegative(),
  clientRequestId: z.string().uuid(),
  recipientListConfirmed: z.literal(true, { error: "実際の配信対象者を確認してください。" }),
  confirmation: z.literal("配信する", { error: "最終確認に「配信する」と入力してください。" })
}).superRefine(rejectOverlappingTags);

export type TagMatchMode = z.infer<typeof tagMatchModeSchema>;

export type TagAudienceContact = {
  id: string;
  friendStatus: string;
  marketingStatus?: string;
};

export type TagAudienceAssignment = {
  contactId: string;
  tagId: string;
};

export function selectTagAudience(input: {
  tagIds: string[];
  excludeTagIds?: string[];
  matchMode: TagMatchMode;
  contacts: TagAudienceContact[];
  assignments: TagAudienceAssignment[];
  maxRecipients: number;
}): { recipientIds: string[]; matchedCount: number; excludedCount: number; excludedByTagCount: number } {
  const excludeTagIds = input.excludeTagIds ?? [];
  const selectedTags = new Set([...input.tagIds, ...excludeTagIds]);
  const tagsByContact = new Map<string, Set<string>>();
  for (const assignment of input.assignments) {
    if (!selectedTags.has(assignment.tagId)) continue;
    const tags = tagsByContact.get(assignment.contactId) || new Set<string>();
    tags.add(assignment.tagId);
    tagsByContact.set(assignment.contactId, tags);
  }

  const matches = (tags: Set<string>): boolean => input.tagIds.every((tagId) => tags.has(tagId));
  const matchedIds = new Set([...tagsByContact.entries()].filter(([, tags]) => matches(tags)).map(([contactId]) => contactId));
  const excludedByTagIds = new Set([...matchedIds].filter((contactId) => {
    const tags = tagsByContact.get(contactId) || new Set<string>();
    return excludeTagIds.some((tagId) => tags.has(tagId));
  }));
  const recipientIds = [...new Set(input.contacts
    .filter((contact) => matchedIds.has(contact.id))
    .filter((contact) => !excludedByTagIds.has(contact.id))
    .filter((contact) => contact.friendStatus === "following")
    .filter((contact) => (contact.marketingStatus || "eligible") === "eligible")
    .map((contact) => contact.id))].sort();

  if (recipientIds.length > input.maxRecipients) throw new Error(`配信対象は${input.maxRecipients}名以内にしてください。`);
  return {
    recipientIds,
    matchedCount: matchedIds.size,
    excludedCount: Math.max(0, matchedIds.size - recipientIds.length),
    excludedByTagCount: excludedByTagIds.size
  };
}

const storedTagAudienceFilterSchema = z.object({
  type: z.literal("tag_filter_v1"),
  tagIds: requiredTagIdsSchema,
  excludeTagIds: excludedTagIdsSchema,
  matchMode: tagMatchModeSchema
}).superRefine(rejectOverlappingTags);

export type StoredTagAudienceFilter = z.infer<typeof storedTagAudienceFilterSchema>;

const STORED_TAG_FILTER_PREFIX = "TAG_FILTER_V1:";

export function serializeTagAudienceFilter(input: { tagIds: string[]; excludeTagIds?: string[]; matchMode: TagMatchMode }): string {
  const parsed = tagAudienceSelectionSchema.parse(input);
  return `${STORED_TAG_FILTER_PREFIX}${JSON.stringify({ type: "tag_filter_v1", ...parsed })}`;
}

export function parseTagAudienceFilter(value: string): StoredTagAudienceFilter {
  if (value.startsWith(STORED_TAG_FILTER_PREFIX)) {
    return storedTagAudienceFilterSchema.parse(JSON.parse(value.slice(STORED_TAG_FILTER_PREFIX.length)));
  }
  if (value.startsWith("AND:")) {
    return storedTagAudienceFilterSchema.parse({
      type: "tag_filter_v1",
      tagIds: value.slice(4).split(",").filter(Boolean),
      excludeTagIds: [],
      matchMode: "all"
    });
  }
  throw new Error("保存されたタグ配信条件が不正です。");
}
