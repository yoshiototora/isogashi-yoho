// 公開データを取り込んで data/imported.json を作り直す。
//   npm run import-data
//
// 取り込むもの：
//   - 祝日        内閣府「国民の祝日」CSV
//   - クルーズ船  長崎港の寄港予定表（PDF）
//   - イベント    長崎スタジアムシティ公式のイベント一覧
// どれかの取得に失敗したら、その項目だけ前回の内容を残す。
// ほかの会場のイベントは、まだ data/index.ts に手で入力している。

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const OUT = new URL("../data/imported.json", import.meta.url);
const YEAR = new Date().getFullYear();

const SOURCES = {
  holidays: "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv",
  stadiumCity: "https://www.nagasakistadiumcity.com/event/",
  // 令和の年で名前が付いている（2026年 → R08）
  cruises: (year) =>
    `https://www.nagasaki-port.jp/nagasaki_cruiseschedule/R${String(year - 2018).padStart(2, "0")}_cruiseschedule.pdf`,
};

const pad = (n) => String(n).padStart(2, "0");

async function fetchHolidays() {
  const res = await fetch(SOURCES.holidays);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // CSVはShift_JIS
  const text = new TextDecoder("shift_jis").decode(await res.arrayBuffer());
  const holidays = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.+)$/);
    if (m && Number(m[1]) >= YEAR) {
      holidays[`${m[1]}-${pad(m[2])}-${pad(m[3])}`] = m[4].trim();
    }
  }
  return holidays;
}

// PDFの文字を、縦位置でまとめて「1行＝1寄港」に戻す
async function readPdfRows(data) {
  const pdf = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    const byY = new Map();
    for (const item of items) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: item.transform[4], text: item.str.trim() });
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      rows.push(byY.get(y).sort((a, b) => a.x - b.x).map((i) => i.text));
    }
  }
  return rows;
}

const BERTHS = ["松が枝", "出島", "小ヶ倉柳", "柳"];

async function fetchCruises(year) {
  const url = SOURCES.cruises(year);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const rows = await readPdfRows(new Uint8Array(await res.arrayBuffer()));

  const calls = [];
  for (const cells of rows) {
    const line = cells.join(" ");
    const date = line.match(/^\d+ (\d{1,2})月(\d{1,2})日/);
    if (!date) continue;
    const times = cells.filter((c) => /^\d{1,2}:\d{2}$/.test(c));
    const tonnage = cells.find((c) => /^\d{1,3},\d{3}$/.test(c));
    // 船名＝日付のあと、最初の数字（トン数・全長）の手前まで
    const afterDate = line.replace(/^\d+ \d{1,2}月\d{1,2}日 ?/, "");
    const name = afterDate.split(/ (?=[\d,.]+ )/)[0].replace(/\s+/g, " ").trim();
    calls.push({
      date: `${year}-${pad(date[1])}-${pad(date[2])}`,
      // 船名が別の行に折り返されていて読めなかったときは空にする
      name: /^[\d,.]*$/.test(name) ? "" : name,
      tonnage: tonnage ? Number(tonnage.replace(/,/g, "")) : null,
      arrive: times[0] ?? null,
      depart: times[1] ?? null,
      berth: cells.find((c) => BERTHS.includes(c)) ?? null,
    });
  }
  if (calls.length === 0) throw new Error("寄港予定を1件も読み取れませんでした（PDFの形式が変わった可能性）");

  // トン数が空欄の行は、同じ船のほかの行から補う
  const known = new Map(calls.filter((c) => c.tonnage).map((c) => [c.name, c.tonnage]));
  const cruises = {};
  for (const { date, ...call } of calls) {
    call.tonnage ??= known.get(call.name) ?? null;
    (cruises[date] ??= []).push(call);
  }
  return cruises;
}

// ───── 長崎スタジアムシティのイベント

// 会場ごとの決まり。ここに無い会場（ホテルなど小さな会場）は取り込まない。
const STADIUM_CITY_VENUES = {
  "HAPPINESS ARENA": {
    place: "ハピネスアリーナ",
    expected: 6000,
    basis: "ハピネスアリーナの収容人数（約6,000人）",
  },
  "PEACE STADIUM": {
    place: "ピーススタジアム",
    expected: 19000,
    basis: "今季ホーム5試合の観客数（18,015〜20,489人）の平均",
    // スタジアムは、規模が分かっているトップチームの試合だけを取り込む
    only: (title) => /V・ファーレン長崎/.test(title) && !/[UＵ]-21/.test(title),
  },
};

