export const MAX_COMPOSER_LENGTH = 5000;

/** Preserve the draft, including whitespace. Selecting a template never sends it. */
export function appendTextTemplate(draft: string, template: string): string | null {
  const result = draft ? `${draft}\n${template}` : template;
  return result.length <= MAX_COMPOSER_LENGTH ? result : null;
}
