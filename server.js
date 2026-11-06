import http from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, "public");
const HISTORY_FILE = path.join(__dirname, "data", "history.json");

// ---- 数据源注册表（覆盖 newsnow 全部源 + 60s 特色源） --------------------
// adapters: 按序尝试的适配器链，任一成功即返回（运行时自动探测可用通道）
//   s60:<ep>          60s API 端点（多公共实例故障转移）
//   newsnow:<id>      newsnow 实例（官方 + 公共中转兜底，可经 env 配置自部署实例）
//   hn / github / wscn / rss:<url>  上游直连适配器
const SOURCES = [
  // 国内
  { id: "weibo", name: "微博", cat: "国内", adapters: ["s60:weibo"] },
  { id: "zhihu", name: "知乎", cat: "国内", adapters: ["s60:zhihu"] },
  { id: "baidu", name: "百度", cat: "国内", adapters: ["s60:baidu", "newsnow:baidu"] },
  { id: "douyin", name: "抖音", cat: "国内", adapters: ["s60:douyin"] },
  { id: "toutiao", name: "今日头条", cat: "国内", adapters: ["s60:toutiao"] },
  { id: "kuaishou", name: "快手", cat: "国内", adapters: ["newsnow:kuaishou"] },
  { id: "bilibili", name: "哔哩哔哩", cat: "国内", adapters: ["s60:bili", "newsnow:bilibili"] },
  { id: "tieba", name: "百度贴吧", cat: "国内", adapters: ["s60:tieba", "newsnow:tieba"] },
  { id: "rednote", name: "小红书", cat: "国内", adapters: ["s60:rednote"] },
  { id: "thepaper", name: "澎湃新闻", cat: "国内", adapters: ["newsnow:thepaper"] },
  { id: "ifeng", name: "凤凰网", cat: "国内", adapters: ["newsnow:ifeng"] },
  { id: "tencent", name: "腾讯新闻", cat: "国内", adapters: ["newsnow:tencent"] },
  { id: "cankaoxiaoxi", name: "参考消息", cat: "国内", adapters: ["newsnow:cankaoxiaoxi"] },
  { id: "kaopu", name: "靠谱新闻", cat: "国内", adapters: ["newsnow:kaopu"] },
  { id: "chongbuluo", name: "冲不部落", cat: "国内", adapters: ["newsnow:chongbuluo"] },
  // 国际
  { id: "zaobao", name: "联合早报", cat: "国际", adapters: ["newsnow:zaobao"] },
  { id: "sputniknewscn", name: "卫星通讯社", cat: "国际", adapters: ["rss:sputnik", "newsnow:sputniknewscn"] },
  { id: "mktnews", name: "MktNews", cat: "国际", adapters: ["newsnow:mktnews"] },
  { id: "hackernews", name: "Hacker News", cat: "国际", adapters: ["hn", "newsnow:hackernews"] },
  { id: "producthunt", name: "Product Hunt", cat: "国际", adapters: ["newsnow:producthunt"] },
  // 科技
  { id: "github", name: "GitHub Trending", cat: "科技", adapters: ["github", "newsnow:github"] },
  { id: "36kr", name: "36氪", cat: "科技", adapters: ["newsnow:36kr"] },
  { id: "ithome", name: "IT之家", cat: "科技", adapters: ["newsnow:ithome"] },
  { id: "juejin", name: "掘金", cat: "科技", adapters: ["newsnow:juejin"] },
  { id: "sspai", name: "少数派", cat: "科技", adapters: ["newsnow:sspai"] },
  { id: "solidot", name: "Solidot", cat: "科技", adapters: ["newsnow:solidot"] },
  { id: "freebuf", name: "FreeBuf", cat: "科技", adapters: ["newsnow:freebuf"] },
  { id: "v2ex", name: "V2EX", cat: "科技", adapters: ["newsnow:v2ex"] },
  { id: "linuxdo", name: "Linux.do", cat: "科技", adapters: ["newsnow:linuxdo"] },
  { id: "coolapk", name: "酷安", cat: "科技", adapters: ["newsnow:coolapk"] },
  { id: "nowcoder", name: "牛客网", cat: "科技", adapters: ["newsnow:nowcoder"] },
  { id: "ghxi", name: "果核剥壳", cat: "科技", adapters: ["newsnow:ghxi"] },
  { id: "pcbeta", name: "远景论坛", cat: "科技", adapters: ["newsnow:pcbeta"] },
  { id: "aihot", name: "AI 热榜", cat: "科技", adapters: ["newsnow:aihot"] },
  { id: "quark", name: "夸克热点", cat: "科技", adapters: ["s60:quark"] },
  // 财经
  { id: "wallstreetcn", name: "华尔街见闻", cat: "财经", adapters: ["wscn", "newsnow:wallstreetcn"] },
  { id: "cls", name: "财联社", cat: "财经", adapters: ["newsnow:cls"] },
  { id: "gelonghui", name: "格隆汇", cat: "财经", adapters: ["newsnow:gelonghui"] },
  { id: "jin10", name: "金十数据", cat: "财经", adapters: ["newsnow:jin10"] },
  { id: "xueqiu", name: "雪球", cat: "财经", adapters: ["newsnow:xueqiu"] },
  { id: "fastbull", name: "法布财经", cat: "财经", adapters: ["newsnow:fastbull"] },
  // 社会
  { id: "douban", name: "豆瓣", cat: "社会", adapters: ["s60:douban", "newsnow:douban"] },
  { id: "hupu", name: "虎扑", cat: "社会", adapters: ["s60:hupu", "newsnow:hupu"] },
  { id: "dongqiudi", name: "懂球帝", cat: "社会", adapters: ["newsnow:dongqiudi"] },
  { id: "steam", name: "Steam", cat: "社会", adapters: ["newsnow:steam"] },
  { id: "smzdm", name: "什么值得买", cat: "社会", adapters: ["newsnow:smzdm"] },
  { id: "iqiyi", name: "爱奇艺", cat: "社会", adapters: ["newsnow:iqiyi"] },
  { id: "qqvideo", name: "腾讯视频", cat: "社会", adapters: ["newsnow:qqvideo"] },
  { id: "dongchedi", name: "懂车帝", cat: "社会", adapters: ["s60:dongchedi", "newsnow:dongchedi"] },
];

