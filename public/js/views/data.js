// 数据：实用数据（金价/油价/汇率/天气/历史今天/Epic/AI 资讯）+ 影视榜
import { $, esc, skeleton, errorState, emptyState, fmtTime, toast } from "../ui.js";
import { fetchMetrics, fetchMedia, ApiError } from "../api.js";
import * as direct from "../direct.js";

export const meta = { path: "data", title: "实用数据", kicker: "第 IV 栏", icon: "data", nav: true, tab: true };

export async function render({ query }) {
  const host = $("#viewHost");
  const tab = query.get("tab") === "media" ? "media" : "utility";

  host.innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">${tab === "media" ? "影视榜单" : "实用数据"}</h2>
        <div class="tabs" role="tablist" aria-label="数据类别">
          <a class="tab" role="tab" href="#/data" aria-selected="${tab === "utility"}">实用数据</a>
          <a class="tab" role="tab" href="#/data?tab=media" aria-selected="${tab === "media"}">影视榜</a>
        </div>
      </div>
      <div id="dataBody"></div>
    </section>`;

  const body = $("#dataBody");
  body.innerHTML = `<div class="metric-grid">${skeleton(6, [70, 60, 50, 66])}</div>`;
  let destroyed = false;

  const bindRetry = (fn) => {
    body.querySelector("[data-retry]")?.addEventListener("click", fn, { once: true });
  };

  const renderUtility = async () => {
    body.innerHTML = `<div class="metric-grid">${skeleton(6, [70, 60, 50, 66])}</div>`;
    try {
      let data;
      try {
        data = await fetchMetrics();
      } catch (e) {
        // 后端未提供指标时，浏览器直连 60s 公共实例
        if (e instanceof ApiError && e.kind === "unsupported") data = await direct.metrics();
        else throw e;
      }
      if (destroyed) return;
      body.innerHTML = utilityHtml(data);
      body.querySelector("[data-copy-gold]")?.addEventListener("click", () => {
        const g = data.gold;
        if (g?.value) toast(`金价 ${g.value} ${g.unit || ""}`, { timeout: 1800 });
      });
    } catch (e) {
      if (destroyed) return;
      body.innerHTML = errorState({
        title: "实用数据暂时不可用",
        message: e instanceof ApiError && e.kind === "unsupported"
          ? "当前部署没有后端接口，且直连 60s 公共实例失败（可能被限流）。"
          : e.message,
        code: e.code,
        retry: "metrics",
      });
      bindRetry(renderUtility);
    }
  };

  const renderMedia = async () => {
    body.innerHTML = `<div class="media-board">${skeleton(4, [80, 66, 72])}</div>`;
    try {
      let data;
      try {
        data = await fetchMedia();
      } catch (e) {
        if (e instanceof ApiError && e.kind === "unsupported") data = await direct.media();
        else throw e;
      }
      if (destroyed) return;
      body.innerHTML = mediaHtml(data);
    } catch (e) {
      if (destroyed) return;
      body.innerHTML = errorState({ title: "影视榜加载失败", message: e.message, code: e.code, retry: "media" });
      bindRetry(renderMedia);
    }
  };

  tab === "media" ? await renderMedia() : await renderUtility();
  return () => { destroyed = true; };
}

/* ---------------- 实用数据 ---------------- */

function utilityHtml(d = {}) {
  const cards = [];

  if (d.gold?.value != null) {
    cards.push(metricCard({
      key: "gold", title: "黄金价格",
      value: d.gold.value, unit: d.gold.unit || "元/克",
      sub: d.gold.name || "国内现货",
      foot: d.gold.updated ? fmtTime(d.gold.updated) : "",
      delta: d.gold.change,
    }));
  }
  if (Array.isArray(d.oil?.items) && d.oil.items.length) {
    const first = d.oil.items[0];
    cards.push(metricCard({
      key: "oil", title: "汽油价格",
      value: first.price, unit: first.unit || "元/升",
      sub: first.name || "92# 汽油",
      foot: d.oil.updated ? fmtTime(d.oil.updated) : "",
    }));
  }
  if (d.exchange?.rates?.length) {
    const usd = d.exchange.rates.find((r) => /USD|美元/i.test(`${r.code}${r.name}`)) || d.exchange.rates[0];
    const others = d.exchange.rates.filter((r) => r !== usd).slice(0, 3);
    cards.push(metricCard({
      key: "fx", title: "汇率 · 1 CNY",
      value: usd ? Number(usd.rate).toFixed(4) : "—",
      unit: usd?.code || "",
      sub: others.map((r) => `${r.code} ${Number(r.rate).toFixed(4)}`).join(" · "),
      foot: d.exchange.updated ? fmtTime(d.exchange.updated) : "",
    }));
  }
  if (d.weather?.now) {
    const w = d.weather.now;
    cards.push(metricCard({
      key: "weather", title: `天气 · ${w.city || "本地"}`,
      value: w.temp, unit: "°C",
      sub: [w.text, w.humidity && `湿度 ${w.humidity}`, w.wind].filter(Boolean).join(" · "),
      foot: w.updated ? fmtTime(w.updated) : "",
    }));
  }

  const forecast = d.weather?.forecast || [];
  const history = d.history?.items || [];
  const epic = d.epic?.items || [];
  const ai = d.aiNews?.items || [];
  const it = d.itNews?.items || [];

  return `
    ${cards.length
      ? `<div class="metric-grid">${cards.join("")}</div>`
      : emptyState({ title: "暂时没有可用指标", why: "上游接口本轮没有返回金价/油价/汇率/天气数据。" })}

    ${forecast.length ? `<div class="section" style="margin-block-start:var(--sp-6)">
      <div class="section-head"><h2 class="section-title">未来天气</h2><span class="note">${esc(forecast.length)} 天</span></div>
      <div class="metric-grid">${forecast.slice(0, 4).map((f) => metricCard({
        key: "fc", title: f.date || "—",
        value: `${f.high ?? "-"}°`, unit: `/ ${f.low ?? "-"}°`,
        sub: f.text || "", foot: "",
      })).join("")}</div>
    </div>` : ""}

    ${history.length ? `<div class="section">
      <div class="section-head"><h2 class="section-title">历史上的今天</h2><span class="note">${esc(history.length)} 条</span></div>
      <div class="batch"><div class="batch-events">
        ${history.slice(0, 8).map((h) => `<div class="event">
          <span class="chip">${esc(h.year || "")}</span>
          <span class="item-title">${esc(h.title || "")}</span>
        </div>`).join("")}
      </div></div>
    </div>` : ""}

    ${epic.length ? `<div class="section">
      <div class="section-head"><h2 class="section-title">Epic 免费游戏</h2><span class="note">周更</span></div>
      <div class="board-grid">${epic.slice(0, 6).map((g) => `
        <article class="board-card">
          <div class="card-head"><span class="card-name">${esc(g.title || "未命名")}</span>
            <span class="card-chips"><span class="chip chip--live">免费</span></span></div>
          <p class="note" style="margin-block-start:.35rem">${esc(g.freeUntil ? `截止 ${g.freeUntil}` : "")}</p>
          ${g.url ? `<a class="expand-btn" href="${esc(g.url)}" target="_blank" rel="noopener" style="text-decoration:none">前往领取 →</a>` : ""}
        </article>`).join("")}</div>
    </div>` : ""}

    ${(ai.length || it.length) ? `<div class="section">
      <div class="section-head"><h2 class="section-title">科技快讯</h2><span class="note">AI 资讯 / IT 资讯</span></div>
      <div class="board-grid">
        ${[["AI 资讯", ai], ["IT 资讯", it]].filter(([, list]) => list.length).map(([name, list]) => `
          <article class="board-card">
            <div class="card-head"><span class="card-name">${esc(name)}</span><span class="card-chips"><span class="chip">${list.length}</span></span></div>
            <ol class="card-list">${list.slice(0, 6).map((n, i) => `<li class="item-row">
              <span class="item-rank">${String(i + 1).padStart(2, "0")}</span>
              ${n.url ? `<a class="item-title" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : `<span class="item-title">${esc(n.title)}</span>`}
              <span></span></li>`).join("")}</ol>
          </article>`).join("")}
      </div>
    </div>` : ""}`;
}

