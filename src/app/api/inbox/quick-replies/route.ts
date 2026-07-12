import { NextResponse } from "next/server";
import { getInboxAuthContext, canAdminister, isTrustedOrigin } from "@/lib/inbox/auth";
import { quickReplyCreateSchema, quickReplyDeleteSchema, quickReplyUpdateSchema } from "@/lib/inbox/schemas";
import { getInboxStore } from "@/lib/inbox/store";

export const runtime = "nodejs";

export async function GET() {
  const auth = await getInboxAuthContext();
  if (!auth) return NextResponse.json({ ok: false, error: "認証が必要です。" }, { status: 401 });
  const store = getInboxStore(auth.organizationId);
  if (!store) return NextResponse.json({ ok: false, error: "データストアが設定されていません。" }, { status: 503 });
  return NextResponse.json({ ok: true, items: await store.listQuickReplies(auth.organizationId) });
}

export async function POST(request: Request) {
  return mutate(request, "create");
}

export async function PATCH(request: Request) {
  return mutate(request, "update");
}

export async function DELETE(request: Request) {
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
