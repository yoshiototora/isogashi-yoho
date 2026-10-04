import {
  BERTH_SPOT,
  PLACE_SPOT,
  cruises,
  events,
  holidays,
  type ReasonIcon,
  type SpotId,
} from "@/data";

// ───── 計算ルール（すべてここに書いてある）─────
// 長崎市の中心部全体について、1日ごとに点数を出す（エリア別の係数は使わない）。
// 点数は 5段階に振り分けるためだけに使い、画面には出さない。
// 配点は仮置きなので、細かい数字の差には意味がない。段階の違いだけを見せる。

// 何もない平日の基本値
export const BASE = 20;

// イベントの大きさは「想定来場者数」だけで決める
export const EVENT_SCALES = [
  { label: "大型", min: 10000, points: 55 },
  { label: "中規模", min: 3000, points: 25 },
  { label: "小規模", min: 0, points: 10 },
];

// クルーズ船は、寄港予定表に載っている「総トン数」だけで大きさを決める
// （10万トン以上を大型船、3万トン以上を中型船とする）。
export const UNKNOWN_SHIP_POINTS = 10; // トン数が分からない船
export const CRUISE_SCALES = [
  { label: "大型船", min: 100000, points: 20 },
  { label: "中型船", min: 30000, points: 10 },
  { label: "小型船", min: 0, points: 5 },
];

export const WEEKEND_POINTS = 10;

// お店ごとの設定。場所ごとに「お店への影響」を選ぶ（選んでいない場所は「大きい」）。
// かんたん設定は3つのボタン、細かい設定はバーで 0〜2 の間を選ぶ（画面では 0〜100%）。
// 点数に掛ける割合は、どちらも value ÷ 2。
export const IMPACT_LEVELS = [
  { value: 2, label: "大きい" },
  { value: 1, label: "少し" },
  { value: 0, label: "ない" },
] as const;
export type ShopSettings = Partial<Record<SpotId, number>> & {
  area?: string; // おすすめの初期設定に使った地域
  fine?: boolean; // 細かい設定を開いているか
  weekend?: number; // 土日祝の影響（細かい設定だけ）
};

const impactRate = (settings: ShopSettings, spot: SpotId | undefined) =>
  (spot ? (settings[spot] ?? 2) : 2) / 2;

// ─────────────────────────────────────────────

const scaleOf = <T extends { min: number }>(scales: T[], n: number) =>
  scales.find((s) => n >= s.min)!;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export type Reason = {
  icon: ReasonIcon;
  kind: "イベント" | "クルーズ船" | "土日祝"; // 要約に使う短い呼び名
  label: string;
  detail: string; // 確かめられる事実（大きさ・場所・時刻）
  points: number;
};

export type BusyDay = {
  date: string; // YYYY-MM-DD
  month: number;
  day: number;
  weekday: string;
  rate: number; // 0〜100 の点数（画面には出さない）
  reasons: Reason[]; // 影響の大きい順
  ships: number; // 入港するクルーズ船の数
  bigEvent: boolean; // 大型イベントがある日か
};

export type BusyLevel = {
  level: 0 | 1 | 2 | 3 | 4;
  short: string; // カレンダーや凡例に出す短い呼び名
  copy: string;
};

export const BUSY_LEVELS: BusyLevel[] = [
  { level: 0, short: "ゆるめ", copy: "今日はゆるめ。" },
  { level: 1, short: "ぼちぼち", copy: "ぼちぼちです。" },
  { level: 2, short: "ちょい忙", copy: "ちょい忙。" },
  { level: 3, short: "バタつき", copy: "バタつきます。" },
  { level: 4, short: "山場", copy: "山場です。" },
];

export function getBusyLevel(rate: number): BusyLevel {
  if (rate >= 85) return BUSY_LEVELS[4];
  if (rate >= 70) return BUSY_LEVELS[3];
  if (rate >= 50) return BUSY_LEVELS[2];
  if (rate >= 30) return BUSY_LEVELS[1];
  return BUSY_LEVELS[0];
}

export function calculateBusyRate(
  date: string,
  settings: ShopSettings = {},
): BusyDay {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();
  const reasons: Reason[] = [];
  let bigEvent = false;

  for (const event of events) {
    if (!(date in event.days)) continue;
    const start = event.days[date];
    const scale = scaleOf(EVENT_SCALES, event.expected);
    if (scale === EVENT_SCALES[0]) bigEvent = true;
    // お店への影響が「ない」場所のイベントは、理由にも出さない
    const rate = impactRate(settings, event.spot ?? PLACE_SPOT[event.place]);
    if (rate === 0) continue;
    reasons.push({
      icon: event.icon,
      kind: "イベント",
      label: event.name,
      detail: [
        start && `${start}開始`,
        `${scale.label}イベント`,
        event.place,
      ]
        .filter(Boolean)
        .join("・"),
      points: Math.round(scale.points * rate),
    });
  }

  const ships = cruises[date] ?? [];
  for (const ship of ships) {
    const size = ship.tonnage ? scaleOf(CRUISE_SCALES, ship.tonnage) : null;
    const rate = impactRate(
      settings,
      BERTH_SPOT[ship.berth ?? ""] ?? "matsugae",
    );
    if (rate === 0) continue;
    reasons.push({
      icon: "cruise",
      kind: "クルーズ船",
      // 船名は知らない人が多いので、太字には船の大きさを出す
      label: size ? `クルーズ船（${size.label}）` : "クルーズ船",
      // 船名には「・」が入ることが多いので、かっこに入れて区切る
      detail:
        [
          ship.arrive && ship.depart && `${ship.arrive}〜${ship.depart}`,
          ship.berth && `${ship.berth}に入港`,
        ]
          .filter(Boolean)
          .join("・") + (ship.name ? `（${ship.name}）` : ""),
      points: Math.round((size?.points ?? UNKNOWN_SHIP_POINTS) * rate),
    });
  }

  // 土日祝の影響も、お店の設定で変えられる（「ない」なら理由にも出さない）
  const weekendPoints = Math.round((WEEKEND_POINTS * (settings.weekend ?? 2)) / 2);
  if (weekendPoints === 0) {
    // 何も足さない
  } else if (holidays[date]) {
    reasons.push({
      icon: "tram",
      kind: "土日祝",
      label: `祝日（${holidays[date]}）`,
      detail: "お出かけの人が増える日",
      points: weekendPoints,
    });
  } else if (dow === 0 || dow === 6) {
    reasons.push({
      icon: "tram",
      kind: "土日祝",
      label: dow === 6 ? "土曜日" : "日曜日",
      detail: "お出かけの人が増える日",
      points: weekendPoints,
    });
  }

  const total = BASE + reasons.reduce((sum, r) => sum + r.points, 0);

  return {
    date,
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: WEEKDAYS[dow],
    rate: Math.min(100, total),
    reasons: reasons.sort((a, b) => b.points - a.points),
    ships: ships.length,
    bigEvent,
  };
}

// 今日から「来月の末日」までの日数（例：10/2 → 11/30 で60日ぶん）
// 来月まるごとのシフトを出すときに、来月全体を見られるようにする
export function daysThroughNextMonth(startDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  // 再来月の0日目 ＝ 来月の末日
  const end = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 2, 0);
  return Math.round((end - start.getTime()) / 86_400_000) + 1;
}

export function getForecast(
  startDate: string,
  days: number,
  settings: ShopSettings = {},
): BusyDay[] {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    return calculateBusyRate(date, settings);
  });
}
