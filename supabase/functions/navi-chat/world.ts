// supabase/functions/navi-chat/world.ts
//
// NAVI v51 — the senses round: five world engines in the DDG/Wikipedia mold.
// Free, keyless, silent network reads that make NAVI's execution layer see
// the live world — and because tryWorld is wired into answerIntent, every
// one of them works as a WORKFLOW STEP ("weather in johannesburg" inside a
// morning routine, "news about music" inside a briefing workflow, "price of
// bitcoin" on a schedule).
//
//   1. WEATHER   — Open-Meteo (geocoding + forecast): "weather in joburg"
//   2. CURRENCY  — Frankfurter (ECB reference rates): "convert 100 usd to zar"
//   3. CRYPTO    — CoinGecko simple price: "price of bitcoin [in rands]"
//   4. ATLAS     — mledoze/countries + World Bank: "capital / population /
//                  currency / languages of <country>"
//   5. NEWS      — Google News RSS (SA edition): "today's headlines" /
//                  "news about <topic>"
//
// v52 — the observatory round — added five more (same laws, same seam):
//   6. SUN       — Open-Meteo daily (same geocoder): "sunrise in joburg" /
//                  "when does the sun set in cape town"
//   7. AIR       — Open-Meteo air quality: "air quality in johannesburg" /
//                  "uv index in durban" (closed AQI + UV band maps)
//   8. MARKETS   — Yahoo Finance v8 chart (keyless, UA header): "price of
//                  apple stock" / "gold price" / "where's the s&p 500" —
//                  CLOSED ticker list; JSE quotes in ZAc are converted to ZAR
//   9. HOLIDAYS  — Nager.Date: "public holidays in south africa" / "when is
//                  the next public holiday" (country resolved via the atlas,
//                  South Africa by default)
//  10. THIS DAY  — Wikipedia on-this-day (selected): "today in history" /
//                  "what happened on this day"
//
// Candidate verified for a future round: TheMealDB recipes (keyless via the
// public test key: themealdb.com/api/json/v1/1/search.php?s=<dish>).
//
// The house rules all hold:
//   - Anchored, conservative parsing (invariant #2): every regex matches the
//     whole tidied message; when in doubt return null and let the pipeline
//     run. Loose forms ("usd to zar") answer ONLY when both sides resolve —
//     they never teach, so conversation is never hijacked.
//   - Honest failure: a matched ask whose source is down gets a "couldn't
//     reach" reply, never a guess and never a silent fall-through to a
//     weaker engine.
//   - Unknown ENTITIES fall through (null) where the pipeline has somewhere
//     better to go ("capital of the roman empire" → web fallback); they
//     answer honestly where it doesn't ("weather in narnia").
//   - Crisis language never drives a search (invariant #1): a news topic
//     carrying crisis words steps aside for the crisis nodes.
//   - Zero external LLM, zero keys: all five endpoints are public and free.
//   - Sources are INJECTED (the v35 ConditionSources pattern) so tests stub
//     the world and never touch the network.
//
// Cache: one in-memory map per warm isolate, TTL per engine — weather 30 min,
// crypto 5 min, exchange rates 6 h, country facts 7 days, news 15 min,
// sun 6 h, air 30 min, market quotes 10 min, holidays 24 h, this-day 6 h.

import { tryUnits, todayInTZ } from './skills.ts';

// Same guard as agent.ts/compose.ts: crisis language is a human emergency,
// never a search topic.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

// The same tidy the other parsing modules use.
function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── The injected world (tests stub these; production uses the real fetchers) ─

export type GeoHit = { name: string; country: string; lat: number; lon: number };
export type Forecast = {
  tempC: number; feelsC: number; humidity: number; windKmh: number; code: number;
  minC: number; maxC: number; rainPct: number | null;
};
export type CountryFacts = {
  name: string; capitals: string[]; population: number;
  currencies: string[]; languages: string[]; region: string;
  popYear?: string; // the World Bank observation year, when known
};
export type SunTimes = { sunrise: string; sunset: string; daylightSec: number };
export type AirNow = { aqi: number | null; pm25: number | null; pm10: number | null; uv: number | null };
export type Quote = { price: number; currency: string };
export type Holiday = { date: string; name: string };
export type DayEvent = { year: number; text: string };

export type WorldSources = {
  /** null = no such place; 'down' = couldn't reach the geocoder. */
  geocode: (city: string) => Promise<GeoHit | null | 'down'>;
  /** null = couldn't reach the forecast service. */
  forecast: (lat: number, lon: number) => Promise<Forecast | null>;
  /** Units of `to` per ONE unit of `from`; null = couldn't reach the rates. */
  rate: (from: string, to: string) => Promise<number | null>;
  /** Price of one coin in each vs currency; null = couldn't reach. */
  crypto: (id: string, vs: string[]) => Promise<Record<string, number> | null>;
  /** 'unknown' = no such country; null = couldn't reach. */
  country: (name: string) => Promise<CountryFacts | null | 'unknown'>;
  /** Newest headline titles (topic omitted = top stories); null = couldn't reach. */
  news: (topic?: string) => Promise<string[] | null>;
  /** v52: local sunrise/sunset ISO datetimes; null = couldn't reach. */
  sun: (lat: number, lon: number) => Promise<SunTimes | null>;
  /** v52: current air quality + UV; null = couldn't reach. */
  air: (lat: number, lon: number) => Promise<AirNow | null>;
  /** v52: last market price for a KNOWN symbol; null = couldn't reach. */
  quote: (symbol: string) => Promise<Quote | null>;
  /** v52: upcoming holidays for a SPOKEN country name; 'unknown' = no calendar. */
  holidays: (country: string) => Promise<Holiday[] | null | 'unknown'>;
  /** v52: curated events for a calendar day; null = couldn't reach. */
  onThisDay: (month: number, day: number) => Promise<DayEvent[] | null>;
};

const TIMEOUT = 4000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(String(res.status));
  return await res.json();
}

