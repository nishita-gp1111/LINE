import { createHash } from "node:crypto";

export type RecipientPolicyInput = {
  appEnvironment: "development" | "test" | "production";
  mockLineApi: boolean;
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

/**
 * Live sends fail closed. Production is intentionally limited to one explicitly
 * configured LINE user until the controlled-launch restriction is removed.
 */
export function evaluateRecipientPolicy(input: RecipientPolicyInput): RecipientPolicyState {
  if (input.mockLineApi) return { allowed: true, reason: null };

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
