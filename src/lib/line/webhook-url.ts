export function getWebhookUrl(appUrl?: string): string {
  const baseUrl = appUrl?.trim();
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/line/webhook` : "/api/line/webhook";
}
