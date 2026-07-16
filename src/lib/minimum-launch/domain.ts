export type RichMenuRuleCandidate = {
  id: string;
  tagId: string;
  richMenuId: string;
  priority: number;
  createdAt: string;
};

export type SurveyRichMenuCandidate = {
  richMenuId: string | null;
  status: string;
  startedAt: string;
  fallbackMinutes: number;
};

export function surveyResponseKey(sessionId: string, questionId: string): string {
  return `survey-response:${sessionId}:${questionId}`;
}

export function followSurveyClientRequestId(webhookEventId: string, surveyId: string, contactId: string): string {
  return `minimum-follow-survey:${webhookEventId}:${surveyId}:${contactId}`;
}

export function surveyGreetingClientRequestId(webhookEventId: string, surveyId: string, contactId: string): string {
  return `minimum-survey-greeting:${webhookEventId}:${surveyId}:${contactId}`;
}

export function surveyQuestionClientRequestId(sessionId: string, questionId: string): string {
  return `minimum-survey-question:${sessionId}:${questionId}`;
}

export function surveyCompletionClientRequestId(sessionId: string): string {
  return `minimum-survey-complete:${sessionId}`;
}

export function surveyRichMenuJobKey(sessionId: string): string {
  return `survey-rich-menu:${sessionId}`;
}

export function surveyRichMenuRunAt(startedAt: Date, delayMinutes: number): string {
  const minutes = Math.min(Math.max(Math.round(delayMinutes), 1), 1_440);
  return new Date(startedAt.getTime() + minutes * 60 * 1000).toISOString();
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

export function selectEligibleSurveyRichMenu(candidates: SurveyRichMenuCandidate[], now = new Date()): string | null {
  const nowMs = now.getTime();
  return candidates
    .filter((candidate) => {
      if (!candidate.richMenuId) return false;
      if (candidate.status === "completed") return true;
      const delay = Math.min(Math.max(Math.round(candidate.fallbackMinutes), 1), 1_440) * 60 * 1000;
      return candidate.status === "active" && Date.parse(candidate.startedAt) + delay <= nowMs;
    })
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))[0]?.richMenuId || null;
}
