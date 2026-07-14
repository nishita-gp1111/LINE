import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureInitialOrganizationWithClient,
  type OrganizationBootstrapResult
} from "../src/lib/auth/organization";

type FakeState = {
  organizations: Array<{ id: string; created_by: string }>;
  memberships: Array<{ organization_id: string; profile_id: string; role: OrganizationBootstrapResult["role"] }>;
  organizationInserts: number;
};

function fakeClient(state: FakeState): SupabaseClient {
  return {
    from(table: string) {
      const filters: Record<string, string> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        limit: async () => {
          if (table === "organizations") {
            return {
              data: state.organizations.filter((row) => !filters.id || row.id === filters.id),
              error: null
            };
          }
          return {
            data: state.memberships.filter(
              (row) => row.profile_id === filters.profile_id && (!filters.organization_id || row.organization_id === filters.organization_id)
            ),
            error: null
          };
        },
        insert(values: { id: string; name: string; created_by: string }) {
          state.organizationInserts += 1;
          state.organizations.push({ id: values.id, created_by: values.created_by });
          return {
            select() {
              return this;
            },
            limit: async () => ({ data: [{ id: values.id, created_by: values.created_by }], error: null })
          };
        },
        upsert: async (values: { organization_id: string; profile_id: string; role: OrganizationBootstrapResult["role"] }) => {
          if (!state.memberships.some((row) => row.organization_id === values.organization_id && row.profile_id === values.profile_id)) {
            state.memberships.push(values);
          }
          return { error: null };
        }
      };
      return builder;
    }
  } as unknown as SupabaseClient;
}

const options = { organizationId: "00000000-0000-4000-8000-000000000001" };
const user = { id: "00000000-0000-4000-8000-000000000099", email: "owner@example.com" };

describe("initial organization bootstrap", () => {
  it("creates one organization and an owner membership when none exists", async () => {
    const state: FakeState = { organizations: [], memberships: [], organizationInserts: 0 };
    const result = await ensureInitialOrganizationWithClient(user, fakeClient(state), options);

    expect(result).toEqual({ organizationId: options.organizationId, role: "owner" });
    expect(state.organizations).toHaveLength(1);
    expect(state.memberships).toEqual([{ organization_id: options.organizationId, profile_id: user.id, role: "owner" }]);
  });

  it("does not create or claim an existing organization", async () => {
    const state: FakeState = {
      organizations: [{ id: options.organizationId, created_by: "00000000-0000-4000-8000-000000000098" }],
      memberships: [],
      organizationInserts: 0
    };
    const result = await ensureInitialOrganizationWithClient(user, fakeClient(state), options);

    expect(result).toBeNull();
    expect(state.organizationInserts).toBe(0);
    expect(state.memberships).toHaveLength(0);
  });

  it("keeps an existing membership unchanged", async () => {
    const state: FakeState = {
      organizations: [{ id: options.organizationId, created_by: user.id }],
      memberships: [{ organization_id: options.organizationId, profile_id: user.id, role: "admin" }],
      organizationInserts: 0
    };
    const result = await ensureInitialOrganizationWithClient(user, fakeClient(state), options);

    expect(result).toEqual({ organizationId: options.organizationId, role: "admin" });
    expect(state.organizationInserts).toBe(0);
    expect(state.memberships).toHaveLength(1);
  });
});
