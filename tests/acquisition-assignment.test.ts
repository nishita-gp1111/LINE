import { describe, expect, it, vi, beforeEach } from "vitest";
import { assignmentRuleSchema, assigneeOptionValue, assigneeUpdate } from "@/lib/acquisition/assignment";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assignAcquisitionContact } from "@/lib/acquisition/assignment-store";

const auth = vi.hoisted(() => ({ value: { organizationId: "org", profileId: "owner", role: "owner" } as { organizationId: string; profileId: string; role: string } | null, trusted: true }));
const save = vi.hoisted(() => vi.fn());
vi.mock("@/lib/inbox/auth", () => ({ getInboxAuthContext: async () => auth.value, isTrustedOrigin: () => auth.trusted, canAdminister: (role: string) => ["owner", "admin"].includes(role) }));
vi.mock("@/lib/acquisition/assignment-store", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/acquisition/assignment-store")>(), saveAssignmentRule: save }));
import { POST } from "@/app/api/acquisition/assignment/route";

const input = { routeSlug: "meeting", staffNames: ["担当A", "担当B", "担当C", "担当D"], enabled: true };
const request = (body: unknown = input) => new Request("https://crm.example/api/acquisition/assignment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { auth.value = { organizationId: "org", profileId: "owner", role: "owner" }; auth.trusted = true; save.mockReset(); });

describe("named assignment settings", () => {
  it("accepts four ordered names and rejects duplicate/empty/invalid inputs", () => {
    expect(assignmentRuleSchema.parse(input).staffNames).toEqual(input.staffNames);
    expect(assignmentRuleSchema.safeParse({ ...input, staffNames: [" A", "A "] }).success).toBe(false);
    expect(assignmentRuleSchema.safeParse({ ...input, staffNames: [] }).success).toBe(false);
    expect(assignmentRuleSchema.safeParse({ ...input, staffNames: [], enabled: false }).success).toBe(true);
    expect(assignmentRuleSchema.safeParse({ ...input, routeSlug: "unknown" }).success).toBe(false);
  });
  it("keeps names distinct from login IDs and clears the other assignment", () => {
    expect(assigneeUpdate("name:担当A")).toEqual({ assigneeName: "担当A", assigneeProfileId: null });
    expect(assigneeUpdate("profile-id")).toEqual({ assigneeName: null, assigneeProfileId: "profile-id" });
    expect(assigneeUpdate("")).toEqual({ assigneeName: null, assigneeProfileId: null });
    expect(assigneeOptionValue({ assigneeName: "担当A", assigneeProfileId: null })).toBe("name:担当A");
  });
  it("uses one atomic database call with the verified organization and contact", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await assignAcquisitionContact({ rpc } as unknown as SupabaseClient, "org", "contact", "meeting");
    expect(rpc).toHaveBeenCalledWith("assign_acquisition_contact", { target_organization_id: "org", target_contact_id: "contact", target_route_slug: "meeting" });
    rpc.mockResolvedValue({ error: { code: "test" } });
    await expect(assignAcquisitionContact({ rpc } as unknown as SupabaseClient, "org", "contact", "meeting")).rejects.toThrow("割り当て");
  });
  it("saves only for an authenticated admin and never trusts a submitted organization", async () => {
    expect((await POST(request({ ...input, organizationId: "other" }))).status).toBe(200);
    expect(save).toHaveBeenCalledWith("org", "owner", input);
    auth.value = null; expect((await POST(request())).status).toBe(401);
    auth.value = { organizationId: "org", profileId: "viewer", role: "viewer" }; expect((await POST(request())).status).toBe(403);
    auth.value.role = "owner"; auth.trusted = false; expect((await POST(request())).status).toBe(403);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid input and reports save errors without exposing database details", async () => {
    expect((await POST(request({ ...input, staffNames: [] }))).status).toBe(400);
    save.mockRejectedValue(new Error("private database details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
