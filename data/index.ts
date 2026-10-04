// アプリが使うデータの入り口。
// ここに置くのは「事実として調べられる入力」だけ（いつ・どこで・どれくらいの規模）。
// 点数はここでは決めず、lib/calculateBusyRate.ts のルールで機械的に出す。
//
//   取り込むデータ（npm run import-data で data/imported.json に取り込む）
//     - クルーズ船：長崎港の寄港予定表
//     - 祝日　　　：内閣府の祝日一覧
//     - イベント　：長崎スタジアムシティ公式のイベント一覧
//   AIが読み取るデータ（npm run research-events で data/auto-events.json に取り込む）
//     - イベント　：出島メッセ長崎、ブリックホール、まちなかのお祭り（長崎市の観光サイト）
//       公式ページを Gemini に読み取らせ、機械的な確認を通ったものだけが入る
//       毎年ある催し（Lovefes、長崎ベイサイドマラソン、NAGASAKI CITY JAZZ）は、それぞれの公式ページから開催日を読む
//   手で補っているもの（このファイル）
//     - 開始時刻　：スタジアムシティの一覧には載っていないので、確認できたものを手で補う
// イベントそのものの手入力は、2026-10-04 にやめた。

import auto from "./auto-events.json";
import imported from "./imported.json";

export type ReasonIcon =
  | "cruise"
  | "event"
  | "fireworks"
  | "live"
  | "festival"
  | "food"
  | "shopping"
  | "tram";

export type CityEvent = {
  name: string;
  icon: ReasonIcon;
  days: Record<string, string | null>; // 開催日 → 開始時刻（確認できていない日は null）
  expected: number; // 想定来場者数（1日あたり）
  basis: string; // 想定来場者数の根拠
  place: string; // 会場
  spot?: SpotId; // 場所（会場の名前から決まらないときに指定）
  source: string; // 日程の出どころ
};

// お店ごとに「影響の大きさ」を選べる場所。
// イベントは会場、クルーズ船は岸壁で、どの場所のものかが決まる。
export const SPOTS = [
  { id: "stadiumcity", name: "長崎スタジアムシティ", hint: "スタジアム・アリーナ" },
  { id: "station", name: "長崎駅", hint: "かもめ広場" },
  { id: "messe", name: "出島メッセ長崎", hint: "長崎駅のとなり" },
  { id: "brick", name: "ブリックホール", hint: "茂里町" },
  { id: "machinaka", name: "まちなかのお祭り", hint: "くんち・ランタンフェスティバルなど" },
  { id: "mizube", name: "長崎水辺の森公園", hint: "Lovefes など" },
  { id: "matsugae", name: "クルーズ船（松が枝）", hint: "大浦・グラバー園の近く" },
  { id: "dejima", name: "クルーズ船（出島岸壁）", hint: "出島・新地中華街の近く" },
] as const;
export type SpotId = (typeof SPOTS)[number]["id"];

// お店のある地域ごとの、おすすめの初期設定（2＝大きい、1＝少し、0＝ない）。
// 近さをもとにした目安で、選んだあとに場所ごとに直せる。
export const SHOP_AREAS: { id: string; name: string; preset: Record<SpotId, 0 | 1 | 2> }[] = [
  {
    id: "nagasaki-station",
    name: "長崎駅",
    preset: { stadiumcity: 2, station: 2, messe: 2, brick: 1, machinaka: 1, mizube: 1, matsugae: 1, dejima: 1 },
  },
  {
    id: "urakami",
    name: "浦上",
    preset: { stadiumcity: 2, station: 1, messe: 1, brick: 2, machinaka: 0, mizube: 0, matsugae: 0, dejima: 0 },
  },
  {
    id: "hamanomachi",
    name: "浜町",
    preset: { stadiumcity: 1, station: 1, messe: 1, brick: 0, machinaka: 2, mizube: 1, matsugae: 1, dejima: 1 },
  },
  {
    id: "shianbashi",
    name: "思案橋",
    preset: { stadiumcity: 1, station: 0, messe: 1, brick: 0, machinaka: 2, mizube: 1, matsugae: 1, dejima: 1 },
  },
  {
    id: "shinchi",
    name: "新地中華街",
    preset: { stadiumcity: 0, station: 1, messe: 1, brick: 0, machinaka: 2, mizube: 2, matsugae: 2, dejima: 2 },
  },
  {
    id: "oura",
    name: "大浦",
    preset: { stadiumcity: 0, station: 0, messe: 0, brick: 0, machinaka: 1, mizube: 2, matsugae: 2, dejima: 1 },
  },
];

