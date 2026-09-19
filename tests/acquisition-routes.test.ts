import { describe, expect, it } from "vitest";
import {
  ACQUISITION_ROUTES,
  SHARED_ACQUISITION_ROUTES,
  STAFF_ACQUISITION_ROUTES,
  acquisitionRouteByMessage,
  acquisitionRouteBySlug,
  buildLineAcquisitionUrl,
  buildLineFriendUrl,
  buildLineLiffAcquisitionUrl
} from "@/lib/acquisition/routes";

describe("acquisition source links", () => {
  it("defines the three production routes and their tag names", () => {
    expect(SHARED_ACQUISITION_ROUTES.map((route) => ({ slug: route.slug, tag: route.tagName }))).toEqual([
      { slug: "meeting", tag: "面談から流入" },
      { slug: "survey", tag: "アンケート経由" },
      { slug: "hp", tag: "HP経由" }
    ]);
    expect(acquisitionRouteBySlug("unknown")).toBeNull();
  });

  it("maps four dedicated links to fixed staff and preserves the source in LIFF and fallback links", () => {
    expect(STAFF_ACQUISITION_ROUTES.map(route => [route.slug, route.fixedAssigneeName])).toEqual([
      ["meeting-imafuku", "今福"], ["meeting-shimizu", "志水"], ["meeting-uoi", "魚井"], ["meeting-nishita", "西田"]
    ]);
    expect(new Set(ACQUISITION_ROUTES.map(route => route.slug)).size).toBe(7);
    expect(new Set(ACQUISITION_ROUTES.map(route => route.registrationMessage)).size).toBe(7);
    for (const route of STAFF_ACQUISITION_ROUTES) {
      expect(route.tagName).toBe("面談から流入");
      expect(acquisitionRouteByMessage(route.registrationMessage)?.slug).toBe(route.slug);
      expect(new URL(buildLineLiffAcquisitionUrl("2000000000-AbCdEf12", route)).searchParams.get("source")).toBe(route.slug);
      const fallback = new URL(buildLineAcquisitionUrl("@example", route));
      expect(acquisitionRouteByMessage(decodeURIComponent(fallback.search.slice(1)))?.fixedAssigneeName).toBe(route.fixedAssigneeName);
    }
  });

  it("matches only the complete normalized registration message", () => {
    expect(acquisitionRouteByMessage("  面談経由で友だち追加しました\n")?.slug).toBe("meeting");
    expect(acquisitionRouteByMessage("アンケート経由で友だち追加しました")?.slug).toBe("survey");
    expect(acquisitionRouteByMessage("ＨＰ経由で友だち追加しました")?.slug).toBe("hp");
    expect(acquisitionRouteByMessage("面談経由")).toBeNull();
  });

  it("builds an official LINE chat URL with the route message prefilled", () => {
    const route = acquisitionRouteBySlug("meeting");
    if (!route) throw new Error("route missing");
    const value = buildLineAcquisitionUrl("@612evfuv", route);
    const url = new URL(value);
    expect(url.origin).toBe("https://line.me");
    expect(decodeURIComponent(url.pathname)).toBe("/R/oaMessage/@612evfuv/");
    expect(decodeURIComponent(url.search.slice(1))).toBe(route.registrationMessage);
    expect(() => buildLineAcquisitionUrl("https://invalid.example", route)).toThrow("Basic ID");
  });

  it("builds the official account profile URL used as the browser fallback", () => {
    expect(buildLineFriendUrl(" @612evfuv ")).toBe("https://line.me/R/ti/p/%40612evfuv");
    expect(() => buildLineFriendUrl("612evfuv")).toThrow("Basic ID");
  });

  it("builds a LIFF permanent URL with an allowlisted acquisition source", () => {
    const route = acquisitionRouteBySlug("hp");
    if (!route) throw new Error("route missing");
    const url = new URL(buildLineLiffAcquisitionUrl("2000000000-AbCdEf12", route));
    expect(url.origin).toBe("https://liff.line.me");
    expect(url.pathname).toBe("/2000000000-AbCdEf12/");
    expect(url.searchParams.get("source")).toBe("hp");
    expect(() => buildLineLiffAcquisitionUrl("bad/id?token=secret", route)).toThrow("LIFF ID");
  });
});
