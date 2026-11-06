// 数据源：健康总览、明细表、单源重试
import { $, esc, skeleton, errorState, emptyState, fmtTime, toast, debounce, icon } from "../ui.js";
import { state, fetchBoards, fetchHealth } from "../api.js";

export const meta = { path: "sources", title: "数据源", kicker: "第 V 栏", icon: "sources", nav: true, tab: false };

export async function render() {
  const host = $("#viewHost");
  host.innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">数据源健康</h2>
        <div class="filter-inputs">
          <div class="keyword-field" style="max-inline-size:16rem">
            <input id="srcFilter" type="search" placeholder="筛选源名或分类" aria-label="筛选数据源" autocomplete="off" />
          </div>
          <button class="btn btn--quiet" id="refreshAll" type="button">全部重试</button>
        </div>
      </div>
      <div id="srcBody">${skeleton(6, [90, 74, 82, 60])}</div>
    </section>`;

  let destroyed = false;

  const paint = () => {
    const q = ($("#srcFilter").value || "").trim();
    const dims = state.sources.filter((s) => !q || s.name.includes(q) || s.cat.includes(q) || s.id.includes(q));
    const boards = dims.map((s) => state.boards.get(s.id)).filter(Boolean);
    const ok = boards.filter((b) => b?.status === "ok");
    const bad = boards.filter((b) => b?.status !== "ok" && b);
    const totalItems = ok.reduce((n, b) => n + b.items.length, 0);

    $("#srcBody").innerHTML = `
      <div class="health-grid">
        ${healthCard("ok", state.sources.length, "注册源")}
        ${healthCard("ok", ok.length, "本轮可用")}
        ${healthCard(bad.length ? "warn" : "ok", bad.length, "不可用")}
        ${healthCard("warn", totalItems, "采集条目")}
        ${healthCard(state.mode === "static" ? "warn" : "ok", state.mode === "static" ? "快照" : "实时", "数据模式")}
      </div>
      ${state.mode === "static"
        ? `<div class="mode-banner" style="margin-block-end:var(--sp-4)">静态快照模式：来源状态取自构建时的采集结果，不能实时重试。部署 Cloudflare Worker 后可获得实时状态。</div>`
        : ""}
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>源</th><th>分类</th><th>状态</th><th>通道</th><th>条目</th><th>最近更新</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${dims.map((s) => {
              const b = state.boards.get(s.id);
              const okRow = b?.status === "ok";
              return `<tr data-row="${esc(s.id)}">
                <td><b>${esc(s.name)}</b><div class="note note--mono">${esc(s.id)}</div></td>
                <td>${esc(s.cat)}</td>
                <td><span class="status-dot" data-s="${okRow ? "ok" : "err"}"></span>${okRow ? "可用" : "不可用"}</td>
                <td class="num">${esc(b?.adapter || "—")}</td>
                <td class="num">${okRow ? b.items.length : 0}</td>
                <td class="num">${esc(b?.updated ? fmtTime(Date.parse(b.updated) || b.updated) : "—")}</td>
                <td><button class="btn btn--quiet" style="min-height:30px;padding:.2rem .5rem" data-reload-src="${esc(s.id)}" ${state.mode === "static" ? "disabled" : ""}>${icon("refresh", "ico")} 重试</button></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      ${dims.length ? "" : emptyState({ title: "没有匹配的数据源", why: "换一个关键词试试。" })}
      <p class="note" style="margin-block-start:var(--sp-3)">
        通道含义：<code>s60</code> 60s API · <code>newsnow</code> NewsNow 实例 · <code>hn</code> Hacker News · <code>github</code> GitHub · <code>wscn</code> 华尔街见闻 · <code>rss</code> RSS 直连。
      </p>`;

    $("#srcBody").querySelectorAll("[data-reload-src]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.reloadSrc;
        btn.setAttribute("aria-busy", "true");
        btn.disabled = true;
        try {
          const [b] = await fetchBoards({ ids: [id] });
          if (b?.status === "ok") toast(`${b.name} 已刷新，${b.items.length} 条`, { tone: "info" });
          else toast(`${b?.name || id} 仍不可用：${b?.reason || "上游无响应"}`, { tone: "error" });
          paint();
        } catch (e) {
          toast(`刷新失败：${e.message}`, { tone: "error" });
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
        }
      });
    });
  };

  try {
    await Promise.all([state.boards.size ? null : fetchBoards({}), fetchHealth().catch(() => null)]);
    if (destroyed) return;
    paint();
  } catch (e) {
    if (destroyed) return;
    $("#srcBody").innerHTML = errorState({ title: "数据源加载失败", message: e.message, code: e.code, retry: "sources" });
  }

  $("#srcFilter").addEventListener("input", debounce(paint, 180));
  $("#refreshAll").addEventListener("click", async () => {
    const btn = $("#refreshAll");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    try {
      await fetchBoards({});
      paint();
      toast("已重新拉取全部数据源");
    } catch (e) {
      toast(`重试失败：${e.message}`, { tone: "error" });
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });

  return () => { destroyed = true; };
}

function healthCard(tone, value, label) {
  return `<div class="health-card" data-tone="${tone}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}
