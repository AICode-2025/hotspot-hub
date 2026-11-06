// 走势：源 → 话题 → 真实排名曲线；涨跌榜；采集批次时间线
import { $, esc, skeleton, errorState, emptyState, trendBadge, fmtTime } from "../ui.js";
import { state, fetchBoards, fetchTrend, fetchTimeline } from "../api.js";

export const meta = { path: "trends", title: "排名走势", kicker: "第 III 栏", icon: "trends", nav: true, tab: true };

const ui = { sourceId: "", title: "", timer: null };

export async function render({ query }) {
  const host = $("#viewHost");
  ui.sourceId = query.get("src") || "";
  ui.title = query.get("t") || "";

  host.innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">排名走势</h2>
        <span class="note">曲线只来自真实采集快照，样本不足时不画线</span>
      </div>
      <div class="trend-layout">
        <aside>
          <label class="rail-label" for="trendSource">选择数据源</label>
          <select id="trendSource" class="date-input" style="inline-size:100%;margin-block-end:.75rem"></select>
          <div class="topic-list" id="topicList" role="listbox" aria-label="话题列表"></div>
        </aside>
        <div class="chart-panel" id="chartPanel"></div>
      </div>
    </section>
    <section class="section" id="moveSection"></section>
    <section class="section" id="batchSection">
      <div class="section-head"><h2 class="section-title">采集时间线</h2><span class="note">按批次展示新上榜与大幅上升</span></div>
      <div id="batchBody">${skeleton(3, [80, 64, 72])}</div>
    </section>`;

  let destroyed = false;
  const cleanup = () => { destroyed = true; clearTimeout(ui.timer); };

  try {
    if (!state.boards.size) await fetchBoards({});
  } catch (e) {
    $("#chartPanel").innerHTML = errorState({ title: "走势数据不可用", message: e.message, retry: "trend" });
    return cleanup;
  }
  if (destroyed) return cleanup;

  const usable = [...state.boards.values()].filter((b) => b.status === "ok");
  if (!usable.length) {
    $("#chartPanel").innerHTML = emptyState({ title: "还没有可分析的源", why: "需要至少一个源成功返回榜单，才具备排名序列。" });
    return cleanup;
  }

  const sel = $("#trendSource");
  sel.innerHTML = state.sources
    .map((s) => {
      const b = state.boards.get(s.id);
      return `<option value="${esc(s.id)}" ${b?.status !== "ok" ? "disabled" : ""}>${esc(s.name)}${b?.status !== "ok" ? "（不可用）" : ""}</option>`;
    })
    .join("");
  if (!ui.sourceId || !usable.some((b) => b.id === ui.sourceId)) ui.sourceId = usable[0].id;
  sel.value = ui.sourceId;

  sel.addEventListener("change", () => {
    ui.sourceId = sel.value;
    ui.title = "";
    syncUrl();
    paintTopics();
    paintChart();
  });

  paintTopics();
  paintChart();
  paintMoves();
  loadTimeline();

  return cleanup;

  function topics() {
    return state.boards.get(ui.sourceId)?.items || [];
  }

  function paintTopics() {
    const list = $("#topicList");
    const items = topics();
    if (!ui.title || !items.some((t) => t.title === ui.title)) ui.title = items[0]?.title || "";
    list.innerHTML = items.slice(0, 40).map((t, i) => `
      <button class="topic-item" type="button" role="option" data-t="${esc(t.title)}"
        aria-selected="${t.title === ui.title}">
        <span class="item-rank">${String(i + 1).padStart(2, "0")}</span>
        <span>${esc(t.title)}</span>
      </button>`).join("");
    list.querySelectorAll("[data-t]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ui.title = btn.dataset.t;
        syncUrl();
        paintTopics();
        paintChart();
      });
    });
  }

  async function paintChart() {
    const host2 = $("#chartPanel");
    if (!ui.title) {
      host2.innerHTML = emptyState({ title: "该源没有话题", why: "换一个数据源试试。" });
      return;
    }
    host2.innerHTML = `<div class="chart-title">${esc(ui.title)}</div>${skeleton(4, [96, 88, 92, 70])}`;
    try {
      const { points, note } = await fetchTrend(ui.sourceId, ui.title);
      if (destroyed) return;
      const board = state.boards.get(ui.sourceId);
      document.title = `${ui.title} · 走势 — 热点晨报`;
      host2.innerHTML = `
        <div class="chart-title">${esc(ui.title)}</div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-block-end:.75rem">
          <span class="chip">${esc(board?.name || "")}</span>
          <span class="chip">${esc(board?.cat || "")}</span>
          ${trendBadge(board?.trends?.[ui.title])}
        </div>
        ${points.length >= 2
          ? chartSvg(points)
          : `<div class="empty" style="border-style:dashed">
              <span class="state-mark">样本不足</span>
              <p class="state-why">${esc(note || `当前只有 ${points.length} 个有效快照点，至少需要 2 个才能看出走势。`)}</p>
              <p class="state-why">采集每 10 分钟一次，稍后回来看会有更多点。</p>
            </div>`}
        ${statsHtml(points)}`;
    } catch (e) {
      if (destroyed) return;
      host2.innerHTML = `<div class="chart-title">${esc(ui.title)}</div>
        ${errorState({ title: "走势加载失败", message: e.message, code: e.code })}`;
    }
  }

  function paintMoves() {
    const fresh = [];
    const rising = [];
    for (const b of state.boards.values()) {
      if (b.status !== "ok") continue;
      b.items.forEach((it, i) => {
        const t = b.trends?.[it.title];
        if (!t) return;
        if (t.isNew) fresh.push({ b, it, rank: i + 1 });
        else if (typeof t.delta === "number" && t.delta >= 5) rising.push({ b, it, rank: i + 1, delta: t.delta });
      });
    }
    rising.sort((a, b) => b.delta - a.delta);
    const sec = $("#moveSection");
    if (!fresh.length && !rising.length) {
      sec.innerHTML = `<div class="section-head"><h2 class="section-title">涨跌榜</h2></div>
        ${emptyState({ title: "本批次没有明显变动", why: "需要至少两个采集批次才能比较涨跌；首次采集后 10 分钟再刷新即可。" })}`;
      return;
    }
    sec.innerHTML = `
      <div class="section-head"><h2 class="section-title">涨跌榜</h2>
        <span class="note">新上榜 ${fresh.length} 条 · 上升 ≥5 位 ${rising.length} 条</span></div>
      <div class="batch">
        <div class="batch-events">
          ${[...rising.slice(0, 12).map((r) => eventRow(r, "up")), ...fresh.slice(0, 12).map((r) => eventRow(r, "new"))].join("")}
        </div>
      </div>`;
  }

  function eventRow({ b, it, rank, delta }, kind) {
    return `<div class="event">
      <span class="chip">${esc(b.name)}</span>
      ${kind === "up" ? `<span class="trend" data-k="up">▲${delta}</span>` : `<span class="trend" data-k="new">新</span>`}
      <a class="item-title" href="${esc(it.url || `#/trends?src=${b.id}`)}" ${it.url ? 'target="_blank" rel="noopener"' : ""}>${esc(it.title)}</a>
      <span class="note note--mono">#${rank}</span>
    </div>`;
  }

  async function loadTimeline() {
    try {
      const data = await fetchTimeline();
      if (destroyed) return;
      const batches = data?.batches || [];
      $("#batchBody").innerHTML = batches.length
        ? `<div class="batch-list">${batches.map((b) => `
          <article class="batch">
            <div class="batch-head">
              <span class="batch-time">${esc(fmtTime(b.t))}</span>
              <span class="note">${b.sources?.length || 0} 个源 · ${b.events?.length || 0} 个变动</span>
            </div>
            ${b.events?.length ? `<div class="batch-events">${b.events.slice(0, 8).map((e) => `
              <div class="event">
                <span class="chip">${esc(e.source || "")}</span>
                ${e.kind === "new" ? `<span class="trend" data-k="new">新</span>` : `<span class="trend" data-k="up">▲${e.delta || 0}</span>`}
                <span class="item-title">${esc(e.title || "")}</span>
                <span class="note note--mono">#${e.rank || "-"}</span>
              </div>`).join("")}</div>` : `<p class="note" style="margin-block-start:.4rem">该批次没有新增或大幅上升。</p>`}
          </article>`).join("")}</div>`
        : emptyState({ title: "还没有批次记录", why: "服务端会在每次采集后写入快照，积累两批后这里才有对比。" });
    } catch (e) {
      if (destroyed) return;
      $("#batchBody").innerHTML = errorState({ title: "时间线加载失败", message: e.message, code: e.code });
    }
  }

  function syncUrl() {
    const qs = new URLSearchParams();
    if (ui.sourceId) qs.set("src", ui.sourceId);
    if (ui.title) qs.set("t", ui.title);
    history.replaceState(null, "", `#/trends?${qs}`);
  }
}

