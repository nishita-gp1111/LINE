import { z } from "zod";

export const tagMatchModeSchema = z.literal("all");

export const tagAudienceSelectionSchema = z.object({
  tagIds: z.array(z.string().uuid()).min(1, "タグを1つ以上選択してください。").max(20, "タグは20個まで選択できます。")
    .refine((values) => new Set(values).size === values.length, "同じタグが重複しています。"),
  matchMode: tagMatchModeSchema
});

export const tagCampaignSendSchema = tagAudienceSelectionSchema.extend({
  name: z.string().trim().min(1, "配信名を入力してください。").max(150, "配信名は150文字以内です。"),
  text: z.string().trim().min(1, "本文を入力してください。").max(5_000, "本文は5000文字以内です。"),
  expectedRecipientCount: z.number().int().nonnegative(),
  clientRequestId: z.string().uuid(),
  confirmation: z.literal("配信する", { error: "最終確認に「配信する」と入力してください。" })
});

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
  matchMode: TagMatchMode;
  contacts: TagAudienceContact[];
  assignments: TagAudienceAssignment[];
  maxRecipients: number;
}): { recipientIds: string[]; matchedCount: number; excludedCount: number } {
  const selectedTags = new Set(input.tagIds);
  const tagsByContact = new Map<string, Set<string>>();
  for (const assignment of input.assignments) {
    if (!selectedTags.has(assignment.tagId)) continue;
    const tags = tagsByContact.get(assignment.contactId) || new Set<string>();
    tags.add(assignment.tagId);
    tagsByContact.set(assignment.contactId, tags);
  }

  const matches = (tags: Set<string>): boolean => input.tagIds.every((tagId) => tags.has(tagId));
  const matchedIds = new Set([...tagsByContact.entries()].filter(([, tags]) => matches(tags)).map(([contactId]) => contactId));
  const recipientIds = [...new Set(input.contacts
    .filter((contact) => matchedIds.has(contact.id))
    .filter((contact) => contact.friendStatus === "following")
    .filter((contact) => (contact.marketingStatus || "eligible") === "eligible")
    .map((contact) => contact.id))].sort();

  if (recipientIds.length > input.maxRecipients) throw new Error(`配信対象は${input.maxRecipients}名以内にしてください。`);
  return {
    recipientIds,
    matchedCount: matchedIds.size,
    excludedCount: Math.max(0, matchedIds.size - recipientIds.length)
  };
}
