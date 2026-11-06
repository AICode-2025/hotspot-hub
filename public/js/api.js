// 数据访问层：v1（Cloudflare Worker）/ legacy（本地 Node）/ 静态快照三级降级
import { $ } from "./ui.js";

const TIMEOUT = 10000;

export const state = {
  mode: "probing",       // probing | live | legacy | static | error
  base: "",
  sources: [],
  cats: [],
  boards: new Map(),     // id -> normalized board
  digest: null,
  digestDates: [],
  timeline: null,
  metrics: null,
  media: null,
  health: null,
  snapshotAt: null,
  lastError: "",
};

export class ApiError extends Error {
  constructor(kind, message, code = "") {
    super(message);
    this.kind = kind; // timeout | http | parse | offline | unsupported
    this.code = code;
  }
}

function resolveBase() {
  const q = new URLSearchParams(location.search).get("api");
  if (q) return q.replace(/\/$/, "");
  if (window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
  const meta = document.querySelector('meta[name="api-base"]')?.content?.trim();
  if (meta) return meta.replace(/\/$/, "");
  return ""; // 同源
}

async function request(path, { timeout = TIMEOUT, retry = 1 } = {}) {
  const url = `${state.base}${path}`;
  let lastErr;
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      if (!navigator.onLine) throw new ApiError("offline", "当前处于离线状态");
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new ApiError("http", `上游返回 ${res.status}`, String(res.status));
      const json = await res.json();
      return json;
    } catch (e) {
      lastErr = e instanceof ApiError ? e
        : e?.name === "TimeoutError" ? new ApiError("timeout", "请求超时")
        : e?.name === "SyntaxError" ? new ApiError("parse", "返回内容不是合法 JSON")
        : new ApiError("http", e?.message || "网络错误");
      if (attempt < retry) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/* ---------------- 初始化与探测 ---------------- */

export async function init() {
  state.base = resolveBase();
  try {
    const meta = await request("/api/v1/meta", { timeout: 6000, retry: 0 });
    if (meta?.code === 200 && meta.data?.sources) {
      state.mode = "live";
      state.cats = meta.data.cats || [];
      state.sources = meta.data.sources || [];
      state.snapshotAt = meta.data.deployedAt || null;
      return state;
    }
    throw new ApiError("parse", "接口结构不符合预期");
  } catch (e) {
    try {
      const legacy = await request("/api/sources", { timeout: 6000, retry: 0 });
      if (legacy?.code === 200 && legacy.data?.sources) {
        state.mode = "legacy";
        state.cats = legacy.data.cats || [];
        state.sources = legacy.data.sources || [];
        return state;
      }
      throw new ApiError("parse", "旧接口结构异常");
    } catch {
      await loadSnapshot();
      if (state.mode === "static") return state;
      state.mode = "error";
      state.lastError = e?.message || "无法连接数据服务";
      return state;
    }
  }
}

async function loadSnapshot() {
  try {
    const res = await fetch(`./demo.json?t=${Date.now()}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    const demo = await res.json();
    state.mode = "static";
    state.cats = demo.cats || [];
    state.sources = demo.sources || [];
    state.digest = normalizeDigest(demo.digest);
    state.timeline = demo.timeline || null;
    state.snapshotAt = demo.generatedAt || null;
    state.boards = new Map();
    for (const s of state.sources) {
      const raw = demo.boards?.[s.id];
      state.boards.set(s.id, normalizeBoard(s, raw?.data || raw));
    }
  } catch (e) {
    state.mode = "error";
    state.lastError = `快照读取失败：${e.message}`;
  }
}

/* ---------------- 归一化 ---------------- */

export function normalizeBoard(source, raw) {
  if (!raw) {
    return {
      id: source.id, name: source.name, cat: source.cat,
      status: "unavailable", reason: "该源尚未返回数据", adapter: "", updated: "", items: [], trends: {},
    };
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    id: source.id,
    name: source.name || raw.name || source.id,
    cat: source.cat || raw.cat || "",
    status: raw.status === "unavailable" || !items.length ? "unavailable" : "ok",
    reason: raw.reason || raw.error || "",
    adapter: raw.adapter || "",
    updated: raw.updated || "",
    items: items.map((it) => ({ title: it.title, url: it.url || "", hot: it.hot ?? null })),
    trends: raw.trends || {},
  };
}

function normalizeDigest(raw) {
  if (!raw || !Array.isArray(raw.news)) return null;
  return {
    date: raw.date || "",
    news: raw.news.map((x) => (typeof x === "string" ? x : x?.title || "")).filter(Boolean),
    tip: raw.tip || "",
    image: raw.image || raw.cover || "",
    link: raw.link || "",
    lunar: raw.lunar_date || "",
    week: raw.day_of_week || "",
    updated: raw.updated || "",
  };
}

/* ---------------- 业务接口 ---------------- */

export async function fetchDigest(date) {
  if (state.mode === "static") return { digest: state.digest, dates: [] };

  if (state.mode === "live") {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    const json = await request(`/api/v1/digest${qs}`, { timeout: 9000 });
    if (json?.code !== 200) throw new ApiError("http", json?.message || "日报接口异常");
    return { digest: normalizeDigest(json.data?.digest || json.data), dates: json.data?.dates || [] };
  }

  const json = await request("/api/60s/60s", { timeout: 9000 });
  if (json?.code !== 200) throw new ApiError("http", "60s 日报接口异常");
  return { digest: normalizeDigest(json.data), dates: [] };
}

function emitBoards(list) {
  try {
    window.dispatchEvent(new CustomEvent("hotspot:boards", { detail: { count: list.length } }));
  } catch { /* 忽略事件异常 */ }
  return list;
}

export async function fetchBoards({ cat = "", ids = [] } = {}) {
  if (state.mode === "static") {
    const out = ids.length
      ? ids.map((id) => state.boards.get(id)).filter(Boolean)
      : [...state.boards.values()];
    return emitBoards(out);
  }

  if (state.mode === "live") {
    const qs = new URLSearchParams();
    if (cat) qs.set("cat", cat);
    if (ids.length) qs.set("ids", ids.join(","));
    const json = await request(`/api/v1/boards?${qs}`, { timeout: 15000 });
    if (json?.code !== 200) throw new ApiError("http", json?.message || "榜单接口异常");
    const list = json.data?.boards || [];
    return emitBoards(list.map((b) => {
      const src = state.sources.find((s) => s.id === b.id) || b;
      const norm = normalizeBoard(src, b);
      state.boards.set(b.id, norm);
      return norm;
    }));
  }

  // legacy：并发池逐个拉取
  const targets = ids.length
    ? state.sources.filter((s) => ids.includes(s.id))
    : cat ? state.sources.filter((s) => s.cat === cat) : state.sources;

  const queue = [...targets];
  const out = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      try {
        const json = await request(`/api/board/${s.id}?limit=30`, { timeout: 12000 });
        const norm = json?.code === 200
          ? normalizeBoard(s, json.data)
          : { ...normalizeBoard(s, null), reason: json?.message || "接口返回异常" };
        state.boards.set(s.id, norm);
        out.push(norm);
      } catch (e) {
        const norm = { ...normalizeBoard(s, null), reason: e.message };
        state.boards.set(s.id, norm);
        out.push(norm);
      }
    }
  }));
  return emitBoards(out);
}

export async function fetchTrend(id, title, hours = 6) {
  if (state.mode === "static") {
    const b = state.boards.get(id);
    return { points: [], note: b ? "静态快照无历史序列" : "该源无数据" };
  }
  if (state.mode === "live") {
    const qs = new URLSearchParams({ id, title, hours: String(hours) });
    const json = await request(`/api/v1/trends?${qs}`, { timeout: 9000 });
    if (json?.code !== 200) throw new ApiError("http", json?.message || "走势接口异常");
    return { points: json.data?.points || [], note: json.data?.note || "" };
  }
  const json = await request(`/api/topic?id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`, { timeout: 9000 });
  return { points: json?.data?.points || [], note: "" };
}

export async function fetchTimeline() {
  if (state.mode === "static") return state.timeline;
  const path = state.mode === "live" ? "/api/v1/timeline" : "/api/timeline";
  const json = await request(path, { timeout: 12000 });
  return json?.data || null;
}

export async function fetchHealth() {
  if (state.mode === "static") {
    const ok = [...state.boards.values()].filter((b) => b.status === "ok");
    return {
      ok: true, total: state.sources.length, available: ok.map((b) => b.id),
      unavailable: state.sources.filter((s) => !ok.some((b) => b.id === s.id)).map((s) => s.id),
      snapshotAt: state.snapshotAt, static: true,
    };
  }
  const path = state.mode === "live" ? "/api/v1/health" : "/api/health";
  return request(path, { timeout: 9000 });
}

export async function fetchMetrics() {
  if (state.mode !== "live") throw new ApiError("unsupported", "该数据需要新版接口（Cloudflare Worker）");
  const json = await request("/api/v1/metrics", { timeout: 15000 });
  if (json?.code !== 200) throw new ApiError("http", json?.message || "指标接口异常");
  return json.data;
}

export async function fetchMedia() {
  if (state.mode !== "live") throw new ApiError("unsupported", "该数据需要新版接口（Cloudflare Worker）");
  const json = await request("/api/v1/media", { timeout: 15000 });
  if (json?.code !== 200) throw new ApiError("http", json?.message || "影视榜接口异常");
  return json.data;
}

export function modeLabel() {
  return { live: "实时", legacy: "本地服务", static: "静态快照", error: "不可用", probing: "检测中" }[state.mode] || "未知";
}

export function searchAll(q, kwMatcher) {
  const hits = [];
  for (const b of state.boards.values()) {
    if (b.status !== "ok") continue;
    b.items.forEach((it, i) => {
      if (kwMatcher(it.title)) hits.push({ ...it, source: b.name, sourceId: b.id, rank: i + 1, trends: b.trends });
    });
  }
  return hits;
}
