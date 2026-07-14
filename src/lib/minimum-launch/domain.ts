export type RichMenuRuleCandidate = {
  id: string;
  tagId: string;
  richMenuId: string;
  priority: number;
  createdAt: string;
};

export function surveyResponseKey(sessionId: string, questionId: string): string {
  return `survey-response:${sessionId}:${questionId}`;
}

export function followSurveyClientRequestId(webhookEventId: string, surveyId: string, contactId: string): string {
  return `minimum-follow-survey:${webhookEventId}:${surveyId}:${contactId}`;
}

export function assignmentEffectMetadata(effectiveAdded: boolean): Record<string, boolean> {
  return { effectiveAdded };
}

export function shouldRunTagAddedEffects(metadata: unknown): boolean {
  return Boolean(metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).effectiveAdded === true);
}

export function selectRichMenuRule(activeTagIds: Iterable<string>, rules: RichMenuRuleCandidate[]): RichMenuRuleCandidate | null {
  const active = new Set(activeTagIds);
  return rules
    .filter((rule) => active.has(rule.tagId))
    .sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))[0] || null;
}
