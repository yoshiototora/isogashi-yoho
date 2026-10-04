// 公式ページを取ってきて、Gemini にイベントを読み取らせ、確認を通ったものをアプリに反映する。
//   npm run research-events
//
// しくみ：
//   1. このプログラムが、下の SOURCES の公式ページを取ってくる
//   2. ページの文章を Gemini に渡し、イベントを決まった形（JSON）で抜き出させる
//   3. 機械的な確認（下の check）を通ったものだけを data/auto-events.json に書く → アプリに出る
//   4. 読み取ったもの全部と、通らなかった理由は data/event-candidates.json に残す
// Gemini 自身に検索はさせない（検索つきの問い合わせは無料枠で使えなかったため）。
// ページを取れなかった・読み取れなかった場所は、前回の内容をそのまま残し、失敗として終わる。
//
// APIキーは .env.local（GitHub Actions では Secrets）の GEMINI_API_KEY から読む。
//   - プログラムにも、保存する結果にも、画面の出力にもキーは書かない
//   - この処理はパソコン（または GitHub Actions）の中だけで動き、公開サイトには含まれない

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = new URL("../data/event-candidates.json", import.meta.url);
const AUTO = new URL("../data/auto-events.json", import.meta.url);
const API = "https://generativelanguage.googleapis.com/v1beta";
const KEY = process.env.GEMINI_API_KEY;
// 混み合っているときは、次のモデルで試す
const MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ["gemini-flash-latest", "gemini-3.5-flash", "gemini-flash-lite-latest"];
let usedModel = MODELS[0];

if (!KEY) {
  console.error("APIキーがありません。.env.local の GEMINI_API_KEY= のあとにキーを貼り付けて保存してください。");
  process.exit(1);
}

// エラー文にキーが混ざっても、画面に出さない
const hide = (text) => String(text).replaceAll(KEY, "***");
const pad = (n) => String(n).padStart(2, "0");

// 今月と来月を調べる
const now = new Date();
const months = [0, 1].map((i) => new Date(now.getFullYear(), now.getMonth() + i, 1));
const monthLabels = months.map((d) => `${d.getFullYear()}年${d.getMonth() + 1}月`);

// 調べる公式ページ。増やすときは、ここに足す。
//   venue：会場のページ。その会場のイベントとして扱う
//   town ：観光サイトのお祭り一覧。まちなか・水辺の森・長崎駅のお祭りだけを拾う
const SOURCES = [
  { type: "venue", place: "出島メッセ長崎", urls: ["https://dejima-messe.jp/event"] },
  {
    type: "venue",
    place: "ブリックホール",
    // 月ごとのページ（Month=年の下2桁＋月）。大ホールだけ
    urls: months.map(
      (d) => `https://www.brickhall.jp/event/?Month=${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}&Facility=1`,
    ),
  },
  { type: "town", place: "まちなかのお祭り", urls: ["https://www.at-nagasaki.jp/event"] },
];

// 会場ごとの決まり（場所・アイコン・想定来場者数とその根拠）
const UNKNOWN = { expected: 1000, basis: "来場者数は不明（小規模として計上）" };
const VENUES = {
  出島メッセ長崎: { spot: "messe", icon: "event", ...UNKNOWN },
  ブリックホール: { spot: "brick", icon: "live", expected: 2000, basis: "ブリックホール大ホールの座席数（2,002席）" },
};
// 会場を持たない大きなお祭りは、規模を先に登録しておく（名前がこの言葉で終わっていれば大型。
// 「長崎くんち 庭見世」のような関連行事は含めない）。
// 正確な人数は未確認。例年の人出から、どれも「大型」（1日1万人以上）に入るとみている。
const BIG_FESTIVALS = ["くんち", "ランタンフェスティバル", "帆船まつり", "みなとまつり", "精霊流し"];
const BIG = { expected: 10000, basis: "例年の人出から大型として登録（正確な人数は未確認）" };
// これより長く続く催事は載せない（毎日がいそがしいわけではないため）
const MAX_DAYS = 14;

