import type { FriendStatus } from "@/lib/webhook/store";

export type FriendStatusPresentation = {
  label: string;
  detail: string;
  isBlocked: boolean;
};

export function friendStatusPresentation(status: FriendStatus): FriendStatusPresentation {
  if (status === "blocked") {
    return {
      label: "ブロック",
      detail: "LINEのブロックイベントを受信済み",
      isBlocked: true
    };
  }
  if (status === "following") {
    return {
      label: "友だち",
      detail: "LINEの友だち追加を確認済み",
      isBlocked: false
    };
  }
  return {
    label: "未確認",
    detail: "LINEから友だち状態をまだ確認できていません",
    isBlocked: false
  };
}
