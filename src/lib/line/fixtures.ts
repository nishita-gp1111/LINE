import type { LineWebhookPayload } from "@/lib/line/types";

const baseEvent = {
  webhookEventId: "01HLINEFIXTURE00000000000001",
  timestamp: 1_735_689_600_000,
  mode: "active",
  source: { type: "user", userId: "Ufixture0001" }
} as const;

export const lineFixtures: Record<string, LineWebhookPayload | string> = {
  empty: { destination: "Ufixturebot", events: [] },
  follow: {
    destination: "Ufixturebot",
    events: [{ ...baseEvent, type: "follow" }]
  },
  "follow-redelivery": {
    destination: "Ufixturebot",
    events: [{ ...baseEvent, type: "follow", deliveryContext: { isRedelivery: true } }]
  },
  unfollow: {
    destination: "Ufixturebot",
    events: [{ ...baseEvent, type: "unfollow", webhookEventId: "01HLINEFIXTURE00000000000002", timestamp: baseEvent.timestamp + 1000 }]
  },
  "re-follow": {
    destination: "Ufixturebot",
    events: [{ ...baseEvent, type: "follow", webhookEventId: "01HLINEFIXTURE00000000000003", timestamp: baseEvent.timestamp + 2000 }]
  },
  text: {
    destination: "Ufixturebot",
    events: [{
      ...baseEvent,
      type: "message",
      webhookEventId: "01HLINEFIXTURE00000000000004",
      timestamp: baseEvent.timestamp + 3000,
      replyToken: "fixture-reply-token-do-not-store",
      message: { id: "Mfixture0001", type: "text", text: "fixture message" }
    }]
  },
  "non-text": {
    destination: "Ufixturebot",
    events: [{
      ...baseEvent,
      type: "message",
      webhookEventId: "01HLINEFIXTURE00000000000005",
      timestamp: baseEvent.timestamp + 4000,
      message: { id: "Mfixture0002", type: "image" }
    }]
  },
  unsend: {
    destination: "Ufixturebot",
    events: [{
      ...baseEvent,
      type: "unsend",
      webhookEventId: "01HLINEFIXTURE00000000000006",
      timestamp: baseEvent.timestamp + 5000,
      unsend: { messageId: "Mfixture0001" }
    }]
  },
  unsupported: {
    destination: "Ufixturebot",
    events: [{ ...baseEvent, type: "join", webhookEventId: "01HLINEFIXTURE00000000000007" }]
  },
  group: {
    destination: "Ufixturebot",
    events: [{
      ...baseEvent,
      type: "message",
      webhookEventId: "01HLINEFIXTURE00000000000008",
      source: { type: "group", groupId: "Cfixture0001", userId: "Ufixture0001" },
      message: { id: "Mfixture0003", type: "text", text: "group message" }
    }]
  },
  malformed: '{"destination":"Ufixturebot","events":['
};

export const lineFixtureNames = Object.keys(lineFixtures);

export function getLineFixture(name: string): LineWebhookPayload | string {
  const fixture = lineFixtures[name];
  if (!fixture) throw new Error(`Unknown fixture: ${name}`);
  return fixture;
}
