/* 热点晨报 — 前端逻辑：多源卡片聚合 + 趋势追踪 + 关键词跨源筛选 */

const $ = (id) => document.getElementById(id);

// ---- 全局状态 ----

let SOURCES = []; // [{id,name,cat,adapters}]
let CATS = [];
let curCat = "全部";
let kwQuery = "";
let staticMode = false; // GitHub Pages 无后端时回退到 demo.json
let DEMO = null;

const boards = new Map(); // id -> { status:'loading'|'ok'|'error', data? }
let trendSrc = null; // 趋势页当前源 id
let trendTopic = null;

// ---- 工具 ----

function fmtHot(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    if (v >= 1e8) return (v / 1e8).toFixed(1) + "亿";
    if (v >= 1e4) return (v / 1e4).toFixed(1) + "万";
    return String(v);
  }
  const s = String(v);
  return /w$/i.test(s) ? s.replace(/w$/i, "万") : s;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function seeded(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
}

// ---- 关键词筛选（语法参考 TrendRadar） ----

function parseKW(q) {
  const plain = [], must = [], excl = [];
  for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("+") && tok.length > 1) must.push(tok.slice(1));
    else if (tok.startsWith("!") && tok.length > 1) excl.push(tok.slice(1));
    else plain.push(tok);
  }
  return { plain, must, excl };
}

function kwMatch(title, k) {
  if (k.excl.some((w) => title.includes(w))) return false;
  if (k.must.length && !k.must.every((w) => title.includes(w))) return false;
  if (k.plain.length && !k.plain.some((w) => title.includes(w))) return false;
  return true;
}

// ---- 趋势徽标 ----

function trendBadge(trends, title) {
  const t = trends?.[title];
  if (!t) return "";
  if (t.isNew) return `<span class="trend new" title="新上榜">新</span>`;
  if (t.delta > 0) return `<span class="trend up" title="上升 ${t.delta} 位">▲${t.delta}</span>`;
  if (t.delta < 0) return `<span class="trend down" title="下降 ${-t.delta} 位">▼${-t.delta}</span>`;
  if (t.delta === 0) return `<span class="trend flat" title="排名持平">—</span>`;
  return "";
}

// ---- 60 秒读懂世界 ----

async function loadDaily() {
  $("dailyError").hidden = true;
  const list = $("dailyList");
  list.innerHTML = [92, 85, 96, 78, 90, 88]
    .map((w) => `<li class="skeleton" style="width:${w}%"></li>`)
    .join("");

  try {
    let d;
    if (staticMode && DEMO?.digest) {
      d = DEMO.digest;
    } else {
      const json = await getJson("api/60s/60s");
      if (json.code !== 200 || !Array.isArray(json.data?.news)) throw new Error("bad payload");
      d = json.data;
    }

    list.innerHTML = "";
    d.news.forEach((text, i) => {
      const li = document.createElement("li");
      li.textContent = text;
      li.style.animation = `row-in 420ms cubic-bezier(0.16,1,0.3,1) ${i * 35}ms backwards`;
      list.appendChild(li);
    });

    if (d.tip) {
      $("dailyTipText").textContent = d.tip;
      $("dailyTip").hidden = false;
    }
    if (d.image) {
      $("dailyImageLink").href = d.image;
      $("dailyImageLink").hidden = false;
    }
    const d0 = d;
    $("metaDate").textContent =
      `${d0.date || ""} ${d0.day_of_week || ""}`.trim() || new Date().toLocaleDateString("zh-CN");
    $("metaLunar").textContent =
      [d0.lunar_date, d0.updated && `数据更新 ${d0.updated}`].filter(Boolean).join(" · ");
  } catch {
    list.innerHTML = "";
    $("dailyError").hidden = false;
  }
}

// ---- 热榜卡片网格 ----

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderCatTabs() {
  const wrap = $("catTabs");
  wrap.innerHTML = "";
  CATS.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.textContent = cat;
    btn.setAttribute("aria-selected", String(cat === curCat));
    btn.addEventListener("click", () => {
      if (curCat === cat) return;
      curCat = cat;
      renderCatTabs();
      renderCards();
    });
    wrap.appendChild(btn);
  });
}

function updateNote() {
  const inCat = SOURCES.filter((s) => curCat === "全部" || s.cat === curCat);
  const ok = inCat.filter((s) => boards.get(s.id)?.status === "ok").length;
  const err = inCat.filter((s) => boards.get(s.id)?.status === "error").length;
  const loading = inCat.length - ok - err;
  $("boardsNote").textContent =
    `${inCat.length} 个源 · 可用 ${ok}${err ? ` · 不可达 ${err}` : ""}${loading ? ` · 加载中 ${loading}` : ""}` +
    (staticMode ? " · 静态演示快照（Pages 无后端）" : "");
}

