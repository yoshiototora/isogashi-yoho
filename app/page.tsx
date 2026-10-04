"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { IMPORTED_AT, SHOP_AREAS, SPOTS } from "@/data";
import {
  BUSY_LEVELS,
  IMPACT_LEVELS,
  daysThroughNextMonth,
  getBusyLevel,
  getForecast,
  type BusyDay,
  type ShopSettings,
} from "@/lib/calculateBusyRate";

// いそがしい日ほど朱色が強くなる（単色の濃淡で表現）
const CELL_STYLE = [
  "text-ink/30",
  "bg-shu/[0.04] text-ink/55",
  "bg-shu/[0.16] text-ink",
  "bg-shu/45 text-ink",
  "bg-shu text-white",
] as const;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// 右上の注意報バッジ（山場だけ）
const ALERT = [null, null, null, null, "いそがし注意報"];
// 段階名の色。忙しい日ほど朱色が強くなる
const COPY_COLOR = ["text-ink", "text-ink", "text-shu/75", "text-shu/90", "text-shu"];
// カモメくんの小さな吹き出し
const KAMOME_SAYS = ["ふぅ〜", "ぼちぼち〜", "おっと", "急げ急げ", "カンカン！"];

// 端末の今日の日付（YYYY-MM-DD）
function getToday() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
// ページを書き出す時点では端末の日付が分からないので、データを取り込んだ日を仮に使う
const getImportedDay = () => IMPORTED_AT.slice(0, 10);
const subscribeNever = () => () => {};

