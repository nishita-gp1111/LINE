import { describe, expect, it } from "vitest";
import { chooseAutoReply, normalizeKeyword, shouldSkipAutomationSend, validateAutoReplyRule, validateScenario } from "@/lib/milestone3/automation";

describe("Milestone 3C automations", () => {
  it("validates versioned steps and prevents self loops", () => {
    expect(() => validateScenario({ name: "welcome", triggerType: "follow", steps: [{ order: 0, type: "send_message" }] })).not.toThrow();
    expect(() => validateScenario({ name: "loop", triggerType: "manual", steps: [{ order: 0, type: "start_scenario", config: { scenarioId: "current" } }] })).toThrow();
  });
  it("uses survey/free-text priority normalization before keywords", () => {
    expect(normalizeKeyword("  ＨＥＬＬＯ　  ")).toBe("hello");
    const selected = chooseAutoReply("hello there", [
      { matchType: "contains", pattern: "hello", priority: 100, isActive: true, stopAfterMatch: true, action: "contains" },
      { matchType: "prefix", pattern: "hello", priority: 0, isActive: true, stopAfterMatch: true, action: "prefix" }
    ]);
    expect(selected?.action).toBe("prefix");
  });
  it("rejects unsafe regex and skips suppressed sends", () => {
    expect(() => validateAutoReplyRule({ matchType: "regex", pattern: "(a+)+", priority: 0 })).toThrow();
    expect(shouldSkipAutomationSend("following", "suppressed")).toBe(true);
  });
});
