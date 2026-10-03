import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ensureBookingManagement } from "@/lib/bookings/service";

export const BOOKING_STATUSES = ["unbooked", "confirmed", "attended", "no_show", "rescheduled", "cancelled", "won"] as const;

const questionType = z.enum(["text", "long_text", "radio", "checkbox", "select"]);
const optionList = z.array(z.string().trim().min(1).max(200)).max(30);

export const bookingAdminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("booking_status_update"), id: z.string().uuid(), status: z.enum(BOOKING_STATUSES) }),
  z.object({ action: z.literal("booking_contact_link"), id: z.string().uuid(), contactId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("member_create"), bookingTypeId: z.string().uuid(), displayName: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email(), priority: z.number().int().min(0).max(10000).default(100) }),
  z.object({ action: z.literal("member_update"), id: z.string().uuid(), displayName: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email(), priority: z.number().int().min(0).max(10000), dailyCapacity: z.number().int().min(1).max(100).nullable(), isActive: z.boolean() }),
  z.object({ action: z.literal("question_create"), formId: z.string().uuid(), key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), label: z.string().trim().min(1).max(500), description: z.string().trim().max(1000).default(""), type: questionType, required: z.boolean(), options: optionList.default([]) }),
  z.object({ action: z.literal("question_update"), id: z.string().uuid(), label: z.string().trim().min(1).max(500), description: z.string().trim().max(1000), type: questionType, required: z.boolean(), options: optionList, sortOrder: z.number().int().min(0).max(10000), isActive: z.boolean() }),
  z.object({ action: z.literal("form_update"), id: z.string().uuid(), title: z.string().trim().min(1).max(160), description: z.string().trim().max(2000), completionMessage: z.string().trim().min(1).max(2000), isActive: z.boolean() }),
  z.object({
    action: z.literal("booking_type_update"),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    durationMinutes: z.number().int().min(10).max(240),
    slotIntervalMinutes: z.number().int().min(5).max(240),
    bufferBeforeMinutes: z.number().int().min(0).max(180),
    bufferAfterMinutes: z.number().int().min(0).max(180),
    minimumNoticeMinutes: z.number().int().min(0).max(43200),
    maximumAdvanceDays: z.number().int().min(1).max(365),
    availableWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    dailyStartTime: z.string().regex(/^\d{2}:\d{2}$/),
    dailyEndTime: z.string().regex(/^\d{2}:\d{2}$/)
  })
]);

export type BookingAdminData = {
  forms: Array<Record<string, unknown>>;
  questions: Array<Record<string, unknown>>;
  bookingTypes: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown> & { calendarConnected: boolean; calendarEmail: string | null }>;
  bookings: Array<Record<string, unknown> & { memberName: string | null; contactName: string | null }>;
  contacts: Array<{ id: string; displayName: string }>;
};