// ── The country atlas (per-isolate) ──────────────────────────────────────────
// REST Countries died behind an API key in 2026, so the atlas reads the open
// dataset it was built on: mledoze/countries (via the jsDelivr CDN — one
// ~1.4 MB fetch per warm isolate, immediately slimmed to the six fields NAVI
// speaks, then kept for the isolate's life). Fetched LAZILY — only a country
// ask ever pays for it.

type SlimCountry = {
  name: string; cca2: string; cca3: string; capitals: string[];
  currencies: string[]; languages: string[]; region: string; alts: string[];
};

// The one name matcher both the atlas and the holiday calendar use.
function findCountry(list: SlimCountry[], name: string): SlimCountry | undefined {
  const q = name.toLowerCase().trim();
  return list.find((c) => c.name.toLowerCase() === q) ??
    list.find((c) => c.alts.includes(q)) ??
    list.find((c) => c.name.toLowerCase().startsWith(q));
}

let atlas: SlimCountry[] | null = null;

async function loadAtlas(): Promise<SlimCountry[] | null> {
  if (atlas) return atlas;
  try {
    const res = await fetch(
      'https://cdn.jsdelivr.net/gh/mledoze/countries@master/countries.json',
      { signal: AbortSignal.timeout(8000), headers: { 'Accept': 'application/json' } },
    );
    if (!res.ok) return null;
    // deno-lint-ignore no-explicit-any
    const rows = await res.json() as any[];
    if (!Array.isArray(rows) || rows.length < 100) return null;
    atlas = rows
      .map((r) => ({
        name: String(r?.name?.common ?? ''),
        cca2: String(r?.cca2 ?? ''),
        cca3: String(r?.cca3 ?? ''),
        capitals: Array.isArray(r?.capital) ? r.capital.map(String) : [],
        currencies: r?.currencies && typeof r.currencies === 'object'
          ? Object.entries(r.currencies as Record<string, { name?: string }>)
            .map(([code, v]) => `${v?.name ?? code} (${code})`)
          : [],
        languages: r?.languages && typeof r.languages === 'object'
          ? Object.values(r.languages as Record<string, string>).map(String)
          : [],
        region: String(r?.region ?? ''),
        alts: [
          String(r?.name?.official ?? ''),
          ...(Array.isArray(r?.altSpellings) ? r.altSpellings.map(String) : []),
        ].map((s) => s.toLowerCase()).filter((s) => s.length > 1),
      }))
      .filter((c) => c.name && c.cca3);
    return atlas;
  } catch {
    return null;
  }
}

const REAL_SOURCES: WorldSources = {
  geocode: async (city) => {
    try {
      const data = await getJson(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
      ) as { results?: { name?: string; country?: string; latitude?: number; longitude?: number }[] };
      const hit = data?.results?.[0];
      if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return null;
      return { name: hit.name ?? city, country: hit.country ?? '', lat: hit.latitude, lon: hit.longitude };
    } catch {
      return 'down';
    }
  },
  forecast: async (lat, lon) => {
    try {
      const data = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`,
        // deno-lint-ignore no-explicit-any
      ) as any;
      const c = data?.current;
      const d = data?.daily;
      if (typeof c?.temperature_2m !== 'number') return null;
      return {
        tempC: Math.round(c.temperature_2m),
        feelsC: Math.round(c.apparent_temperature ?? c.temperature_2m),
        humidity: Math.round(c.relative_humidity_2m ?? 0),
        windKmh: Math.round(c.wind_speed_10m ?? 0),
        code: Number(c.weather_code ?? 0),
        minC: Math.round(d?.temperature_2m_min?.[0] ?? c.temperature_2m),
        maxC: Math.round(d?.temperature_2m_max?.[0] ?? c.temperature_2m),
        rainPct: typeof d?.precipitation_probability_max?.[0] === 'number'
          ? Math.round(d.precipitation_probability_max[0]) : null,
      };
    } catch {
      return null;
    }
  },
  rate: async (from, to) => {
    try {
      const data = await getJson(
        `https://api.frankfurter.app/latest?from=${from}&to=${to}`,
      ) as { rates?: Record<string, number> };
      const r = data?.rates?.[to];
      return typeof r === 'number' && r > 0 ? r : null;
    } catch {
      return null;
    }
  },
  crypto: async (id, vs) => {
    try {
      const data = await getJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs.join(',')}`,
      ) as Record<string, Record<string, number>>;
      const row = data?.[id];
      return row && typeof row === 'object' && Object.keys(row).length ? row : null;
    } catch {
      return null;
    }
  },
  country: async (name) => {
    const list = await loadAtlas();
    if (!list) return null;
    const hit = findCountry(list, name);
    if (!hit) return 'unknown';
    // Population lives at the World Bank (mledoze carries none) — fetched only
    // here, cached with the whole answer by tryWorld. A miss just means the
    // population ask falls through to the web; the other facts don't need it.
    let population = 0;
    let popYear: string | undefined;
    try {
      const data = await getJson(
        `https://api.worldbank.org/v2/country/${hit.cca3}/indicator/SP.POP.TOTL?format=json&mrnev=1`,
        // deno-lint-ignore no-explicit-any
      ) as any;
      const row = Array.isArray(data?.[1]) ? data[1][0] : null;
      if (typeof row?.value === 'number' && row.value > 0) {
        population = row.value;
        if (row.date) popYear = String(row.date);
      }
    } catch { /* population stays 0 — the one ask that needs it falls through */ }
    return { ...hit, population, popYear };
  },
  news: async (topic) => {
    try {
      const url = topic
        ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-ZA&gl=ZA&ceid=ZA:en`
        : 'https://news.google.com/rss?hl=en-ZA&gl=ZA&ceid=ZA:en';
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) return null;
      const xml = await res.text();
      const titles: string[] = [];
      const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null && titles.length < 5) {
        const t = m[1]
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ').trim();
        if (t && !titles.includes(t)) titles.push(t);
      }
      return titles;
    } catch {
      return null;
    }
  },
  sun: async (lat, lon) => {
    try {
      const data = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=sunrise,sunset,daylight_duration&timezone=auto&forecast_days=1`,
        // deno-lint-ignore no-explicit-any
      ) as any;
      const d = data?.daily;
      if (typeof d?.sunrise?.[0] !== 'string' || typeof d?.sunset?.[0] !== 'string') return null;
      return {
        sunrise: String(d.sunrise[0]),
        sunset: String(d.sunset[0]),
        daylightSec: Math.round(Number(d.daylight_duration?.[0] ?? 0)),
      };
    } catch {
      return null;
    }
  },
  air: async (lat, lon) => {
    try {
      const data = await getJson(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
        `&current=pm2_5,pm10,us_aqi,uv_index`,
        // deno-lint-ignore no-explicit-any
      ) as any;
      const c = data?.current;
      if (!c || typeof c !== 'object') return null;
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const out = { aqi: num(c.us_aqi), pm25: num(c.pm2_5), pm10: num(c.pm10), uv: num(c.uv_index) };
      return out.aqi === null && out.uv === null ? null : out;
    } catch {
      return null;
    }
  },
  quote: async (symbol) => {
    try {
      // Yahoo's v8 chart endpoint is keyless but wants a browser UA.
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
        { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } },
      );
      if (!res.ok) return null;
      // deno-lint-ignore no-explicit-any
      const data = await res.json() as any;
      const meta = data?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      if (!Number.isFinite(price) || price <= 0) return null;
      let currency = String(meta?.currency ?? 'USD');
      let value = price;
      // JSE quotes come back in ZAc (cents of a rand) — speak rand.
      if (currency === 'ZAc') { currency = 'ZAR'; value = price / 100; }
      return { price: value, currency };
    } catch {
      return null;
    }
  },
  holidays: async (country) => {
    const list = await loadAtlas();
    if (!list) return null;
    const hit = findCountry(list, country);
    if (!hit || !hit.cca2) return 'unknown';
    try {
      const res = await fetch(
        `https://date.nager.at/api/v3/NextPublicHolidays/${hit.cca2}`,
        { signal: AbortSignal.timeout(TIMEOUT), headers: { 'Accept': 'application/json' } },
      );
      if (res.status === 404) return 'unknown'; // no calendar for that country
      if (!res.ok) return null;
      // deno-lint-ignore no-explicit-any
      const rows = await res.json() as any[];
      if (!Array.isArray(rows)) return null;
      return rows
        .filter((r) => typeof r?.date === 'string')
        .map((r) => ({ date: String(r.date), name: String(r.localName ?? r.name ?? 'Public holiday') }));
    } catch {
      return null;
    }
  },
  onThisDay: async (month, day) => {
    try {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const data = await getJson(
        `https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${mm}/${dd}`,
        // deno-lint-ignore no-explicit-any
      ) as any;
      const events = Array.isArray(data?.selected) ? data.selected : [];
      return events
        .filter((e: { year?: unknown; text?: unknown }) => typeof e?.year === 'number' && typeof e?.text === 'string')
        .map((e: { year: number; text: string }) => ({ year: e.year, text: e.text }));
    } catch {
      return null;
    }
  },
};