function renderCards() {
  const grid = $("cardGrid");
  grid.innerHTML = "";
  const list = SOURCES.filter((s) => curCat === "全部" || s.cat === curCat);

  list.forEach((s) => {
    const card = document.createElement("article");
    card.className = "card";
    card.id = `card-${s.id}`;
    card.innerHTML = `
      <div class="card-head">
        <span class="card-name">${esc(s.name)}</span>
        <span class="card-chips">${s.adapters.map((a) => `<span class="chip">${esc(a.split(":")[0])}</span>`).join("")}</span>
      </div>
      <ol class="card-list"><li class="skeleton" style="width:88%"></li><li class="skeleton" style="width:76%"></li><li class="skeleton" style="width:92%"></li><li class="skeleton" style="width:70%"></li></ol>`;
    grid.appendChild(card);

    const st = boards.get(s.id);
    if (st?.status === "ok") paintCard(s, st.data);
    else if (st?.status === "error") paintError(s);
    else {
      boards.set(s.id, { status: "loading" });
      loadBoard(s);
    }
  });
  updateNote();
}

async function loadBoard(s) {
  try {
    let data;
    if (staticMode) {
      data = DEMO?.boards?.[s.id];
      if (!data) throw new Error("no demo board");
    } else {
      const json = await getJson(`api/board/${s.id}?limit=30`);
      if (json.code !== 200 || !Array.isArray(json.data?.items)) throw new Error("bad payload");
      data = json.data;
    }
    boards.set(s.id, { status: "ok", data });
    paintCard(s, data);
  } catch {
    boards.set(s.id, { status: "error" });
    paintError(s);
  }
  updateNote();
  if (trendSrc === s.id) renderTopics();
}

