import { describe, expect, it } from "vitest";
import { assertPerUserRichMenuPath, assertRichMenuMutation, validateRichMenuDefinition } from "@/lib/milestone3/rich-menu";

describe("Milestone 3E rich menu", () => {
  const definition = { width: 2500, height: 1686, chatBarText: "メニュー", areas: [{ x: 0, y: 0, width: 1250, height: 843, action: { type: "uri", uri: "https://example.com" } }] };
  it("validates bounds and HTTPS actions", () => {
    expect(validateRichMenuDefinition(definition).areas).toHaveLength(1);
    expect(() => validateRichMenuDefinition({ ...definition, areas: [{ ...definition.areas[0], x: 2400 }] })).toThrow();
    expect(() => validateRichMenuDefinition({ ...definition, areas: [{ ...definition.areas[0], action: { type: "uri", uri: "http://example.com" } }] })).toThrow();
  });
  it("requires explicit owner confirmation before global default changes", () => {
    expect(() => assertRichMenuMutation({ mock: false, enabled: false, role: "owner", isDefaultChange: true, confirmation: "SET_DEFAULT_RICH_MENU" })).toThrow();
    expect(() => assertRichMenuMutation({ mock: false, enabled: true, role: "admin", isDefaultChange: true, confirmation: "SET_DEFAULT_RICH_MENU" })).toThrow();
    expect(() => assertRichMenuMutation({ mock: false, enabled: true, role: "owner", isDefaultChange: true, confirmation: "SET_DEFAULT_RICH_MENU" })).toThrow();
  });
  it("rejects the LINE default rich-menu endpoint", () => {
    expect(() => assertPerUserRichMenuPath("/v2/bot/user/all/richmenu/Rmenu")).toThrow();
    expect(() => assertPerUserRichMenuPath("/v2/bot/user/U123/richmenu/Rmenu")).not.toThrow();
  });
});
