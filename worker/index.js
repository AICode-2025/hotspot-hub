// Cloudflare Worker：热点晨报 API v1 + D1 持久化 + Cron 采集
import {
  CATS, SOURCES, S60_INSTANCES, NEWSNOW_BASES, RSS_MAP,
  METRIC_ENDPOINTS, MEDIA_ENDPOINTS,
} from "./sources.js";

const VERSION = "2.0.0";
const UA = "Mozilla/5.0 (compatible; hotspot-hub/2.0; +https://github.com/AICode-2025/hotspot-hub)";
const REFRESH_MS = 8 * 60 * 1000;   // 单源最长复用时间
const REQUEST_BUDGET = 16;          // 单次请求最多实时抓取的源数（控制 subrequest）
const KEEP_SNAPSHOTS = 48;          // 每源保留批次数
const KEEP_DAYS = 90;

/* ============================ 基础工具 ============================ */

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

const ok = (data, extra) => json({ code: 200, message: "ok", data }, 200, extra);
const fail = (message, code = 502) => json({ code, message }, code);

function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allow = String(env.ALLOW_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const hit = allow.includes(origin) ? origin : allow[0] || "*";
  return {
    "access-control-allow-origin": hit,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

async function fetchJson(url, timeout = 8000, headers = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { "user-agent": UA, accept: "application/json", ...headers },
    cf: { cacheTtl: 60, cacheEverything: false },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${new URL(url).host}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(`invalid json @ ${new URL(url).host}`); }
}

async function fetchText(url, timeout = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* ============================ 适配器 ============================ */

function pickInstance(seed = 0) {
  return S60_INSTANCES[Math.abs(seed) % S60_INSTANCES.length];
}

async function fetch60s(endpoint, seed = 0) {
  let lastErr;
  // 先试轮转实例，再试第一个，最多 2 次，控制 subrequest
  for (const base of [pickInstance(seed), S60_INSTANCES[0]]) {
    try {
      const data = await fetchJson(`${base}/v2/${endpoint}?encoding=json`, 9000);
      if (data?.code === 200 && Array.isArray(data.data)) {
        return {
          items: data.data.map((it) => ({
            title: stripHtml(it.title || it.name || it.content || ""),
            url: it.link || it.url || "",
            hot: it.hot_value ?? it.hot ?? it.score ?? null,
          })).filter((x) => x.title),
          adapter: "s60",
          updated: data.updated || "",
          raw: data,
        };
      }
      if (data?.status === 200 && Array.isArray(data.data)) {
        return {
          items: data.data.map((it) => ({
            title: stripHtml(it.title || it.name || ""),
            url: it.url || it.link || "",
            hot: it.hot ?? it.play ?? null,
          })).filter((x) => x.title),
          adapter: "s60",
          updated: data.update_time || "",
          raw: data,
        };
      }
      throw new Error(`business code ${data?.code ?? data?.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function fetch60sRaw(endpoint, seed = 0) {
  let lastErr;
  for (const base of [pickInstance(seed), S60_INSTANCES[0]]) {
    try {
      const data = await fetchJson(`${base}/v2/${endpoint}?encoding=json`, 9000);
      if (data?.code === 200) return data;
      throw new Error(`business code ${data?.code}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function fetchNewsnow(id) {
  let lastErr;
  for (const base of NEWSNOW_BASES) {
    try {
      const data = await fetchJson(`${base}/api/s?id=${encodeURIComponent(id)}`, 8000);
      if (!Array.isArray(data.items)) throw new Error("bad payload");
      return {
        items: data.items.map((it) => ({
          title: stripHtml(it.title || ""),
          url: it.mobileUrl || it.url || "",
          hot: null,
        })).filter((x) => x.title),
        adapter: "newsnow",
        updated: data.updatedTime ? new Date(data.updatedTime).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "",
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function fetchHN() {
  const data = await fetchJson("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30");
  return {
    items: (data.hits || []).map((h) => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      hot: h.points ?? null,
    })),
    adapter: "hn",
    updated: "",
  };
}

async function fetchGithub() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const data = await fetchJson(`https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=20`);
  return {
    items: (data.items || []).map((r) => ({
      title: `${r.full_name} — ${r.description || ""}`.trim(),
      url: r.html_url,
      hot: r.stargazers_count ?? null,
    })),
    adapter: "github",
    updated: "",
  };
}

async function fetchWscn() {
  const data = await fetchJson("https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=30");
  return {
    items: (data?.data?.items || []).map((it) => ({
      title: stripHtml(it.content_text || it.title || "").slice(0, 120),
      url: it.uri || "",
      hot: null,
    })).filter((x) => x.title),
    adapter: "wscn",
    updated: "",
  };
}

function parseRss(xml, limit = 30) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, limit)) {
    const title = stripHtml((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]?.trim() || "";
    if (title) items.push({ title, url: link, hot: null });
  }
  return items;
}

async function fetchRss(key) {
  const url = RSS_MAP[key] || key;
  const xml = await fetchText(url, 9000);
  return { items: parseRss(xml), adapter: "rss", updated: "" };
}

const ADAPTERS = {
  s60: (ep, seed) => fetch60s(ep, seed),
  newsnow: (id) => fetchNewsnow(id),
  hn: () => fetchHN(),
  github: () => fetchGithub(),
  wscn: () => fetchWscn(),
  rss: (key) => fetchRss(key),
};

async function loadBoard(source) {
  let lastErr;
  const seed = [...source.id].reduce((n, c) => n + c.charCodeAt(0), 0);
  for (const spec of source.adapters) {
    const idx = spec.indexOf(":");
    const kind = idx === -1 ? spec : spec.slice(0, idx);
    const arg = idx === -1 ? "" : spec.slice(idx + 1);
    try {
      const r = await ADAPTERS[kind](arg, seed);
      if (!r?.items?.length) throw new Error("empty board");
      return { ...r, items: r.items.slice(0, 30) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no adapter");
}

/* ============================ D1 ============================ */

async function db(env) {
  if (!env.DB) throw new Error("D1 binding missing");
  return env.DB;
}

async function latestSnapshots(env, ids) {
  if (!env.DB || !ids.length) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT s.id, s.source, s.taken_at, s.adapter, s.item_count
     FROM snapshots s
     JOIN (SELECT source, MAX(taken_at) AS t FROM snapshots WHERE source IN (${placeholders}) GROUP BY source) m
       ON s.source = m.source AND s.taken_at = m.t`
  ).bind(...ids).all();

  const map = new Map();
  const snaps = rows.results || [];
  if (!snaps.length) return map;

  const snapIds = snaps.map((s) => s.id);
  const itemRows = await env.DB.prepare(
    `SELECT snapshot_id, rank, title, url, hot FROM items WHERE snapshot_id IN (${snapIds.map(() => "?").join(",")}) ORDER BY snapshot_id, rank`
  ).bind(...snapIds).all();

  const byId = new Map();
  for (const it of itemRows.results || []) {
    if (!byId.has(it.snapshot_id)) byId.set(it.snapshot_id, []);
    byId.get(it.snapshot_id).push({ title: it.title, url: it.url, hot: it.hot });
  }
  for (const s of snaps) {
    map.set(s.source, {
      taken_at: s.taken_at,
      adapter: s.adapter,
      items: byId.get(s.id) || [],
    });
  }
  return map;
}

async function previousRankMap(env, source, beforeTs) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id FROM snapshots WHERE source = ? AND taken_at < ? ORDER BY taken_at DESC LIMIT 1`
  ).bind(source, beforeTs).first();
  if (!row) return null;
  const rows = await env.DB.prepare(`SELECT title, rank FROM items WHERE snapshot_id = ?`).bind(row.id).all();
  const map = new Map();
  for (const r of rows.results || []) map.set(r.title, r.rank);
  return map;
}

function computeTrends(items, prev) {
  if (!prev) return {};
  const out = {};
  items.forEach((it, i) => {
    const rank = i + 1;
    const old = prev.get(it.title);
    if (old == null) out[it.title] = { isNew: true };
    else out[it.title] = { delta: old - rank };
  });
  return out;
}

async function saveSnapshot(env, source, board) {
  if (!env.DB) return;
  const dbh = await db(env);
  const now = Date.now();
  const res = await dbh.prepare(
    `INSERT INTO snapshots (source, taken_at, adapter, item_count) VALUES (?, ?, ?, ?)`
  ).bind(source.id, now, board.adapter || "", board.items.length).run();
  const snapId = res.meta?.last_row_id;
  if (!snapId) return;

  const stmts = board.items.map((it, i) =>
    dbh.prepare(`INSERT INTO items (snapshot_id, rank, title, url, hot) VALUES (?, ?, ?, ?, ?)`)
      .bind(snapId, i + 1, it.title, it.url || "", it.hot == null ? null : String(it.hot)));
  if (stmts.length) await dbh.batch(stmts);

  await dbh.prepare(
    `DELETE FROM snapshots WHERE source = ? AND id NOT IN (SELECT id FROM snapshots WHERE source = ? ORDER BY taken_at DESC LIMIT ?)`
  ).bind(source.id, source.id, KEEP_SNAPSHOTS).run();

  await dbh.prepare(
    `INSERT INTO source_health (source, ok, adapter, items, latency_ms, checked_at, error)
     VALUES (?, 1, ?, ?, ?, ?, '')
     ON CONFLICT(source) DO UPDATE SET ok=1, adapter=excluded.adapter, items=excluded.items,
       latency_ms=excluded.latency_ms, checked_at=excluded.checked_at, error=''`
  ).bind(source.id, board.adapter || "", board.items.length, 0, now).run();
}

async function markHealth(env, source, error) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO source_health (source, ok, adapter, items, latency_ms, checked_at, error)
       VALUES (?, 0, '', 0, 0, ?, ?)
       ON CONFLICT(source) DO UPDATE SET ok=0, error=excluded.error, checked_at=excluded.checked_at`
    ).bind(source.id, Date.now(), String(error).slice(0, 160)).run();
  } catch { /* 忽略健康写入失败 */ }
}

async function saveDigest(env, digest) {
  if (!env.DB || !digest?.news?.length) return;
  await env.DB.prepare(
    `INSERT INTO digests (date, news_json, tip, image, cover, lunar, week, link, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET news_json=excluded.news_json, tip=excluded.tip,
       image=excluded.image, cover=excluded.cover, lunar=excluded.lunar, week=excluded.week,
       link=excluded.link, fetched_at=excluded.fetched_at`
  ).bind(
    digest.date, JSON.stringify(digest.news), digest.tip || "", digest.image || "", digest.cover || "",
    digest.lunar || "", digest.week || "", digest.link || "", Date.now()
  ).run();
}

async function readDigest(env, date) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT * FROM digests WHERE date = ?`).bind(date).first();
  if (!row) return null;
  return {
    date: row.date,
    news: JSON.parse(row.news_json || "[]"),
    tip: row.tip, image: row.image || row.cover, cover: row.cover,
    lunar: row.lunar, week: row.week, link: row.link,
  };
}

async function digestDates(env) {
  if (!env.DB) return [];
  const rows = await env.DB.prepare(`SELECT date FROM digests ORDER BY date DESC LIMIT 30`).all();
  return (rows.results || []).map((r) => r.date);
}

async function saveMetrics(env, key, value, raw) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT OR REPLACE INTO metrics (key, ts, value, raw_json) VALUES (?, ?, ?, ?)`)
    .bind(key, Date.now(), value, JSON.stringify(raw)).run();
  await env.DB.prepare(`DELETE FROM metrics WHERE key = ? AND ts < ?`).bind(key, Date.now() - 30 * 864e5).run();
}

async function readMetrics(env, key) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT * FROM metrics WHERE key = ? ORDER BY ts DESC LIMIT 1`).bind(key).first();
  if (!row) return null;
  try { return { value: row.value, ts: row.ts, raw: JSON.parse(row.raw_json || "null") }; } catch { return null; }
}

async function saveMedia(env, board, list) {
  if (!env.DB || !list?.length) return;
  const dbh = await db(env);
  const ts = Date.now();
  const stmts = list.slice(0, 20).map((m, i) =>
    dbh.prepare(`INSERT OR REPLACE INTO media_rank (board, ts, rank, title, score, url) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(board, ts, i + 1, m.title, String(m.score ?? ""), m.url || ""));
  await dbh.batch(stmts);
  await dbh.prepare(`DELETE FROM media_rank WHERE board = ? AND ts < ?`).bind(board, ts - 7 * 864e5).run();
}

/* ============================ 归一化 ============================ */

function normalizeDigest(raw) {
  const d = raw?.data || raw;
  if (!d) return null;
  const news = (d.news || []).map((x) => (typeof x === "string" ? x : x?.title || "")).filter(Boolean);
  if (!news.length) return null;
  return {
    date: d.date || new Date().toISOString().slice(0, 10),
    news,
    tip: stripHtml(d.tip || ""),
    image: d.image || "",
    cover: d.cover || "",
    lunar: d.lunar_date || "",
    week: d.day_of_week || "",
    link: d.link || "",
  };
}

function toBoard(source, snapshot, trends = {}) {
  return {
    id: source.id,
    name: source.name,
    cat: source.cat,
    adapter: snapshot.adapter || "",
    updated: snapshot.taken_at ? new Date(snapshot.taken_at).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "",
    status: snapshot.items?.length ? "ok" : "unavailable",
    trends,
    items: (snapshot.items || []).map((it) => ({ title: it.title, url: it.url, hot: it.hot })),
    takenAt: snapshot.taken_at || null,
  };
}

/* ============================ 路由 ============================ */

async function handleMeta(env) {
  return ok({
    cats: CATS,
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, cat: s.cat, adapters: s.adapters })),
    version: VERSION,
    deployedAt: env.DEPLOYED_AT || null,
    endpoints: ["meta", "boards", "board/:id", "digest", "trends", "timeline", "metrics", "media", "sources", "health"],
  });
}

async function handleBoards(env, url, request) {
  const cat = url.searchParams.get("cat") || "";
  const ids = (url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10) || 30, 50);

  let targets = SOURCES;
  if (ids.length) targets = targets.filter((s) => ids.includes(s.id));
  else if (cat && cat !== "全部") targets = targets.filter((s) => s.cat === cat);

  const snapMap = await latestSnapshots(env, targets.map((s) => s.id)).catch(() => new Map());
  const budget = { left: ids.length ? Math.min(ids.length, 8) : REQUEST_BUDGET };
  const now = Date.now();

  const results = await Promise.all(targets.map(async (source) => {
    const cached = snapMap.get(source.id);
    const fresh = cached && now - cached.taken_at < REFRESH_MS && cached.items.length;

    if (!fresh) {
      if (budget.left > 0) {
        budget.left -= 1;
        const started = Date.now();
        try {
          const board = await loadBoard(source);
          await saveSnapshot(env, source, board).catch(() => {});
          if (cached) {
            const prev = await previousRankMap(env, source.id, now).catch(() => null);
            const trends = prev ? computeTrends(board.items, prev) : {};
            return toBoard(source, { ...board, taken_at: now }, trends);
          }
          return toBoard(source, { ...board, taken_at: now });
        } catch (e) {
          await markHealth(env, source, e.message);
          if (cached) return toBoard(source, cached);
          return {
            id: source.id, name: source.name, cat: source.cat, status: "unavailable",
            reason: e.message, adapter: "", updated: "", items: [], trends: {},
          };
        }
      }
      if (cached) {
        const prev = await previousRankMap(env, source.id, cached.taken_at).catch(() => null);
        return toBoard(source, cached, computeTrends(cached.items, prev));
      }
      return {
        id: source.id, name: source.name, cat: source.cat, status: "unavailable",
        reason: "等待首轮采集（Cron 每 10 分钟）", adapter: "", updated: "", items: [], trends: {},
      };
    }

    const prev = await previousRankMap(env, source.id, cached.taken_at).catch(() => null);
    const board = toBoard(source, cached, computeTrends(cached.items, prev));
    board.items = board.items.slice(0, limit);
    return board;
  }));

  return ok({ boards: results, generatedAt: now, cat: cat || "全部" });
}

async function handleBoard(env, id) {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) return fail("未知数据源", 404);
  try {
    const board = await loadBoard(source);
    await saveSnapshot(env, source, board).catch(() => {});
    return ok(toBoard(source, { ...board, taken_at: Date.now() }));
  } catch (e) {
    const snapMap = await latestSnapshots(env, [id]).catch(() => new Map());
    const cached = snapMap.get(id);
    if (cached) return ok(toBoard(source, cached));
    return fail(`上游不可用：${e.message}`, 502);
  }
}

async function handleDigest(env, url) {
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  let digest = await readDigest(env, date).catch(() => null);
  if (!digest) {
    try {
      const raw = await fetch60sRaw("60s");
      const norm = normalizeDigest(raw);
      if (norm) {
        digest = norm;
        await saveDigest(env, norm);
      }
    } catch { /* 交给前端展示空态 */ }
  }
  const dates = await digestDates(env).catch(() => []);
  return ok({ digest, dates, date });
}

async function handleTrends(env, url) {
  const id = url.searchParams.get("id") || "";
  const title = url.searchParams.get("title") || "";
  const hours = Math.min(parseInt(url.searchParams.get("hours") || "6", 10) || 6, 48);
  if (!env.DB) return ok({ id, title, points: [], note: "D1 未绑定，无法提供历史序列" });
  const since = Date.now() - hours * 3600e3;
  const rows = await env.DB.prepare(
    `SELECT s.taken_at, i.rank FROM items i
     JOIN snapshots s ON s.id = i.snapshot_id
     WHERE s.source = ? AND i.title = ? AND s.taken_at >= ?
     ORDER BY s.taken_at ASC`
  ).bind(id, title, since).all();
  const points = (rows.results || []).map((r) => ({ t: r.taken_at, rank: r.rank }));
  return ok({ id, title, points, note: points.length < 2 ? "该话题的有效快照不足 2 个" : "" });
}

async function handleTimeline(env) {
  if (!env.DB) return ok({ batches: [] });
  const rows = await env.DB.prepare(
    `SELECT id, source, taken_at, item_count FROM snapshots WHERE taken_at >= ? ORDER BY taken_at DESC LIMIT 240`
  ).bind(Date.now() - 12 * 3600e3).all();

  const buckets = new Map();
  for (const r of rows.results || []) {
    const t = Math.floor(r.taken_at / (10 * 60e3)) * 10 * 60e3;
    if (!buckets.has(t)) buckets.set(t, { t, sources: [], events: [] });
    buckets.get(t).sources.push({ id: r.source, name: SOURCES.find((s) => s.id === r.source)?.name || r.source, count: r.item_count });
  }
  const batches = [...buckets.values()].sort((a, b) => b.t - a.t).slice(0, 12);
  return ok({ batches });
}

async function buildMetrics(env) {
  const out = {};
  const gold = await readMetrics(env, "gold");
  if (gold) {
    const raw = gold.raw || {};
    out.gold = {
      value: raw.price ?? gold.value,
      unit: raw.unit || "元/克",
      name: raw.name || "黄金",
      change: typeof raw.change === "number" ? raw.change : undefined,
      updated: gold.ts,
    };
  }
  const oil = await readMetrics(env, "oil");
  if (oil) out.oil = { items: oil.raw?.items || [], updated: oil.ts };
  const fx = await readMetrics(env, "exchange");
  if (fx) out.exchange = { rates: fx.raw?.rates || [], updated: fx.ts };
  const weather = await readMetrics(env, "weather");
  if (weather) out.weather = { now: weather.raw?.now || null, forecast: weather.raw?.forecast || [] };
  const history = await readMetrics(env, "history");
  if (history) out.history = { items: history.raw?.items || [] };
  const epic = await readMetrics(env, "epic");
  if (epic) out.epic = { items: epic.raw?.items || [] };
  const ai = await readMetrics(env, "aiNews");
  if (ai) out.aiNews = { items: ai.raw?.items || [] };
  const it = await readMetrics(env, "itNews");
  if (it) out.itNews = { items: it.raw?.items || [] };
  return out;
}

async function handleMetrics(env, url) {
  if (url.searchParams.get("refresh") === "1") await collectMetrics(env).catch(() => {});
  const data = await buildMetrics(env);
  if (!Object.keys(data).length) {
    await collectMetrics(env).catch(() => {});
    return ok(await buildMetrics(env));
  }
  return ok(data);
}

async function readMedia(env) {
  if (!env.DB) return {};
  const rows = await env.DB.prepare(
    `SELECT m.board, m.rank, m.title, m.score, m.url
     FROM media_rank m
     JOIN (SELECT board, MAX(ts) AS t FROM media_rank GROUP BY board) x
       ON m.board = x.board AND m.ts = x.t
     ORDER BY m.board, m.rank`
  ).all();
  const data = {};
  for (const r of rows.results || []) {
    const [group, key] = r.board.split(".");
    data[group] ||= {};
    data[group][key] ||= [];
    data[group][key].push({ title: r.title, score: r.score, url: r.url, rank: r.rank });
  }
  return data;
}

async function handleMedia(env, url) {
  if (!env.DB) return ok({});
  if (url.searchParams.get("refresh") === "1") await collectMedia(env).catch(() => {});
  let data = await readMedia(env);
  if (!Object.keys(data).length) {
    await collectMedia(env).catch(() => {});
    data = await readMedia(env);
  }
  return ok(data);
}

async function handleSources(env) {
  if (!env.DB) {
    return ok({ sources: SOURCES.map((s) => ({ id: s.id, name: s.name, cat: s.cat, ok: null, items: 0 })) });
  }
  const rows = await env.DB.prepare(`SELECT * FROM source_health`).all();
  const map = new Map((rows.results || []).map((r) => [r.source, r]));
  return ok({
    sources: SOURCES.map((s) => {
      const h = map.get(s.id);
      return {
        id: s.id, name: s.name, cat: s.cat,
        ok: h ? !!h.ok : null,
        adapter: h?.adapter || "",
        items: h?.items || 0,
        checkedAt: h?.checked_at || null,
        error: h?.error || "",
      };
    }),
  });
}

async function handleHealth(env) {
  const stats = env.DB
    ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM snapshots`).first().catch(() => null)
    : null;
  return ok({
    ok: true,
    version: VERSION,
    deployedAt: env.DEPLOYED_AT || null,
    sources: SOURCES.length,
    snapshots: stats?.n || 0,
    d1: Boolean(env.DB),
    ts: Date.now(),
  });
}

/* ============================ 采集任务 ============================ */

async function collectBoards(env, offset = 0, batch = 14) {
  const list = [];
  for (let i = 0; i < batch; i++) list.push(SOURCES[(offset + i) % SOURCES.length]);
  const queue = [...list];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      try {
        const board = await loadBoard(s);
        await saveSnapshot(env, s, board);
      } catch (e) {
        await markHealth(env, s, e.message);
      }
    }
  }));
  return list.length;
}

async function collectDigest(env) {
  const raw = await fetch60sRaw("60s");
  const norm = normalizeDigest(raw);
  if (norm) await saveDigest(env, norm);
  return Boolean(norm);
}

async function collectMetrics(env) {
  const [gold, oil, fx, wNow, wFc, history, epic, ai, it] = await Promise.allSettled([
    fetch60s(METRIC_ENDPOINTS.gold),
    fetch60s(METRIC_ENDPOINTS.oil),
    fetch60s(METRIC_ENDPOINTS.exchange),
    fetch60s(METRIC_ENDPOINTS.weatherNow),
    fetch60s(METRIC_ENDPOINTS.weatherForecast),
    fetch60s(METRIC_ENDPOINTS.history),
    fetch60s(METRIC_ENDPOINTS.epic),
    fetch60s(METRIC_ENDPOINTS.aiNews),
    fetch60s(METRIC_ENDPOINTS.itNews),
  ]);

  const grab = (r) => (r.status === "fulfilled" ? r.value.raw?.data ?? r.value.raw : null);

  const goldData = grab(gold);
  if (goldData) {
    const price = goldData.price ?? goldData.today_price ?? goldData.value;
    if (price != null) await saveMetrics(env, "gold", Number(price) || 0, {
      price, unit: goldData.unit || "元/克", name: goldData.name || "黄金",
      change: Number(goldData.change ?? 0) || undefined,
    });
  }
  const oilData = grab(oil);
  if (oilData) {
    const list = (Array.isArray(oilData) ? oilData : oilData.items || oilData.list || []).map((x) => ({
      name: x.name || x.province || x.region || "", price: x.price ?? x.p92 ?? x.value ?? "", unit: x.unit || "元/升",
    })).filter((x) => x.price !== "");
    if (list.length) await saveMetrics(env, "oil", 0, { items: list.slice(0, 20) });
  }
  const fxData = grab(fx);
  if (fxData) {
    const rates = (Array.isArray(fxData) ? fxData : fxData.rates || fxData.list || []).map((x) => ({
      code: x.currency || x.code || x.name || "", name: x.name || "", rate: x.rate ?? x.price ?? x.value ?? "",
    })).filter((x) => x.rate !== "");
    if (rates.length) await saveMetrics(env, "exchange", 0, { rates: rates.slice(0, 12) });
  }
  const nowData = grab(wNow);
  const fcData = grab(wFc);
  if (nowData || fcData) {
    const now = nowData ? {
      city: nowData.city || nowData.location || "",
      temp: nowData.temperature ?? nowData.temp ?? "",
      text: nowData.weather || nowData.text || "",
      humidity: nowData.humidity ?? "",
      wind: nowData.wind || nowData.winddirection || "",
      updated: nowData.updated || "",
    } : null;
    const forecast = (Array.isArray(fcData) ? fcData : fcData?.daily_forecast || fcData?.forecast || fcData?.list || []).map((f) => ({
      date: f.date || f.day || "",
      high: f.max_temperature ?? f.tempMax ?? f.high ?? f.max ?? "",
      low: f.min_temperature ?? f.tempMin ?? f.low ?? f.min ?? "",
      text: f.day_condition || f.weather || f.condition || f.text || "",
    }));
    await saveMetrics(env, "weather", 0, { now, forecast: forecast.slice(0, 7) });
  }
  const historyData = grab(history);
  if (historyData) {
    const items = (Array.isArray(historyData) ? historyData : historyData.items || historyData.list || []).map((h) => ({
      year: h.year || h.date || "", title: h.title || h.event || h.content || "",
    })).filter((h) => h.title);
    if (items.length) await saveMetrics(env, "history", 0, { items: items.slice(0, 10) });
  }
  const epicData = grab(epic);
  if (epicData) {
    const items = (Array.isArray(epicData) ? epicData : epicData.games || epicData.items || []).map((g) => ({
      title: g.title || g.name || "", url: g.url || g.link || "", freeUntil: g.end_date || g.freeUntil || "",
    })).filter((g) => g.title);
    if (items.length) await saveMetrics(env, "epic", 0, { items: items.slice(0, 6) });
  }
  const aiData = grab(ai);
  if (aiData) {
    const items = (Array.isArray(aiData) ? aiData : aiData.items || aiData.news || []).map((n) => ({
      title: n.title || n.content || "", url: n.link || n.url || "",
    })).filter((n) => n.title);
    if (items.length) await saveMetrics(env, "aiNews", 0, { items: items.slice(0, 10) });
  }
  const itData = grab(it);
  if (itData) {
    const items = (Array.isArray(itData) ? itData : itData.items || []).map((n) => ({
      title: n.title || n.name || "", url: n.link || n.url || "",
    })).filter((n) => n.title);
    if (items.length) await saveMetrics(env, "itNews", 0, { items: items.slice(0, 10) });
  }
}

async function collectMedia(env) {
  const entries = Object.entries(MEDIA_ENDPOINTS);
  const queue = [...entries];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const [board, ep] = queue.shift() || [];
      if (!board) return;
      try {
        const r = await fetch60s(ep);
        const list = (r.items || []).map((it) => ({
          title: it.title,
          url: it.url,
          score: it.hot != null ? String(it.hot) : "",
        }));
        if (list.length) await saveMedia(env, board, list);
      } catch { /* 单个榜单失败不影响其他 */ }
    }
  }));
}

