import { z } from "zod";

const lineSourceSchema = z
  .object({
    type: z.enum(["user", "group", "room"]),
    userId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    roomId: z.string().min(1).optional()
  })
  .passthrough();

const lineMessageSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    text: z.string().optional(),
    markAsReadToken: z.string().min(1).optional()
  })
  .passthrough();

export const lineEventSchema = z
  .object({
    type: z.string().min(1),
    webhookEventId: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    mode: z.string().optional(),
    deliveryContext: z
      .object({ isRedelivery: z.boolean().optional() })
      .passthrough()
      .optional(),
    source: lineSourceSchema.optional(),
    replyToken: z.string().optional(),
    message: lineMessageSchema.optional(),
    unsend: z.object({ messageId: z.string().min(1) }).optional()
  })
  .passthrough();

export const lineWebhookPayloadSchema = z
  .object({
    destination: z.string().optional(),
    events: z.array(lineEventSchema)
  })
  .passthrough();

export type LineEvent = z.infer<typeof lineEventSchema>;
export type LineWebhookPayload = z.infer<typeof lineWebhookPayloadSchema>;

export type LineProfile = {
  displayName?: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
};

export type ProfileLookup = {
  profile?: LineProfile;
  error?: {
    kind: "not_found" | "temporary" | "configuration" | "invalid";
    message: string;
  };
};
