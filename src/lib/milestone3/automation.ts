import { z } from "zod";

export const automationStepSchema = z.object({
  order: z.number().int().nonnegative(),
  type: z.enum(["send_message", "wait_duration", "wait_until", "add_tag", "remove_tag", "set_custom_field", "branch", "start_scenario", "stop_scenario", "end"]),
  config: z.record(z.string(), z.unknown()).default({})
});
export type AutomationStep = z.infer<typeof automationStepSchema>;

export const automationScenarioSchema = z.object({
  name: z.string().trim().min(1).max(150),
  triggerType: z.enum(["follow", "tag_added", "tag_removed", "survey_answered", "survey_completed", "custom_field_changed", "tracked_link_clicked", "manual"]),
  allowReentry: z.boolean().default(false),
  reentryCooldownSeconds: z.number().int().nonnegative().default(0),
  steps: z.array(automationStepSchema).max(50)
});

export function validateScenario(input: unknown): z.infer<typeof automationScenarioSchema> {
  const scenario = automationScenarioSchema.parse(input);
  const orders = new Set<number>();
  for (const step of scenario.steps) {
    if (orders.has(step.order)) throw new Error("step orderが重複しています。");
    orders.add(step.order);
    if (step.type === "start_scenario" && step.config.scenarioId === undefined) throw new Error("start_scenarioにはscenarioIdが必要です。");
    if (step.type === "wait_duration" && (!Number.isInteger(step.config.seconds) || Number(step.config.seconds) < 1)) throw new Error("wait durationが不正です。");
  }
  const graph = new Map<string, string[]>();
  for (const step of scenario.steps) {
    const target = typeof step.config.scenarioId === "string" ? step.config.scenarioId : null;
    if (target) graph.set("current", [...(graph.get("current") ?? []), target]);
  }
  if ((graph.get("current") ?? []).some((target) => target === "current")) throw new Error("scenarioの自己循環は禁止です。");
  return scenario;
}

export function normalizeKeyword(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ja-JP");
}

export const autoReplyRuleSchema = z.object({
  matchType: z.enum(["exact", "prefix", "contains", "regex"]),
  pattern: z.string().trim().min(1).max(200),
  priority: z.number().int().nonnegative().default(0),
  isActive: z.boolean().default(true),
  stopAfterMatch: z.boolean().default(true)
});

export function validateAutoReplyRule(input: unknown): z.infer<typeof autoReplyRuleSchema> {
  const rule = autoReplyRuleSchema.parse(input);
  if (rule.matchType === "regex") {
    if (/\([^)]*[+*][^)]*\)[+*{]/u.test(rule.pattern) || /(\([^?][^)]*\))\1/u.test(rule.pattern)) throw new Error("安全性確認が必要なregexです。");
    try { new RegExp(rule.pattern, "iu"); } catch { throw new Error("regexが不正です。"); }
  }
  return rule;
}

type ReplyRule = z.infer<typeof autoReplyRuleSchema> & { action: string };
export function chooseAutoReply(input: string, rules: ReplyRule[]): ReplyRule | null {
  const normalized = normalizeKeyword(input);
  const rank: Record<ReplyRule["matchType"], number> = { exact: 0, prefix: 1, contains: 2, regex: 3 };
  return rules.filter((rule) => rule.isActive).sort((a, b) => rank[a.matchType] - rank[b.matchType] || b.priority - a.priority).find((rule) => {
    if (rule.matchType === "exact") return normalized === normalizeKeyword(rule.pattern);
    if (rule.matchType === "prefix") return normalized.startsWith(normalizeKeyword(rule.pattern));
    if (rule.matchType === "contains") return normalized.includes(normalizeKeyword(rule.pattern));
    return new RegExp(rule.pattern, "iu").test(input);
  }) ?? null;
}

export function shouldSkipAutomationSend(friendStatus: string, marketingStatus: string): boolean {
  return friendStatus === "blocked" || marketingStatus !== "eligible";
}
