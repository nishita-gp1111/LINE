import { beforeEach, describe, expect, it } from "vitest";
import { getLaunchReadiness } from "@/lib/launch/readiness";

beforeEach(() => { process.env.MOCK_LINE_API = "true"; process.env.APP_ENV = "test"; });
describe("launch readiness", () => { it("never reports LIVE in Mock mode", async () => { const result = await getLaunchReadiness(); expect(result.state).toBe("INTERNAL TEST ONLY"); expect(result.checks.some((check) => check.key === "migration")).toBe(true); expect(result.checks.some((check) => check.key === "scheduler")).toBe(false); }); });
