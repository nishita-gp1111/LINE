import { describe, expect, it } from "vitest";
import { activeTagAssignmentKey, compileSafeCondition, customFieldDefinitionSchema, isSuppressed, validateSegmentDsl } from "@/lib/milestone3/foundation";

describe("Milestone 3A foundation", () => {
  it("keeps tag provenance separate", () => {
    expect(activeTagAssignmentKey("c", "t", "manual", "p")).not.toBe(activeTagAssignmentKey("c", "t", "survey", "p"));
  });
  it("validates typed custom fields", () => {
    expect(() => customFieldDefinitionSchema.parse({ name: "Tier", key: "tier", fieldType: "single_select" })).toThrow();
    expect(customFieldDefinitionSchema.parse({ name: "Tier", key: "tier", fieldType: "single_select", options: ["gold"] }).options).toEqual(["gold"]);
  });
  it("limits segment nesting and does not accept SQL text", () => {
    expect(() => validateSegmentDsl({ conjunction: "and", conditions: [{ field: "friend_status", operator: "equals", value: "following" }], groups: [] })).not.toThrow();
    expect(() => validateSegmentDsl({ conjunction: "and", conditions: [], groups: [{ conjunction: "and", conditions: [], groups: [{ conjunction: "and", conditions: [], groups: [{ conjunction: "and", conditions: [], groups: [] }] }] }] })).toThrow();
    const compiled = compileSafeCondition({ field: "friend_status", operator: "equals", value: "following; drop table contacts" });
    expect(compiled.sql).not.toContain("drop");
    expect(compiled.params[0]).toContain("drop table");
  });
  it("excludes blocked and non-marketing contacts", () => {
    expect(isSuppressed("blocked", "eligible")).toBe(true);
    expect(isSuppressed("following", "suppressed")).toBe(true);
    expect(isSuppressed("following", "eligible")).toBe(false);
  });
});
