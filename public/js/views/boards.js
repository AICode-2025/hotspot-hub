// 分类热榜：分类/状态筛选、关键词表达式、卡片/列表、跨源检索
import {
  $, $$, esc, fmtHot, skeleton, errorState, emptyState, parseKeyword, matchKeyword,
  trendBadge, debounce, readPref, writePref, toast, copyText,
} from "../ui.js";
import { state, fetchBoards } from "../api.js";

export const meta = { path: "boards", title: "分类热榜", kicker: "第 II 栏", icon: "boards", nav: true, tab: true };

const ui = {
  cat: "全部",
  status: "all",
  q: "",
  view: "cards",
  expanded: new Set(),
};

export async function render({ query }) {
  const host = $("#viewHost");
  ui.cat = query.get("cat") || readPref("boards.cat", "全部");
  ui.status = query.get("status") || "all";
  ui.q = query.get("q") || "";
  ui.view = query.get("view") || readPref("boards.view", "cards");

  host.innerHTML = `
    <section class="section">
      <div class="filter-bar">
        <div class="tabs" id="catTabs" role="tablist" aria-label="分类"></div>
        <div class="tabs" id="statusTabs" role="tablist" aria-label="接入状态"></div>
      </div>
      <div class="filter-inputs" style="margin-block-end:var(--sp-4)">
        <div class="keyword-field">
          <input id="kwInput" type="search" placeholder="关键词：词A 词B  +必含  !排除  /正则/  @10" autocomplete="off" aria-label="关键词筛选" value="${esc(ui.q)}" />
        </div>
        <span class="hit-count" id="hitCount">—</span>
        <div class="seg" id="viewSeg" role="group" aria-label="视图切换">
          <button type="button" data-view="cards" aria-pressed="${ui.view === "cards"}">卡片</button>
          <button type="button" data-view="list" aria-pressed="${ui.view === "list"}">列表</button>
        </div>
        <button class="btn btn--quiet" id="copyAll" type="button">复制当前结果</button>
      </div>
      <div id="boardBody"></div>
    </section>`;

  const body = $("#boardBody");
  body.innerHTML = `<div class="board-grid">${skeleton(8, [90, 76, 84, 68])}</div>`;

  let destroyed = false;
  const paint = () => {
    if (destroyed) return;
    paintTabs();
    paintBody(body);
  };

  const load = async (force = false) => {
    body.innerHTML = `<div class="board-grid">${skeleton(8, [90, 76, 84, 68])}</div>`;
    try {
      if (force || !state.boards.size) await fetchBoards({});
      if (destroyed) return;
      paint();
    } catch (e) {
      if (destroyed) return;
      body.innerHTML = errorState({ title: "热榜加载失败", message: e.message, code: e.code, retry: "boards" });
      body.querySelector('[data-retry]')?.addEventListener("click", () => load(true), { once: true });
    }
  };

  const onKw = debounce(() => {
    ui.q = $("#kwInput").value.trim();
    syncUrl({ replace: true });
    paint();
  }, 280);

  $("#kwInput").addEventListener("input", onKw);
  $("#viewSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    ui.view = btn.dataset.view;
    writePref("boards.view", ui.view);
    syncUrl({ replace: true });
    paint();
  });
  $("#catTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    ui.cat = btn.dataset.cat;
    writePref("boards.cat", ui.cat);
    syncUrl({ replace: true });
    paint();
  });
  $("#statusTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-status]");
    if (!btn) return;
    ui.status = btn.dataset.status;
    syncUrl({ replace: true });
    paint();
  });
  body.addEventListener("click", (e) => {
    const exp = e.target.closest("[data-expand]");
    if (exp) {
      const id = exp.dataset.expand;
      ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id);
      paint();
      return;
    }
    const copy = e.target.closest("[data-copy-one]");
    if (copy) {
      const id = copy.dataset.copyOne;
      const b = state.boards.get(id);
      const idx = Number(copy.dataset.idx);
      const it = b?.items?.[idx];
      if (it) copyText(it.url ? `${it.title}\n${it.url}` : it.title);
    }
  });
  $("#copyAll").addEventListener("click", () => copyCurrent());

  function copyCurrent() {
    const rows = collect();
    if (!rows.length) return toast("当前筛选没有结果", { tone: "error" });
    const md = rows.map(({ b, it }) => `- ${it.title}${it.url ? ` — ${it.url}` : ""}（${b.name}）`).join("\n");
    copyText(`# 热榜摘录 ${new Date().toLocaleString("zh-CN", { hour12: false })}\n\n${md}`);
  }

  paintTabs();
  await load();

  return () => { destroyed = true; };

  /* ---------- 内部 ---------- */

  function paintTabs() {
    const cats = ["全部", ...(state.cats || []).filter((c) => c !== "全部")];
    $("#catTabs").innerHTML = cats
      .map((c) => `<button class="tab" type="button" role="tab" data-cat="${esc(c)}" aria-selected="${c === ui.cat}">${esc(c)}</button>`)
      .join("");
    const statuses = [["all", "全部"], ["ok", "已接入"], ["bad", "不可用"]];
    $("#statusTabs").innerHTML = statuses
      .map(([k, label]) => `<button class="tab" type="button" role="tab" data-status="${k}" aria-selected="${k === ui.status}">${esc(label)}</button>`)
      .join("");
  }

  function normalizeKw() {
    const kw = parseKeyword(ui.q);
    if (ui.q && !kw.valid) {
      $("#hitCount").innerHTML = `<span style="color:var(--err)">${esc(kw.error)}</span>`;
      return null;
    }
    return kw;
  }

  function listBoards() {
    return [...state.boards.values()].filter((b) => {
      if (ui.cat !== "全部" && b.cat !== ui.cat) return false;
      if (ui.status === "ok" && b.status !== "ok") return false;
      if (ui.status === "bad" && b.status === "ok") return false;
      return true;
    });
  }

  function collect() {
    const kw = normalizeKw();
    const rows = [];
    for (const b of listBoards()) {
      if (b.status !== "ok") continue;
      b.items.forEach((it) => {
        if (!ui.q || (kw && matchKeyword(it.title, kw))) rows.push({ b, it });
      });
    }
    return rows;
  }

  function paintBody(body) {
    const kw = normalizeKw();
    const boards = listBoards();
    const rows = collect();
    const limit = kw?.limit || 0;
    const shown = limit ? rows.slice(0, limit) : rows;

    $("#hitCount").textContent = ui.q
      ? `命中 ${shown.length} 条 · ${new Set(shown.map((r) => r.b.id)).size} 个源`
      : `${rows.length} 条 · ${boards.filter((b) => b.status === "ok").length}/${boards.length} 源可用`;

    if (!boards.length) {
      body.innerHTML = emptyState({
        title: "没有符合条件的源",
        why: "当前分类与状态组合下没有数据源，换一个分类或把状态改为「全部」。",
        actions: [`<a class="btn btn--quiet" href="#/sources">查看数据源状态</a>`],
      });
      return;
    }

    if (ui.q && !shown.length) {
      body.innerHTML = emptyState({
        title: "没有命中",
        why: `关键词「${ui.q}」在已采集的标题中没有匹配。可尝试减少限定词，或改用更短的词。`,
        actions: [`<button class="btn btn--quiet" data-clear>清空关键词</button>`],
      });
      body.querySelector("[data-clear]")?.addEventListener("click", () => {
        ui.q = "";
        $("#kwInput").value = "";
        syncUrl({ replace: true });
        paint();
      });
      return;
    }

    if (ui.view === "list") {
      body.innerHTML = `<div class="compact-list">${shown.map(({ b, it }, i) => {
        const rank = b.items.indexOf(it) + 1;
        return `<div class="compact-row">
          <span class="item-rank">${String(rank).padStart(2, "0")}</span>
          ${it.url
            ? `<a class="item-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
            : `<span class="item-title">${esc(it.title)}</span>`}
          <span class="compact-src">${esc(b.name)}</span>
          <span>${trendBadge(b.trends?.[it.title])}${it.hot ? `<span class="item-hot">${esc(fmtHot(it.hot))}</span>` : ""}</span>
        </div>`;
      }).join("")}</div>`;
      return;
    }

    body.innerHTML = `<div class="board-grid">${boards.map((b) => cardHtml(b, kw)).join("")}</div>`;
  }

  function cardHtml(b, kw) {
    const open = ui.expanded.has(b.id);
    if (b.status !== "ok") {
      return `<article class="board-card is-unavailable">
        <div class="card-head"><span class="card-name">${esc(b.name)}</span>
          <span class="card-chips"><span class="chip">${esc(b.cat)}</span></span></div>
        <p class="note" style="margin-block-start:.4rem">${esc(b.reason || "上游未返回数据")}</p>
        <a class="expand-btn" href="#/sources" style="text-decoration:none">排查该源 →</a>
      </article>`;
    }
    const matched = kw?.limit || kw?.must?.length || kw?.plain?.length || kw?.excl?.length || kw?.re?.length
      ? b.items.map((it, i) => ({ it, i })).filter(({ it }) => matchKeyword(it.title, kw))
      : b.items.map((it, i) => ({ it, i }));
    const view = open ? matched.slice(0, 30) : matched.slice(0, 10);
    return `<article class="board-card">
      <div class="card-head">
        <span class="card-name">${esc(b.name)}</span>
        <span class="card-chips">
          ${b.adapter ? `<span class="chip chip--live">${esc(b.adapter)}</span>` : ""}
          <span class="chip">${matched.length}</span>
        </span>
      </div>
      ${b.updated ? `<p class="card-updated">${esc(b.updated)}</p>` : ""}
      <ol class="card-list">
        ${view.map(({ it, i }) => `<li class="item-row">
          <span class="item-rank">${String(i + 1).padStart(2, "0")}</span>
          ${it.url
            ? `<a class="item-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>`
            : `<span class="item-title">${esc(it.title)}</span>`}
          <span>${trendBadge(b.trends?.[it.title])}${it.hot ? `<span class="item-hot">${esc(fmtHot(it.hot))}</span>` : ""}</span>
        </li>`).join("")}
      </ol>
      ${matched.length > 10
        ? `<button class="expand-btn" type="button" data-expand="${esc(b.id)}">${open ? "收起" : `展开全部 ${Math.min(matched.length, 30)} 条`}</button>`
        : ""}
    </article>`;
  }

  function syncUrl({ replace } = {}) {
    const qs = new URLSearchParams();
    if (ui.cat && ui.cat !== "全部") qs.set("cat", ui.cat);
    if (ui.status !== "all") qs.set("status", ui.status);
    if (ui.q) qs.set("q", ui.q);
    if (ui.view !== "cards") qs.set("view", ui.view);
    const hash = `#/boards${qs.toString() ? `?${qs}` : ""}`;
    history.replaceState(null, "", hash);
  }
}