// ── Cache (per warm isolate, webCache-style) ─────────────────────────────────

const CACHE_MAX = 300;
const cache = new Map<string, { text: string; exp: number }>();

function cached(key: string): string | null {
  const hit = cache.get(key);
  return hit && hit.exp > Date.now() ? hit.text : null;
}

function remember(key: string, text: string, ttlMs: number): string {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { text, exp: Date.now() + ttlMs });
  return text;
}

const MIN = 60 * 1000;
const TTL_WEATHER = 30 * MIN;
const TTL_CRYPTO = 5 * MIN;
const TTL_RATE = 6 * 60 * MIN;
const TTL_COUNTRY = 7 * 24 * 60 * MIN;
const TTL_NEWS = 15 * MIN;
const TTL_SUN = 6 * 60 * MIN;
const TTL_AIR = 30 * MIN;
const TTL_QUOTE = 10 * MIN;
const TTL_HOLIDAYS = 24 * 60 * MIN;
const TTL_THIS_DAY = 6 * 60 * MIN;

// ── Shared vocabulary ────────────────────────────────────────────────────────

// Frankfurter serves the ECB reference set — a CLOSED list, so an unsupported
// code teaches honestly instead of failing weirdly. Word aliases cover how
// people actually talk about the big ones (rand, dollars, euros, pounds…).
const FRANKFURTER = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD',
  'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

const CURRENCY_WORDS: Record<string, string> = {
  dollar: 'USD', dollars: 'USD', buck: 'USD', bucks: 'USD',
  rand: 'ZAR', rands: 'ZAR',
  euro: 'EUR', euros: 'EUR',
  pound: 'GBP', pounds: 'GBP', sterling: 'GBP', quid: 'GBP',
  yen: 'JPY', yuan: 'CNY', rupee: 'INR', rupees: 'INR',
  franc: 'CHF', francs: 'CHF',
};

/** A spoken currency word/code → its ISO code, or null when unknown. */
function currencyOf(word: string): string | null {
  const w = word.trim().toLowerCase();
  if (CURRENCY_WORDS[w]) return CURRENCY_WORDS[w];
  const up = w.toUpperCase();
  return FRANKFURTER.has(up) ? up : null;
}

