import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TagDeletionCheck } from "@/lib/tags/deletion";
import { ACQUISITION_ROUTES } from "@/lib/acquisition/routes";

const migration = readFileSync("supabase/migrations/20261007010000_safe_tag_deletion.sql", "utf8");
const definitions = ["automation_scenarios", "automation_steps", "auto_reply_rules", "campaigns", "funnel_steps", "rich_menu_areas", "rich_menu_rules", "rich_menus", "segments", "survey_options", "survey_questions", "surveys"];
const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID();
let db: PGlite;
let tag: string;
async function check(remove = false, organization = org, profile = actor, name = "テストタグ") {
  return (await db.query<{ result: TagDeletionCheck }>("select manage_crm_tag_deletion($1,$2,$3,$4,$5) result", [organization, profile, tag, remove, name])).rows[0].result;
}
async function active() { return (await db.query<{ is_active: boolean }>("select is_active from tags where id=$1", [tag])).rows[0].is_active; }
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organization_members (organization_id uuid, profile_id uuid, role text);
    create table tags (id uuid primary key default gen_random_uuid(), organization_id uuid not null, name text not null, is_active boolean default true, updated_at timestamptz default now());
    create unique index tags_active_name_idx on tags(organization_id,lower(name)) where is_active;
    create table contact_tag_assignments (id uuid primary key default gen_random_uuid(), organization_id uuid, tag_id uuid references tags, contact_id uuid, removed_at timestamptz, removed_by_profile_id uuid, updated_at timestamptz default now());
    create table audit_logs (organization_id uuid, actor_profile_id uuid, action text, resource_type text, resource_id uuid, metadata_json jsonb);
  `);
  for (const table of definitions) await db.exec(`create table ${table} (id uuid primary key default gen_random_uuid(), organization_id uuid, config_json jsonb default '{}', tag_id uuid, status text default 'draft', description text default '');`);
  await db.exec(migration); await db.exec(migration);
  await db.query("insert into organization_members values ($1,$2,'owner')", [org, actor]);
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate ${definitions.join(",")}, contact_tag_assignments, audit_logs, tags cascade`);
  tag = randomUUID();
  await db.query("insert into tags(id,organization_id,name) values ($1,$2,'テストタグ')", [tag, org]);
});
afterAll(async () => { await db?.close(); });