export async function getBookingAdminData(client: SupabaseClient, organizationId: string): Promise<BookingAdminData> {
  await ensureBookingManagement(client, organizationId);
  const [formsResult, questionsResult, typesResult, membersResult, connectionsResult, bookingsResult, contactsResult] = await Promise.all([
    client.from("booking_forms").select("*").eq("organization_id", organizationId).order("created_at", { ascending: true }),
    client.from("booking_questions").select("*").eq("organization_id", organizationId).order("sort_order", { ascending: true }),
    client.from("booking_types").select("*").eq("organization_id", organizationId).order("created_at", { ascending: true }),
    client.from("booking_members").select("*").eq("organization_id", organizationId).order("priority", { ascending: true }),
    client.from("calendar_connections").select("booking_member_id, provider_email, disabled_at").eq("organization_id", organizationId),
    client.from("bookings").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(300),
    client.from("contacts").select("id, display_name, line_user_id").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(500)
  ]);
  const failed = [formsResult, questionsResult, typesResult, membersResult, connectionsResult, bookingsResult, contactsResult].find((result) => result.error);
  if (failed?.error) throw new Error("booking_admin_read_failed");
  const connectionByMember = new Map((connectionsResult.data || []).map((row) => [String(row.booking_member_id), row]));
  const memberById = new Map((membersResult.data || []).map((row) => [String(row.id), row]));
  const contactById = new Map((contactsResult.data || []).map((row) => [String(row.id), row]));
  return {
    forms: (formsResult.data || []) as Array<Record<string, unknown>>,
    questions: (questionsResult.data || []) as Array<Record<string, unknown>>,
    bookingTypes: (typesResult.data || []) as Array<Record<string, unknown>>,
    members: (membersResult.data || []).map((row) => {
      const connection = connectionByMember.get(String(row.id));
      return {
        ...(row as Record<string, unknown>),
        calendarConnected: Boolean(connection && !connection.disabled_at),
        calendarEmail: connection?.provider_email ? String(connection.provider_email) : null
      };
    }),
    bookings: (bookingsResult.data || []).map((row) => ({
      ...(row as Record<string, unknown>),
      memberName: row.assigned_member_id ? String(memberById.get(String(row.assigned_member_id))?.display_name || "") || null : null,
      contactName: row.contact_id ? String(contactById.get(String(row.contact_id))?.display_name || "") || null : null
    })),
    contacts: (contactsResult.data || []).map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name || `LINE ${String(row.line_user_id).slice(-6)}`)
    }))
  };
}
export async function executeBookingAdminAction(input: {
  client: SupabaseClient;
  organizationId: string;
  body: unknown;
}): Promise<void> {
  const action = bookingAdminActionSchema.parse(input.body);
  const now = new Date().toISOString();
  let error: { message?: string } | null = null;

  if (action.action === "booking_status_update") {
    ({ error } = await input.client.from("bookings").update({ status: action.status, updated_at: now }).eq("organization_id", input.organizationId).eq("id", action.id));
  } else if (action.action === "booking_contact_link") {
    if (action.contactId) {
      const { data } = await input.client.from("contacts").select("id").eq("organization_id", input.organizationId).eq("id", action.contactId).maybeSingle();
      if (!data) throw new Error("contact_not_found");
    }
    ({ error } = await input.client.from("bookings").update({ contact_id: action.contactId, updated_at: now }).eq("organization_id", input.organizationId).eq("id", action.id));
  } else if (action.action === "member_create") {
    ({ error } = await input.client.from("booking_members").insert({
      organization_id: input.organizationId,
      booking_type_id: action.bookingTypeId,
      display_name: action.displayName,
      email: action.email,
      priority: action.priority
    }));
  } else if (action.action === "member_update") {
    ({ error } = await input.client.from("booking_members").update({
      display_name: action.displayName,
      email: action.email,
      priority: action.priority,
      daily_capacity: action.dailyCapacity,
      is_active: action.isActive,
      updated_at: now
    }).eq("organization_id", input.organizationId).eq("id", action.id));
  } else if (action.action === "question_create") {
    const { count } = await input.client.from("booking_questions").select("id", { count: "exact", head: true }).eq("organization_id", input.organizationId).eq("booking_form_id", action.formId);
    ({ error } = await input.client.from("booking_questions").insert({
      organization_id: input.organizationId,
      booking_form_id: action.formId,
      question_key: action.key,
      label: action.label,
      description: action.description,
      question_type: action.type,
      is_required: action.required,
      options_json: action.options,
      sort_order: (count || 0) * 10 + 10
    }));
  } else if (action.action === "question_update") {
    ({ error } = await input.client.from("booking_questions").update({
      label: action.label,
      description: action.description,
      question_type: action.type,
      is_required: action.required,
      options_json: action.options,
      sort_order: action.sortOrder,
      is_active: action.isActive,
      updated_at: now
    }).eq("organization_id", input.organizationId).eq("id", action.id));
  } else if (action.action === "form_update") {
    ({ error } = await input.client.from("booking_forms").update({
      title: action.title,
      description: action.description,
      completion_message: action.completionMessage,
      is_active: action.isActive,
      updated_at: now
    }).eq("organization_id", input.organizationId).eq("id", action.id));
  } else if (action.action === "booking_type_update") {
    if (action.dailyStartTime >= action.dailyEndTime) throw new Error("booking_time_range_invalid");
    ({ error } = await input.client.from("booking_types").update({
      name: action.name,
      duration_minutes: action.durationMinutes,
      slot_interval_minutes: action.slotIntervalMinutes,
      buffer_before_minutes: action.bufferBeforeMinutes,
      buffer_after_minutes: action.bufferAfterMinutes,
      minimum_notice_minutes: action.minimumNoticeMinutes,
      maximum_advance_days: action.maximumAdvanceDays,
      available_weekdays: action.availableWeekdays,
      daily_start_time: action.dailyStartTime,
      daily_end_time: action.dailyEndTime,
      updated_at: now
    }).eq("organization_id", input.organizationId).eq("id", action.id));
  }
  if (error) throw new Error(error.message || "booking_admin_write_failed");
}