const CATS = ["全部", "国内", "国际", "科技", "财经", "社会"];

// ---- 上游配置 ----------------------------------------------------------

// 60s API 公共实例（按优先级故障转移，见 docs.60s-api.viki.moe 公共实例列表）
const S_INSTANCES = [
  "https://60s.okbaike.com",
  "https://60s.7se.cn",
  "https://60s.viki.moe",
];

// newsnow 实例（可经环境变量 NEWSNOW_BASE 追加自部署实例）
const NEWSNOW_BASES = [process.env.NEWSNOW_BASE, "https://newsnow.busiyi.world"].filter(Boolean);
const NEWSNOW_FALLBACK = (id) =>
  `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://newsnow.busiyi.world/api/s?id=${encodeURIComponent(id)}`)}`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 hotspot-hub/1.0";

// ---- 缓存 --------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000;
const ERR_TTL = 2 * 60 * 1000; // 失败结果短缓存，避免每次重试都跑完整适配器链
const cache = new Map(); // key -> { at, body }
const errCache = new Map(); // key -> { at, err }

async function cached(key, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return { body: hit.body, fresh: false };
  const miss = errCache.get(key);
  if (miss && Date.now() - miss.at < ERR_TTL) throw miss.err;
  try {
    const body = await loader();
    cache.set(key, { at: Date.now(), body });
    errCache.delete(key);
    return { body, fresh: true };
  } catch (e) {
    errCache.set(key, { at: Date.now(), err: e });
    throw e;
  }
}

// ---- 通用抓取 ----------------------------------------------------------

async function fetchText(url, timeout = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.text();
}

async function fetchJson(url, timeout = 8000) {
  const text = await fetchText(url, timeout);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("upstream non-json");
  }
}

const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, "").trim();

// ---- 适配器 ------------------------------------------------------------

// 60s API：多实例故障转移 + 两代返回格式归一化
async function fetch60s(endpoint) {
  let lastErr;
  for (const base of S_INSTANCES) {
    try {
      const json = await fetchJson(`${base}/v2/${endpoint}`);
      if (json?.code === 200 && Array.isArray(json.data)) {
        return {
          items: json.data.map((it) => ({ title: it.title, url: it.link, hot: it.hot_value ?? it.score ?? null })),
          updated: "",
        };
      }
      if (json?.status === 200 && Array.isArray(json.data)) {
        return {
          items: json.data.map((it) => ({ title: it.title, url: it.url, hot: it.hot ?? it.play ?? null })),
          updated: json.update_time || "",
        };
      }
      throw new Error(`business code ${json?.code ?? json?.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// 60s API 原始透传（每日新闻等非榜单结构，如 /v2/60s 的 data.news）
async function fetch60sRaw(endpoint) {
  let lastErr;
  for (const base of S_INSTANCES) {
    try {
      const json = await fetchJson(`${base}/v2/${endpoint}`);
      if (json?.code === 200) return json;
      throw new Error(`business code ${json?.code}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// newsnow：官方/自部署实例 + 公共中转兜底
async function fetchNewsnow(id) {
  let lastErr;
  for (const base of NEWSNOW_BASES) {
    try {
      const json = await fetchJson(`${base}/api/s?id=${encodeURIComponent(id)}`, 5000);
      if (!Array.isArray(json.items)) throw new Error("bad payload");
      return {
        items: json.items.map((it) => ({ title: it.title, url: it.mobileUrl || it.url, hot: null })),
        updated: json.updatedTime ? new Date(json.updatedTime).toLocaleString("zh-CN", { hour12: false }) : "",
      };
    } catch (e) {
      lastErr = e;
    }
  }
  try {
    const json = await fetchJson(NEWSNOW_FALLBACK(id), 10000);
    if (!Array.isArray(json.items)) throw new Error("bad payload");
    return {
      items: json.items.map((it) => ({ title: it.title, url: it.mobileUrl || it.url, hot: null })),
      updated: json.updatedTime ? new Date(json.updatedTime).toLocaleString("zh-CN", { hour12: false }) : "",
    };
  } catch (e) {
    throw lastErr || e;
  }
}

// Hacker News 首页（Algolia API）
async function fetchHN() {
  const json = await fetchJson("https://hn.algolia.com/api/v1/search?tags=front_page");
  const items = (json.hits || []).map((h) => ({
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    hot: h.points ?? null,
  }));
  return { items, updated: "" };
}

// GitHub 热门仓库（近 30 天新增按星标排序，近似 Trending）
async function fetchGithub() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const json = await fetchJson(
    `https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=20`
  );
  const items = (json.items || []).map((r) => ({
    title: r.description ? `${r.full_name} — ${stripHtml(r.description).slice(0, 60)}` : r.full_name,
    url: r.html_url,
    hot: r.stargazers_count,
  }));
  return { items, updated: "" };
}

// 华尔街见闻快讯
async function fetchWscn() {
  const json = await fetchJson("https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=25");
  const items = (json?.data?.items || [])
    .map((it) => ({
      title: stripHtml(it.content_text || it.content || it.title).slice(0, 80),
      url: it.uri || "https://wallstreetcn.com/live/global",
      hot: null,
    }))
    .filter((it) => it.title);
  return { items, updated: "" };
}

// 通用 RSS
async function fetchRss(url) {
  const xml = await fetchText(url);
  const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/g)]
    .slice(0, 25)
    .map((m) => {
      const block = m[0];
      const title = (block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
      const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
      return { title: stripHtml(title), url: link.trim(), hot: null };
    })
    .filter((it) => it.title);
  return { items, updated: "" };
}

const ADAPTER_IMPL = {
  "s60": (ep) => fetch60s(ep),
  "newsnow": (id) => fetchNewsnow(id),
  "hn": () => fetchHN(),
  "github": () => fetchGithub(),
  "wscn": () => fetchWscn(),
  "rss": (url) => fetchRss(url),
};

async function loadBoard(source) {
  let lastErr;
  for (const spec of source.adapters) {
    const [kind, arg] = [spec.split(":")[0], spec.split(":").slice(1).join(":")];
    try {
      const r = await ADAPTER_IMPL[kind](arg);
      if (!r.items.length) throw new Error("empty board");
      return { ...r, adapter: kind };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ---- 快照历史（趋势追踪） ------------------------------------------------

const MAX_SNAPSHOTS = 48;
let history = null;
let historyReady = null;

function loadHistory() {
  historyReady ??= readFile(HISTORY_FILE, "utf8")
    .then((s) => JSON.parse(s))
    .catch(() => ({}))
    .then((h) => (history = h));
  return historyReady;
}

function saveHistory() {
  mkdir(path.dirname(HISTORY_FILE), { recursive: true })
    .then(() => writeFile(HISTORY_FILE, JSON.stringify(history)))
    .catch((e) => console.error(`[history] save failed: ${e.message}`));
}

// items: [{title, ...}]，按当前顺序即排名
function recordSnapshot(key, items) {
  const ranks = {};
  items.forEach((it, i) => {
    if (it?.title && !(it.title in ranks)) ranks[it.title] = i + 1;
  });
  const snaps = history[key] || [];
  const prev = snaps[snaps.length - 1]?.ranks;

  history[key] = [...snaps, { t: Date.now(), ranks }].slice(-MAX_SNAPSHOTS);
  saveHistory();

  if (!prev) return {};
  const trends = {};
  for (const [title, rank] of Object.entries(ranks)) {
    const old = prev[title];
    if (old == null) trends[title] = { isNew: true };
    else if (old !== rank) trends[title] = { delta: old - rank };
    else trends[title] = { delta: 0 };
  }
  return trends;
}

// ---- 静态文件 ----------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error();
    const data = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

const sendJson = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

// ---- 服务器 ------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader("access-control-allow-origin", "*");

  try {
    // 数据源注册表
    if (url.pathname === "/api/sources") {
      sendJson(res, 200, {
        code: 200,
        message: "ok",
        data: {
          cats: CATS,
          sources: SOURCES.map((s) => ({ id: s.id, name: s.name, cat: s.cat, adapters: s.adapters })),
        },
      });
      return;
    }

    // 归一化榜单（适配器链自动选择可用通道 + 趋势标注）
    const mBoard = url.pathname.match(/^\/api\/board\/([\w-]+)$/);
    if (mBoard) {
      const source = SOURCES.find((s) => s.id === mBoard[1]);
      if (!source) {
        sendJson(res, 404, { code: 404, message: "未知数据源" });
        return;
      }
      await loadHistory();
      const { body, fresh } = await cached(`board:${source.id}`, () => loadBoard(source));
      if (fresh) body.trends = recordSnapshot(`board:${source.id}`, body.items);
      const limit = Math.min(parseInt(url.searchParams.get("limit")) || 30, 50);
      sendJson(res, 200, {
        code: 200,
        message: "ok",
        data: {
          id: source.id,
          name: source.name,
          cat: source.cat,
          adapter: body.adapter,
          updated: body.updated,
          trends: body.trends || {},
          items: body.items.slice(0, limit).map((it) => ({
            title: it.title,
            url: it.url,
            hot: it.hot,
          })),
        },
      });
      return;
    }

    // 采集批次时间线（来自真实快照历史，不含任何模拟数据）
    if (url.pathname === "/api/timeline") {
      await loadHistory();
      const buckets = new Map();
      for (const [key, snaps] of Object.entries(history)) {
        if (!key.startsWith("board:")) continue;
        const id = key.slice(6);
        const src = SOURCES.find((x) => x.id === id);
        const name = src?.name || id;
        const cat = src?.cat || "";
        snaps.forEach((snap, i) => {
          const bucketT = Math.floor(snap.t / (5 * 60 * 1000)) * 5 * 60 * 1000;
          const b = buckets.get(bucketT) || { t: bucketT, sources: [], events: [] };
          b.sources.push({ id, name, cat, count: Object.keys(snap.ranks || {}).length });
          const prev = snaps[i - 1]?.ranks;
          if (prev && b.events.length < 24) {
            for (const [title, rank] of Object.entries(snap.ranks || {})) {
              const old = prev[title];
              if (old == null) b.events.push({ kind: "new", source: name, id, title, rank });
              else if (old - rank >= 5) b.events.push({ kind: "up", source: name, id, title, rank, delta: old - rank });
              if (b.events.length >= 24) break;
            }
          }
          buckets.set(bucketT, b);
        });
      }
      const batches = [...buckets.values()]
        .sort((a, b) => b.t - a.t)
        .slice(0, 10)
        .map((b) => ({ ...b, sources: b.sources.slice(0, 60) }));
      sendJson(res, 200, { code: 200, message: "ok", data: { batches } });
      return;
    }

    // 单个话题的真实排名历史（趋势曲线唯一数据来源）
    if (url.pathname === "/api/topic") {
      await loadHistory();
      const id = url.searchParams.get("id") || "";
      const title = url.searchParams.get("title") || "";
      const snaps = history[`board:${id}`] || [];
      const points = snaps
        .map((s) => ({ t: s.t, rank: s.ranks?.[title] ?? null }))
        .filter((p) => p.rank != null);
      sendJson(res, 200, { code: 200, message: "ok", data: { id, title, points } });
      return;
    }

    // 兼容保留：60s / newsnow 原始透传
    const m60s = url.pathname.match(/^\/api\/60s\/([\w-]+)$/);
    if (m60s) {
      const body = await cached(`60s:${m60s[1]}`, () =>
        m60s[1] === "60s"
          ? fetch60sRaw("60s")
          : fetch60s(m60s[1]).then((r) => ({ code: 200, message: "ok", data: r.items, updated: r.updated }))
      );
      sendJson(res, 200, body.body);
      return;
    }
    if (url.pathname === "/api/newsnow") {
      const id = url.searchParams.get("id") || "weibo";
      const body = await cached(`newsnow:${id}`, () => fetchNewsnow(id));
      sendJson(res, 200, { code: 200, message: "ok", data: body.body.items, updated: body.body.updated });
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        sources: SOURCES.length,
        warm: {
          running: warm.running,
          done: warm.done,
          total: warm.total,
          available: [...warm.ok],
          unavailable: [...warm.err],
        },
        ts: Date.now(),
      });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res, url.pathname);
      return;
    }

    res.writeHead(405).end();
  } catch (e) {
    sendJson(res, 502, { code: 502, message: "上游数据源暂时不可用，请稍后重试" });
    console.error(`[proxy] ${url.pathname} -> ${e.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`热点中枢已启动: http://localhost:${PORT}（数据源 ${SOURCES.length} 个）`);
  warmup();
});

// ---- 采集调度（预热）：并发抓取全部源写入缓存与快照，VPS 上由 node-cron / CF 上由 Cron Triggers 承担 ----

const warm = { running: false, done: 0, total: SOURCES.length, ok: new Set(), err: new Set(), lastAt: null };

async function warmup() {
  if (warm.running) return;
  warm.running = true;
  warm.done = 0;
  warm.ok.clear();
  warm.err.clear();
  await loadHistory();
  const queue = [...SOURCES];
  const WORKERS = 8;
  const worker = async () => {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      try {
        await cached(`board:${s.id}`, () => loadBoard(s));
        warm.ok.add(s.id);
      } catch {
        warm.err.add(s.id);
      }
      warm.done++;
      warm.lastAt = Date.now();
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  warm.running = false;
  console.log(`[warm] 预热完成：可用 ${warm.ok.size} / ${SOURCES.length}`);
}

setInterval(() => warmup().catch(() => {}), 10 * 60 * 1000);