// The coins NAVI quotes — a closed list mapped to CoinGecko ids.
const COINS: Record<string, { id: string; label: string }> = {
  bitcoin: { id: 'bitcoin', label: 'Bitcoin' }, btc: { id: 'bitcoin', label: 'Bitcoin' },
  ethereum: { id: 'ethereum', label: 'Ethereum' }, eth: { id: 'ethereum', label: 'Ethereum' },
  solana: { id: 'solana', label: 'Solana' }, sol: { id: 'solana', label: 'Solana' },
  cardano: { id: 'cardano', label: 'Cardano' }, ada: { id: 'cardano', label: 'Cardano' },
  dogecoin: { id: 'dogecoin', label: 'Dogecoin' }, doge: { id: 'dogecoin', label: 'Dogecoin' },
  xrp: { id: 'ripple', label: 'XRP' }, ripple: { id: 'ripple', label: 'XRP' },
  litecoin: { id: 'litecoin', label: 'Litecoin' }, ltc: { id: 'litecoin', label: 'Litecoin' },
  bnb: { id: 'binancecoin', label: 'BNB' },
  polkadot: { id: 'polkadot', label: 'Polkadot' }, dot: { id: 'polkadot', label: 'Polkadot' },
  tron: { id: 'tron', label: 'TRON' }, trx: { id: 'tron', label: 'TRON' },
};
const COIN_NAMES = Object.keys(COINS).join('|');

// v52: the markets NAVI quotes — a CLOSED list mapped to Yahoo symbols.
// No raw tickers on purpose: "price of a car" must never hit a market API.
const TICKERS: Record<string, { sym: string; label: string; kind: 'stock' | 'index' | 'commodity'; unit?: string }> = {
  'apple': { sym: 'AAPL', label: 'Apple (AAPL)', kind: 'stock' },
  'tesla': { sym: 'TSLA', label: 'Tesla (TSLA)', kind: 'stock' },
  'microsoft': { sym: 'MSFT', label: 'Microsoft (MSFT)', kind: 'stock' },
  'google': { sym: 'GOOGL', label: 'Alphabet (GOOGL)', kind: 'stock' },
  'alphabet': { sym: 'GOOGL', label: 'Alphabet (GOOGL)', kind: 'stock' },
  'amazon': { sym: 'AMZN', label: 'Amazon (AMZN)', kind: 'stock' },
  'meta': { sym: 'META', label: 'Meta (META)', kind: 'stock' },
  'facebook': { sym: 'META', label: 'Meta (META)', kind: 'stock' },
  'nvidia': { sym: 'NVDA', label: 'Nvidia (NVDA)', kind: 'stock' },
  'netflix': { sym: 'NFLX', label: 'Netflix (NFLX)', kind: 'stock' },
  'naspers': { sym: 'NPN.JO', label: 'Naspers (NPN, JSE)', kind: 'stock' },
  's&p 500': { sym: '^GSPC', label: 'The S&P 500', kind: 'index' },
  'sp500': { sym: '^GSPC', label: 'The S&P 500', kind: 'index' },
  's&p': { sym: '^GSPC', label: 'The S&P 500', kind: 'index' },
  'dow jones': { sym: '^DJI', label: 'The Dow Jones', kind: 'index' },
  'dow': { sym: '^DJI', label: 'The Dow Jones', kind: 'index' },
  'nasdaq': { sym: '^IXIC', label: 'The Nasdaq', kind: 'index' },
  'gold': { sym: 'GC=F', label: 'Gold', kind: 'commodity', unit: 'per ounce' },
  'silver': { sym: 'SI=F', label: 'Silver', kind: 'commodity', unit: 'per ounce' },
  'oil': { sym: 'CL=F', label: 'Oil (WTI crude)', kind: 'commodity', unit: 'per barrel' },
  'crude oil': { sym: 'CL=F', label: 'Oil (WTI crude)', kind: 'commodity', unit: 'per barrel' },
  'brent': { sym: 'BZ=F', label: 'Brent crude', kind: 'commodity', unit: 'per barrel' },
};
const TICKER_NAMES = Object.keys(TICKERS)
  .sort((a, b) => b.length - a.length) // longest first: "crude oil" before "oil"
  .map((k) => k.replace(/[&$^.]/g, (ch) => '\\' + ch))
  .join('|');

// v52: closed US-AQI bands (EPA) — every number lands in exactly one.
function aqiBand(aqi: number): string {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'moderate';
  if (aqi <= 150) return 'unhealthy for sensitive groups';
  if (aqi <= 200) return 'unhealthy';
  if (aqi <= 300) return 'very unhealthy';
  return 'hazardous';
}

// v52: closed UV-index bands (WHO).
function uvBand(uv: number): string {
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very high';
  return 'extreme';
}

// "2026-07-16T06:55" → "06:55"; daylight seconds → "10 h 36 min".
function clockOf(iso: string): string {
  return iso.length >= 16 ? iso.slice(11, 16) : iso;
}
function daylightOf(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `${h} h ${m} min`;
}