const stripTags = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// 「2026.11.21 土 〜11.22 日」→ ["2026-11-21", "2026-11-22"]
function expandDates(text) {
  const m = text.match(/(\d{4})\.(\d{2})\.(\d{2})(?:.*?〜\s*(?:(\d{4})\.)?(\d{2})\.(\d{2}))?/);
  if (!m) return [];
  const start = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const end = m[5] ? Date.UTC(+(m[4] ?? m[1]), +m[5] - 1, +m[6]) : start;
  const dates = [];
  // 長期開催（物産展など）は「特定の日に混む」ものではないので対象外
  if (end < start || end - start > 6 * 86_400_000) return [];
  for (let t = start; t <= end; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

// 長い正式名称を、画面に出しやすい名前にする
function shortName(title) {
  const velca = title.match(/長崎ヴェルカ\s*vs\s*(.+)$/);
  if (velca) return `長崎ヴェルカ vs ${velca[1].trim()}`;
  const vvaren = title.match(/V・ファーレン長崎\s*VS\s*(.+)$/i);
  if (vvaren) return `V・ファーレン長崎 vs ${vvaren[1].trim()}`;
  return title;
}

async function fetchStadiumCity() {
  const res = await fetch(SOURCES.stadiumCity, { headers: { "User-Agent": "Mozilla/5.0 (isogashi-yoho data import)" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const items = [...html.matchAll(/<li id="(\d+)" class="event-archive--item"([\s\S]*?)<\/li>/g)];
  if (items.length === 0) throw new Error("イベントを1件も読み取れませんでした（ページの作りが変わった可能性）");

  const events = [];
  for (const [, id, body] of items) {
    const venue = body.match(/data-venue="([^"]*)"/)?.[1] ?? "";
    const category = body.match(/data-slug="([^"]*)"/)?.[1] ?? "";
    const title = stripTags(body.match(/<h2 class="event-archive--ttl">([\s\S]*?)<\/h2>/)?.[1] ?? "");
    const day = stripTags(body.match(/<div class="event-archive--day">([\s\S]*?)<\/div>/)?.[1] ?? "");
    const rule = STADIUM_CITY_VENUES[venue];
    const dates = expandDates(day);
    if (!rule || !title || dates.length === 0) continue;
    if (rule.only && !rule.only(title)) continue;
    events.push({
      id: `stadiumcity-${id}`,
      name: shortName(title),
      icon: category.includes("音楽") ? "live" : "event",
      dates,
      expected: rule.expected,
      basis: rule.basis,
      place: rule.place,
      source: SOURCES.stadiumCity,
    });
  }
  return events;
}

// 前回との違いを一覧にする（人が確認するため）
function reportEventChanges(before = [], after = []) {
  const key = (e) => `${e.dates.join(",")} ${e.name}（${e.place}）`;
  const old = new Map(before.map((e) => [e.id, e]));
  const now = new Map(after.map((e) => [e.id, e]));
  const lines = [];
  for (const e of after) {
    const prev = old.get(e.id);
    if (!prev) lines.push(`  ＋ 追加：${key(e)}`);
    else if (key(prev) !== key(e)) lines.push(`  ～ 変更：${key(prev)} → ${key(e)}`);
  }
  for (const e of before) if (!now.has(e.id)) lines.push(`  − 削除：${key(e)}`);
  console.log(lines.length ? `イベントの変更 ${lines.length}件\n${lines.join("\n")}` : "イベントの変更なし");
}

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const result = {
  fetchedAt: new Date().toISOString(),
  sources: { ...SOURCES, cruises: SOURCES.cruises(YEAR) },
  holidays: previous.holidays ?? {},
  cruises: previous.cruises ?? {},
  events: previous.events ?? [],
};

let failed = false;
for (const [key, load] of [
  ["holidays", fetchHolidays],
  ["cruises", () => fetchCruises(YEAR)],
  ["events", fetchStadiumCity],
]) {
  try {
    result[key] = await load();
    const n = Object.values(result[key]).flat().length;
    console.log(`✓ ${key}: ${n}件`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${key}: 取得できなかったので前回の内容を残します（${error.message}）`);
  }
}

reportEventChanges(previous.events, result.events);

writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
console.log(`→ data/imported.json を更新しました`);
if (failed) process.exitCode = 1;
