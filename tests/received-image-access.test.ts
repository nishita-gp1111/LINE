import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: true, mode: "supabase", mockLine: false, client: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/inbox/auth", () => ({ getInboxAuthContext: async () => mocks.auth ? { organizationId: "org-a" } : null }));
vi.mock("@/lib/auth/config", () => ({ getAuthMode: () => mocks.mode }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => ({ MOCK_LINE_API: mocks.mockLine, LINE_CHANNEL_ACCESS_TOKEN: "test-token", LINE_MEDIA_BUCKET: "line-media" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.client }));
vi.mock("@/lib/line/received-image", async original => ({ ...await original<typeof import("@/lib/line/received-image")>(), fetchReceivedImage: mocks.download }));
import { getReceivedImage } from "@/lib/inbox/received-image";
import { GET } from "@/app/api/inbox/messages/[id]/image/route";

const id = "00000000-0000-4000-8000-000000000001";
function fakeClient({ exists = true, cached = false, publicBucket = false, unsent = false } = {}) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: exists ? { id, line_message_id: "line-123" } : null, error: null }) };
  if (unsent) query.maybeSingle.mockResolvedValueOnce({ data: { id, line_message_id: "line-123" }, error: null }).mockResolvedValue({ data: null, error: null });
  const storage = { download: vi.fn().mockResolvedValue({ data: cached ? new Blob(["cached"], { type: "image/jpeg" }) : null }), upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) };
  mocks.client.mockReturnValue({ from: vi.fn().mockReturnValue(query), storage: { from: vi.fn().mockReturnValue(storage), getBucket: vi.fn().mockResolvedValue({ data: { public: publicBucket } }) } });
  return { query, storage };
}
beforeEach(() => { vi.clearAllMocks(); mocks.auth = true; mocks.mockLine = false; mocks.mode = "supabase"; mocks.download.mockResolvedValue(Buffer.from("normalized jpeg")); });
describe("received image access", () => {
  it("rejects anonymous access before touching LINE or storage", async () => {
    mocks.auth = false;
    const response = await GET(new Request("https://crm.example/image"), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(401); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("scopes access to org, inbound image, received and not-deleted", async () => {
    const { query } = fakeClient({ exists: false });
    await expect(getReceivedImage("org-a", id)).rejects.toMatchObject({ status: 404 });
    expect(query.eq).toHaveBeenCalledWith("organization_id", "org-a");
    expect(query.eq).toHaveBeenCalledWith("direction", "inbound");
    expect(query.eq).toHaveBeenCalledWith("message_type", "image");
    expect(query.eq).toHaveBeenCalledWith("status", "received");
    expect(query.is).toHaveBeenCalledWith("deleted_at", null);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("uses private cached content without a LINE request", async () => {
    fakeClient({ cached: true }); expect(await (await getReceivedImage("org-a", id)).text()).toBe("cached"); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("archives recovered historic images and sends no-store response", async () => {
    const { storage } = fakeClient();
    const response = await GET(new Request("https://crm.example/image"), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(storage.upload).toHaveBeenCalledWith(`org-a/inbound/${id}/display.jpg`, expect.any(Buffer), expect.objectContaining({ contentType: "image/jpeg" }));
    expect(await response.text()).not.toContain("test-token");
  });
  it("does not upload customer images to a public bucket", async () => {
    const { storage } = fakeClient({ publicBucket: true });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await getReceivedImage("org-a", id); expect(storage.upload).not.toHaveBeenCalled(); log.mockRestore();
  });
  it("does not contact LINE when MOCK_LINE_API is on", async () => {
    fakeClient(); mocks.mockLine = true;
    await expect(getReceivedImage("org-a", id)).rejects.toMatchObject({ status: 410 }); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("removes downloaded image if unsend occurs during download", async () => {
    const { storage } = fakeClient({ unsent: true });
    await expect(getReceivedImage("org-a", id)).rejects.toMatchObject({ status: 404 }); expect(storage.remove).toHaveBeenCalled();
  });
});