/* ============================ 入口 ============================ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (!url.pathname.startsWith("/api/")) {
      return new Response("hotspot-api: use /api/v1/*", { status: 200, headers: { "content-type": "text/plain; charset=utf-8", ...cors } });
    }

    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached && request.method === "GET" && !url.searchParams.get("refresh")) {
      const res = new Response(cached.body, cached);
      Object.entries(cors).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    }

    let res;
    try {
      const p = url.pathname;
      if (p === "/api/v1/meta") res = await handleMeta(env);
      else if (p === "/api/v1/boards") res = await handleBoards(env, url, request);
      else if (p.match(/^\/api\/v1\/board\/[\w-]+$/)) res = await handleBoard(env, p.split("/").pop());
      else if (p === "/api/v1/digest") res = await handleDigest(env, url);
      else if (p === "/api/v1/trends") res = await handleTrends(env, url);
      else if (p === "/api/v1/timeline") res = await handleTimeline(env);
      else if (p === "/api/v1/metrics") res = await handleMetrics(env, url);
      else if (p === "/api/v1/media") res = await handleMedia(env, url);
      else if (p === "/api/v1/sources") res = await handleSources(env);
      else if (p === "/api/v1/health") res = await handleHealth(env);
      else res = fail("接口不存在", 404);
    } catch (e) {
      res = fail(`服务端错误：${e.message}`, 500);
    }

    const headers = new Headers(res.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
    headers.set("cache-control", "public, max-age=60, s-maxage=120");

    const out = new Response(res.body, { status: res.status, headers });
    if (request.method === "GET" && out.status === 200) ctx.waitUntil(cache.put(cacheKey, out.clone()));
    return out;
  },

  async scheduled(event, env, ctx) {
    const now = Date.now();
    const offset = Math.floor(now / (10 * 60e3)) * 14 % SOURCES.length;
    const tasks = [collectBoards(env, offset, 14)];
    tasks.push(collectDigest(env).catch(() => false));

    if (now % (30 * 60e3) < 10 * 60e3) tasks.push(collectMetrics(env).catch(() => {}));
    if (now % (60 * 60e3) < 10 * 60e3) tasks.push(collectMedia(env).catch(() => {}));

    ctx.waitUntil(Promise.allSettled(tasks));
  },
};