describe("transactional tag deletion", () => {
  it("previews without changing data; removes all active provenance but preserves history and contacts", async () => {
    const contact = randomUUID();
    await db.query("insert into contact_tag_assignments (organization_id,tag_id,contact_id) values ($1,$2,$3),($1,$2,$3)", [org, tag, contact]);
    expect(await check()).toMatchObject({ status: "ready", contactCount: 1 });
    expect(await active()).toBe(true);
    expect(await check(true)).toMatchObject({ status: "deleted", contactCount: 1 });
    expect(await active()).toBe(false);
    const assignments = await db.query<{ removed_at: string; removed_by_profile_id: string }>("select removed_at,removed_by_profile_id from contact_tag_assignments");
    expect(assignments.rows).toHaveLength(2);
    expect(assignments.rows.every(row => row.removed_at && row.removed_by_profile_id === actor)).toBe(true);
    expect((await db.query("select * from audit_logs")).rows).toHaveLength(1);
    expect(await check(true)).toEqual({ status: "deleted" });
    expect((await db.query("select * from audit_logs")).rows).toHaveLength(1);
    await db.query("insert into tags(organization_id,name) values ($1,'テストタグ')", [org]);
  });
  it.each(definitions)("protects nested references in %s, including paused/draft settings", async table => {
    await db.query(`insert into ${table}(organization_id,config_json) values ($1,$2)`, [org, { nested: { excludeTagIds: [tag] } }]);
    expect((await check()).status).toBe("in_use"); expect((await check(true)).status).toBe("in_use");
    expect(await active()).toBe(true);
  });
  it("protects direct rich-menu foreign keys and legacy AND campaign conditions", async () => {
    await db.query("insert into rich_menu_rules(organization_id,tag_id) values ($1,$2)", [org, tag]);
    expect((await check()).blockers).toEqual([{ key: "richMenus", count: 1 }]);
    await db.exec("truncate rich_menu_rules");
    await db.query("insert into campaigns(organization_id,description) values ($1,$2)", [org, `AND:${tag}`]);
    expect((await check()).blockers).toEqual([{ key: "campaigns", count: 1 }]);
  });
  it("protects equivalent upper-case UUIDs in stored JSON", async () => {
    await db.query("insert into survey_options(organization_id,config_json) values ($1,$2)", [org, { tagId: tag.toUpperCase() }]);
    expect((await check()).status).toBe("in_use");
    await db.exec("truncate survey_options"); await check(true);
    await expect(db.query("insert into survey_options(organization_id,config_json) values ($1,$2)", [org, { tagId: tag.toUpperCase() }])).rejects.toThrow("Archived tag");
  });
  it("ignores completed campaign history but rejects a subsequent resume", async () => {
    await db.query("insert into campaigns(organization_id,description,status) values ($1,$2,'completed')", [org, `TAG_FILTER_V1:${JSON.stringify({ excludeTagIds: [tag] })}`]);
    expect((await check(true)).status).toBe("deleted");
    await db.exec("update campaigns set status='completed'");
    await expect(db.exec("update campaigns set status='sending'")).rejects.toThrow("Archived tag");
  });
  it("checks references again after the confirmation preview", async () => {
    expect((await check()).status).toBe("ready");
    await db.query("insert into survey_options(organization_id,config_json) values ($1,$2)", [org, { tagId: tag }]);
    expect((await check(true)).status).toBe("in_use");
  });
  it("rejects stale assignments and settings after deletion", async () => {
    await check(true);
    await expect(db.query("insert into contact_tag_assignments(organization_id,tag_id,contact_id) values ($1,$2,$3)", [org, tag, randomUUID()])).rejects.toThrow("Archived tag");
    await expect(db.query("insert into survey_options(organization_id,config_json) values ($1,$2)", [org, { tagId: tag }])).rejects.toThrow("Archived tag");
    // Removed assignments can still be retained as history.
    await db.query("insert into contact_tag_assignments(organization_id,tag_id,contact_id,removed_at) values ($1,$2,$3,now())", [org, tag, randomUUID()]);
  });
  it("protects every built-in acquisition tag", async () => {
    for (const name of new Set(ACQUISITION_ROUTES.map(route => route.tagName))) {
      await db.query("update tags set name=$1 where id=$2", [name, tag]);
      expect((await check(true, org, actor, name)).blockers).toContainEqual({ key: "acquisition", count: 1 });
    }
  });
  it("checks permission, organization boundary and confirmed tag name", async () => {
    expect((await check(true, otherOrg)).status).toBe("forbidden");
    await db.query("insert into organization_members values ($1,$2,'admin')", [otherOrg, actor]);
    expect((await check(true, otherOrg)).status).toBe("not_found");
    expect((await check(true, org, randomUUID())).status).toBe("forbidden");
    expect((await check(true, org, actor, "古いタグ名")).status).toBe("changed");
    expect(await active()).toBe(true);
    await db.query("insert into segments(organization_id,config_json) values ($1,$2)", [otherOrg, { tagId: tag }]);
    expect((await check()).status).toBe("ready");
  });
  it("restricts RPC execution and has bounded write locks without invoking external services", async () => {
    const permission = await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','public.manage_crm_tag_deletion(uuid,uuid,uuid,boolean,text)','execute') allowed");
    expect(permission.rows[0].allowed).toBe(false);
    expect(migration).toContain("in share row exclusive mode"); expect(migration).toContain("'lock_timeout', '2s'");
    expect(migration).not.toContain("api.line.me");
  });
});
