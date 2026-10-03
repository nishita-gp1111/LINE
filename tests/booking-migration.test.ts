import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(fileURLToPath(new URL("../supabase/migrations/20260719010000_booking_management.sql", import.meta.url)), "utf8");

describe("Booking Management migration", () => {
  it("creates all booking tables without modifying existing CRM tables", () => {
    for (const table of ["booking_forms", "booking_questions", "booking_types", "booking_members", "calendar_connections", "bookings", "booking_answers", "booking_reminders"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.%I enable row level security`);
    }
    expect(migration).not.toMatch(/alter table public\.contacts\s/i);
  });

  it("enforces organization-scoped foreign keys and double-booking prevention", () => {
    expect(migration).toContain("unique (organization_id, id)");
    expect(migration).toContain("foreign key (organization_id, booking_member_id)");
    expect(migration).toContain("bookings_member_busy_time_excl");
    expect(migration).toContain("tstzrange(busy_starts_at, busy_ends_at, '[)') with &&");
  });

  it("keeps initializer output names distinct from booking table columns", () => {
    expect(migration).toContain("returns table(default_form_id uuid, default_booking_type_id uuid)");
    expect(migration).not.toContain("returns table(form_id uuid, booking_type_id uuid)");
  });

  it("stores only hashes or encrypted capability tokens", () => {
    expect(migration).toContain("public_token_hash text not null unique");
    expect(migration).toContain("reschedule_token_hash text not null unique");
    expect(migration).toContain("encrypted_reschedule_token text not null");
    expect(migration).toContain("encrypted_refresh_token text not null");
    expect(migration).not.toMatch(/\n\s+refresh_token\s+text\s+not\s+null/);
  });
});
