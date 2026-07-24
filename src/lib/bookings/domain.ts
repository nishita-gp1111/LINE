import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const bookingQuestionTypeSchema = z.enum(["text", "long_text", "radio", "checkbox", "select"]);
export type BookingQuestionType = z.infer<typeof bookingQuestionTypeSchema>;

export type BookingQuestion = {
  id: string;
  key: string;
  label: string;
  description: string;
  type: BookingQuestionType;
  required: boolean;
  options: string[];
  sortOrder: number;
};

export type BookingTypeSettings = {
  id: string;
  slug: string;
  name: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  timezone: string;
  availableWeekdays: number[];
  dailyStartTime: string;
  dailyEndTime: string;
};

export type BookingMemberAvailability = {
  id: string;
  priority: number;
  dailyCapacity: number | null;
  busy: Array<{ start: string; end: string }>;
  bookedStarts: string[];
};

export type PublicBookingForm = {
  id: string;
  slug: string;
  title: string;
  description: string;
  completionMessage: string;
  bookingType: BookingTypeSettings;
  questions: BookingQuestion[];
};

export type PublicSlot = {
  start: string;
  end: string;
  availableMemberCount: number;
};

const answerValueSchema = z.union([
  z.string().max(4000),
  z.array(z.string().min(1).max(200)).max(30)
]);

export const publicApplySchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  source: z.string().trim().max(100).optional(),
  contactId: z.string().uuid().optional(),
  website: z.string().max(0).optional(),
  answers: z.record(z.string(), answerValueSchema).default({})
});

export const bookingOnlyApplySchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  source: z.string().trim().max(100).optional(),
  contactId: z.string().uuid().optional(),
  website: z.string().max(0).optional()
});

export const availabilitySchema = z.object({
  token: z.string().min(20).max(200),
  mode: z.enum(["initial", "reschedule"]).default("initial")
});

export const confirmBookingSchema = z.object({
  token: z.string().min(20).max(200),
  startsAt: z.string().datetime({ offset: true })
});

export type NormalizedAnswers = Record<string, string | string[]>;

function normalizedOptions(question: BookingQuestion): Set<string> {
  return new Set(question.options.map((option) => option.normalize("NFKC").trim()).filter(Boolean));
}

export function validateBookingAnswers(
  questions: BookingQuestion[],
  input: Record<string, string | string[]>
): NormalizedAnswers {
  const answers: NormalizedAnswers = {};
  for (const question of questions.filter((item) => item.type && item.key)) {
    const raw = input[question.key];
    const optionSet = normalizedOptions(question);
    if (question.type === "checkbox") {
      const values = Array.isArray(raw)
        ? [...new Set(raw.map((value) => value.normalize("NFKC").trim()).filter(Boolean))]
        : [];
      if (question.required && values.length === 0) throw new Error(`${question.label}を選択してください。`);
      if (values.some((value) => !optionSet.has(value))) throw new Error(`${question.label}に不正な選択肢があります。`);
      if (values.length > 0) answers[question.key] = values;
      continue;
    }

    const value = typeof raw === "string" ? raw.normalize("NFKC").trim() : "";
    if (question.required && !value) throw new Error(`${question.label}を入力してください。`);
    if (value.length > 4000) throw new Error(`${question.label}は4000文字以内で入力してください。`);
    if (["radio", "select"].includes(question.type) && value && !optionSet.has(value)) {
      throw new Error(`${question.label}に不正な選択肢があります。`);
    }
    if (value) answers[question.key] = value;
  }
  return answers;
}

export function createBookingToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashBookingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function normalizeBookingSource(value: string | null | undefined): string {
  const normalized = (value || "direct")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return normalized || "direct";
}

type DateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function dateParts(date: Date, timezone: string): DateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour"), minute: pick("minute"), second: pick("second") };
}

function zonedDateTime(parts: DateParts, timezone: string): Date {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let result = utcGuess;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = dateParts(new Date(result), timezone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    result -= actualAsUtc - utcGuess;
  }
  return new Date(result);
}

