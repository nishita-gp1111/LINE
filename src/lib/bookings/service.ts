import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "@/lib/env/schema";
import {
  availableMembersForSlot,
  createBookingToken,
  generateAvailableSlots,
  hashBookingToken,
  normalizeBookingSource,
  rankAssignmentCandidates,
  validateBookingAnswers,
  type BookingMemberAvailability,
  type BookingQuestion,
  type BookingTypeSettings,
  type PublicBookingForm,
  type PublicSlot
} from "@/lib/bookings/domain";
import { decryptBookingSecret, encryptBookingSecret } from "@/lib/bookings/crypto";
import {
  createGoogleBookingEvent,
  deleteGoogleBookingEvent,
  queryGoogleFreeBusy,
  refreshGoogleAccessToken,
  updateGoogleBookingEvent,
  type GoogleOAuthConfig
} from "@/lib/bookings/google-calendar";
import { sendBookingEmail, type BookingEmailKind } from "@/lib/bookings/email";

const ACTIVE_BOOKING_STATUSES = ["calendar_pending", "confirmed", "rescheduled"];

export class BookingServiceError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
    this.name = "BookingServiceError";
  }
}

type BookingRow = {
  id: string;
  organization_id: string;
  booking_form_id: string | null;
  booking_type_id: string;
  contact_id: string | null;
  assigned_member_id: string | null;
  applicant_name: string;
  applicant_email: string;
  cloudworks_name: string | null;
  source: string;
  questionnaire_answer: Record<string, string | string[]>;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  busy_starts_at: string | null;
  busy_ends_at: string | null;
  timezone: string;
  calendar_event_id: string | null;
  meet_url: string | null;
  encrypted_reschedule_token: string;
  booking_version: number;
  reschedule_count: number;
  created_at: string;
  updated_at: string;
};

type BookingMemberRow = {
  id: string;
  organization_id: string;
  booking_type_id: string;
  display_name: string;
  email: string;
  priority: number;
  daily_capacity: number | null;
  is_active: boolean;
  last_assigned_at: string | null;
};

type CalendarConnectionRow = {
  id: string;
  organization_id: string;
  booking_member_id: string;
  calendar_id: string;
  encrypted_refresh_token: string;
  disabled_at: string | null;
};

type PreparedCalendarMember = BookingMemberAvailability & {
  row: BookingMemberRow;
  connection: CalendarConnectionRow;
  accessToken: string;
};

