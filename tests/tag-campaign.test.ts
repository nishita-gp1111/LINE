import { describe, expect, it } from "vitest";
import { parseTagAudienceFilter, selectTagAudience, serializeTagAudienceFilter, tagCampaignSendSchema } from "@/lib/milestone3/tag-campaign";

const contacts = [
  { id: "a", friendStatus: "following" },
  { id: "b", friendStatus: "following" },
  { id: "c", friendStatus: "following" },
  { id: "d", friendStatus: "blocked" },
  { id: "e", friendStatus: "following", marketingStatus: "suppressed" }
];
const assignments = [
  { contactId: "a", tagId: "tag-a" },
  { contactId: "a", tagId: "tag-b" },
  { contactId: "b", tagId: "tag-b" },
  { contactId: "c", tagId: "tag-c" },
  { contactId: "d", tagId: "tag-a" },
  { contactId: "e", tagId: "tag-a" }
];

describe("tag campaign audience", () => {
  it("selects only contacts matching every selected tag", () => {
    const result = selectTagAudience({ tagIds: ["tag-a", "tag-b"], matchMode: "all", contacts, assignments, maxRecipients: 50 });
    expect(result).toEqual({ recipientIds: ["a"], matchedCount: 1, excludedCount: 0, excludedByTagCount: 0 });
  });

  it("excludes a matched contact when it has any selected exclusion tag", () => {
    const result = selectTagAudience({
      tagIds: ["tag-a", "tag-b"],
      excludeTagIds: ["tag-converted", "tag-no-delivery"],
      matchMode: "all",
      contacts: [...contacts, { id: "f", friendStatus: "following" }, { id: "g", friendStatus: "following" }],
      assignments: [
        ...assignments,
        { contactId: "f", tagId: "tag-a" },
        { contactId: "f", tagId: "tag-b" },
        { contactId: "f", tagId: "tag-converted" },
        { contactId: "g", tagId: "tag-a" },
        { contactId: "g", tagId: "tag-b" },
        { contactId: "g", tagId: "tag-no-delivery" }
      ],
      maxRecipients: 50
    });
    expect(result).toEqual({ recipientIds: ["a"], matchedCount: 3, excludedCount: 2, excludedByTagCount: 2 });
  });

  it("requires an explicit typed confirmation and stable recipient count", () => {
    const base = {
      tagIds: ["00000000-0000-4000-8000-000000000001"],
      matchMode: "all",
      name: "対象タグ配信",
      text: "ご案内です。",
      expectedRecipientCount: 1,
      clientRequestId: "00000000-0000-4000-8000-000000000002"
    };
    expect(tagCampaignSendSchema.safeParse({ ...base, confirmation: "送信" }).success).toBe(false);
    expect(tagCampaignSendSchema.safeParse({ ...base, confirmation: "配信する" }).success).toBe(true);
    expect(tagCampaignSendSchema.safeParse({ ...base, matchMode: "any", confirmation: "配信する" }).success).toBe(false);
    expect(tagCampaignSendSchema.safeParse({ ...base, excludeTagIds: [base.tagIds[0]], confirmation: "配信する" }).success).toBe(false);
  });

  it("stores exclusion conditions for the final server-side recipient check", () => {
    const filter = {
      tagIds: ["00000000-0000-4000-8000-000000000001"],
      excludeTagIds: ["00000000-0000-4000-8000-000000000002"],
      matchMode: "all" as const
    };
    expect(parseTagAudienceFilter(serializeTagAudienceFilter(filter))).toEqual({ type: "tag_filter_v1", ...filter });
    expect(parseTagAudienceFilter(`AND:${filter.tagIds[0]}`)).toEqual({ type: "tag_filter_v1", tagIds: filter.tagIds, excludeTagIds: [], matchMode: "all" });
  });
});
