import { NextResponse } from "next/server";
import { getInboxAuthContext, canAdminister, isTrustedOrigin } from "@/lib/inbox/auth";
import { quickReplyCreateSchema, quickReplyDeleteSchema, quickReplyUpdateSchema } from "@/lib/inbox/schemas";
import { getInboxStore } from "@/lib/inbox/store";

export const runtime = "nodejs";

async function safely(action: () => Promise<NextResponse>) {
  try {
    const response = await action();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const duplicate = error instanceof Error && error.message === "同じ名前のクイック返信が存在します。";
    return NextResponse.json({ ok: false, error: duplicate ? "同じ名前のテンプレートがあります。別の名前にしてください。" : "テンプレートの処理に失敗しました。一覧を再読み込みして確認してください。" }, { status: duplicate ? 409 : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function GET() { return safely(list); }

async function list() {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  const store = getInboxStore(auth.organizationId);
  if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
  return NextResponse.json({ ok: true, items: await store.listQuickReplies(auth.organizationId) });
}

export async function POST(request: Request) {
  return safely(() => mutate(request, "create"));
}

export async function PATCH(request: Request) {
  return safely(() => mutate(request, "update"));
}

export async function DELETE(request: Request) { return safely(() => remove(request)); }

async function remove(request: Request) {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  if (!canAdminister(auth.role) || !isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const parsed = quickReplyDeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "入力内容が不正です。" }, { status: 400 });
  const store = getInboxStore(auth.organizationId);
  if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
  await store.deleteQuickReply(auth.organizationId, parsed.data.id);
  await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "quick_reply.deleted", resourceType: "quick_reply", resourceId: parsed.data.id });
  return NextResponse.json({ ok: true });
}

async function mutate(request: Request, mode: "create" | "update") {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  if (!canAdminister(auth.role) || !isTrustedOrigin(request)) return NextResponse.json({ ok: false, error: "権限がありません。" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const store = getInboxStore(auth.organizationId);
  if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
  if (mode === "create") {
    const parsed = quickReplyCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ ok: false, error: "入力内容が不正です。" }, { status: 400 });
    const item = await store.createQuickReply(auth.organizationId, auth.profileId, parsed.data.name, parsed.data.textContent, parsed.data.sortOrder);
    await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "quick_reply.created", resourceType: "quick_reply", resourceId: item.id, metadata: { textLength: parsed.data.textContent.length } });
    return NextResponse.json({ ok: true, item });
  }
  const parsed = quickReplyUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "入力内容が不正です。" }, { status: 400 });
  const item = await store.updateQuickReply(auth.organizationId, parsed.data.id, parsed.data.name, parsed.data.textContent, parsed.data.sortOrder, parsed.data.isActive);
  await store.recordAudit({ organizationId: auth.organizationId, actorProfileId: auth.profileId, action: "quick_reply.updated", resourceType: "quick_reply", resourceId: item.id, metadata: { textLength: parsed.data.textContent.length } });
  return NextResponse.json({ ok: true, item });
}
