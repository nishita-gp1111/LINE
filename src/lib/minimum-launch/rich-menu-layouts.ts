export type RichMenuActionInput = {
  type: "uri" | "message";
  value: string;
};

export type RichMenuLayoutArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RichMenuLayoutId =
  | "single"
  | "split-2"
  | "stack-2"
  | "hero-3"
  | "hero-3-friendly"
  | "columns-3"
  | "grid-4"
  | "grid-6";

export type RichMenuLayout = {
  id: RichMenuLayoutId;
  label: string;
  description: string;
  areas: RichMenuLayoutArea[];
};

const LAYOUT_SCALE = 10_000;

export const RICH_MENU_LAYOUTS: RichMenuLayout[] = [
  {
    id: "single",
    label: "1ボタン",
    description: "全面",
    areas: [{ x: 0, y: 0, width: 10_000, height: 10_000 }]
  },
  {
    id: "split-2",
    label: "2ボタン",
    description: "左右",
    areas: [
      { x: 0, y: 0, width: 5_000, height: 10_000 },
      { x: 5_000, y: 0, width: 5_000, height: 10_000 }
    ]
  },
  {
    id: "stack-2",
    label: "2ボタン",
    description: "上下",
    areas: [
      { x: 0, y: 0, width: 10_000, height: 5_000 },
      { x: 0, y: 5_000, width: 10_000, height: 5_000 }
    ]
  },
  {
    id: "hero-3",
    label: "3ボタン",
    description: "上1・下2",
    areas: [
      { x: 0, y: 0, width: 10_000, height: 5_000 },
      { x: 0, y: 5_000, width: 5_000, height: 5_000 },
      { x: 5_000, y: 5_000, width: 5_000, height: 5_000 }
    ]
  },
  {
    id: "hero-3-friendly",
    label: "3ボタン",
    description: "上58%・下42%",
    areas: [
      { x: 0, y: 0, width: 10_000, height: 5_800 },
      { x: 0, y: 5_800, width: 5_000, height: 4_200 },
      { x: 5_000, y: 5_800, width: 5_000, height: 4_200 }
    ]
  },
  {
    id: "columns-3",
    label: "3ボタン",
    description: "横3列",
    areas: [
      { x: 0, y: 0, width: 3_333, height: 10_000 },
      { x: 3_333, y: 0, width: 3_334, height: 10_000 },
      { x: 6_667, y: 0, width: 3_333, height: 10_000 }
    ]
  },
  {
    id: "grid-4",
    label: "4ボタン",
    description: "2×2",
    areas: [
      { x: 0, y: 0, width: 5_000, height: 5_000 },
      { x: 5_000, y: 0, width: 5_000, height: 5_000 },
      { x: 0, y: 5_000, width: 5_000, height: 5_000 },
      { x: 5_000, y: 5_000, width: 5_000, height: 5_000 }
    ]
  },
  {
    id: "grid-6",
    label: "6ボタン",
    description: "3×2",
    areas: [
      { x: 0, y: 0, width: 3_333, height: 5_000 },
      { x: 3_333, y: 0, width: 3_334, height: 5_000 },
      { x: 6_667, y: 0, width: 3_333, height: 5_000 },
      { x: 0, y: 5_000, width: 3_333, height: 5_000 },
      { x: 3_333, y: 5_000, width: 3_334, height: 5_000 },
      { x: 6_667, y: 5_000, width: 3_333, height: 5_000 }
    ]
  }
];

export function getRichMenuLayout(id: string): RichMenuLayout {
  const layout = RICH_MENU_LAYOUTS.find((candidate) => candidate.id === id);
  if (!layout) throw new Error("リッチメニューのレイアウトを選択してください。");
  return layout;
}

function scaledEdge(size: number, edge: number): number {
  return edge === LAYOUT_SCALE ? size : Math.floor((size * edge) / LAYOUT_SCALE);
}

export function scaleRichMenuLayout(id: string, width: number, height: number): RichMenuLayoutArea[] {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("リッチメニュー画像のサイズが不正です。");
  }
  return getRichMenuLayout(id).areas.map((area) => {
    const x = scaledEdge(width, area.x);
    const y = scaledEdge(height, area.y);
    const right = scaledEdge(width, area.x + area.width);
    const bottom = scaledEdge(height, area.y + area.height);
    return { x, y, width: right - x, height: bottom - y };
  });
}
