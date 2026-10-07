export type TagDeletionCheck = {
  status: "ready" | "deleted" | "in_use" | "not_found" | "forbidden" | "changed";
  tag?: { id: string; name: string };
  contactCount?: number;
  blockers?: Array<{ key: string; count: number }>;
};

export const tagDependencyLabels: Record<string, { label: string; href: string }> = {
  acquisition: { label: "流入経路URLの自動付与タグ", href: "/admin/acquisition" },
  surveys: { label: "アンケート", href: "/admin/surveys" },
  automations: { label: "タグ起点メッセージ・シナリオ", href: "/admin/automations" },
  autoReplies: { label: "自動返信", href: "/admin/auto-replies" },
  segments: { label: "セグメント条件", href: "/admin/segments" },
  richMenus: { label: "リッチメニュー条件", href: "/admin/rich-menus" },
  campaigns: { label: "未完了の配信・除外条件", href: "/admin/campaigns" },
  analytics: { label: "分析条件", href: "/admin/analytics/funnels" }
};