function paintCard(s, data) {
  const card = document.getElementById(`card-${s.id}`);
  if (!card) return;
  card.classList.remove("card-error");

  const k = parseKW(kwQuery);
  const kw = kwQuery.trim() ? k : null;
  const rows = data.items.filter((it) => !kw || kwMatch(it.title, kw));
  card.classList.toggle("card-dim", kw && rows.length === 0);

  const items = rows.slice(0, 10)
    .map((it, i) => {
      const hot = fmtHot(it.hot);
      const inner = `<span class="title">${esc(it.title)}</span>${trendBadge(data.trends, it.title)}`;
      const a = it.url
        ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${inner}</a>`
        : `<span class="nolink">${inner}</span>`;
      return `<li><span class="rank">${String(i + 1).padStart(2, "0")}</span>${a}${hot ? `<span class="hot-value">${esc(hot)}</span>` : ""}</li>`;
    })
    .join("");

  card.innerHTML = `
    <div class="card-head">
      <span class="card-name">${esc(s.name)}</span>
      <span class="card-chips">${data.adapter ? `<span class="chip chip-live">${esc(data.adapter)}</span>` : ""}</span>
    </div>
    ${data.updated ? `<div class="card-updated">${esc(data.updated)}</div>` : ""}
    ${rows.length ? `<ol class="card-list">${items}</ol>` : `<p class="card-empty">无匹配条目</p>`}`;
}

function paintError(s) {
  const card = document.getElementById(`card-${s.id}`);
  if (!card) return;
  card.classList.add("card-error", "card-dim");
  card.innerHTML = `
    <div class="card-head">
      <span class="card-name">${esc(s.name)}</span>
      <span class="card-chips">${s.adapters.map((a) => `<span class="chip">${esc(a.split(":")[0])}</span>`).join("")}</span>
    </div>
    <p class="card-empty">上游不可达 <button class="retry-btn" data-src="${s.id}" type="button">重试</button></p>`;
  card.querySelector("[data-src]").addEventListener("click", () => {
    boards.set(s.id, { status: "loading" });
    renderCards();
  });
}

// ---- 趋势页 ----

function renderTrendTabs() {
  const wrap = $("trendTabs");
  wrap.innerHTML = "";
  SOURCES.forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.type = "button";
    btn.textContent = s.name;
    btn.title = s.cat;
    btn.setAttribute("aria-selected", String(s.id === trendSrc));
    btn.addEventListener("click", () => {
      trendSrc = s.id;
      trendTopic = null;
      renderTrendTabs();
      renderTopics();
    });
    wrap.appendChild(btn);
  });
}

function renderTopics() {
  const st = boards.get(trendSrc);
  const list = $("topicList");

  if (!st || st.status === "loading") {
    list.innerHTML = [88, 74, 92, 66, 80].map((w) => `<li class="skeleton" style="width:${w}%"></li>`).join("");
    $("trendPanel").innerHTML = "";
    if (!st) {
      const s = SOURCES.find((x) => x.id === trendSrc);
      boards.set(trendSrc, { status: "loading" });
      loadBoard(s);
    }
    return;
  }
  if (st.status === "error") {
    list.innerHTML = "";
    $("trendPanel").innerHTML = `<p class="error-box">该源暂不可达，无法展示趋势</p>`;
    return;
  }

  const data = st.data;
  if (!trendTopic || !data.items.some((it) => it.title === trendTopic)) {
    trendTopic = data.items[0]?.title;
  }
  list.innerHTML = data.items.slice(0, 30)
    .map((it, i) => `
      <li data-t="${esc(it.title)}" aria-selected="${it.title === trendTopic}">
        <span class="rank">${String(i + 1).padStart(2, "0")}</span>
        <span class="t">${esc(it.title)}</span>${trendBadge(data.trends, it.title)}
      </li>`)
    .join("");
  list.querySelectorAll("li[data-t]").forEach((li) =>
    li.addEventListener("click", () => { trendTopic = li.dataset.t; renderTopics(); }));
  renderTrendPanel();
}

function renderTrendPanel() {
  const st = boards.get(trendSrc);
  if (!st?.data || !trendTopic) return;
  const s = SOURCES.find((x) => x.id === trendSrc);
  const data = st.data;
  const item = data.items.find((it) => it.title === trendTopic);
  if (!item) return;
  const rank = data.items.indexOf(item) + 1;
  const t = data.trends?.[trendTopic] || {};

  // 演示时间线（随服务端快照积累，可替换为 /api/board 的真实历史）
  const rnd = seeded(trendSrc + trendTopic);
  let r = rank + Math.floor(rnd() * 8) + 2;
  const tl = [];
  for (let i = 0; i < 12; i++) {
    r = Math.max(1, Math.min(50, r + Math.floor((rnd() - 0.48) * 7)));
    tl.push(r);
  }
  tl[11] = rank;

  const best = Math.min(...tl), first = tl[0], now = tl[11];
  const W = 420, H = 110, pad = 6, max = Math.max(...tl), min = best;
  const xy = tl.map((v, i) => [pad + (i * (W - 2 * pad)) / 11, pad + ((v - min) / Math.max(1, max - min)) * (H - 2 * pad)]);
  const path = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");

  $("trendPanel").innerHTML = `
    <h3>${esc(trendTopic)}</h3>
    <span class="chip">${esc(s.cat)} · ${esc(s.name)}</span>
    ${t.isNew ? `<span class="chip chip-new">新上榜</span>` : ""}
    ${typeof t.delta === "number" && t.delta > 0 ? `<span class="chip chip-hot">↑${t.delta}</span>` : ""}
    <div class="stats">
      <div class="stat"><b>#${now}</b><span>当前排名</span></div>
      <div class="stat"><b>#${best}</b><span>峰值排名</span></div>
      <div class="stat"><b>${tl.filter((x) => x <= 10).length}</b><span>前十时段</span></div>
      <div class="stat"><b>${first > now ? "▲" : first < now ? "▼" : "—"}</b><span>趋势</span></div>
    </div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${path} L ${W - pad} ${H - pad} L ${pad} ${H - pad} Z" fill="var(--accent)" opacity="0.08"/>
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${xy[11][0]}" cy="${xy[11][1]}" r="3.5" fill="var(--accent)"/>
    </svg>
    <div class="spark-cap"><span>12 时段前</span><span>y 轴：排名越低越高</span><span>现在</span></div>`;
}

// ---- 启动 ----

document.querySelectorAll("[data-retry]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.retry === "daily") loadDaily();
  });
});

let kwTimer;
$("kwInput").addEventListener("input", (e) => {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(() => {
    kwQuery = e.target.value;
    SOURCES.filter((s) => curCat === "全部" || s.cat === curCat)
      .forEach((s) => {
        const st = boards.get(s.id);
        if (st?.status === "ok") paintCard(s, st.data);
      });
  }, 150);
});

async function boot() {
  try {
    const json = await getJson("api/sources");
    SOURCES = json.data.sources;
    CATS = json.data.cats;
  } catch {
    // GitHub Pages 无后端：回退到部署时生成的数据快照
    try {
      DEMO = await getJson("demo.json");
      SOURCES = DEMO.sources;
      CATS = DEMO.cats;
      staticMode = true;
    } catch {
      $("boardsNote").textContent = "数据源目录加载失败，请刷新重试";
      return;
    }
  }
  if (!trendSrc) trendSrc = SOURCES[0].id;
  renderCatTabs();
  renderCards();
  renderTrendTabs();
  renderTopics();
  if (staticMode) loadDaily(); // 补一次日报渲染（首次启动时可能先于 DEMO 加载）
}

loadDaily();
boot();
