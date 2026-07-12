import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const value = match[2].replace(/^['"]|['"]$/g, "");
    process.env[match[1]] = value;
  }
}

loadLocalEnv();

const fixtureName = process.argv[process.argv.indexOf("--fixture") + 1] || "follow";
const fixtures = {
  empty: { destination: "Ufixturebot", events: [] },
  follow: { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000001", timestamp: 1735689600000, mode: "active", type: "follow", source: { type: "user", userId: "Ufixture0001" } }] },
  "follow-redelivery": { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000001", timestamp: 1735689600000, mode: "active", type: "follow", deliveryContext: { isRedelivery: true }, source: { type: "user", userId: "Ufixture0001" } }] },
  unfollow: { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000002", timestamp: 1735689601000, mode: "active", type: "unfollow", source: { type: "user", userId: "Ufixture0001" } }] },
  "re-follow": { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000003", timestamp: 1735689602000, mode: "active", type: "follow", source: { type: "user", userId: "Ufixture0001" } }] },
  text: { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000004", timestamp: 1735689603000, mode: "active", type: "message", replyToken: "fixture-reply-token-do-not-store", source: { type: "user", userId: "Ufixture0001" }, message: { id: "Mfixture0001", type: "text", text: "fixture message" } }] },
  "non-text": { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000005", timestamp: 1735689604000, mode: "active", type: "message", source: { type: "user", userId: "Ufixture0001" }, message: { id: "Mfixture0002", type: "image" } }] },
  unsend: { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000006", timestamp: 1735689605000, mode: "active", type: "unsend", source: { type: "user", userId: "Ufixture0001" }, unsend: { messageId: "Mfixture0001" } }] },
  unsupported: { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000007", timestamp: 1735689606000, mode: "active", type: "join", source: { type: "user", userId: "Ufixture0001" } }] },
  group: { destination: "Ufixturebot", events: [{ webhookEventId: "01HLINEFIXTURE00000000000008", timestamp: 1735689607000, mode: "active", type: "message", source: { type: "group", groupId: "Cfixture0001", userId: "Ufixture0001" }, message: { id: "Mfixture0003", type: "text", text: "group message" } }] },
  malformed: '{"destination":"Ufixturebot","events":['
};

if (process.env.APP_ENV === "production") {
  console.error("Refusing to send mock fixtures while APP_ENV=production.");
  process.exit(1);
}
if (!process.env.LINE_CHANNEL_SECRET) {
  console.error("LINE_CHANNEL_SECRET is required; no default secret is used.");
  process.exit(1);
}
if (!(fixtureName in fixtures)) {
  console.error(`Unknown fixture: ${fixtureName}`);
  console.error(`Available fixtures: ${Object.keys(fixtures).join(", ")}`);
  process.exit(1);
}

const body = typeof fixtures[fixtureName] === "string" ? fixtures[fixtureName] : JSON.stringify(fixtures[fixtureName]);
const signature = createHmac("sha256", process.env.LINE_CHANNEL_SECRET).update(body, "utf8").digest("base64");
const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/line/webhook`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-line-signature": signature },
  body
});

console.log(`fixture=${fixtureName} status=${response.status}`);
console.log(await response.text());
