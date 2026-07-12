import { z } from "zod";
import { lineTextMessageSchema } from "@/lib/line/send";

export const conversationIdSchema = z.string().min(1).max(100);
export const clientRequestIdSchema = z.string().uuid();
export const retryKeySchema = z.string().uuid();
export const textMessageSchema = lineTextMessageSchema;

export const inboxActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), conversationId: conversationIdSchema, lastMessageId: z.string().nullable().optional() }),
  z.object({ action: z.literal("update"), conversationId: conversationIdSchema, status: z.enum(["open", "pending", "closed"]).optional(), assigneeProfileId: z.string().nullable().optional(), priority: z.enum(["normal", "high"]).optional() }),
  z.object({ action: z.literal("note_create"), conversationId: conversationIdSchema, body: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("note_update"), noteId: conversationIdSchema, body: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("note_delete"), noteId: conversationIdSchema })
]);

export const sendMessageSchema = z.object({
  conversationId: conversationIdSchema,
  text: textMessageSchema,
  clientRequestId: clientRequestIdSchema
});

export const retryMessageSchema = z.object({ messageId: conversationIdSchema, conversationId: conversationIdSchema.optional() });

export const quickReplyCreateSchema = z.object({ name: z.string().trim().min(1).max(100), textContent: textMessageSchema, sortOrder: z.number().int().min(0).max(10000) });
export const quickReplyUpdateSchema = quickReplyCreateSchema.extend({ id: conversationIdSchema, isActive: z.boolean() });
export const quickReplyDeleteSchema = z.object({ id: conversationIdSchema });
