// 浏览器直连 60s 公共实例（仅当后端未提供 /api/v1/metrics 时兜底）
// 60s 允许跨域：Access-Control-Allow-Origin: *

const BASES = [
  "https://60s.okbaike.com",
  "https://60api.09cdn.xyz",
  "https://60s.zeabur.app",
  "https://60s.tmini.net",
];
const TTL = 5 * 60 * 1000;

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(`hotspot.direct.${key}`);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return Date.now() - t < TTL ? v : null;
  } catch { return null; }
}
function cacheSet(key, v) {
  try { sessionStorage.setItem(`hotspot.direct.${key}`, JSON.stringify({ t: Date.now(), v })); } catch { /* 忽略配额 */ }
}

async function get(ep, { timeout = 7000, retry = 1 } = {}) {
  const key = ep;
  const hit = cacheGet(key);
  if (hit) return hit;
  let lastErr;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const base = BASES[attempt % BASES.length];
    try {
      const res = await fetch(`${base}/v2/${ep}?encoding=json`, {
        signal: AbortSignal.timeout(timeout),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json?.code !== 200) throw new Error(`business ${json?.code}`);
      cacheSet(key, json.data);
      return json.data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("60s 直连失败");
}

// 并发池：避免同时打 9 个请求触发公共实例限流
async function pool(tasks, size = 3) {
  const out = new Array(tasks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      try { out[idx] = { ok: true, value: await tasks[idx]() }; }
      catch (e) { out[idx] = { ok: false, error: e }; }
    }
  }));
  return out;
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export async function metrics() {
  const eps = ["gold-price", "fuel-price", "exchange-rate", "weather/realtime",
    "weather/forecast", "today-in-history", "epic", "ai-news", "it-news"];
  const results = await pool(eps.map((ep) => () => get(ep)), 3);
  const [gold, oil, fx, wNow, wFc, history, epic, ai, it] = results;
  const val = (r) => (r?.ok ? r.value : null);
  const out = {};

  const g = val(gold);
  const metal = g?.metals?.[0];
  if (metal) {
    out.gold = {
      value: num(metal.today_price) ?? num(metal.sell_price),
      unit: metal.unit || "元/克",
      name: metal.name || "今日金价",
      updated: metal.updated_at || metal.updated || "",
    };
  }
  const o = val(oil);
  if (o?.items?.length) {
    out.oil = {
      items: o.items.map((x) => ({ name: x.name, price: x.price, unit: (x.price_desc || "").replace(/[\d.\s]/g, "") || "元/升" })),
      updated: Date.now(),
      region: o.region,
      trend: o.trend?.description || "",
    };
  }
  const f = val(fx);
  if (f?.rates?.length) {
    out.exchange = {
      rates: f.rates
        .filter((r) => ["USD", "EUR", "JPY", "HKD", "GBP"].includes(r.currency))
        .map((r) => ({ code: r.currency, rate: r.rate })),
      updated: f.updated_at || f.updated || "",
      base: f.base_code || "CNY",
    };
  }
  const w = val(wNow);
  if (w?.weather) {
    out.weather = {
      now: {
        city: w.location?.city || w.location?.name || "",
        temp: w.weather.temperature,
        text: w.weather.condition || "",
        humidity: w.weather.humidity != null ? `${w.weather.humidity}%` : "",
        wind: [w.weather.wind_direction, w.weather.wind_power].filter(Boolean).join(" "),
      },
      forecast: [],
    };
  }
  const fc = val(wFc);
  if (fc) {
    const list = Array.isArray(fc) ? fc : fc.daily_forecast || fc.forecast || fc.days || [];
    out.weather = out.weather || { now: null };
    out.weather.forecast = list.slice(0, 5).map((d) => ({
      date: d.date || d.day || "",
      high: d.max_temperature ?? d.tempMax ?? d.high ?? d.max ?? "",
      low: d.min_temperature ?? d.tempMin ?? d.low ?? d.min ?? "",
      text: d.day_condition || d.condition || d.weather || d.text || "",
    }));
    if (!out.weather.now && fc.location?.city) out.weather.now = { city: fc.location.city };
  }
  const h = val(history);
  if (h?.items?.length) out.history = { items: h.items.slice(0, 10).map((x) => ({ year: x.year, title: x.title })) };
  const e = val(epic);
  if (Array.isArray(e) && e.length) {
    out.epic = {
      items: e.slice(0, 6).map((x) => ({
        title: x.title,
        url: x.url || x.link || (x.product_slug ? `https://store.epicgames.com/zh-CN/p/${x.product_slug}` : ""),
        freeUntil: x.free_end || x.end_date || x.free_until || "",
      })),
    };
  }
  const a = val(ai);
  if (a?.news?.length) out.aiNews = { items: a.news.slice(0, 8).map((x) => ({ title: x.title, url: x.link || "" })) };
  const i = val(it);
  if (i) {
    const list = Array.isArray(i) ? i : i.items || i.news || [];
    if (list.length) out.itNews = { items: list.slice(0, 8).map((x) => ({ title: x.title, url: x.link || x.url || "" })) };
  }
  if (!Object.keys(out).length) throw new Error("60s 直连未返回可用数据");
  return out;
}

const MEDIA = {
  "maoyan.allMovie": "maoyan/all/movie",
  "maoyan.realtimeMovie": "maoyan/realtime/movie",
  "maoyan.realtimeTv": "maoyan/realtime/tv",
  "maoyan.realtimeWeb": "maoyan/realtime/web",
  "douban.movie": "douban/weekly/movie",
  "douban.tv_chinese": "douban/weekly/tv_chinese",
  "douban.tv_global": "douban/weekly/tv_global",
  "douban.show_chinese": "douban/weekly/show_chinese",
  "douban.show_global": "douban/weekly/show_global",
  "baidu.teleplay": "baidu/teleplay",
};

export async function media() {
  const entries = Object.entries(MEDIA);
  const results = await pool(entries.map(([, ep]) => () => get(ep, { timeout: 6000, retry: 0 })), 5);
  const out = {};
  results.forEach((r, idx) => {
    if (!r?.ok || !Array.isArray(r.value) || !r.value.length) return;
    const [group, key] = entries[idx][0].split(".");
    out[group] ||= {};
    out[group][key] = r.value.slice(0, 12).map((x) => ({
      title: x.title || x.name || "",
      score: x.score ?? x.hot ?? x.box_office ?? "",
      url: x.url || x.link || "",
    })).filter((x) => x.title);
  });
  if (!Object.keys(out).length) throw new Error("影视榜接口本轮均不可用（常见于上游风控）");
  return out;
}
