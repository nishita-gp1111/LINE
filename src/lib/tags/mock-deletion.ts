import "server-only";
import { ACQUISITION_ROUTES } from "@/lib/acquisition/routes";
import { foundationState } from "@/lib/milestone3/foundation-store";
import { listMenus, listRules, listScenarios, listSurveys } from "@/lib/milestone3/interactive-store";
import type { TagDeletionCheck } from "@/lib/tags/deletion";

export function checkMockTagDeletion(id: string, remove = false, expectedName?: string): TagDeletionCheck {
  const state = foundationState();
  const tag = state.tags.find(item => item.id === id);
  if (!tag) return { status: "not_found" };
  if (!tag.isActive) return { status: "deleted" };
  if (remove && tag.name !== expectedName) return { status: "changed" };
  const references = (value: unknown): boolean => {
    if (typeof value === "string") return value === id;
    if (Array.isArray(value)) return value.some(references);
    return !!value && typeof value === "object" && Object.values(value).some(references);
  };
  const sources: Array<[string, unknown[]]> = [
    ["surveys", listSurveys()], ["automations", listScenarios()], ["autoReplies", listRules()],
    ["segments", state.segments], ["richMenus", listMenus()]
  ];
  const blockers = sources.map(([key, items]) => ({ key, count: items.filter(references).length })).filter(item => item.count > 0);
  if (ACQUISITION_ROUTES.some(route => route.tagName === tag.name)) blockers.push({ key: "acquisition", count: 1 });
  const assignments = state.assignments.filter(item => item.tagId === id && !item.removedAt);
  const result = { tag: { id, name: tag.name }, contactCount: new Set(assignments.map(item => item.contactId)).size, blockers };
  if (blockers.length) return { ...result, status: "in_use" };
  if (remove) {
    tag.isActive = false;
    const now = new Date().toISOString();
    assignments.forEach(item => { item.removedAt = now; });
  }
  return { ...result, status: remove ? "deleted" : "ready" };
}