// ページから文章だけを取り出す
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60000);
}

async function askGemini(prompt) {
  let lastError;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${API}/models/${model}:generateContent`, {
        method: "POST",
        // キーはURLに付けず、ヘッダーで送る（URLは記録に残りやすいため）
        headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
      const text = await res.text();
      if (res.ok) {
        usedModel = model;
        const parts = JSON.parse(text).candidates?.[0]?.content?.parts ?? [];
        return JSON.parse(parts.map((p) => p.text ?? "").join(""));
      }
      lastError = new Error(`HTTP ${res.status} ${hide(text).replace(/\s+/g, " ").slice(0, 200)}`);
      // 混雑（503）と回数の上限（429）は、少し待ってやり直す。それ以外はすぐ次のモデルへ
      if (res.status !== 503 && res.status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw lastError;
}

const RULES = `決まり：
- 文章に書かれていることだけを使ってください。書かれていない情報を足さないでください。
- name は、文章に書かれているとおりの名前をそのまま写してください。
- 日付は YYYY-MM-DD の形にしてください。複数日の催事は、すべての日を並べてください。
- 日付がはっきり書かれていないもの（未定・例年◯月ごろ など）は入れないでください。
- 開始時刻が書かれていなければ start は null にしてください。
- 該当するイベントがなければ、空の配列を返してください。`;

const venuePrompt = (place, url, pageText) => `次の文章は、「${place}」の公式ページ（${url}）から取り出したものです。
この中から、${monthLabels.join("と")}に開催されるイベントを抜き出してください。

${RULES}
- kind は次から選んでください。
  "show"：コンサート・公演・スポーツ・フェス・展示会・即売会など、一般の人が集まる催し
  "conference"：学会・大会・全国会議・サミット
  "seminar"：セミナー・研修・説明会・講演会・試験・社内の集まり
  "community"：学校や市民団体の発表会・演奏会

答えは次の形のJSONの配列だけにしてください。
[{"name":"イベント名","dates":["YYYY-MM-DD"],"start":"HH:MM または null","kind":"show | conference | seminar | community"}]

文章：
${pageText}`;

const townPrompt = (place, url, pageText) => `次の文章は、長崎市の公式観光サイトのイベント一覧（${url}）から取り出したものです。
この中から、${monthLabels.join("と")}に開催されるお祭り・イベントを抜き出してください。
「毎年同日開催」と書かれているものは、今年の日付にしてください。

${RULES}
- kind は次から選んでください。
  "festival"：出店・パレード・ステージなどがあり、多くの人が集まるお祭りやイベント
  "ceremony"：式典・慰霊・ミサ・参拝などの行事
  "other"：体験プラン・期間限定メニュー・花の見ごろなど
- area は次から選んでください。
  "machinaka"：浜町・新地中華街・中央公園・諏訪神社・眼鏡橋・中島川など、長崎市中心部のまちなか
  "mizube"：長崎水辺の森公園・長崎港
  "station"：長崎駅
  "other"：それ以外、または文章から分からない

答えは次の形のJSONの配列だけにしてください。
[{"name":"イベント名","dates":["YYYY-MM-DD"],"start":"HH:MM または null","kind":"festival | ceremony | other","area":"machinaka | mizube | station | other"}]

文章：
${pageText}`;

// ───── 機械的な確認。通らなかった理由を返す（通れば null）
const squash = (text) => String(text).replace(/[\s|｜]/g, "");
const first = `${months[0].getFullYear()}-${pad(months[0].getMonth() + 1)}-01`;
const last = `${months[1].getFullYear()}-${pad(months[1].getMonth() + 1)}-31`;

function check(e, type, pageText) {
  if (typeof e.name !== "string" || squash(e.name).length < 2) return "名前がない";
  if (!squash(pageText).includes(squash(e.name))) return "名前がページの文章に見つからない";
  if (!Array.isArray(e.dates) || e.dates.length === 0) return "日付がない";
  for (const d of e.dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return "日付の形がおかしい";
    if (d < first || d > last) return "調べる期間の外";
  }
  if (e.dates.length > MAX_DAYS) return `長期開催（${MAX_DAYS}日より長い）`;
  if (e.start != null && !/^\d{1,2}:\d{2}$/.test(e.start)) return "開始時刻の形がおかしい";
  if (type === "venue") {
    if (e.kind === "show") return null;
    if (e.kind === "conference") return e.dates.length >= 2 ? null : "1日だけの会議";
    return "セミナー・発表会など";
  }
  if (e.kind !== "festival") return "お祭りではない";
  if (!(e.area in TOWN_PLACES)) return "対象の場所ではない";
  return null;
}

// アプリが使う形にする
const TOWN_PLACES = { machinaka: "まちなか", mizube: "長崎水辺の森公園", station: "長崎駅" };
function toAppEvent(e, type, place, url) {
  const name = e.name.replace(/[|｜]/g, " ").replace(/\s+/g, " ").trim();
  const base = { name, dates: [...new Set(e.dates)].sort(), start: e.start ?? null, source: url };
  if (type === "venue") {
    const { spot, icon, expected, basis } = VENUES[place];
    return { ...base, icon, expected, basis, place, spot, from: place };
  }
  const size = BIG_FESTIVALS.some((word) => name.endsWith(word)) ? BIG : UNKNOWN;
  return { ...base, icon: "festival", ...size, place: TOWN_PLACES[e.area], spot: e.area, from: place };
}

const previous = existsSync(AUTO) ? (JSON.parse(readFileSync(AUTO, "utf8")).events ?? []) : [];
const candidates = [];
const approved = [];
let failed = false;
for (const { type, place, urls } of SOURCES) {
  const found = [];
  let ok = true;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (isogashi-yoho data import)" } });
      if (!res.ok) throw new Error(`ページを取れませんでした（HTTP ${res.status}）`);
      const pageText = toText(await res.text());
      const list = await askGemini((type === "venue" ? venuePrompt : townPrompt)(place, url, pageText));
      if (!Array.isArray(list)) throw new Error("読み取った結果が決まった形ではありません");
      for (const e of list) {
        const rejected = check(e, type, pageText);
        candidates.push({ ...e, place, source: url, accepted: !rejected, reason: rejected ?? undefined });
        if (!rejected) found.push(toAppEvent(e, type, place, url));
      }
      console.log(`✓ ${place}：読み取り ${list.length}件（${url}）`);
    } catch (error) {
      ok = false;
      failed = true;
      console.error(`✗ ${place}：${hide(error.message)}`);
    }
  }
  // 失敗した場所は、前回の内容を残す
  approved.push(...(ok ? found : previous.filter((e) => e.from === place)));
}

const byDate = (a, b) => (a.dates?.[0] ?? "").localeCompare(b.dates?.[0] ?? "");
const researchedAt = new Date().toISOString();
writeFileSync(
  OUT,
  JSON.stringify({ researchedAt, model: usedModel, months: monthLabels, events: candidates.sort(byDate) }, null, 2) + "\n",
);
writeFileSync(AUTO, JSON.stringify({ researchedAt, events: approved.sort(byDate) }, null, 2) + "\n");

console.log(`\n読み取り ${candidates.length}件 → 反映 ${approved.length}件（data/auto-events.json）`);
for (const e of approved) {
  console.log(`  ○ ${e.dates.join(",")} ${e.start ?? "--:--"} ${e.name}（${e.place}）`);
}
for (const e of candidates.filter((c) => !c.accepted)) {
  console.log(`  × ${(e.dates ?? []).join(",")} ${e.name}（${e.place}）… ${e.reason}`);
}
if (failed) {
  console.error("\n読み取れなかった場所があります。その場所は前回の内容のままです。");
  process.exitCode = 1;
}
