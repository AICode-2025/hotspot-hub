// 今日晨报：60 秒日报 + 往期归档 + 本批次速览
import { $, esc, skeleton, errorState, emptyState, toast, copyText, icon, todayISO } from "../ui.js";
import { state, fetchDigest, fetchBoards, ApiError } from "../api.js";

export const meta = { path: "today", title: "今日晨报", kicker: "第 I 栏", icon: "today", nav: true, tab: true };

export async function render({ query }) {
  const host = $("#viewHost");
  const date = query.get("date") || "";
  const isToday = !date || date === todayISO();

  host.innerHTML = shell(date, isToday);
  const body = $("#digestBody", host);
  body.innerHTML = `<div class="digest-list">${skeleton(6, [96, 88, 94, 72, 90, 80])}</div>`;

  let destroyed = false;
  let digestReady = false;
  const load = async () => {
    body.innerHTML = `<div class="digest-list">${skeleton(6, [96, 88, 94, 72, 90, 80])}</div>`;
    const slowTimer = setTimeout(() => {
      if (!destroyed && !digestReady) {
        body.insertAdjacentHTML("beforeend", `<p class="note" style="margin-block-start:var(--sp-3)">上游响应较慢，仍在请求 60s 日报…</p>`);
      }
    }, 8000);
    // 榜单不阻塞日报：先渲染日报，速览后到后补
    ensureBoards().then(() => { if (!destroyed && digestReady) fillRail(); });
    try {
      const digestRes = await fetchDigest(date || undefined);
      if (destroyed) return;
      const { digest, dates } = digestRes;
      if (!digest) {
        body.innerHTML = emptyState({
          title: isToday ? "今天的日报还没到" : "这一天没有归档",
          why: isToday
            ? "60s 每日日报通常在早晨更新，采集器会在下一轮补齐。"
            : "只保留有采集记录的日期，未采集的日子不会补造内容。",
          actions: [`<button class="btn btn--quiet" data-retry="digest">再试一次</button>`],
        });
        bindRetry(load);
        return;
      }
      body.innerHTML = digestHtml(digest);
      body.querySelectorAll(".digest-cover img").forEach((img) =>
        img.addEventListener("error", () => img.closest(".digest-cover")?.remove(), { once: true }));
      digestReady = true;
      fillRail();
      fillArchive(dates, digest.date);
      $("#sideDate").textContent = digest.date || date || "—";
    } catch (e) {
      if (destroyed) return;
      const unsupported = e instanceof ApiError && e.kind === "unsupported";
      body.innerHTML = unsupported
        ? emptyState({ title: "当前数据源不提供日报", why: e.message })
        : errorState({ title: "日报加载失败", message: e.message, code: e.code, retry: "digest" });
      bindRetry(load);
    } finally {
      clearTimeout(slowTimer);
    }
  };

  bindRetry(load);
  bindArchive(host);
  await load();

  return () => { destroyed = true; };
}

function shell(date, isToday) {
  return `
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">每天 60 秒读懂世界</h2>
        <div class="archive-bar" id="archiveBar">
          <button class="btn btn--quiet" data-day="-1" type="button" aria-label="前一天">← 前一天</button>
          <input class="date-input" type="date" id="datePicker" value="${esc(date || todayISO())}" max="${todayISO()}" aria-label="选择日期" />
          <button class="btn btn--quiet" data-day="1" type="button" aria-label="后一天" ${isToday ? "disabled" : ""}>后一天 →</button>
          ${!isToday ? `<a class="btn btn--quiet" href="#/today">回到今天</a>` : ""}
          <button class="btn btn--quiet" data-copy="digest" type="button">复制简报</button>
        </div>
      </div>
      <div class="digest">
        <div id="digestBody"></div>
        <aside class="rail" id="digestRail"></aside>
      </div>
    </section>`;
}

function digestHtml(d) {
  return `
    ${d.image ? `<figure class="digest-cover">
      <img src="${esc(d.image)}" alt="今日日报配图" loading="eager" decoding="async" referrerpolicy="no-referrer" />
      <a class="cover-link" href="${esc(d.image)}" target="_blank" rel="noopener">查看日报原图 ↗</a>
    </figure>` : ""}
    <ol class="digest-list">
      ${d.news.map((t, i) => `<li class="digest-item" style="animation-delay:${Math.min(i, 8) * 30}ms">
        <span class="digest-num">${String(i + 1).padStart(2, "0")}</span>
        <span>${esc(t)}</span>
      </li>`).join("")}
    </ol>
    ${d.tip ? `<blockquote class="digest-tip">「 ${esc(d.tip)} 」</blockquote>` : ""}
    <div class="digest-meta">
      <span class="note note--mono">${esc([d.date, d.week, d.lunar].filter(Boolean).join(" · "))}</span>
      ${d.updated ? `<span class="note note--mono">数据更新 ${esc(d.updated)}</span>` : ""}
      ${d.link ? `<a class="digest-image-link" href="${esc(d.link)}" target="_blank" rel="noopener">查看原文 ${icon("arrow")}</a>` : ""}
    </div>`;
}

