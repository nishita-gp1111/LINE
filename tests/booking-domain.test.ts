import { describe, expect, it } from "vitest";
import {
  availableMembersForSlot,
  createBookingToken,
  generateAvailableSlots,
  hashBookingToken,
  rankAssignmentCandidates,
  validateBookingAnswers,
  type BookingQuestion,
  type BookingTypeSettings
} from "../src/lib/bookings/domain";

const settings: BookingTypeSettings = {
  id: "type-1",
  slug: "monitor",
  name: "面談",
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  minimumNoticeMinutes: 0,
  maximumAdvanceDays: 1,
  timezone: "Asia/Tokyo",
  availableWeekdays: [1],
  dailyStartTime: "10:00",
  dailyEndTime: "12:00"
};

describe("booking domain", () => {
  it("validates required questionnaire answers and allowed options", () => {
    const questions: BookingQuestion[] = [
      { id: "q1", key: "experience", label: "副業経験", description: "", type: "radio", required: true, options: ["未経験", "経験あり"], sortOrder: 1 },
      { id: "q2", key: "interest", label: "興味", description: "", type: "checkbox", required: true, options: ["AI", "営業"], sortOrder: 2 }
    ];
    expect(validateBookingAnswers(questions, { experience: "未経験", interest: ["AI", "AI"] })).toEqual({ experience: "未経験", interest: ["AI"] });
    expect(() => validateBookingAnswers(questions, { experience: "不正", interest: ["AI"] })).toThrow("不正な選択肢");
    expect(() => validateBookingAnswers(questions, { experience: "未経験", interest: [] })).toThrow("興味を選択");
  });

  it("shows only slots with at least one free member and respects buffer time", () => {
    const slots = generateAvailableSlots({
      settings,
      now: new Date("2026-07-19T15:00:00.000Z"), // 2026-07-20 00:00 JST (Monday)
      members: [
        { id: "a", priority: 100, dailyCapacity: null, bookedStarts: [], busy: [{ start: "2026-07-20T01:20:00.000Z", end: "2026-07-20T02:00:00.000Z" }] },
        { id: "b", priority: 100, dailyCapacity: null, bookedStarts: [], busy: [{ start: "2026-07-20T01:00:00.000Z", end: "2026-07-20T01:30:00.000Z" }] }
      ]
    });
    expect(slots[0]).toMatchObject({ start: "2026-07-20T01:30:00.000Z", availableMemberCount: 1 });
    expect(slots.find((slot) => slot.start === "2026-07-20T01:00:00.000Z")).toBeUndefined();
    expect(slots.find((slot) => slot.start === "2026-07-20T01:30:00.000Z")?.availableMemberCount).toBe(1);
  });

  it("returns the concrete free members for a selected slot", () => {
    const members = availableMembersForSlot({
      settings,
      startsAt: "2026-07-20T00:00:00.000Z",
      members: [
        { id: "a", priority: 100, dailyCapacity: null, bookedStarts: [], busy: [] },
        { id: "b", priority: 100, dailyCapacity: null, bookedStarts: [], busy: [{ start: "2026-07-20T00:20:00.000Z", end: "2026-07-20T00:40:00.000Z" }] }
      ]
    });
    expect(members.map((member) => member.id)).toEqual(["a"]);
  });

  it("assigns the least busy member, then balances totals and last assignment", () => {
    const ranked = rankAssignmentCandidates([
      { id: "a", priority: 100, bookingsOnDay: 5, totalBookings: 10, lastAssignedAt: null },
      { id: "b", priority: 100, bookingsOnDay: 2, totalBookings: 20, lastAssignedAt: "2026-07-18T00:00:00Z" },
      { id: "c", priority: 100, bookingsOnDay: 2, totalBookings: 8, lastAssignedAt: "2026-07-19T00:00:00Z" }
    ]);
    expect(ranked.map((candidate) => candidate.id)).toEqual(["c", "b", "a"]);
  });

  it("creates unguessable tokens and stable SHA-256 hashes", () => {
    const token = createBookingToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(hashBookingToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBookingToken(token)).toBe(hashBookingToken(token));
  });
});