function googleConfig(env: AppEnv): GoogleOAuthConfig {
  if (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET || !env.NEXT_PUBLIC_APP_URL) {
    throw new BookingServiceError("google_calendar_not_configured", 503);
  }
  return {
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/booking/google/callback`
  };
}

function encryptionSecret(env: AppEnv): string {
  if (!env.BOOKING_TOKEN_ENCRYPTION_KEY) throw new BookingServiceError("booking_encryption_not_configured", 503);
  return env.BOOKING_TOKEN_ENCRYPTION_KEY;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapBookingType(row: Record<string, unknown>): BookingTypeSettings {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    durationMinutes: Number(row.duration_minutes),
    slotIntervalMinutes: Number(row.slot_interval_minutes),
    bufferBeforeMinutes: Number(row.buffer_before_minutes),
    bufferAfterMinutes: Number(row.buffer_after_minutes),
    minimumNoticeMinutes: Number(row.minimum_notice_minutes),
    maximumAdvanceDays: Number(row.maximum_advance_days),
    timezone: String(row.timezone),
    availableWeekdays: Array.isArray(row.available_weekdays) ? row.available_weekdays.map(Number) : [1, 2, 3, 4, 5],
    dailyStartTime: String(row.daily_start_time),
    dailyEndTime: String(row.daily_end_time)
  };
}

function mapQuestion(row: Record<string, unknown>): BookingQuestion {
  const type = String(row.question_type);
  if (!["text", "long_text", "radio", "checkbox", "select"].includes(type)) {
    throw new BookingServiceError("booking_question_type_invalid", 500);
  }
  return {
    id: String(row.id),
    key: String(row.question_key),
    label: String(row.label),
    description: String(row.description || ""),
    type: type as BookingQuestion["type"],
    required: Boolean(row.is_required),
    options: arrayOfStrings(row.options_json),
    sortOrder: Number(row.sort_order || 0)
  };
}

export async function ensureBookingManagement(client: SupabaseClient, organizationId: string): Promise<void> {
  const { error } = await client.rpc("ensure_default_booking_management", { target_organization_id: organizationId });
  if (error) throw new BookingServiceError("booking_schema_not_ready", 503);
}

export async function loadPublicBookingForm(
  client: SupabaseClient,
  organizationId: string,
  slug: string
): Promise<PublicBookingForm | null> {
  const { data: form, error: formError } = await client
    .from("booking_forms")
    .select("id, slug, title, description, completion_message, booking_type_id")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (formError) throw new BookingServiceError("booking_form_read_failed", 503);
  if (!form) return null;
  const [{ data: type, error: typeError }, { data: questions, error: questionError }] = await Promise.all([
    client.from("booking_types").select("*").eq("organization_id", organizationId).eq("id", form.booking_type_id).eq("is_active", true).maybeSingle(),
    client.from("booking_questions").select("*").eq("organization_id", organizationId).eq("booking_form_id", form.id).eq("is_active", true).order("sort_order", { ascending: true })
  ]);
  if (typeError || questionError) throw new BookingServiceError("booking_form_read_failed", 503);
  if (!type) return null;
  return {
    id: String(form.id),
    slug: String(form.slug),
    title: String(form.title),
    description: String(form.description || ""),
    completionMessage: String(form.completion_message || "ご予約ありがとうございます。"),
    bookingType: mapBookingType(type as Record<string, unknown>),
    questions: (questions || []).map((row) => mapQuestion(row as Record<string, unknown>))
  };
}

export async function loadPublicBookingType(
  client: SupabaseClient,
  organizationId: string,
  slug: string
): Promise<BookingTypeSettings | null> {
  const { data, error } = await client
    .from("booking_types")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new BookingServiceError("booking_type_read_failed", 503);
  return data ? mapBookingType(data as Record<string, unknown>) : null;
}

export async function createPublicApplication(input: {
  client: SupabaseClient;
  env: AppEnv;
  organizationId: string;
  form: PublicBookingForm;
  applicant: { name: string; email: string; source?: string; answers: Record<string, string | string[]> };
}): Promise<{ token: string }> {
  const answers = validateBookingAnswers(input.form.questions, input.applicant.answers);
  const publicToken = createBookingToken();
  const rescheduleToken = createBookingToken();
  const cloudworks = typeof answers.cloudworks_name === "string" ? answers.cloudworks_name : null;
  const { data: booking, error } = await input.client.from("bookings").insert({
    organization_id: input.organizationId,
    booking_form_id: input.form.id,
    booking_type_id: input.form.bookingType.id,
    applicant_name: input.applicant.name,
    applicant_email: input.applicant.email,
    cloudworks_name: cloudworks,
    source: normalizeBookingSource(input.applicant.source),
    questionnaire_answer: answers,
    questionnaire_completed_at: new Date().toISOString(),
    status: "unbooked",
    timezone: input.form.bookingType.timezone,
    public_token_hash: hashBookingToken(publicToken),
    reschedule_token_hash: hashBookingToken(rescheduleToken),
    encrypted_reschedule_token: encryptBookingSecret(rescheduleToken, encryptionSecret(input.env))
  }).select("id").single();
  if (error || !booking) throw new BookingServiceError("booking_application_save_failed", 503);

  const questionByKey = new Map(input.form.questions.map((question) => [question.key, question]));
  const rows = Object.entries(answers).flatMap(([key, value]) => {
    const question = questionByKey.get(key);
    if (!question) return [];
    return [{
      organization_id: input.organizationId,
      booking_id: booking.id,
      question_id: question.id,
      answer_text: typeof value === "string" ? value : null,
      answer_json: Array.isArray(value) ? value : null
    }];
  });
  if (rows.length > 0) {
    const { error: answerError } = await input.client.from("booking_answers").insert(rows);
    if (answerError) {
      await input.client.from("bookings").delete().eq("organization_id", input.organizationId).eq("id", booking.id);
      throw new BookingServiceError("booking_answers_save_failed", 503);
    }
  }
  return { token: publicToken };
}

export async function createBookingOnlyApplication(input: {
  client: SupabaseClient;
  env: AppEnv;
  organizationId: string;
  bookingType: BookingTypeSettings;
  applicant: { name: string; email: string; source?: string };
}): Promise<{ token: string }> {
  const publicToken = createBookingToken();
  const rescheduleToken = createBookingToken();
  const { error } = await input.client.from("bookings").insert({
    organization_id: input.organizationId,
    booking_type_id: input.bookingType.id,
    applicant_name: input.applicant.name,
    applicant_email: input.applicant.email,
    source: normalizeBookingSource(input.applicant.source),
    questionnaire_answer: {},
    status: "unbooked",
    timezone: input.bookingType.timezone,
    public_token_hash: hashBookingToken(publicToken),
    reschedule_token_hash: hashBookingToken(rescheduleToken),
    encrypted_reschedule_token: encryptBookingSecret(rescheduleToken, encryptionSecret(input.env))
  });
  if (error) throw new BookingServiceError("booking_application_save_failed", 503);
  return { token: publicToken };
}

async function bookingByToken(client: SupabaseClient, token: string, mode: "initial" | "reschedule"): Promise<BookingRow | null> {
  const column = mode === "initial" ? "public_token_hash" : "reschedule_token_hash";
  const { data, error } = await client.from("bookings").select("*").eq(column, hashBookingToken(token)).maybeSingle();
  if (error) throw new BookingServiceError("booking_read_failed", 503);
  return data as BookingRow | null;
}

async function bookingTypeById(client: SupabaseClient, booking: BookingRow): Promise<BookingTypeSettings> {
  const { data, error } = await client.from("booking_types").select("*").eq("organization_id", booking.organization_id).eq("id", booking.booking_type_id).maybeSingle();
  if (error || !data) throw new BookingServiceError("booking_type_not_found", 404);
  return mapBookingType(data as Record<string, unknown>);
}

async function preparedCalendarMembers(input: {
  client: SupabaseClient;
  env: AppEnv;
  booking: BookingRow;
  settings: BookingTypeSettings;
  excludeBookingId?: string;
  now?: Date;
}): Promise<PreparedCalendarMember[]> {
  const config = googleConfig(input.env);
  const secret = encryptionSecret(input.env);
  const now = input.now || new Date();
  const timeMax = new Date(now.getTime() + (input.settings.maximumAdvanceDays + 2) * 86_400_000);
  const [{ data: members, error: memberError }, { data: connections, error: connectionError }, { data: existing, error: bookingError }] = await Promise.all([
    input.client.from("booking_members").select("*").eq("organization_id", input.booking.organization_id).eq("booking_type_id", input.booking.booking_type_id).eq("is_active", true),
    input.client.from("calendar_connections").select("*").eq("organization_id", input.booking.organization_id).is("disabled_at", null),
    input.client.from("bookings").select("id, assigned_member_id, starts_at, busy_starts_at, busy_ends_at, status").eq("organization_id", input.booking.organization_id).in("status", ACTIVE_BOOKING_STATUSES).gte("busy_ends_at", now.toISOString()).lte("busy_starts_at", timeMax.toISOString())
  ]);
  if (memberError || connectionError || bookingError) throw new BookingServiceError("booking_availability_read_failed", 503);
  const connectionByMember = new Map((connections || []).map((row) => [String(row.booking_member_id), row as CalendarConnectionRow]));
  const existingRows = (existing || []).filter((row) => String(row.id) !== input.excludeBookingId);

  const prepared = await Promise.all((members || []).map(async (raw): Promise<PreparedCalendarMember | null> => {
    const row = raw as BookingMemberRow;
    const connection = connectionByMember.get(String(row.id));
    if (!connection) return null;
    try {
      const refreshToken = decryptBookingSecret(connection.encrypted_refresh_token, secret);
      const token = await refreshGoogleAccessToken({ config, refreshToken });
      const googleBusy = await queryGoogleFreeBusy({
        accessToken: token.accessToken,
        calendarId: connection.calendar_id,
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        timezone: input.settings.timezone
      });
      const dbBusy = existingRows.flatMap((booking) =>
        String(booking.assigned_member_id) === String(row.id) && booking.busy_starts_at && booking.busy_ends_at
          ? [{ start: String(booking.busy_starts_at), end: String(booking.busy_ends_at) }]
          : []
      );
      const bookedStarts = existingRows.flatMap((booking) =>
        String(booking.assigned_member_id) === String(row.id) && booking.starts_at ? [String(booking.starts_at)] : []
      );
      await input.client.from("calendar_connections").update({ last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", connection.id);
      return {
        id: String(row.id),
        priority: Number(row.priority || 100),
        dailyCapacity: row.daily_capacity === null ? null : Number(row.daily_capacity),
        busy: [...googleBusy, ...dbBusy],
        bookedStarts,
        row,
        connection,
        accessToken: token.accessToken
      };
    } catch {
      return null;
    }
  }));
  return prepared.filter((member): member is PreparedCalendarMember => Boolean(member));
}

export async function getBookingAvailability(input: {
  client: SupabaseClient;
  env: AppEnv;
  token: string;
  mode: "initial" | "reschedule";
  now?: Date;
}): Promise<{ booking: Pick<BookingRow, "applicant_name" | "starts_at" | "timezone" | "status">; settings: BookingTypeSettings; slots: PublicSlot[] }> {
  const booking = await bookingByToken(input.client, input.token, input.mode);
  if (!booking) throw new BookingServiceError("booking_not_found", 404);
  if (input.mode === "initial" && !["unbooked", "calendar_failed"].includes(booking.status)) {
    throw new BookingServiceError("booking_already_confirmed", 409);
  }
  if (input.mode === "reschedule" && !["confirmed", "rescheduled"].includes(booking.status)) {
    throw new BookingServiceError("booking_cannot_reschedule", 409);
  }
  const settings = await bookingTypeById(input.client, booking);
  const members = await preparedCalendarMembers({
    client: input.client,
    env: input.env,
    booking,
    settings,
    excludeBookingId: input.mode === "reschedule" ? booking.id : undefined,
    now: input.now
  });
  const eligibleMembers = input.mode === "reschedule" && booking.assigned_member_id
    ? members.filter((member) => member.id === booking.assigned_member_id)
    : members;
  if (eligibleMembers.length === 0) throw new BookingServiceError("calendar_members_not_connected", 503);
  return {
    booking: { applicant_name: booking.applicant_name, starts_at: booking.starts_at, timezone: booking.timezone, status: booking.status },
    settings,
    slots: generateAvailableSlots({ settings, members: eligibleMembers, now: input.now })
  };
}

function answersDescription(booking: BookingRow, labels: Map<string, string>): string {
  const rows = Object.entries(booking.questionnaire_answer || {}).map(([key, value]) =>
    `${labels.get(key) || key}: ${Array.isArray(value) ? value.join("、") : value}`
  );
  return [
    `名前: ${booking.applicant_name}`,
    `メール: ${booking.applicant_email}`,
    booking.cloudworks_name ? `CloudWorks名: ${booking.cloudworks_name}` : null,
    `予約経路: ${booking.source}`,
    rows.length > 0 ? "" : null,
    rows.length > 0 ? "アンケート回答" : null,
    ...rows
  ].filter(Boolean).join("\n");
}

async function bookingQuestionLabels(client: SupabaseClient, booking: BookingRow): Promise<Map<string, string>> {
  if (!booking.booking_form_id) return new Map();
  const { data, error } = await client.from("booking_questions")
    .select("question_key, label")
    .eq("organization_id", booking.organization_id)
    .eq("booking_form_id", booking.booking_form_id);
  if (error) return new Map();
  return new Map((data || []).map((row) => [String(row.question_key), String(row.label)]));
}

async function assignmentCounts(client: SupabaseClient, booking: BookingRow, candidateIds: string[], startsAt: Date): Promise<Map<string, { day: number; total: number }>> {
  const localDay = (date: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: booking.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  const targetDay = localDay(startsAt);
  const { data, error } = await client.from("bookings")
    .select("assigned_member_id, starts_at")
    .eq("organization_id", booking.organization_id)
    .in("assigned_member_id", candidateIds)
    .in("status", ["confirmed", "rescheduled", "attended", "no_show", "won"]);
  if (error) throw new BookingServiceError("booking_assignment_read_failed", 503);
  const counts = new Map(candidateIds.map((id) => [id, { day: 0, total: 0 }]));
  for (const row of data || []) {
    const id = String(row.assigned_member_id || "");
    const count = counts.get(id);
    if (!count) continue;
    count.total += 1;
    const date = new Date(String(row.starts_at));
    if (!Number.isNaN(date.getTime()) && localDay(date) === targetDay) count.day += 1;
  }
  return counts;
}

async function releaseCalendarPending(client: SupabaseClient, bookingId: string, status = "calendar_failed"): Promise<void> {
  await client.from("bookings").update({
    assigned_member_id: null,
    starts_at: null,
    ends_at: null,
    busy_starts_at: null,
    busy_ends_at: null,
    status,
    updated_at: new Date().toISOString()
  }).eq("id", bookingId).eq("status", "calendar_pending");
}

async function createReminderRows(input: {
  client: SupabaseClient;
  booking: BookingRow;
  bookingVersion: number;
  startsAt: Date;
  immediateType: "confirmation" | "reschedule";
}): Promise<void> {
  const now = new Date();
  const rows = [
    { type: input.immediateType, scheduled: now },
    { type: "day_before", scheduled: new Date(input.startsAt.getTime() - 86_400_000) },
    { type: "hour_before", scheduled: new Date(input.startsAt.getTime() - 3_600_000) }
  ].map((item) => ({
    organization_id: input.booking.organization_id,
    booking_id: input.booking.id,
    booking_version: input.bookingVersion,
    reminder_type: item.type,
    scheduled_for: item.scheduled.toISOString(),
    status: item.scheduled <= now && item.type !== input.immediateType ? "cancelled" : "pending",
    updated_at: now.toISOString()
  }));
  const { error } = await input.client.from("booking_reminders").upsert(rows, {
    onConflict: "organization_id,booking_id,booking_version,reminder_type"
  });
  if (error) throw new BookingServiceError("booking_reminder_save_failed", 503);
}

async function sendImmediateBookingEmail(input: {
  client: SupabaseClient;
  env: AppEnv;
  booking: BookingRow;
  member: BookingMemberRow;
  startsAt: string;
  meetUrl: string;
  bookingVersion: number;
  kind: "confirmation" | "reschedule";
}): Promise<void> {
  const rawToken = decryptBookingSecret(input.booking.encrypted_reschedule_token, encryptionSecret(input.env));
  const appUrl = input.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  const result = await sendBookingEmail({
    env: input.env,
    message: {
      idempotencyKey: `booking/${input.booking.id}/${input.bookingVersion}/${input.kind}`,
      kind: input.kind,
      recipient: input.booking.applicant_email,
      applicantName: input.booking.applicant_name,
      memberName: input.member.display_name,
      startsAt: input.startsAt,
      timezone: input.booking.timezone,
      meetUrl: input.meetUrl,
      rescheduleUrl: `${appUrl}/booking/reschedule/${encodeURIComponent(rawToken)}`
    }
  });
  const status = result.status === "sent" ? "sent" : result.status === "not_configured" ? "not_configured" : "failed";
  await Promise.all([
    input.client.from("bookings").update({
      confirmation_email_status: status,
      confirmation_email_sent_at: result.status === "sent" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq("id", input.booking.id),
    input.client.from("booking_reminders").update({
      status: result.status === "sent" ? "sent" : result.status === "not_configured" ? "cancelled" : "failed",
      provider_message_id: result.status === "sent" ? result.providerMessageId : null,
      error_code_safe: result.status === "failed" ? result.errorCode : null,
      sent_at: result.status === "sent" ? new Date().toISOString() : null,
      attempt_count: 1,
      updated_at: new Date().toISOString()
    }).eq("organization_id", input.booking.organization_id).eq("booking_id", input.booking.id).eq("booking_version", input.bookingVersion).eq("reminder_type", input.kind)
  ]);
}

export async function confirmBooking(input: {
  client: SupabaseClient;
  env: AppEnv;
  token: string;
  startsAt: string;
  mode: "initial" | "reschedule";
  now?: Date;
}): Promise<{ bookingId: string; startsAt: string; memberName: string; meetUrl: string }> {
  const booking = await bookingByToken(input.client, input.token, input.mode);
  if (!booking) throw new BookingServiceError("booking_not_found", 404);
  const expectedStatuses = input.mode === "initial" ? ["unbooked", "calendar_failed"] : ["confirmed", "rescheduled"];
  if (!expectedStatuses.includes(booking.status)) throw new BookingServiceError("booking_state_changed", 409);
  const settings = await bookingTypeById(input.client, booking);
  const questionLabels = await bookingQuestionLabels(input.client, booking);
  const members = await preparedCalendarMembers({
    client: input.client,
    env: input.env,
    booking,
    settings,
    excludeBookingId: input.mode === "reschedule" ? booking.id : undefined,
    now: input.now
  });
  const eligibleMembers = input.mode === "reschedule" && booking.assigned_member_id
    ? members.filter((member) => member.id === booking.assigned_member_id)
    : members;
  const published = generateAvailableSlots({ settings, members: eligibleMembers, now: input.now });
  if (!published.some((slot) => slot.start === input.startsAt)) throw new BookingServiceError("booking_slot_unavailable", 409);
  const available = availableMembersForSlot({ settings, members: eligibleMembers, startsAt: input.startsAt }) as PreparedCalendarMember[];
  if (available.length === 0) throw new BookingServiceError("booking_slot_unavailable", 409);
  const start = new Date(input.startsAt);
  const end = new Date(start.getTime() + settings.durationMinutes * 60_000);
  const counts = await assignmentCounts(input.client, booking, available.map((member) => member.id), start);
  const ranked = rankAssignmentCandidates(available.map((member) => ({
    id: member.id,
    priority: member.priority,
    bookingsOnDay: counts.get(member.id)?.day || 0,
    totalBookings: counts.get(member.id)?.total || 0,
    lastAssignedAt: member.row.last_assigned_at
  })));
  const old = { ...booking };
  const newVersion = input.mode === "reschedule" ? booking.booking_version + 1 : booking.booking_version;
  let calendarFailure = false;

  for (const candidate of ranked) {
    const member = available.find((item) => item.id === candidate.id);
    if (!member) continue;
    const busyStartsAt = new Date(start.getTime() - settings.bufferBeforeMinutes * 60_000).toISOString();
    const busyEndsAt = new Date(end.getTime() + settings.bufferAfterMinutes * 60_000).toISOString();
    const { data: reserved, error: reserveError } = await input.client.from("bookings").update({
      assigned_member_id: member.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      busy_starts_at: busyStartsAt,
      busy_ends_at: busyEndsAt,
      status: "calendar_pending",
      booking_version: newVersion,
      reschedule_count: input.mode === "reschedule" ? booking.reschedule_count + 1 : booking.reschedule_count,
      updated_at: new Date().toISOString()
    }).eq("id", booking.id).in("status", expectedStatuses).select("id").maybeSingle();
    if (reserveError || !reserved) continue;

    let eventId: string | null = null;
    let createdNewEvent = false;
    let updatedExistingEvent = false;
    try {
      const summary = `【面談予約】${booking.applicant_name}`;
      const description = answersDescription(booking, questionLabels);
      let event;
      if (input.mode === "reschedule" && old.assigned_member_id === member.id && old.calendar_event_id) {
        event = await updateGoogleBookingEvent({
          accessToken: member.accessToken,
          calendarId: member.connection.calendar_id,
          eventId: old.calendar_event_id,
          summary,
          description,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          timezone: settings.timezone
        });
        updatedExistingEvent = true;
      } else {
        event = await createGoogleBookingEvent({
          accessToken: member.accessToken,
          calendarId: member.connection.calendar_id,
          bookingId: booking.id,
          summary,
          description,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          timezone: settings.timezone
        });
        createdNewEvent = true;
      }
      eventId = event.id;
      if (!event.meetUrl) throw new BookingServiceError("google_meet_creation_pending", 503);

      const finalStatus = input.mode === "reschedule" ? "rescheduled" : "confirmed";
      const { error: finalError } = await input.client.from("bookings").update({
        status: finalStatus,
        calendar_event_id: event.id,
        meet_url: event.meetUrl,
        updated_at: new Date().toISOString()
      }).eq("id", booking.id).eq("status", "calendar_pending");
      if (finalError) throw new BookingServiceError("booking_confirmation_save_failed", 503);
      await input.client.from("booking_members").update({ last_assigned_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", member.id);

      const bookingForEmail = { ...booking, starts_at: start.toISOString(), booking_version: newVersion };
      try {
        await createReminderRows({
          client: input.client,
          booking: bookingForEmail,
          bookingVersion: newVersion,
          startsAt: start,
          immediateType: input.mode === "reschedule" ? "reschedule" : "confirmation"
        });
        await sendImmediateBookingEmail({
          client: input.client,
          env: input.env,
          booking: bookingForEmail,
          member: member.row,
          startsAt: start.toISOString(),
          meetUrl: event.meetUrl,
          bookingVersion: newVersion,
          kind: input.mode === "reschedule" ? "reschedule" : "confirmation"
        });
      } catch {
        await input.client.from("bookings").update({ confirmation_email_status: "failed", updated_at: new Date().toISOString() }).eq("id", booking.id);
      }
      return {
        bookingId: booking.id,
        startsAt: start.toISOString(),
        memberName: member.row.display_name,
        meetUrl: event.meetUrl
      };
    } catch {
      calendarFailure = true;
      if (createdNewEvent && eventId) {
        await deleteGoogleBookingEvent({
          accessToken: member.accessToken,
          calendarId: member.connection.calendar_id,
          eventId
        }).catch(() => undefined);
      }
      if (updatedExistingEvent && old.calendar_event_id && old.starts_at && old.ends_at) {
        await updateGoogleBookingEvent({
          accessToken: member.accessToken,
          calendarId: member.connection.calendar_id,
          eventId: old.calendar_event_id,
          summary: `【面談予約】${booking.applicant_name}`,
          description: answersDescription(booking, questionLabels),
          startsAt: old.starts_at,
          endsAt: old.ends_at,
          timezone: settings.timezone
        }).catch(() => undefined);
      }
      if (input.mode === "reschedule") {
        await input.client.from("bookings").update({
          assigned_member_id: old.assigned_member_id,
          starts_at: old.starts_at,
          ends_at: old.ends_at,
          busy_starts_at: old.busy_starts_at,
          busy_ends_at: old.busy_ends_at,
          status: old.status,
          booking_version: old.booking_version,
          reschedule_count: old.reschedule_count,
          calendar_event_id: old.calendar_event_id,
          meet_url: old.meet_url,
          updated_at: new Date().toISOString()
        }).eq("id", booking.id).eq("status", "calendar_pending");
      } else {
        await releaseCalendarPending(input.client, booking.id);
      }
    }
  }
  if (calendarFailure) throw new BookingServiceError("booking_calendar_update_failed", 503);
  throw new BookingServiceError("booking_slot_unavailable", 409);
}

export async function getRescheduleSummary(client: SupabaseClient, token: string): Promise<{
  applicantName: string;
  startsAt: string;
  timezone: string;
  status: string;
} | null> {
  const booking = await bookingByToken(client, token, "reschedule");
  if (!booking || !booking.starts_at) return null;
  return { applicantName: booking.applicant_name, startsAt: booking.starts_at, timezone: booking.timezone, status: booking.status };
}

export async function dispatchDueBookingReminders(input: {
  client: SupabaseClient;
  env: AppEnv;
  now?: Date;
  limit?: number;
}): Promise<{ scanned: number; sent: number; failed: number; skipped: number }> {
  if (!input.env.BOOKING_REMINDERS_ENABLED) return { scanned: 0, sent: 0, failed: 0, skipped: 0 };
  const now = input.now || new Date();
  const limit = Math.min(Math.max(input.limit || 30, 1), 100);
  await input.client.from("booking_reminders").update({
    status: "failed",
    error_code_safe: "processing_lease_expired",
    updated_at: now.toISOString()
  }).eq("status", "processing").lt("updated_at", new Date(now.getTime() - 15 * 60_000).toISOString());
  const { data: reminders, error } = await input.client.from("booking_reminders")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("scheduled_for", now.toISOString())
    .lt("attempt_count", 3)
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw new BookingServiceError("booking_reminders_read_failed", 503);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const reminder of reminders || []) {
    const { data: claimed } = await input.client.from("booking_reminders").update({
      status: "processing",
      attempt_count: Number(reminder.attempt_count || 0) + 1,
      updated_at: now.toISOString()
    }).eq("id", reminder.id).in("status", ["pending", "failed"]).select("id").maybeSingle();
    if (!claimed) { skipped += 1; continue; }
    try {
    const { data: booking } = await input.client.from("bookings").select("*").eq("id", reminder.booking_id).maybeSingle();
    if (!booking || Number(booking.booking_version) !== Number(reminder.booking_version) || !["confirmed", "rescheduled"].includes(String(booking.status))) {
      await input.client.from("booking_reminders").update({ status: "cancelled", updated_at: now.toISOString() }).eq("id", reminder.id);
      skipped += 1;
      continue;
    }
    const { data: member } = await input.client.from("booking_members").select("*").eq("id", booking.assigned_member_id).maybeSingle();
    if (!member || !booking.starts_at || !booking.meet_url) {
      await input.client.from("booking_reminders").update({ status: "failed", error_code_safe: "booking_details_missing", updated_at: now.toISOString() }).eq("id", reminder.id);
      failed += 1;
      continue;
    }
    const rawToken = decryptBookingSecret(String(booking.encrypted_reschedule_token), encryptionSecret(input.env));
    const appUrl = input.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
    const kind = String(reminder.reminder_type) as BookingEmailKind;
    const result = await sendBookingEmail({
      env: input.env,
      message: {
        idempotencyKey: `booking/${booking.id}/${booking.booking_version}/${kind}`,
        kind,
        recipient: String(booking.applicant_email),
        applicantName: String(booking.applicant_name),
        memberName: String(member.display_name),
        startsAt: String(booking.starts_at),
        timezone: String(booking.timezone),
        meetUrl: String(booking.meet_url),
        rescheduleUrl: `${appUrl}/booking/reschedule/${encodeURIComponent(rawToken)}`
      }
    });
    await input.client.from("booking_reminders").update({
      status: result.status === "sent" ? "sent" : result.status === "not_configured" ? "cancelled" : "failed",
      provider_message_id: result.status === "sent" ? result.providerMessageId : null,
      error_code_safe: result.status === "failed" ? result.errorCode : null,
      sent_at: result.status === "sent" ? now.toISOString() : null,
      updated_at: now.toISOString()
    }).eq("id", reminder.id);
    if (result.status === "sent") sent += 1;
    else if (result.status === "failed") failed += 1;
    else skipped += 1;
    } catch {
      await input.client.from("booking_reminders").update({
        status: "failed",
        error_code_safe: "reminder_processing_failed",
        updated_at: now.toISOString()
      }).eq("id", reminder.id);
      failed += 1;
    }
  }
  return { scanned: reminders?.length || 0, sent, failed, skipped };
}

export async function connectBookingMemberCalendar(input: {
  client: SupabaseClient;
  env: AppEnv;
  organizationId: string;
  memberId: string;
  providerUserId: string | null;
  providerEmail: string | null;
  refreshToken: string;
  scopes: string[];
}): Promise<void> {
  const { data: member, error: memberError } = await input.client.from("booking_members").select("id").eq("organization_id", input.organizationId).eq("id", input.memberId).maybeSingle();
  if (memberError || !member) throw new BookingServiceError("booking_member_not_found", 404);
  const now = new Date().toISOString();
  const { error } = await input.client.from("calendar_connections").upsert({
    organization_id: input.organizationId,
    booking_member_id: input.memberId,
    provider: "google",
    provider_user_id: input.providerUserId,
    provider_email: input.providerEmail,
    calendar_id: "primary",
    encrypted_refresh_token: encryptBookingSecret(input.refreshToken, encryptionSecret(input.env)),
    granted_scopes: input.scopes,
    connected_at: now,
    last_verified_at: now,
    disabled_at: null,
    updated_at: now
  }, { onConflict: "organization_id,booking_member_id" });
  if (error) throw new BookingServiceError("calendar_connection_save_failed", 503);
}
