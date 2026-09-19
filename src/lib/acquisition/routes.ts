export const SHARED_ACQUISITION_ROUTE_SLUGS = ["meeting", "survey", "hp"] as const;
export const ACQUISITION_ROUTE_SLUGS = [...SHARED_ACQUISITION_ROUTE_SLUGS, "meeting-imafuku", "meeting-shimizu", "meeting-uoi", "meeting-nishita"] as const;

export type AcquisitionRouteSlug = (typeof ACQUISITION_ROUTE_SLUGS)[number];

export type AcquisitionRoute = {
  slug: AcquisitionRouteSlug;
  label: string;
  tagName: string;
  registrationMessage: string;
  description: string;
  fixedAssigneeName?: string;
};

export const SHARED_ACQUISITION_ROUTES: readonly AcquisitionRoute[] = [
  {
    slug: "meeting",
    label: "面談から流入",
    tagName: "面談から流入",
    registrationMessage: "面談経由で友だち追加しました",
    description: "面談後に案内する友だち追加URLです。"
  },
  {
    slug: "survey",
    label: "アンケート経由",
    tagName: "アンケート経由",
    registrationMessage: "アンケート経由で友だち追加しました",
    description: "外部アンケートの完了画面などに設置する友だち追加URLです。"
  },
  {
    slug: "hp",
    label: "HP経由",
    tagName: "HP経由",
    registrationMessage: "HP経由で友だち追加しました",
    description: "会社ホームページなどに設置する友だち追加URLです。"
  }
] as const;

export const STAFF_ACQUISITION_ROUTES: readonly (AcquisitionRoute & { fixedAssigneeName: string })[] = [
  { slug: "meeting-imafuku", fixedAssigneeName: "今福", label: "今福さん専用", tagName: "面談から流入", registrationMessage: "面談経由（今福担当）で友だち追加しました", description: "今福さんが担当する面談の友だち追加URLです。" },
  { slug: "meeting-shimizu", fixedAssigneeName: "志水", label: "志水さん専用", tagName: "面談から流入", registrationMessage: "面談経由（志水担当）で友だち追加しました", description: "志水さんが担当する面談の友だち追加URLです。" },
  { slug: "meeting-uoi", fixedAssigneeName: "魚井", label: "魚井さん専用", tagName: "面談から流入", registrationMessage: "面談経由（魚井担当）で友だち追加しました", description: "魚井さんが担当する面談の友だち追加URLです。" },
  { slug: "meeting-nishita", fixedAssigneeName: "西田", label: "西田さん専用", tagName: "面談から流入", registrationMessage: "面談経由（西田担当）で友だち追加しました", description: "西田さんが担当する面談の友だち追加URLです。" }
];

export const ACQUISITION_ROUTES: readonly AcquisitionRoute[] = [...SHARED_ACQUISITION_ROUTES, ...STAFF_ACQUISITION_ROUTES];
export const FIXED_ASSIGNEE_NAMES = STAFF_ACQUISITION_ROUTES.map(route => route.fixedAssigneeName);

function normalizeMessage(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function acquisitionRouteBySlug(value: string): AcquisitionRoute | null {
  return ACQUISITION_ROUTES.find((route) => route.slug === value) || null;
}

export function acquisitionRouteByMessage(value: string): AcquisitionRoute | null {
  const normalized = normalizeMessage(value);
  return ACQUISITION_ROUTES.find((route) => normalizeMessage(route.registrationMessage) === normalized) || null;
}

function normalizeBasicId(basicId: string): string {
  const normalizedId = basicId.normalize("NFKC").trim();
  if (!/^@[A-Za-z0-9._-]{1,100}$/.test(normalizedId)) {
    throw new Error("LINE公式アカウントのBasic IDが不正です。");
  }
  return normalizedId;
}

export function buildLineAcquisitionUrl(basicId: string, route: AcquisitionRoute): string {
  const normalizedId = normalizeBasicId(basicId);
  return `https://line.me/R/oaMessage/${encodeURIComponent(normalizedId)}/?${encodeURIComponent(route.registrationMessage)}`;
}

export function buildLineFriendUrl(basicId: string): string {
  return `https://line.me/R/ti/p/${encodeURIComponent(normalizeBasicId(basicId))}`;
}

function normalizeLiffId(liffId: string): string {
  const normalizedId = liffId.normalize("NFKC").trim();
  if (!/^[A-Za-z0-9_-]{5,100}$/.test(normalizedId)) {
    throw new Error("LIFF IDが不正です。");
  }
  return normalizedId;
}

export function buildLineLiffAcquisitionUrl(liffId: string, route: AcquisitionRoute): string {
  const normalizedId = normalizeLiffId(liffId);
  const url = new URL(`https://liff.line.me/${encodeURIComponent(normalizedId)}/`);
  url.searchParams.set("source", route.slug);
  return url.toString();
}
