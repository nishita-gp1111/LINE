import { describe, expect, it } from "vitest";
import {
  ACQUISITION_ROUTES,
  acquisitionRouteByMessage,
  acquisitionRouteBySlug,
  buildLineAcquisitionUrl,
  buildLineFriendUrl
} from "@/lib/acquisition/routes";

describe("acquisition source links", () => {
  it("defines the two production routes and their tag names", () => {
    expect(ACQUISITION_ROUTES.map((route) => ({ slug: route.slug, tag: route.tagName }))).toEqual([
      { slug: "meeting", tag: "面談から流入" },
      { slug: "survey", tag: "アンケート経由" }
    ]);
    expect(acquisitionRouteBySlug("unknown")).toBeNull();
  });

  it("matches only the complete normalized registration message", () => {
    expect(acquisitionRouteByMessage("  面談経由で友だち追加しました\n")?.slug).toBe("meeting");
    expect(acquisitionRouteByMessage("アンケート経由で友だち追加しました")?.slug).toBe("survey");
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
});