function metricCard({ title, value, unit = "", sub = "", foot = "", delta }) {
  const deltaHtml = typeof delta === "number"
    ? `<span class="trend" data-k="${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}">${delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}${Math.abs(delta)}</span>`
    : "";
  return `<article class="metric-card">
    <h3>${esc(title)}</h3>
    <p class="metric-value">${esc(value ?? "—")}<small>${esc(unit)}</small></p>
    ${sub ? `<p class="metric-sub">${esc(sub)}</p>` : ""}
    <div class="metric-foot"><span>${esc(foot)}</span>${deltaHtml}</div>
  </article>`;
}

/* ---------------- 影视榜 ---------------- */

const MEDIA_GROUPS = [
  ["maoyan", [
    ["allMovie", "猫眼全球票房"],
    ["realtimeMovie", "电影实时票房"],
    ["realtimeTv", "电视收视"],
    ["realtimeWeb", "网剧热度"],
  ]],
  ["douban", [
    ["movie", "豆瓣口碑电影"],
    ["tv_chinese", "华语剧集"],
    ["tv_global", "全球剧集"],
    ["show_chinese", "华语综艺"],
    ["show_global", "全球综艺"],
  ]],
  ["baidu", [["teleplay", "百度电视剧"]]],
];

function mediaHtml(d = {}) {
  const groups = MEDIA_GROUPS.map(([key, boards]) => {
    const cols = boards
      .map(([id, label]) => ({ label, list: d?.[key]?.[id] || [] }))
      .filter((c) => c.list.length);
    if (!cols.length) return "";
    return `<div class="section">
      <div class="section-head"><h2 class="section-title">${esc(key === "maoyan" ? "猫眼" : key === "douban" ? "豆瓣" : "百度")}</h2></div>
      <div class="media-board">${cols.map((c) => `
        <div class="media-col">
          <h3>${esc(c.label)}</h3>
          <ol class="media-list">${c.list.slice(0, 12).map((m, i) => `
            <li class="media-row">
              <span class="item-rank">${String(i + 1).padStart(2, "0")}</span>
              ${m.url ? `<a class="item-title" href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>` : `<span class="item-title">${esc(m.title)}</span>`}
              <span class="score">${esc(m.score ?? m.hot ?? "")}</span>
            </li>`).join("")}</ol>
        </div>`).join("")}</div>
    </div>`;
  }).filter(Boolean);

  if (!groups.length) {
    return emptyState({ title: "暂无影视榜单", why: "上游猫眼/豆瓣接口本轮未返回内容，通常与风控或榜单更新周期有关。" });
  }
  return groups.join("");
}