function chartSvg(points) {
  const W = 720, H = 200, padX = 28, padY = 18;
  const ranks = points.map((p) => p.rank);
  const max = Math.max(...ranks, 10);
  const min = 1;
  const n = points.length;
  const x = (i) => padX + (i * (W - padX * 2)) / Math.max(1, n - 1);
  const y = (r) => padY + ((r - min) / Math.max(1, max - min)) * (H - padY * 2);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.rank).toFixed(1)}`).join(" ");
  const area = `${path} L ${x(n - 1).toFixed(1)} ${H - padY} L ${padX} ${H - padY} Z`;
  const best = points.reduce((a, b) => (b.rank < a.rank ? b : a), points[0]);
  const last = points[n - 1];
  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
      aria-label="排名走势：最新第 ${last.rank} 名，最好第 ${best.rank} 名">
      ${[0.25, 0.5, 0.75].map((f) => `<line x1="${padX}" x2="${W - padX}" y1="${(padY + f * (H - padY * 2)).toFixed(1)}" y2="${(padY + f * (H - padY * 2)).toFixed(1)}" stroke="currentColor" stroke-opacity=".12" stroke-dasharray="2 4"/>`).join("")}
      <path d="${area}" fill="var(--accent)" opacity="0.08"/>
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.rank).toFixed(1)}" r="${i === n - 1 ? 4 : 2.4}" fill="var(--accent)"><title>第 ${p.rank} 名 · ${fmtTime(p.t)}</title></circle>`).join("")}
    </svg>
    <div class="chart-axis"><span>${esc(fmtTime(points[0].t))}</span><span>排名越小越高</span><span>${esc(fmtTime(last.t))}</span></div>
  </div>`;
}

function statsHtml(points) {
  if (!points.length) return "";
  const ranks = points.map((p) => p.rank);
  const last = ranks[ranks.length - 1];
  const best = Math.min(...ranks);
  const worst = Math.max(...ranks);
  const first = ranks[0];
  const dir = last < first ? "▲ 上升" : last > first ? "▼ 下降" : "— 持平";
  return `<div class="stat-row">
    <div class="stat"><b>#${last}</b><span>最新排名</span></div>
    <div class="stat"><b>#${best}</b><span>最佳排名</span></div>
    <div class="stat"><b>#${worst}</b><span>最差排名</span></div>
    <div class="stat"><b>${ranks.length}</b><span>有效样本</span></div>
    <div class="stat"><b>${dir}</b><span>相对首次</span></div>
  </div>`;
}
