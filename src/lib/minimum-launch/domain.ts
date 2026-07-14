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

export function surveyQuestionClientRequestId(sessionId: string, questionId: string): string {
  return `minimum-survey-question:${sessionId}:${questionId}`;
}

export function surveyCompletionClientRequestId(sessionId: string): string {
  return `minimum-survey-complete:${sessionId}`;
}

export function surveyPostbackData(sessionId: string, token: string): string {
  return `minimum-survey:${sessionId}:${token}`;
}

export function parseSurveyPostbackData(data: string): { sessionId: string | null; token: string } | null {
  const prefix = "minimum-survey:";
  if (!data.startsWith(prefix)) return null;
  const payload = data.slice(prefix.length);
  const separator = payload.indexOf(":");
  if (separator < 0) return payload ? { sessionId: null, token: payload } : null;
  const sessionId = payload.slice(0, separator);
  const token = payload.slice(separator + 1);
  return sessionId && token ? { sessionId, token } : null;
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
