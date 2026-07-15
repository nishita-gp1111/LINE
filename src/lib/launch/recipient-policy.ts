import { createHash } from "node:crypto";

export type RecipientPolicyInput = {
  appEnvironment: "development" | "test" | "production";
  mockLineApi: boolean;
  recipientMode?: "controlled" | "all_followers";
  allowedLineUserIds: string[];
  allowedLineUserHashes: string[];
  lineUserId: string;
};

export type RecipientPolicyState = {
  allowed: boolean;
  reason: string | null;
};

export function hashLineUserId(lineUserId: string): string {
  return createHash("sha256").update(lineUserId, "utf8").digest("hex");
}

export function configuredRecipientHashes(
  allowedLineUserIds: string[],
  allowedLineUserHashes: string[]
): string[] {
  return [...new Set([
    ...allowedLineUserIds.map(hashLineUserId),
    ...allowedLineUserHashes.map((value) => value.toLowerCase())
  ])];
}

export function configuredRecipientCount(allowedLineUserIds: string[], allowedLineUserHashes: string[]): number {
  return configuredRecipientHashes(allowedLineUserIds, allowedLineUserHashes).length;
}

/** Live sends fail closed unless Production explicitly opts into all-followers mode. */
export function evaluateRecipientPolicy(input: RecipientPolicyInput): RecipientPolicyState {
  if (input.mockLineApi) return { allowed: true, reason: null };

  if (input.recipientMode === "all_followers") {
    return input.appEnvironment === "production"
      ? { allowed: true, reason: null }
      : { allowed: false, reason: "全フォロワー送信はProductionでのみ利用できます。" };
  }

  const allowedHashes = configuredRecipientHashes(input.allowedLineUserIds, input.allowedLineUserHashes);
  const configuredCount = allowedHashes.length;
  if (configuredCount === 0) {
    return {
      allowed: false,
      reason: "LINE_TEST_USER_IDS / LINE_TEST_USER_HASHESが未設定のため、実LINEへの送信を拒否しました。"
    };
  }

  if (configuredCount !== 1) {
    return {
      allowed: false,
      reason: "Controlled Launchでは送信許可先をSho本人1名だけに制限してください。"
    };
  }

  if (!allowedHashes.includes(hashLineUserId(input.lineUserId))) {
    return {
      allowed: false,
      reason: "この送信先はProduction allowlistで許可されていません。"
    };
  }

  return { allowed: true, reason: null };
}