// 会場の名前 → 場所
export const PLACE_SPOT: Record<string, SpotId> = {
  ハピネスアリーナ: "stadiumcity",
  ピーススタジアム: "stadiumcity",
  "長崎駅 かもめ広場ほか": "station",
  出島メッセ長崎: "messe",
  ブリックホール: "brick",
  "諏訪神社・中央公園・お旅所ほか": "machinaka",
  長崎水辺の森公園: "mizube",
};
// 岸壁の名前 → 場所（分からないときは松が枝）
export const BERTH_SPOT: Record<string, SpotId> = {
  松が枝: "matsugae",
  出島: "dejima",
};

// データを取り込んだ日時
export const IMPORTED_AT: string = imported.fetchedAt;

// ───── 取り込んだイベント（長崎スタジアムシティ）

type ImportedEvent = Omit<CityEvent, "days"> & { id: string; dates: string[] };

// 開始時刻は一覧ページに載っていないので、確認できたものだけ手で補う
// （取り込んだイベントの id → 開催日 → 開始時刻）
const START_TIMES: Record<string, Record<string, string>> = {
  "stadiumcity-51884": { "2026-10-03": "14:00" }, // RIZIN
  "stadiumcity-41994": { "2026-10-08": "19:05" }, // ヴェルカ vs 信州
  "stadiumcity-41992": { "2026-10-10": "15:05" }, // ヴェルカ vs 群馬
  "stadiumcity-41996": { "2026-10-12": "15:05" }, // ヴェルカ vs 神戸
  "stadiumcity-53268": { "2026-10-17": "14:00" }, // ハピネスジャム
  "stadiumcity-41999": { "2026-10-19": "19:05" }, // ヴェルカ vs A千葉
  "stadiumcity-50555": { "2026-10-21": "19:00" }, // V・ファーレン vs 広島
  "stadiumcity-42001": { "2026-10-26": "19:05" }, // ヴェルカ vs 琉球
  "stadiumcity-48275": { "2026-10-31": "14:00" }, // 五木ひろし
  "stadiumcity-50333": { "2026-11-01": "17:00" }, // 野口五郎
  "stadiumcity-52130": { "2026-11-07": "17:00" }, // 広瀬香美
};

const importedEvents: CityEvent[] = (imported.events as ImportedEvent[]).map(
  ({ id, dates, ...event }) => ({
    ...event,
    days: Object.fromEntries(
      dates.map((d) => [d, START_TIMES[id]?.[d] ?? null]),
    ),
  }),
);

// ───── AIが読み取ったイベント（今月と来月）

type AutoEvent = Omit<CityEvent, "days"> & { dates: string[]; start: string | null };

const autoEvents: CityEvent[] = (auto.events as AutoEvent[]).map(
  ({ dates, start, ...event }) => ({
    ...event,
    days: Object.fromEntries(dates.map((d) => [d, start])),
  }),
);

export const events: CityEvent[] = [...importedEvents, ...autoEvents];

export type CruiseCall = {
  name: string; // 船名（読み取れなかったときは空）
  tonnage: number | null; // 総トン数
  arrive: string | null; // 入港時刻
  depart: string | null; // 出港時刻
  berth: string | null; // 接岸する岸壁
};

// クルーズ船の寄港予定（日付 → その日に来る船）
export const cruises = imported.cruises as Record<string, CruiseCall[]>;

export const holidays: Record<string, string> = imported.holidays;