function localDatePlusDays(now: Date, timezone: string, days: number): DateParts {
  const current = dateParts(now, timezone);
  const date = new Date(Date.UTC(current.year, current.month - 1, current.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  };
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) throw new Error("予約受付時間の設定が不正です。");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function overlaps(start: Date, end: Date, busy: { start: string; end: string }): boolean {
  const busyStart = new Date(busy.start);
  const busyEnd = new Date(busy.end);
  if (Number.isNaN(busyStart.getTime()) || Number.isNaN(busyEnd.getTime())) return true;
  return start < busyEnd && end > busyStart;
}

function localDateKey(date: Date, timezone: string): string {
  const parts = dateParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function availableMembersForSlot(input: {
  settings: BookingTypeSettings;
  members: BookingMemberAvailability[];
  startsAt: string;
}): BookingMemberAvailability[] {
  const start = new Date(input.startsAt);
  if (Number.isNaN(start.getTime())) return [];
  const end = new Date(start.getTime() + input.settings.durationMinutes * 60_000);
  const busyStart = new Date(start.getTime() - input.settings.bufferBeforeMinutes * 60_000);
  const busyEnd = new Date(end.getTime() + input.settings.bufferAfterMinutes * 60_000);
  const key = localDateKey(start, input.settings.timezone);
  return input.members.filter((member) => {
    if (member.busy.some((range) => overlaps(busyStart, busyEnd, range))) return false;
    if (member.bookedStarts.some((booked) => {
      const bookedDate = new Date(booked);
      return !Number.isNaN(bookedDate.getTime()) && bookedDate.getTime() === start.getTime();
    })) return false;
    if (member.dailyCapacity !== null) {
      const count = member.bookedStarts.filter((booked) => {
        const bookedDate = new Date(booked);
        return !Number.isNaN(bookedDate.getTime()) && localDateKey(bookedDate, input.settings.timezone) === key;
      }).length;
      if (count >= member.dailyCapacity) return false;
    }
    return true;
  });
}

export function generateAvailableSlots(input: {
  settings: BookingTypeSettings;
  members: BookingMemberAvailability[];
  now?: Date;
  limit?: number;
}): PublicSlot[] {
  const { settings, members } = input;
  const now = input.now || new Date();
  const limit = Math.min(Math.max(input.limit || 240, 1), 500);
  const minimum = new Date(now.getTime() + settings.minimumNoticeMinutes * 60_000);
  const startClock = parseTime(settings.dailyStartTime);
  const endClock = parseTime(settings.dailyEndTime);
  const slots: PublicSlot[] = [];

  for (let dayOffset = 0; dayOffset <= settings.maximumAdvanceDays && slots.length < limit; dayOffset += 1) {
    const day = localDatePlusDays(now, settings.timezone, dayOffset);
    const weekday = new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay();
    if (!settings.availableWeekdays.includes(weekday)) continue;
    const dayStart = zonedDateTime({ ...day, ...startClock, second: 0 }, settings.timezone);
    const dayEnd = zonedDateTime({ ...day, ...endClock, second: 0 }, settings.timezone);

    for (
      let start = dayStart;
      start.getTime() + settings.durationMinutes * 60_000 <= dayEnd.getTime() && slots.length < limit;
      start = new Date(start.getTime() + settings.slotIntervalMinutes * 60_000)
    ) {
      if (start < minimum) continue;
      const end = new Date(start.getTime() + settings.durationMinutes * 60_000);
      const busyStart = new Date(start.getTime() - settings.bufferBeforeMinutes * 60_000);
      const busyEnd = new Date(end.getTime() + settings.bufferAfterMinutes * 60_000);
      const available = availableMembersForSlot({ settings, members, startsAt: start.toISOString() });
      if (available.length > 0) {
        slots.push({ start: start.toISOString(), end: end.toISOString(), availableMemberCount: available.length });
      }
    }
  }
  return slots;
}

export type AssignmentCandidate = {
  id: string;
  priority: number;
  bookingsOnDay: number;
  totalBookings: number;
  lastAssignedAt: string | null;
};

export function rankAssignmentCandidates(candidates: AssignmentCandidate[]): AssignmentCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.bookingsOnDay !== right.bookingsOnDay) return left.bookingsOnDay - right.bookingsOnDay;
    if (left.totalBookings !== right.totalBookings) return left.totalBookings - right.totalBookings;
    if (left.priority !== right.priority) return left.priority - right.priority;
    const leftTime = left.lastAssignedAt ? new Date(left.lastAssignedAt).getTime() : 0;
    const rightTime = right.lastAssignedAt ? new Date(right.lastAssignedAt).getTime() : 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

export function formatBookingDate(value: string, timezone: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
