import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseInboxStore } from "@/lib/inbox/store-supabase";

describe("long conversation history", () => {
  it("queries the latest 200 messages, then renders them in chronological order", async () => {
    const tables: Record<string, ReturnType<typeof builder>> = {};
    function builder(table: string) {
      const data = table === "conversations" ? { id: "conversation", organization_id: "org", contact_id: "contact" }
        : table === "contacts" ? { id: "contact" }
          : table === "messages" ? [{ id: "newest", line_event_timestamp: "2026-09-26T02:00:00Z" }, { id: "previous", line_event_timestamp: "2026-09-26T01:00:00Z" }]
            : table === "conversation_read_states" ? null : [];
      return {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data }), maybeSingle: vi.fn().mockResolvedValue({ data }),
        then: (resolve: (value: { data: typeof data }) => unknown) => Promise.resolve({ data }).then(resolve)
      };
    }
    const client = { from: (table: string) => tables[table] = builder(table) } as unknown as SupabaseClient;
    const result = await new SupabaseInboxStore(client, "org").getConversation("org", "conversation", "profile");
    expect(tables.messages.order).toHaveBeenCalledWith("line_event_timestamp", { ascending: false });
    expect(tables.messages.order).toHaveBeenCalledWith("id", { ascending: false });
    expect(tables.messages.limit).toHaveBeenCalledWith(200);
    expect(tables.messages.eq).toHaveBeenCalledWith("organization_id", "org");
    expect(result?.messages.map(message => message.id)).toEqual(["previous", "newest"]);
  });
});