// WMO weather codes → words. Closed and exhaustive over Open-Meteo's set.
function skyOf(code: number): string {
  if (code === 0) return 'clear skies';
  if (code === 1) return 'mostly clear';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzling';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'raining';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snowing';
  if (code >= 95) return 'thunderstorms';
  return 'mixed conditions';
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMoney(n: number): string {
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// ── Parsers (exported for tests) ─────────────────────────────────────────────

const WEATHER_RX =
  /^(?:what(?:'s| is) |how(?:'s| is) )?(?:the )?(?:weather|forecast)(?: like)?(?: today| right now| now)?(?: (?:in|for|at) ([a-z][a-z' .-]{1,39}?))?(?: today| right now| now)?$/;

/** { city } from a weather ask ('' = no city named), or null. */
export function parseWeatherAsk(message: string): { city: string } | null {
  const t = tidy(message);
  if (!t || t.length > 70) return null;
  const m = t.match(WEATHER_RX);
  if (!m) return null;
  const city = (m[1] ?? '').trim();
  // A multi-part tail ("in durban and price of ethereum") is not a place.
  if (/\b(?:and|then)\b/.test(city)) return null;
  return { city };
}

// Explicit convert forms (an unknown side TEACHES — the verb showed intent);
// the loose rate form ("usd to zar") only ever answers, never teaches.
const CONVERT_RX =
  /^(?:convert |change |how much is |what(?:'s| is) )?(\d{1,12}(?:\.\d{1,4})?) ?([a-z]{2,12}) (?:to|into|in) ([a-z]{2,12})$/;
const RATE_RX =
  /^(?:what(?:'s| is) )?(?:the )?(?:exchange rate (?:for |of )?)?([a-z]{3,9}) (?:to|vs|against) ([a-z]{3,9})(?: exchange rate| rate)?$/;

/** { amount, from, to, explicit } from a conversion ask (raw words), or null. */
export function parseConvertAsk(
  message: string,
): { amount: number; from: string; to: string; explicit: boolean } | null {
  const t = tidy(message);
  if (!t || t.length > 60) return null;
  const m = t.match(CONVERT_RX);
  if (m) return { amount: parseFloat(m[1]), from: m[2], to: m[3], explicit: /^(?:convert|change)\b/.test(t) };
  const r = t.match(RATE_RX);
  if (r) return { amount: 1, from: r[1], to: r[2], explicit: false };
  return null;
}

const CRYPTO_RX = new RegExp(
  `^(?:what(?:'s| is) |how much is )?(?:the )?(?:price of |current price of )?(${COIN_NAMES})(?: price| worth)?(?: (?:in|to) ([a-z]{3,9}))?(?: (?:right )?now| today)?$`,
);

/** { coin, vs? } from a crypto price ask, or null. */
export function parseCryptoAsk(message: string): { coin: string; vs?: string } | null {
  const t = tidy(message);
  if (!t || t.length > 60) return null;
  const m = t.match(CRYPTO_RX);
  if (!m) return null;
  // A bare coin name with no price words is conversation ("bitcoin"), not an ask.
  if (!/\b(?:price|worth|how much)\b/.test(t)) return null;
  return m[2] ? { coin: m[1], vs: m[2] } : { coin: m[1] };
}

const COUNTRY_RX =
  /^(?:what(?:'s| is) )?(?:the )?(capital|population|currency|currencies|language|languages) of (?:the )?([a-z][a-z' .-]{2,39})$/;
const COUNTRY_PEOPLE_RX =
  /^how many people live in (?:the )?([a-z][a-z' .-]{2,39})$/;

/** { what, country } from a country-fact ask, or null. */
export function parseCountryAsk(
  message: string,
): { what: 'capital' | 'population' | 'currency' | 'languages'; country: string } | null {
  const t = tidy(message);
  if (!t || t.length > 60) return null;
  const p = t.match(COUNTRY_PEOPLE_RX);
  if (p) return { what: 'population', country: p[1].trim() };
  const m = t.match(COUNTRY_RX);
  if (!m) return null;
  const what = m[1] === 'currencies' ? 'currency' : m[1] === 'language' ? 'languages' : m[1];
  return { what: what as 'capital' | 'population' | 'currency' | 'languages', country: m[2].trim() };
}

const NEWS_TOP_RX =
  /^(?:what(?:'s| is) (?:in |happening in )?)?(?:the )?(?:news|headlines)(?: today| right now)?$|^(?:any|latest|today'?s) (?:news|headlines)$|^(?:give me|show me) the (?:news|headlines)$/;
const NEWS_TOPIC_RX =
  /^(?:any |latest |show me |give me )?(?:news|headlines) (?:about|on|for) (.{2,60})$|^what'?s (?:the news|happening) (?:about|on|with) (.{2,60})$/;

/** { topic? } from a news ask (no topic = top stories), or null. */
export function parseNewsAsk(message: string): { topic?: string } | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  if (NEWS_TOP_RX.test(t)) return {};
  const m = t.match(NEWS_TOPIC_RX);
  if (!m) return null;
  const topic = (m[1] ?? m[2]).trim();
  // Crisis language never drives a search — the crisis nodes own the message.
  if (CRISIS_RX.test(topic)) return null;
  // "what's the news with you" is conversation, not a search topic.
  if (/^(?:you|me|us|him|her|them|it|yourself|everyone|everybody|life)$/.test(topic)) return null;
  return { topic };
}

// ── v52 parsers — sun, air, markets, holidays, this day ──────────────────────

const SUN_RX =
  /^(?:when (?:is|does) (?:the )?sun ?(rise|set)|(?:what time is |when is )?(?:the )?(sunrise|sunset)(?: time)?)(?: today)?(?: (?:in|at|for) ([a-z][a-z' .-]{1,39}?))?(?: today)?$/;

/** { which, city } from a sun ask ('' = no city named), or null. */
export function parseSunAsk(message: string): { which: 'sunrise' | 'sunset'; city: string } | null {
  const t = tidy(message);
  if (!t || t.length > 70) return null;
  const m = t.match(SUN_RX);
  if (!m) return null;
  const which = (m[1] ? `sun${m[1]}` : m[2]) as 'sunrise' | 'sunset';
  const city = (m[3] ?? '').trim();
  // A multi-part tail is not a place (splitIntents never splits these forms).
  if (/\b(?:and|then)\b/.test(city)) return null;
  return { which, city };
}

const AIR_RX =
  /^(?:what(?:'s| is) |how(?:'s| is) )?(?:the )?(air quality|air pollution|aqi|uv index|uv)(?: like)?(?: (?:in|for|at) ([a-z][a-z' .-]{1,39}?))?(?: today| right now| now)?$/;

/** { what, city } from an air/UV ask ('' = no city named), or null. */
export function parseAirAsk(message: string): { what: 'air' | 'uv'; city: string } | null {
  const t = tidy(message);
  if (!t || t.length > 70) return null;
  const m = t.match(AIR_RX);
  if (!m) return null;
  const what = m[1].startsWith('uv') ? 'uv' : 'air';
  const city = (m[2] ?? '').trim();
  if (/\b(?:and|then)\b/.test(city)) return null;
  return { what, city };
}

const QUOTE_RX = new RegExp(
  `^(?:what(?:'s| is) |how much is )?(?:the )?(?:price of |current price of )?(?:one share of |a share of |shares of )?(${TICKER_NAMES})(?: (?:stock|shares?))?(?: price| worth| trading(?: at)?)?(?: (?:right )?now| today)?$`,
);
const QUOTE_WHERE_RX = new RegExp(
  `^where(?:'s| is) the (${TICKER_NAMES})(?: (?:at|trading))?(?: today| right now)?$`,
);

/** { name } (a TICKERS key) from a market price ask, or null. */
export function parseQuoteAsk(message: string): { name: string } | null {
  const t = tidy(message);
  if (!t || t.length > 60) return null;
  // "where's the s&p 500" — the where-form is a market idiom for INDEXES only
  // ("where's the apple" is somebody looking for fruit).
  const w = t.match(QUOTE_WHERE_RX);
  if (w && TICKERS[w[1]].kind === 'index') return { name: w[1] };
  const m = t.match(QUOTE_RX);
  if (!m) return null;
  // A bare name with no price words is conversation ("tesla"), not an ask.
  if (!/\b(?:price|worth|how much|trading)\b/.test(t)) return null;
  // Companies need the market word — "price of apple" stays fruit.
  if (TICKERS[m[1]].kind === 'stock' && !/\b(?:stock|shares?)\b/.test(t)) return null;
  return { name: m[1] };
}

const HOLIDAY_NEXT_RX =
  /^(?:when(?:'s| is) |what(?:'s| is) )?(?:the )?next public holiday(?: (?:in|for) ([a-z][a-z' .-]{2,39}))?$/;
const HOLIDAYS_LIST_RX =
  /^(?:what (?:are )?|show me |list |any )?(?:the )?(?:next |upcoming )?public holidays(?: (?:in|for) ([a-z][a-z' .-]{2,39}))?(?: this year| coming up)?$/;

/** { country ('' = home), next } from a public-holiday ask, or null. */
export function parseHolidaysAsk(message: string): { country: string; next: boolean } | null {
  const t = tidy(message);
  if (!t || t.length > 70) return null;
  const n = t.match(HOLIDAY_NEXT_RX);
  const m = n ? null : t.match(HOLIDAYS_LIST_RX);
  if (!n && !m) return null;
  const country = ((n ? n[1] : m?.[1]) ?? '').trim();
  if (/\b(?:and|then)\b/.test(country)) return null;
  return { country, next: !!n };
}

const THIS_DAY_RX =
  /^(?:today|(?:on )?this day) in history$|^what happened on this day(?: in history)?$|^what happened today in history$/;

/** {} from a this-day-in-history ask, or null ("what happened today" is
 *  somebody's day, not a history ask — it needs "on this day" or "in history"). */
export function parseThisDayAsk(message: string): Record<never, never> | null {
  const t = tidy(message);
  if (!t || t.length > 50) return null;
  return THIS_DAY_RX.test(t) ? {} : null;
}

// ── v52 formatting helpers ───────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// "2026-09-24" → "24 September" (year named only when it isn't this year).
function niceDate(iso: string, thisYear: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m > 12) return iso;
  return `${d} ${MONTH_NAMES[m - 1]}${y !== thisYear ? ` ${y}` : ''}`;
}

function daysUntil(iso: string, today: { y: number; m: number; d: number }): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.y, today.m - 1, today.d)) / 86400000);
}

// UV comes back in tenths — show one decimal, band on the raw value.
function fmtUv(n: number): string {
  return String(Math.round(n * 10) / 10);
}

// ── The engine ───────────────────────────────────────────────────────────────

const CURRENCY_LIST =
  'rand (ZAR), dollars (USD), euros (EUR), pounds (GBP), yen (JPY), yuan (CNY), rupees (INR) and the other ECB reference currencies (AUD, BRL, CAD, CHF, KRW, MXN, NOK, NZD, SEK, SGD, TRY …)';

/**
 * Answer a world ask — weather, currency, crypto, country facts, news — or
 * return null when the message is none of world.ts's business. Read-only,
 * reply-only (never a profile), works signed-in or out, and every reply is
 * either live data, a cached copy of live data, or an honest can't-reach.
 */
export async function tryWorld(
  message: string,
  sources: WorldSources = REAL_SOURCES,
): Promise<string | null> {
  // 1. WEATHER
  const weather = parseWeatherAsk(message);
  if (weather) {
    if (!weather.city) {
      return 'Tell me where and I\'ll check the sky: "weather in johannesburg" (any city works).';
    }
    const key = `w:${weather.city}`;
    const hit = cached(key);
    if (hit) return hit;
    const geo = await sources.geocode(weather.city);
    if (geo === 'down') return 'I couldn\'t reach the weather service just now — try me again in a moment.';
    if (!geo) return `I couldn't find a place called "${weather.city}" on the map — check the spelling and try me again.`;
    const fc = await sources.forecast(geo.lat, geo.lon);
    if (!fc) return 'I found the place but couldn\'t reach the forecast service just now — try me again in a moment.';
    const where = geo.country && geo.country !== geo.name ? `${geo.name}, ${geo.country}` : geo.name;
    const rain = fc.rainPct !== null ? `, ${fc.rainPct}% chance of rain` : '';
    return remember(
      key,
      `Weather in ${where} right now: ${fc.tempC}°C (feels like ${fc.feelsC}°C), ${skyOf(fc.code)}, humidity ${fc.humidity}%, wind ${fc.windKmh} km/h. Today: low ${fc.minC}°C, high ${fc.maxC}°C${rain}. (Open-Meteo)`,
      TTL_WEATHER,
    );
  }

  // 2. CRYPTO (before currency — "bitcoin price in rands" must not read as money-to-money)
  const coinAsk = parseCryptoAsk(message);
  if (coinAsk) {
    const coin = COINS[coinAsk.coin];
    const vsAsked = coinAsk.vs ? currencyOf(coinAsk.vs) : null;
    if (coinAsk.vs && !vsAsked) {
      return `I can quote ${coin.label} in ${CURRENCY_LIST} — "${coinAsk.vs}" isn't one I track.`;
    }
    const vs = vsAsked ? [vsAsked.toLowerCase()] : ['usd', 'zar'];
    const key = `c:${coin.id}:${vs.join(',')}`;
    const hit = cached(key);
    if (hit) return hit;
    const row = await sources.crypto(coin.id, vs);
    if (!row) return 'I couldn\'t reach the crypto price feed just now — try me again in a moment.';
    const parts = vs
      .filter((v) => typeof row[v] === 'number')
      .map((v) => `${fmtMoney(row[v])} ${v.toUpperCase()}`);
    if (!parts.length) {
      return `The feed doesn't quote ${coin.label} in ${vs.join('/').toUpperCase()} — try USD, ZAR, EUR or GBP.`;
    }
    return remember(
      key,
      `${coin.label} right now: ${parts.join(' · ')}. (CoinGecko — crypto moves fast, treat this as a snapshot.)`,
      TTL_CRYPTO,
    );
  }

  // 3. CURRENCY
  const conv = parseConvertAsk(message);
  if (conv) {
    // Physical units keep their own lane — "convert 100 pounds to kg" is
    // mass, and skills.ts already answers it perfectly.
    if (tryUnits(message)) return null;
    const from = currencyOf(conv.from);
    const to = currencyOf(conv.to);
    if (!from || !to) {
      // Only the explicit convert verb teaches; loose shapes stay conversation.
      if (conv.explicit && (from || to)) {
        return `I convert between ${CURRENCY_LIST} — "${from ? conv.to : conv.from}" isn't one I have rates for.`;
      }
      return null;
    }
    if (from === to) return `That one's easy — ${fmtMoney(conv.amount)} ${from} is exactly ${fmtMoney(conv.amount)} ${to}.`;
    const rateKey = `r:${from}:${to}`;
    let rate: number | null = null;
    const hit = cached(rateKey);
    if (hit) rate = parseFloat(hit);
    if (rate === null || !Number.isFinite(rate)) {
      rate = await sources.rate(from, to);
      if (rate === null) return 'I couldn\'t reach the exchange-rate service just now — try me again in a moment.';
      remember(rateKey, String(rate), TTL_RATE);
    }
    const out = conv.amount * rate;
    return `${fmtMoney(conv.amount)} ${from} ≈ ${fmtMoney(out)} ${to} (rate ${fmtMoney(rate)} — European Central Bank reference rates, updated daily).`;
  }

  // 4. ATLAS
  const countryAsk = parseCountryAsk(message);
  if (countryAsk) {
    const key = `a:${countryAsk.what}:${countryAsk.country}`;
    const hit = cached(key);
    if (hit) return hit;
    const facts = await sources.country(countryAsk.country);
    // No such country → fall through: "capital of the roman empire" belongs
    // to the web fallback, not to an honest miss.
    if (facts === 'unknown') return null;
    if (!facts) return 'I couldn\'t reach the country atlas just now — try me again in a moment.';
    let text = '';
    if (countryAsk.what === 'capital') {
      if (!facts.capitals.length) return null;
      text = facts.capitals.length === 1
        ? `The capital of ${facts.name} is ${facts.capitals[0]}.`
        : `${facts.name} has ${facts.capitals.length} capitals: ${facts.capitals.join(', ')}.`;
    } else if (countryAsk.what === 'population') {
      if (!facts.population) return null;
      text = facts.popYear
        ? `${facts.name} has about ${fmtNum(facts.population)} people (World Bank, ${facts.popYear}).`
        : `${facts.name} has about ${fmtNum(facts.population)} people.`;
    } else if (countryAsk.what === 'currency') {
      if (!facts.currencies.length) return null;
      text = `${facts.name} uses the ${facts.currencies.join(' and the ')}.`;
    } else {
      if (!facts.languages.length) return null;
      text = facts.languages.length === 1
        ? `${facts.name} has one official language: ${facts.languages[0]}.`
        : `${facts.name} has ${facts.languages.length} official languages: ${facts.languages.join(', ')}.`;
    }
    return remember(key, text, TTL_COUNTRY);
  }

  // 5. NEWS
  const news = parseNewsAsk(message);
  if (news) {
    const key = `n:${news.topic ?? ''}`;
    const hit = cached(key);
    if (hit) return hit;
    const titles = await sources.news(news.topic);
    if (titles === null) return 'I couldn\'t reach the news feed just now — try me again in a moment.';
    if (!titles.length) {
      return news.topic
        ? `Nothing in the news about "${news.topic}" right now — either it's quiet or the feed is. Try a broader topic.`
        : 'The news feed came back empty just now — try me again in a moment.';
    }
    const lines = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const head = news.topic ? `The latest on "${news.topic}":` : "Today's headlines:";
    return remember(key, `${head}\n${lines}\n(Google News, South Africa edition.)`, TTL_NEWS);
  }

  // 6. SUN (v52 — rides the same geocoder as weather)
  const sun = parseSunAsk(message);
  if (sun) {
    if (!sun.city) {
      return `Tell me where and I'll check the almanac: "${sun.which} in johannesburg" (any city works).`;
    }
    const key = `s:${sun.which}:${sun.city}`;
    const hit = cached(key);
    if (hit) return hit;
    const geo = await sources.geocode(sun.city);
    if (geo === 'down') return 'I couldn\'t reach the sun almanac just now — try me again in a moment.';
    if (!geo) return `I couldn't find a place called "${sun.city}" on the map — check the spelling and try me again.`;
    const st = await sources.sun(geo.lat, geo.lon);
    if (!st) return 'I found the place but couldn\'t reach the sun almanac just now — try me again in a moment.';
    const where = geo.country && geo.country !== geo.name ? `${geo.name}, ${geo.country}` : geo.name;
    const text = sun.which === 'sunrise'
      ? `Sunrise in ${where} today is at ${clockOf(st.sunrise)} (sunset ${clockOf(st.sunset)} — ${daylightOf(st.daylightSec)} of daylight). (Open-Meteo)`
      : `Sunset in ${where} today is at ${clockOf(st.sunset)} (sunrise ${clockOf(st.sunrise)} — ${daylightOf(st.daylightSec)} of daylight). (Open-Meteo)`;
    return remember(key, text, TTL_SUN);
  }

  // 7. AIR (v52 — same geocoder again)
  const airAsk = parseAirAsk(message);
  if (airAsk) {
    if (!airAsk.city) {
      return 'Tell me where and I\'ll check the air: "air quality in johannesburg" or "uv index in durban" (any city works).';
    }
    const key = `air:${airAsk.what}:${airAsk.city}`;
    const hit = cached(key);
    if (hit) return hit;
    const geo = await sources.geocode(airAsk.city);
    if (geo === 'down') return 'I couldn\'t reach the air-quality service just now — try me again in a moment.';
    if (!geo) return `I couldn't find a place called "${airAsk.city}" on the map — check the spelling and try me again.`;
    const now = await sources.air(geo.lat, geo.lon);
    if (!now) return 'I found the place but couldn\'t reach the air-quality service just now — try me again in a moment.';
    const where = geo.country && geo.country !== geo.name ? `${geo.name}, ${geo.country}` : geo.name;
    if (airAsk.what === 'uv') {
      if (now.uv === null) return `The air-quality service has no UV reading for ${where} just now — try me again later.`;
      return remember(key, `UV index in ${where} right now: ${fmtUv(now.uv)} (${uvBand(now.uv)}). (Open-Meteo)`, TTL_AIR);
    }
    if (now.aqi === null) return `The air-quality service has no reading for ${where} just now — try me again later.`;
    const parts = [`US AQI ${Math.round(now.aqi)} — ${aqiBand(now.aqi)}`];
    if (now.pm25 !== null) parts.push(`PM2.5 ${Math.round(now.pm25)} µg/m³`);
    if (now.pm10 !== null) parts.push(`PM10 ${Math.round(now.pm10)} µg/m³`);
    if (now.uv !== null) parts.push(`UV index ${fmtUv(now.uv)} (${uvBand(now.uv)})`);
    return remember(key, `Air quality in ${where} right now: ${parts.join(', ')}. (Open-Meteo)`, TTL_AIR);
  }

  // 8. MARKETS (v52)
  const quoteAsk = parseQuoteAsk(message);
  if (quoteAsk) {
    const tk = TICKERS[quoteAsk.name];
    const key = `q:${tk.sym}`;
    const hit = cached(key);
    if (hit) return hit;
    const q = await sources.quote(tk.sym);
    if (!q) return 'I couldn\'t reach the market feed just now — try me again in a moment.';
    const unit = tk.unit ? ` ${tk.unit}` : '';
    return remember(
      key,
      `${tk.label} right now: ${fmtMoney(q.price)} ${q.currency}${unit}. (Yahoo Finance — markets move, treat this as a snapshot.)`,
      TTL_QUOTE,
    );
  }

  // 9. HOLIDAYS (v52 — country resolved through the same atlas, home is SA)
  const hol = parseHolidaysAsk(message);
  if (hol) {
    const country = hol.country || 'south africa';
    const today = todayInTZ('Africa/Johannesburg');
    const todayISO = `${today.y}-${String(today.m).padStart(2, '0')}-${String(today.d).padStart(2, '0')}`;
    const key = `h:${hol.next ? 'next' : 'list'}:${country}:${todayISO}`;
    const hit = cached(key);
    if (hit) return hit;
    const rows = await sources.holidays(country);
    if (rows === 'unknown') {
      return `I couldn't find a public-holiday calendar for "${country}" — try the country's common name, like "public holidays in south africa".`;
    }
    if (rows === null) return 'I couldn\'t reach the holiday calendar just now — try me again in a moment.';
    const upcoming = rows.filter((r) => r.date >= todayISO);
    if (!upcoming.length) {
      return `The holiday calendar has nothing coming up for ${titleCase(country)} — either it's a quiet stretch or the calendar is.`;
    }
    if (hol.next) {
      const h = upcoming[0];
      const days = daysUntil(h.date, today);
      const when = days === 0 ? "that's today!" : days === 1 ? "that's tomorrow!" : `${days} days away`;
      return remember(
        key,
        `The next public holiday in ${titleCase(country)} is ${h.name} on ${niceDate(h.date, today.y)} — ${when} (Nager.Date)`,
        TTL_HOLIDAYS,
      );
    }
    const lines = upcoming.slice(0, 5)
      .map((h, i) => `${i + 1}. ${niceDate(h.date, today.y)} — ${h.name}`).join('\n');
    return remember(
      key,
      `Public holidays coming up in ${titleCase(country)}:\n${lines}\n(Nager.Date)`,
      TTL_HOLIDAYS,
    );
  }

  // 10. THIS DAY (v52 — Wikipedia's curated on-this-day feed)
  if (parseThisDayAsk(message)) {
    const today = todayInTZ('Africa/Johannesburg');
    const key = `d:${today.m}-${today.d}`;
    const hit = cached(key);
    if (hit) return hit;
    const events = await sources.onThisDay(today.m, today.d);
    if (events === null) return 'I couldn\'t reach the history books just now — try me again in a moment.';
    if (!events.length) return 'The history feed came back empty for today — try me again in a moment.';
    // The feed leads with its most notable picks — keep its top 5, then read
    // them oldest-first so the reply tells time forward.
    const picks = events.slice(0, 5).sort((a, b) => a.year - b.year);
    const lines = picks.map((e) => `${e.year} — ${e.text}`).join('\n');
    return remember(
      key,
      `On this day (${today.d} ${MONTH_NAMES[today.m - 1]}) in history:\n${lines}\n(Wikipedia)`,
      TTL_THIS_DAY,
    );
  }

  return null;
}
