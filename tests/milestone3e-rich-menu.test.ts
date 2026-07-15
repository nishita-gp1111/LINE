import { describe, expect, it } from "vitest";
import { assertPerUserRichMenuPath, assertRichMenuMutation, validateRichMenuDefinition } from "@/lib/milestone3/rich-menu";
import { RICH_MENU_LAYOUTS, scaleRichMenuLayout } from "@/lib/minimum-launch/rich-menu-layouts";
import { buildFriendlyRichMenuSvg, GP_FRIENDLY_RICH_MENU_PRESET } from "@/lib/minimum-launch/rich-menu-preset";

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
  it("scales every visual layout inside the uploaded image", () => {
    for (const layout of RICH_MENU_LAYOUTS) {
      const areas = scaleRichMenuLayout(layout.id, 2500, 1686);
      expect(areas).toHaveLength(layout.areas.length);
      for (const area of areas) {
        expect(area.x).toBeGreaterThanOrEqual(0);
        expect(area.y).toBeGreaterThanOrEqual(0);
        expect(area.width).toBeGreaterThan(0);
        expect(area.height).toBeGreaterThan(0);
        expect(area.x + area.width).toBeLessThanOrEqual(2500);
        expect(area.y + area.height).toBeLessThanOrEqual(1686);
      }
    }
  });
  it("keeps adjacent columns gap-free after pixel rounding", () => {
    const areas = scaleRichMenuLayout("grid-6", 2500, 1686);
    expect(areas[0].x + areas[0].width).toBe(areas[1].x);
    expect(areas[1].x + areas[1].width).toBe(areas[2].x);
    expect(areas[2].x + areas[2].width).toBe(2500);
    expect(areas[0].y + areas[0].height).toBe(areas[3].y);
    expect(areas[3].y + areas[3].height).toBe(1686);
  });
  it("matches the friendly hero image at a 58/42 row boundary", () => {
    const areas = scaleRichMenuLayout("hero-3-friendly", 1536, 1024);
    expect(areas).toEqual([
      { x: 0, y: 0, width: 1536, height: 593 },
      { x: 0, y: 593, width: 768, height: 431 },
      { x: 768, y: 593, width: 768, height: 431 }
    ]);
  });
  it("ships a friendly GP preset with the intended actions", () => {
    expect(GP_FRIENDLY_RICH_MENU_PRESET.layoutId).toBe("hero-3-friendly");
    expect(GP_FRIENDLY_RICH_MENU_PRESET.applyExisting).toBe(false);
    expect(GP_FRIENDLY_RICH_MENU_PRESET.actions).toEqual([
      { type: "uri", value: "https://timerex.net/s/s.nishita_b272/a237d2aa" },
      { type: "message", value: "相談したいです" },
      { type: "uri", value: "https://www.growth-path.jp/" }
    ]);
    const svg = buildFriendlyRichMenuSvg();
    expect(svg).toContain('width="1536"');
    expect(svg).toContain('height="1024"');
    expect(svg).toContain("無料相談予約");
    expect(svg).toContain("チャット相談");
    expect(svg).toContain("会社情報");
  });
});