// ───── お店の設定（この端末に保存する）
const SETTINGS_KEY = "isogashi-yoho:shop-settings";
const settingsListeners = new Set<() => void>();
function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener);
  return () => settingsListeners.delete(listener);
}
function readSettings() {
  try {
    return window.localStorage.getItem(SETTINGS_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}
function writeSettings(settings: ShopSettings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 保存できない端末でも、画面はそのまま使える
  }
  settingsListeners.forEach((listener) => listener());
}
function parseSettings(raw: string): ShopSettings {
  try {
    return JSON.parse(raw) as ShopSettings;
  } catch {
    return {};
  }
}

export default function Home() {
  const today = useSyncExternalStore(subscribeNever, getToday, getImportedDay);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showNextMonth, setShowNextMonth] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRaw = useSyncExternalStore(subscribeSettings, readSettings, () => "{}");
  const settings = useMemo(() => parseSettings(settingsRaw), [settingsRaw]);
  // 「大きい」以外にしたものの数と、選んだ地域
  const adjusted =
    SPOTS.filter((spot) => (settings[spot.id] ?? 2) !== 2).length +
    ((settings.weekend ?? 2) !== 2 ? 1 : 0);
  const shopArea = SHOP_AREAS.find((a) => a.id === settings.area);

  // 詳細シートはスマホ幅だけ。PCでは理由を画面に出したままにする
  const openSheet = () => {
    if (!window.matchMedia("(min-width: 1024px)").matches) setSheetOpen(true);
  };

  const forecast = useMemo(
    () => getForecast(today, daysThroughNextMonth(today), settings),
    [today, settings],
  );
  const selected = forecast.find((d) => d.date === selectedDate) ?? forecast[0];
  const { level, short, copy } = getBusyLevel(selected.rate);

  // カレンダーは「今月（今日以降）」と「来月」を切り替えて表示する
  const thisMonth = forecast[0].month;
  const nextMonth = forecast[forecast.length - 1].month;
  const viewMonth = showNextMonth ? nextMonth : thisMonth;
  const visibleDays = forecast.filter((d) => d.month === viewMonth);
  const leadingBlanks = new Date(`${visibleDays[0].date}T00:00:00Z`).getUTCDay();

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-[440px] flex-col overflow-hidden bg-paper px-4 lg:max-w-[1120px] lg:px-12">
      <header className="relative pb-1 pt-5 lg:pt-9">
        <div aria-hidden className="absolute -right-6 -top-3 w-[56%] lg:-right-14 lg:w-[440px]">
          <Image
            src="/assets/header/town.png"
            alt=""
            width={556}
            height={269}
            priority
            className="h-auto w-full"
          />
          {/* 左端を雲のかたちでなじませる */}
          <span className="absolute -left-[10%] top-[4%] aspect-square w-[24%] rounded-full bg-paper" />
          <span className="absolute -left-[14%] top-[30%] aspect-square w-[30%] rounded-full bg-paper" />
          <span className="absolute -left-[8%] top-[62%] aspect-square w-[34%] rounded-full bg-paper" />
          <span className="absolute left-[14%] top-[84%] aspect-square w-[26%] rounded-full bg-paper" />
        </div>

        <p className="relative flex items-center gap-1.5">
          <Image
            src="/assets/icons/weather-sunny.png"
            alt=""
            width={163}
            height={151}
            className="h-7 w-auto lg:h-10"
          />
          <span className="text-xl font-extrabold tracking-wide lg:text-3xl">
            いそがし予報
          </span>
          <Wave />
        </p>
        <h1 className="relative mt-4 flex items-start gap-1 text-[2.1rem] font-extrabold leading-tight lg:mt-6 lg:text-6xl">
          いつが忙しい？
        </h1>
        {/* お店の設定：押せることがひと目で分かるボタンにする */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="relative mt-4 flex w-full items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-left text-white transition-transform active:scale-[0.98] lg:mt-6 lg:w-auto lg:min-w-[22rem] lg:px-5 lg:py-3.5"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="h-7 w-7 shrink-0" fill="none">
            <path
              d="M12 21s7-6.2 7-11.2A7 7 0 0 0 5 9.8C5 14.8 12 21 12 21Z"
              fill="#fff"
            />
            <circle cx="12" cy="9.8" r="2.6" className="fill-shu" />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold lg:text-base">
              {shopArea
                ? `うちのお店：${shopArea.name}`
                : adjusted > 0
                  ? `うちのお店に合わせています（${adjusted}か所）`
                  : "お店の場所を設定する"}
            </span>
            <span className="block text-[11px] font-bold text-white/70 lg:text-xs">
              {shopArea || adjusted > 0
                ? "タップして変更できます"
                : "お店に合わせた予報になります"}
            </span>
          </span>
          <span aria-hidden className="text-xl font-extrabold text-white/80">
            ›
          </span>
        </button>
      </header>

      {/* PCでは左に「この日の予報・理由・凡例」、右にカレンダーを並べる */}
      <div className="relative mt-6 lg:mt-10 lg:grid lg:grid-cols-[360px_1fr] lg:grid-rows-[auto_auto_1fr] lg:items-start lg:gap-x-10 lg:gap-y-8">
      <button
        onClick={openSheet}
        aria-label={`${selected.month}月${selected.day}日のいそがし予報 ${short}`}
        className="relative block w-full overflow-hidden rounded-[2.25rem] bg-blush text-left lg:col-span-2 lg:cursor-default lg:rounded-[2.75rem]"
      >
        <span className="relative block min-h-[9.75rem] px-5 pb-5 pt-5 lg:min-h-0 lg:px-10 lg:pb-9 lg:pt-8">
          <span className="block pr-[6.75rem] lg:pr-[22rem]">
            <span className="block text-sm font-extrabold lg:text-xl">
              {selected.month}月{selected.day}日（{selected.weekday}）のいそがし予報
            </span>
            {selected.date === today && (
              <span className="mt-1 inline-block rounded-md bg-ink px-1.5 text-[10px] font-extrabold leading-4 text-white lg:text-xs lg:leading-5">
                今日
              </span>
            )}
            <span
              key={selected.date}
              className={`mt-3 block w-fit animate-fade-in whitespace-nowrap font-extrabold leading-snug tracking-tight lg:mt-4 ${
                copy.length > 5 ? "text-[1.85rem]" : "text-[2.5rem]"
              } lg:text-[5.5rem] ${COPY_COLOR[level]}`}
            >
              <Marker level={level}>{copy}</Marker>
            </span>
          </span>
        </span>

        {/* 注意報バッジ：山場の日だけ、右上に小さく */}
        {ALERT[level] && (
          <span
            className="absolute right-3 top-3 rounded-full bg-shu px-2.5 py-1 text-[10px] font-extrabold text-white lg:right-8 lg:top-7 lg:px-4 lg:py-1.5 lg:text-sm"
          >
            {ALERT[level]}
          </span>
        )}
        <span
          aria-hidden
          className="absolute bottom-[60%] right-[17rem] hidden rounded-2xl rounded-br-sm bg-white px-3 py-1.5 text-sm font-extrabold lg:block"
        >
          {KAMOME_SAYS[level]}
        </span>
        <KamomeFull
          level={level}
          className="absolute right-2 top-10 w-[6.25rem] lg:bottom-5 lg:right-12 lg:top-auto lg:w-56"
        />
      </button>

      <section className="mt-6 rounded-[2rem] bg-white px-2.5 pb-2.5 pt-3 lg:col-start-2 lg:row-span-2 lg:row-start-2 lg:mt-0 lg:rounded-[2.5rem] lg:px-6 lg:pb-6 lg:pt-5">
        <div className="mx-auto mb-3 flex w-fit rounded-full bg-ink/[0.06] lg:mb-5">
          {[thisMonth, nextMonth].map((m) => (
            <button
              key={m}
              onClick={() => setShowNextMonth(m === nextMonth)}
              aria-pressed={m === viewMonth}
              className={`rounded-full px-6 py-1.5 text-sm font-extrabold transition-colors lg:px-8 lg:text-base ${
                m === viewMonth ? "bg-ink text-white" : "text-ink/45 hover:text-ink"
              }`}
            >
              {m}月
            </button>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink/45 lg:gap-2 lg:text-sm">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1 lg:mt-3 lg:gap-2">
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <span key={i} />
          ))}
          {visibleDays.map((day) => (
            <button
              key={day.date}
              onClick={() => {
                setSelectedDate(day.date);
                openSheet();
              }}
              aria-label={`${day.month}月${day.day}日 ${getBusyLevel(day.rate).short}`}
              aria-pressed={day.date === selected.date}
              className={`relative flex h-14 flex-col items-center justify-center rounded-2xl transition-transform hover:scale-[1.04] active:scale-95 lg:h-[5.25rem] lg:gap-1 lg:rounded-3xl ${
                CELL_STYLE[getBusyLevel(day.rate).level]
              } ${
                day.date === selected.date
                  ? "outline-[2.5px] outline-offset-1 outline-ink"
                  : ""
              }`}
            >
              {getBusyLevel(day.rate).level === 4 && (
                <Sparks className="absolute -right-1 -top-1.5 h-4 w-3.5 rotate-12 lg:h-5 lg:w-4" />
              )}
              {day.date === today && (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-1.5 text-[8px] font-extrabold leading-[14px] text-white lg:-top-2 lg:px-2 lg:text-[10px] lg:leading-4">
                  今日
                </span>
              )}
              <span className="text-[15px] font-extrabold leading-tight tabular-nums lg:text-2xl">
                {day.day}
              </span>
              <span className="whitespace-nowrap text-[10px] font-bold tracking-tighter opacity-85 lg:text-[13px] lg:tracking-normal">
                {getBusyLevel(day.rate).short}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* PCでは理由をその場に出す（スマホは日付をタップするとシートで出る） */}
      <div className="hidden lg:col-start-1 lg:row-start-2 lg:block lg:px-2">
        <p className="text-sm font-bold text-ink/60">なぜ？</p>
        <ReasonList day={selected} />
      </div>

      <div className="mt-6 lg:col-start-1 lg:row-start-3 lg:mt-2">
        <p className="text-center text-xs font-bold text-ink/55 lg:text-left lg:text-sm">
          混みやすさの目安
        </p>
        <ul className="-mx-2 mt-3 grid grid-cols-5 text-center lg:mx-0">
          {BUSY_LEVELS.map((l) => (
            <li
              key={l.level}
              className={`transition-transform duration-300 ${
                l.level === level ? "-translate-y-1 scale-110" : ""
              }`}
            >
              <KamomeMini level={l.level} className="mx-auto h-9 w-10" />
              <p
                className={`mx-auto w-fit whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-extrabold ${CELL_STYLE[l.level]} ${l.level === 0 ? "bg-white" : ""}`}
              >
                {l.short}
              </p>
            </li>
          ))}
        </ul>
      </div>
      </div>

      <Harbor day={selected} />

      {settingsOpen && (
        <ShopSettingsSheet
          today={today}
          settings={settings}
          onChange={writeSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {sheetOpen && (
        <DaySheet
          day={selected}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </main>
  );
}

// 凡例用のミニカモメくん
function KamomeMini({ level, className }: { level: number; className: string }) {
  return (
    <span className={`relative block ${className}`}>
      <Image
        src={`/assets/kamome/kamome-level-${level + 1}.png`}
        alt=""
        fill
        sizes="64px"
        className="object-contain object-bottom"
      />
    </span>
  );
}

// いそがしいほど、せっかちに体をゆらす
const BOB_SPEED = ["3.2s", "2.6s", "1.8s", "1.2s", "0.8s"];

// 全身のカモメくん。busyRate のレベル（0〜4）で5枚を切り替える
function KamomeFull({ level, className }: { level: number; className: string }) {
  return (
    <span aria-hidden className={`block ${className}`}>
      <span
        className="relative block aspect-square w-full origin-bottom animate-bob"
        style={{ animationDuration: BOB_SPEED[level] }}
      >
        <Image
          src={`/assets/kamome/kamome-level-${level + 1}.png`}
          alt=""
          fill
          sizes="(min-width: 1024px) 224px, 100px"
          className="object-contain object-bottom"
        />
      </span>
      <span className="mx-auto -mt-1.5 block h-2.5 w-3/4 rounded-[50%] bg-ink/10" />
    </span>
  );
}

// フッター：選択日のクルーズ船の入港と大型イベントを反映した長崎の港
function Harbor({ day }: { day: BusyDay }) {
  const current = day.ships > 0 ? "sunny-ship" : "sunny-no-ship";

  return (
    <footer aria-hidden className="mt-auto pt-6 lg:pt-12">
      {/* イラスト全体が切れずに見えるよう、画面の幅に収める */}
      <div className="relative mx-auto mb-5 aspect-[683/113] w-full lg:mb-8 lg:w-[720px]">
        {["sunny-no-ship", "sunny-ship"].map((name) => (
          <Image
            key={name}
            src={`/assets/footer/${name}.png`}
            alt=""
            fill
            sizes="(min-width: 1024px) 720px, 520px"
            loading="eager"
            className={`object-fill transition-opacity duration-300 ${
              name === current ? "opacity-100" : "opacity-0"
            }`}
          />
        ))}
        {day.bigEvent && (
          <svg
            viewBox="0 0 96 26"
            className={`absolute left-[36%] top-[14%] w-[20%] animate-fade-in`}
          >
            <path
              d="M2 3q46 16 92 0"
              fill="none"
              stroke="#16264f"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <path d="M12 6.5l9 1.6-6 9z" fill="#f0432b" />
            <path d="M30 9.6l9 .8-5.2 9.4z" fill="#f6c21c" />
            <path d="M49 10.6l9-.6-3.8 10z" fill="#3b8fe0" />
            <path d="M67 9.2l8.8-2-2.6 10.4z" fill="#f0432b" />
          </svg>
        )}
        {day.ships > 1 && (
          <Image
            src="/assets/footer/ship.png"
            alt=""
            width={124}
            height={52}
            className={`absolute bottom-[16%] left-[6%] h-auto w-[13%] animate-fade-in`}
          />
        )}
      </div>
    </footer>
  );
}

// お店の設定：場所ごとに「お店への影響」を選ぶ。
// ふつうは3つのボタン（大きい・少し・ない）。「もっと細かく設定する」を開くと、
// バーで 0〜100% を5%きざみで選べて、土日祝の影響も変えられる。
const IMPACT_STYLE: Record<number, string> = {
  2: "bg-shu text-white",
  1: "bg-shu/25 text-ink",
  0: "bg-ink/15 text-ink",
};

// 細かい設定のバー（0〜100%）。設定の値は 0〜2 で持つので、50で割って保存する
function ImpactSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const percent = Math.round(value * 50);
  return (
    <span className="flex items-center gap-2">
      <span className="text-[10px] font-bold text-ink/45">ない</span>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        aria-label={label}
        aria-valuetext={`${percent}%`}
        onChange={(e) => onChange(Number(e.target.value) / 50)}
        className="h-8 min-w-0 flex-1 accent-shu"
      />
      <span className="text-[10px] font-bold text-ink/45">大きい</span>
      <span className="w-11 text-right text-sm font-extrabold tabular-nums">
        {percent}%
      </span>
    </span>
  );
}

// いまの設定で、今日から来月末までの各段階が何日あるか
function countLevels(today: string, settings: ShopSettings) {
  const counts = [0, 0, 0, 0, 0];
  for (const day of getForecast(today, daysThroughNextMonth(today), settings)) {
    counts[getBusyLevel(day.rate).level]++;
  }
  return counts;
}

function ShopSettingsSheet({
  today,
  settings,
  onChange,
  onClose,
}: {
  today: string;
  settings: ShopSettings;
  onChange: (settings: ShopSettings) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const fine = settings.fine === true;
  // 設定する前（すべて「大きい」）と、いまの設定での日数
  const before = useMemo(() => countLevels(today, {}), [today]);
  const after = useMemo(() => countLevels(today, settings), [today, settings]);

  // かんたん設定に戻すときは、近いほうの3つのどれかに寄せる（土日祝は元に戻す）
  const toggleFine = () => {
    if (!fine) return onChange({ ...settings, fine: true });
    const simple: ShopSettings = { area: settings.area };
    for (const spot of SPOTS) {
      const value = settings[spot.id];
      if (value !== undefined) simple[spot.id] = value >= 1.5 ? 2 : value >= 0.5 ? 1 : 0;
    }
    onChange(simple);
  };

  return (
    <div
      className="fixed inset-0 z-10 flex animate-fade-in items-end justify-center bg-ink/40 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="うちのお店に合わせる"
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92dvh] w-full max-w-[480px] animate-sheet-up overflow-y-auto rounded-t-[2.25rem] bg-paper px-5 pt-6 sm:rounded-[2.25rem] sm:px-7"
      >
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-xl text-ink/40 hover:text-ink"
        >
          ×
        </button>
        <p className="text-xl font-extrabold">うちのお店に合わせる</p>

        {/* まず地域を選ぶと、おすすめの設定が入る */}
        <p className="mt-4 text-sm font-extrabold">① お店はどのあたり？</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SHOP_AREAS.map((a) => (
            <button
              key={a.id}
              onClick={() =>
                onChange({ ...a.preset, area: a.id, fine: settings.fine, weekend: settings.weekend })
              }
              aria-pressed={settings.area === a.id}
              className={`rounded-full border-[1.5px] px-3.5 py-2 text-sm font-extrabold transition-colors active:scale-95 ${
                settings.area === a.id
                  ? "border-ink bg-ink text-white"
                  : "border-ink/15 bg-white text-ink"
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-extrabold">② 場所ごとに直す</p>
        <p className="mt-0.5 text-xs font-bold text-ink/65">
          その場所で何かあるとき、お店への影響はどれくらいですか？
        </p>
        {fine && (
          <p className="mt-2 rounded-2xl bg-blush px-3.5 py-2.5 text-[11px] font-bold leading-relaxed">
            バーを右にするほど、その場所で何かある日が「忙しい日」になりやすくなります。
            <br />
            左にするほど、なりにくくなります。
            <br />
            0%にすると、その場所の予定は予報に入りません。
          </p>
        )}

        <ul className="mt-3 space-y-2">
          {SPOTS.map((spot) => {
            const current = settings[spot.id] ?? 2;
            return (
              <li
                key={spot.id}
                className={`rounded-3xl bg-white px-4 py-3 ${
                  fine ? "space-y-1" : "flex items-center gap-3"
                }`}
              >
                <span className="block min-w-0 flex-1">
                  <span className="block text-sm font-extrabold leading-tight">
                    {spot.name}
                  </span>
                  <span className="block text-[11px] font-medium text-ink/55">
                    {spot.hint}
                  </span>
                </span>
                {fine ? (
                  <ImpactSlider
                    label={`${spot.name}の影響`}
                    value={current}
                    onChange={(value) => onChange({ ...settings, [spot.id]: value })}
                  />
                ) : (
                  <span
                    role="group"
                    aria-label={`${spot.name}の影響`}
                    className="flex shrink-0 rounded-full bg-ink/[0.06] p-0.5"
                  >
                    {IMPACT_LEVELS.map((l) => (
                      <button
                        key={l.value}
                        onClick={() => onChange({ ...settings, [spot.id]: l.value })}
                        aria-pressed={current === l.value}
                        className={`min-w-[3.25rem] rounded-full px-2 py-2 text-xs font-extrabold transition-colors ${
                          current === l.value ? IMPACT_STYLE[l.value] : "text-ink/45"
                        }`}
                      >
                        {l.label}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* 細かい設定：土日祝の影響も選べる */}
        {fine && (
          <>
            <p className="mt-5 text-sm font-extrabold">③ 土日・祝日</p>
            <p className="mt-0.5 text-xs font-bold text-ink/65">
              土日や祝日の、お店への影響はどれくらいですか？
            </p>
            <div className="mt-3 rounded-3xl bg-white px-4 py-3">
              <ImpactSlider
                label="土日・祝日の影響"
                value={settings.weekend ?? 2}
                onChange={(value) => onChange({ ...settings, weekend: value })}
              />
            </div>
          </>
        )}
        <button
          onClick={toggleFine}
          aria-expanded={fine}
          className="mt-4 flex w-full items-center justify-between rounded-2xl border-[1.5px] border-ink/15 bg-white px-4 py-3 text-left active:scale-[0.99]"
        >
          <span>
            <span className="block text-sm font-extrabold">
              {fine ? "かんたん設定に戻す" : "もっと細かく設定する"}
            </span>
            <span className="block text-[11px] font-bold text-ink/55">
              {fine
                ? "3つから選ぶ形に戻します"
                : "バーで細かく調整できて、土日・祝日の影響も変えられます"}
            </span>
          </span>
          <span aria-hidden className="text-lg font-extrabold text-ink/50">
            {fine ? "−" : "＋"}
          </span>
        </button>

        {/* 設定でどう変わるか：下に固定して、動かしながら見えるようにする */}
        <div className="sticky bottom-0 -mx-5 mt-4 border-t border-ink/10 bg-paper px-5 pb-5 pt-3 sm:-mx-7 sm:px-7">
          <p className="text-xs font-extrabold">
            この設定での予報
            <span className="ml-1.5 font-bold text-ink/55">今日〜来月末・設定する前との差</span>
          </p>
          <ul className="mt-2 grid grid-cols-5 gap-1">
            {BUSY_LEVELS.map((l) => {
              const diff = after[l.level] - before[l.level];
              return (
                <li
                  key={l.level}
                  className={`rounded-xl px-1 py-1.5 text-center ${CELL_STYLE[l.level]} ${
                    l.level === 0 ? "border border-ink/10 !text-ink/60" : ""
                  }`}
                >
                  <span className="block text-[10px] font-extrabold">{l.short}</span>
                  <span className="block text-sm font-extrabold tabular-nums">
                    {after[l.level]}日
                  </span>
                  <span className="block text-[10px] font-bold tabular-nums opacity-80">
                    {diff === 0 ? "±0" : diff > 0 ? `+${diff}` : `−${-diff}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => onChange({})}
              className="px-2 py-2 text-xs font-bold text-ink/55 underline underline-offset-4"
            >
              はじめに戻す
            </button>
            <button
              onClick={onClose}
              className="rounded-full bg-ink px-8 py-3 text-sm font-extrabold text-white active:scale-95"
            >
              できた
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DaySheet({
  day,
  onClose,
}: {
  day: BusyDay;
  onClose: () => void;
}) {
  const { level, copy } = getBusyLevel(day.rate);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-10 flex animate-fade-in items-end justify-center bg-ink/40 sm:items-center lg:hidden"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${day.month}月${day.day}日のいそがし予報`}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92dvh] w-full max-w-[440px] animate-sheet-up overflow-y-auto rounded-t-[2.25rem] bg-paper px-6 pb-8 pt-6 sm:rounded-[2.25rem]"
      >
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full text-xl text-ink/40 hover:text-ink"
        >
          ×
        </button>

        <p className="text-sm font-bold text-ink/70">
          {day.month}月{day.day}日（{day.weekday}）
        </p>
        <div className="relative mt-4 pb-2 pr-32">
          <p
            className={`w-fit text-[2.1rem] font-extrabold leading-tight tracking-tight ${COPY_COLOR[level]}`}
          >
            <Marker level={level}>{copy}</Marker>
          </p>
          <KamomeFull level={level} className="absolute -top-3 right-0 w-28" />
        </div>

        <p className="mt-6 text-sm font-bold text-ink/60">
          なぜ？
        </p>
        <ReasonList day={day} />
      </div>
    </div>
  );
}

// いそがしい理由。影響の大きい順に、確かめられる事実をすべて並べる
function ReasonList({ day }: { day: BusyDay }) {
  if (day.reasons.length === 0) {
    return (
      <p className="mt-3 text-lg font-bold text-ink/60">
        大きな予定は、いまのところなし。
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-3">
      {day.reasons.map((r, i) => (
        <li key={i} className="flex items-center gap-3">
          <span className="relative h-7 w-8 shrink-0">
            <Image
              src={`/assets/icons/${r.icon}.png`}
              alt=""
              fill
              sizes="32px"
              className="object-contain"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold leading-tight">
              {r.label}
            </span>
            <span className="block text-xs font-medium text-ink/55">
              {r.detail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// 港町の小さなしるし
function Wave() {
  return (
    <svg
      width="28"
      height="8"
      viewBox="0 0 28 8"
      fill="none"
      aria-hidden
      className="text-shu"
    >
      <path
        d="M1 5c2.2 0 2.2-3 4.3-3s2.2 3 4.4 3 2.1-3 4.3-3 2.2 3 4.3 3 2.2-3 4.4-3 2.1 3 4.3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 赤い「！！」のアクセント
function Sparks({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 20 24"
      fill="none"
      aria-hidden
      className={`shrink-0 text-shu ${className}`}
    >
      <path
        d="M8 3 4 12M17 8l-9 9"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 段階名の下のマーカー帯。いそがしい日だけ出し、段階が上がるほど少し濃くする
const MARKER_STYLE = [
  "",
  "",
  "bg-[linear-gradient(transparent_68%,rgb(240_67_43/0.10)_68%)]",
  "bg-[linear-gradient(transparent_66%,rgb(240_67_43/0.16)_66%)]",
  "bg-[linear-gradient(transparent_62%,rgb(240_67_43/0.24)_62%)]",
];

function Marker({ level, children }: { level: number; children: ReactNode }) {
  return <span className={`px-0.5 ${MARKER_STYLE[level]}`}>{children}</span>;
}
