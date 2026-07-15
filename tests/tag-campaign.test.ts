import { describe, expect, it } from "vitest";
import { selectTagAudience, tagCampaignSendSchema } from "@/lib/milestone3/tag-campaign";

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
    expect(result).toEqual({ recipientIds: ["a"], matchedCount: 1, excludedCount: 0 });
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
  });
});
