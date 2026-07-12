export class LineConfigurationError extends Error {
  readonly kind = "configuration" as const;

  constructor(message: string) {
    super(message);
    this.name = "LineConfigurationError";
  }
}

export class LineTemporaryError extends Error {
  readonly kind = "temporary" as const;

  constructor(message: string) {
    super(message);
    this.name = "LineTemporaryError";
  }
}

export function safeErrorMessage(error: unknown, fallback = "LINE処理に失敗しました。"): string {
  if (error instanceof LineConfigurationError || error instanceof LineTemporaryError) {
    return error.message;
  }
  return fallback;
}
