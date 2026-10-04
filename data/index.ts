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
//   手入力のデータ（このファイル）
//     - イベント　：そのほかの会場。公式サイトで日程を確認して入力（出どころを各イベントに記載）
//     - 開始時刻　：スタジアムシティの一覧には載っていないので、確認できたものを手で補う

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

// 会場
const MESSE = "出島メッセ長崎";
const BRICK = "ブリックホール";

// 日程の出どころ（2026-10-03 に確認）
const MESSE_EVENTS = "https://dejima-messe.jp/event";
const BRICK_EVENTS = "https://www.brickhall.jp/event/";

// 想定来場者数の根拠
const BRICK_CAPACITY = "ブリックホール大ホールの座席数（2,002席）";
// 来場者数が分からない催事は、いちばん小さい区分（小規模）で数える
const UNKNOWN = { expected: 1000, basis: "来場者数は不明（小規模として計上）" };
const BRICK_SHOW = { expected: 2000, basis: BRICK_CAPACITY };

// 同じ開始時刻・時刻なしの日をまとめて書くための小道具
const on = (time: string | null, ...dates: string[]) =>
  Object.fromEntries(dates.map((d) => [d, time]));

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

// ───── 手で入力しているイベント（2026年10〜11月分・2026-10-03 に確認）
//   - 出島メッセ長崎　：公式カレンダーにある催事と学会
//   - ブリックホール　：大ホールの興行（学校・市民団体の発表会は除く）
//   - 長崎くんち
//   - 長崎水辺の森公園：Lovefes、長崎ベイサイドマラソン
//   - 長崎駅　　　　　：NAGASAKI CITY JAZZ（かもめ広場ほか）
// 載せていないもの：グラバー園のランタンナイトのような長期開催、小さな会場の催事
const manualEvents: CityEvent[] = [
  // ── 長崎くんち（浜町・新地中華街ほか）
  {
    name: "長崎くんち",
    icon: "festival",
    days: on(null, "2026-10-07", "2026-10-08", "2026-10-09"),
    // 正確な人出は未確認。例年3日間で数十万人とされ、どの数字でも「大型」に入る
    expected: 100000,
    basis: "例年の人出（3日間で数十万人とされる・未確認）",
    place: "諏訪神社・中央公園・お旅所ほか",
    source: "毎年10月7〜9日に開催",
  },

  // ── 長崎水辺の森公園（大浦・新地中華街の近く）
  {
    name: "Lovefes 2026",
    icon: "live",
    days: on(null, "2026-10-24", "2026-10-25"),
    expected: 55000,
    basis: "2024年の来場者数（2日間で11万人・主催のKTN発表）の1日あたり",
    place: "長崎水辺の森公園",
    source: "https://www.ktn.co.jp/special/lovefes/",
  },
  {
    name: "長崎ベイサイドマラソン",
    icon: "event",
    days: on("9:00", "2026-11-15"),
    expected: 2950,
    basis: "募集定員（ハーフ1,900人、10km 1,050人。1.9kmは含まず）",
    place: "長崎水辺の森公園",
    source: "https://www.city.nagasaki.lg.jp/page/20104.html",
  },

  // ── 長崎駅
  {
    name: "NAGASAKI CITY JAZZ",
    icon: "live",
    days: on(null, "2026-11-14", "2026-11-15"),
    ...UNKNOWN,
    place: "長崎駅 かもめ広場ほか",
    source: "https://nagasaki-city-jazz.com/",
  },

  // ── 出島メッセ長崎（長崎駅のとなり）
  {
    name: "リトル・ママフェスタ",
    icon: "shopping",
    days: on(null, "2026-10-03"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "日本呼吸器学会",
    icon: "event",
    days: on(null, "2026-10-09", "2026-10-10"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "Global Offshore Wind Summit",
    icon: "event",
    days: on(null, "2026-10-13", "2026-10-14", "2026-10-15"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "長崎水道展",
    icon: "event",
    days: on(null, "2026-10-21", "2026-10-22", "2026-10-23"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "日本救急医学会総会",
    icon: "event",
    days: on(null, "2026-10-27", "2026-10-28", "2026-10-29"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "ハーレーダビッドソン＆ロッキンミュージック",
    icon: "live",
    days: on(null, "2026-11-07", "2026-11-08"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "日本神経内視鏡学会",
    icon: "event",
    days: on(null, "2026-11-12", "2026-11-13"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "マイナビ インターンシップフェア",
    icon: "event",
    days: on(null, "2026-11-14"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "日本大腸肛門病学会",
    icon: "event",
    days: on(null, "2026-11-20", "2026-11-21"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },
  {
    name: "トコハピカーニバル",
    icon: "shopping",
    days: on(null, "2026-11-28", "2026-11-29"),
    ...UNKNOWN,
    place: MESSE,
    source: MESSE_EVENTS,
  },

  // ── ブリックホール 大ホール（浦上）
  {
    name: "さらば青春の光 単独ライブ",
    icon: "live",
    days: on("14:00", "2026-10-03"),
    ...BRICK_SHOW,
    place: BRICK,
    source: BRICK_EVENTS,
  },
  {
    name: "玉置浩二 コンサート",
    icon: "live",
    days: on("17:30", "2026-10-04"),
    ...BRICK_SHOW,
    place: BRICK,
    source: BRICK_EVENTS,
  },
  {
    name: "辻井伸行 コンサート",
    icon: "live",
    days: { "2026-10-10": "15:00", "2026-10-11": "14:00" },
    ...BRICK_SHOW,
    place: BRICK,
    source: BRICK_EVENTS,
  },
  {
    name: "宮川大輔×ケンドーコバヤシ トークライブ",
    icon: "live",
    days: on("16:00", "2026-10-18"),
    ...BRICK_SHOW,
    place: BRICK,
    source: BRICK_EVENTS,
  },
  {
    name: "ゴスペラーズ コンサート",
    icon: "live",
    days: on("17:00", "2026-10-31"),
    ...BRICK_SHOW,
    place: BRICK,
    source: BRICK_EVENTS,
  },
  {
    name: "マリアセレン コンサート",
    icon: "live",
    days: on("18:30", "2026-11-06"),
    ...BRICK_SHOW,
    place: BRICK,
    source: BRICK_EVENTS,
  },
  {
    name: "スターダスト☆レビュー コンサート",
    icon: "live",
    days: on("17:00", "2026-11-07"),
    ...BRICK_SHOW,
    place: BRICK,
    source: BRICK_EVENTS,
  },
];

// ───── AIが読み取ったイベント（今月と来月）

type AutoEvent = Omit<CityEvent, "days"> & { dates: string[]; start: string | null };

// 手入力や取り込みと同じイベントは、そちらを優先する。
// 「同じ日にあり、名前に4文字以上の同じ並びがある」ものを同じイベントとみなす。
const squash = (text: string) => text.replace(/[\s・×＆&]/g, "");
function sameEvent(a: AutoEvent, b: CityEvent) {
  if (!a.dates.some((d) => d in b.days)) return false;
  const [x, y] = [squash(a.name), squash(b.name)];
  for (let i = 0; i + 4 <= y.length; i++) {
    if (x.includes(y.slice(i, i + 4))) return true;
  }
  return false;
}

const autoEvents: CityEvent[] = (auto.events as AutoEvent[])
  .filter((a) => ![...importedEvents, ...manualEvents].some((b) => sameEvent(a, b)))
  .map(({ dates, start, ...event }) => ({
    ...event,
    days: Object.fromEntries(dates.map((d) => [d, start])),
  }));

export const events: CityEvent[] = [...importedEvents, ...manualEvents, ...autoEvents];

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
