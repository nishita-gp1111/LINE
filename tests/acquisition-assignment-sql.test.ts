import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260919010000_acquisition_assignment.sql", "utf8");
const inboxMigration = readFileSync("supabase/migrations/20260712020000_milestone_2_inbox.sql", "utf8");
const ensureConversation = inboxMigration.match(/create or replace function public.ensure_conversation_for_contact[\s\S]*?\$\$;/)?.[0];
const org = randomUUID();
const otherOrg = randomUUID();
const actor = randomUUID();
// Synthetic labels, not customer/account data.
const names = ["担当A", "担当B", "担当C", "担当D"];
let db: PGlite;

async function contact(organization = org) {
  const id = randomUUID();
  await db.query("insert into contacts (id, organization_id) values ($1, $2)", [id, organization]);
  return id;
}
async function save(staff = names, enabled = true, slug = "meeting", actorId = actor, organization = org) {
  return db.query("select save_acquisition_assignment_rule($1,$2,$3,$4,$5)", [organization, actorId, slug, staff, enabled]);
}
async function assign(id: string, slug = "meeting", organization = org) {
  const result = await db.query<{ result: { status: string } }>("select assign_acquisition_contact($1,$2,$3) as result", [organization, id, slug]);
  return result.rows[0].result.status;
}
async function name(id: string) {
  const result = await db.query<{ assignee_name: string | null; assignee_profile_id: string | null }>("select assignee_name, assignee_profile_id from conversations where contact_id=$1", [id]);
  return result.rows[0];
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organizations (id uuid primary key);
    create table profiles (id uuid primary key);
    create table organization_members (organization_id uuid references organizations, profile_id uuid references profiles, role text);
    create table contacts (id uuid primary key, organization_id uuid references organizations, unique(organization_id,id));
    create table conversations (id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations,
      contact_id uuid not null, assignee_profile_id uuid references profiles, last_message_at timestamptz, updated_at timestamptz default now(),
      unique(organization_id,contact_id), foreign key(organization_id,contact_id) references contacts(organization_id,id));
  `);
  if (!ensureConversation) throw new Error("Existing ensure_conversation_for_contact missing");
  await db.exec(ensureConversation);
  await db.exec(migration);
  await db.exec(migration); // Applying the new migration twice remains safe.
  await db.query("insert into organizations values ($1),($2)", [org, otherOrg]);
  await db.query("insert into profiles values ($1)", [actor]);
  await db.query("insert into organization_members values ($1,$2,'owner')", [org, actor]);
}, 30000);
beforeEach(async () => {
  await db.exec("truncate acquisition_assignment_decisions, acquisition_assignment_rules, conversations, contacts cascade");
});
afterAll(async () => { await db?.close(); });

describe("actual PostgreSQL assignment migration", () => {
  it("cycles evenly over four named assignees without creating login accounts", async () => {
    await save();
    const results: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = await contact();
      expect(await assign(id)).toBe("assigned");
      results.push((await name(id)).assignee_name!);
    }
    expect(results).toEqual([...names, ...names, ...names]);
    expect((await db.query<{ count: number }>("select count(*)::int as count from profiles")).rows[0].count).toBe(1);
  });

  it("handles overlapping requests and duplicate contact claims once", async () => {
    await save();
    const ids = await Promise.all(Array.from({ length: 40 }, () => contact()));
    await Promise.all(ids.flatMap(id => [assign(id), assign(id)]));
    const grouped = await db.query<{ assignee_name: string; count: number }>("select assignee_name, count(*)::int as count from conversations group by assignee_name order by assignee_name");
    expect(grouped.rows.map(row => row.count)).toEqual([10, 10, 10, 10]);
    expect((await db.query<{ next_index: number }>("select next_index::int from acquisition_assignment_rules")).rows[0].next_index).toBe(40);
    // PGlite is single-connection; assert the production SQL has both row locks.
    expect(migration.match(/for update;/g)).toHaveLength(2);
  });

  it("preserves an existing login assignee without advancing the sequence", async () => {
    await save();
    const id = await contact();
    await db.query("insert into conversations(organization_id,contact_id,assignee_profile_id) values ($1,$2,$3)", [org, id, actor]);
    expect(await assign(id)).toBe("preserved");
    expect((await name(id)).assignee_profile_id).toBe(actor);
    const next = await contact();
    await assign(next);
    expect((await name(next)).assignee_name).toBe(names[0]);
  });

  it("preserves a manual name and manual unassignment across repeat and other-route claims", async () => {
    await save(); await save(names, true, "hp");
    const id = await contact();
    await db.query("insert into conversations(organization_id,contact_id,assignee_name) values ($1,$2,'手動担当')", [org, id]);
    expect(await assign(id)).toBe("preserved");
    await db.query("update conversations set assignee_name=null where contact_id=$1", [id]);
    expect(await assign(id, "hp")).toBe("duplicate");
    expect((await name(id)).assignee_name).toBeNull();
  });

  it("does nothing on unconfigured/disabled routes and resumes at the same position", async () => {
    const id = await contact();
    expect(await assign(id)).toBe("disabled");
    expect(await name(id)).toBeUndefined();
    await save(); await assign(id); await save(names, false);
    expect(await assign(await contact())).toBe("disabled");
    await save();
    const next = await contact(); await assign(next);
    expect((await name(next)).assignee_name).toBe(names[1]);
    expect(await assign(await contact(), "survey")).toBe("disabled");
  });

  it("validates names and permissions and rejects cross-organization contacts", async () => {
    await expect(save([], true)).rejects.toThrow();
    await expect(save(["A", " A "])).rejects.toThrow();
    await expect(save([" "])).rejects.toThrow();
    await expect(save(["x".repeat(41)])).rejects.toThrow();
    await expect(save(names, true, "meeting", randomUUID())).rejects.toThrow("Administrator");
    await save();
    await expect(assign(await contact(otherOrg))).rejects.toThrow("Contact not found");
    const permissions = await db.query<{ can_call: boolean; can_write: boolean }>("select has_function_privilege('authenticated','public.assign_acquisition_contact(uuid,uuid,text)','execute') as can_call, has_table_privilege('authenticated','public.acquisition_assignment_rules','insert') as can_write");
    expect(permissions.rows[0]).toEqual({ can_call: false, can_write: false });
  });

  it("allows a manual switch between a login assignee and a name but rejects both", async () => {
    await save(); const id = await contact(); await assign(id);
    await expect(db.query("update conversations set assignee_profile_id=$1 where contact_id=$2", [actor,id])).rejects.toThrow();
    await db.query("update conversations set assignee_name=null, assignee_profile_id=$1 where contact_id=$2", [actor,id]);
    expect(await assign(id)).toBe("duplicate");
    expect((await name(id)).assignee_profile_id).toBe(actor);
  });

  it("resets the next position only when the ordered names change", async () => {
    await save(); await assign(await contact()); await save();
    const next = await contact(); await assign(next); expect((await name(next)).assignee_name).toBe(names[1]);
    await save([...names].reverse());
    const reordered = await contact(); await assign(reordered); expect((await name(reordered)).assignee_name).toBe(names[3]);
  });
});