function fillArchive(dates, current) {
  const bar = $("#archiveBar");
  if (!bar) return;
  bar.querySelector(".archive-dates")?.remove();
  // 去重并排除当前日期：只有存在往期时才显示切换条
  const list = [...new Set(dates || [])].filter((d) => d && d !== current).slice(0, 7);
  if (!list.length) return;
  const wrap = document.createElement("div");
  wrap.className = "archive-dates";
  wrap.innerHTML = `<span class="note">往期</span>${list
    .map((d) => `<a class="date-chip" href="#/today?date=${esc(d)}">${esc(d.slice(5))}</a>`)
    .join("")}`;
  bar.appendChild(wrap);
}

function fillRail() {
  const rail = $("#digestRail");
  if (!rail) return;
  const boards = [...state.boards.values()];
  const ok = boards.filter((b) => b.status === "ok");
  const total = ok.reduce((n, b) => n + b.items.length, 0);
  const fresh = ok.reduce((n, b) => n + Object.values(b.trends || {}).filter((t) => t?.isNew).length, 0);

  const words = new Map();
  for (const b of ok) {
    for (const it of b.items.slice(0, 5)) {
      for (const w of extractWords(it.title)) words.set(w, (words.get(w) || 0) + 1);
    }
  }
  const top = [...words.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 12);

  rail.innerHTML = `
    <div class="rail-block">
      <p class="rail-label">本批次速览</p>
      <dl class="metrics">
        <div class="metric"><dt>已接入源</dt><dd>${ok.length}</dd></div>
        <div class="metric"><dt>采集条目</dt><dd>${total}</dd></div>
        <div class="metric"><dt>新上榜</dt><dd>${fresh}</dd></div>
        <div class="metric"><dt>更新时间</dt><dd style="font-size:1.05rem">${esc(new Date().toTimeString().slice(0, 5))}</dd></div>
      </dl>
    </div>
    <div class="rail-block">
      <p class="rail-label">跨源热词</p>
      <div class="word-cloud">
        ${top.length
          ? top.map(([w, n]) => `<a href="#/boards?q=${encodeURIComponent(w)}">${esc(w)}<sup>${n}</sup></a>`).join("")
          : `<span class="note">需要至少两个源出现同一词，才会进入热词。</span>`}
      </div>
    </div>
    <div class="rail-block">
      <p class="rail-label">各分类头条</p>
      <div class="batch-events">
        ${["国内", "国际", "科技", "财经"].map((cat) => {
          const b = ok.find((x) => x.cat === cat);
          const it = b?.items?.[0];
          return it
            ? `<div class="event"><span class="chip">${esc(cat)}</span><a class="item-title" href="${esc(it.url || "#/boards")}" ${it.url ? 'target="_blank" rel="noopener"' : ""}>${esc(it.title)}</a></div>`
            : `<div class="event"><span class="chip">${esc(cat)}</span><span class="note">本批次无数据</span></div>`;
        }).join("")}
      </div>
    </div>`;
}

const STOP = new Set(["的", "了", "是", "在", "和", "与", "为", "将", "已", "被", "对", "从", "到", "中", "上", "下", "个", "年", "月", "日", "时", "中国", "美国", "全球", "最新", "宣布", "表示", "回应", "首次", "一个", "我们", "他们"]);

function extractWords(title) {
  const out = [];
  const zh = String(title).match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  for (const w of zh) if (!STOP.has(w)) out.push(w);
  const en = String(title).match(/[A-Za-z][A-Za-z0-9.+-]{2,}/g) || [];
  for (const w of en) out.push(w);
  return [...new Set(out)];
}

async function ensureBoards() {
  if (state.boards.size) return;
  try {
    await fetchBoards({});
  } catch { /* 速览失败不影响日报 */ }
}

function bindRetry(load) {
  const host = $("#viewHost");
  host.querySelectorAll('[data-retry="digest"]').forEach((btn) =>
    btn.addEventListener("click", load, { once: true }));
  host.querySelector('[data-copy="digest"]')?.addEventListener("click", () => {
    const d = state.digest;
    if (!d) return toast("还没有可复制的日报", { tone: "error" });
    const md = [`# ${d.date} 每天 60 秒读懂世界`, "", ...d.news.map((t, i) => `${i + 1}. ${t}`), d.tip ? `\n> ${d.tip}` : "", d.link ? `\n原文：${d.link}` : ""].join("\n");
    copyText(md);
  });
}

function bindArchive(host) {
  host.querySelectorAll("[data-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const delta = parseInt(btn.dataset.day, 10);
      const cur = new Date($("#datePicker").value || todayISO());
      cur.setDate(cur.getDate() + delta);
      const next = cur.toISOString().slice(0, 10);
      if (next > todayISO()) return;
      location.hash = `#/today?date=${next}`;
    });
  });
  $("#datePicker")?.addEventListener("change", (e) => {
    const v = e.target.value;
    if (!v) return;
    location.hash = v === todayISO() ? "#/today" : `#/today?date=${v}`;
  });
}
