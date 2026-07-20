import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { BookingServiceError } from "@/lib/bookings/service";

const SAFE_MESSAGES: Record<string, string> = {
  booking_management_disabled: "現在、予約受付を停止しています。",
  booking_database_not_configured: "予約システムを準備中です。",
  booking_encryption_not_configured: "予約システムの安全設定が未完了です。",
  google_calendar_not_configured: "Google Calendar連携を準備中です。",
  calendar_members_not_connected: "予約を受け付けられる担当者がまだ登録されていません。",
  booking_form_read_failed: "予約フォームを読み込めませんでした。",
  booking_type_read_failed: "予約設定を読み込めませんでした。",
  booking_form_not_found: "予約フォームが見つかりません。",
  booking_type_not_found: "予約ページが見つかりません。",
  booking_application_save_failed: "入力内容を保存できませんでした。もう一度お試しください。",
  booking_answers_save_failed: "アンケート回答を保存できませんでした。",
  booking_not_found: "予約情報が見つかりません。",
  booking_already_confirmed: "この予約はすでに確定しています。",
  booking_cannot_reschedule: "この予約は日時変更できません。",
  booking_state_changed: "予約状態が更新されました。画面を再読み込みしてください。",
  booking_slot_unavailable: "選択した日時は直前に埋まりました。別の日時を選択してください。",
  booking_calendar_update_failed: "Google Calendarへ予約を反映できませんでした。時間をおいてもう一度お試しください。",
  booking_rate_limited: "短時間に複数のお申し込みを受け付けました。15分ほど待ってからお試しください。",
  google_meet_creation_pending: "Google Meetの発行を完了できませんでした。別の日時でお試しください。",
  booking_schema_not_ready: "Booking Managementのデータベース準備が未完了です。"
};

export function bookingJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export function bookingErrorResponse(error: unknown) {
  if (error instanceof ZodError) return bookingJson({ error: "入力内容を確認してください。", code: "invalid_request" }, 400);
  if (error instanceof BookingServiceError) {
    return bookingJson({ error: SAFE_MESSAGES[error.code] || "予約処理を完了できませんでした。", code: error.code }, error.status);
  }
  return bookingJson({ error: "予約処理を完了できませんでした。", code: "booking_unexpected_error" }, 500);
}
