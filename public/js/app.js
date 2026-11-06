// 入口：导航、路由注册、模式提示、全局检索、主题与刷新
import { $, $$, esc, readPref, toast, icon, debounce } from "./ui.js";
import { state, init, fetchBoards, modeLabel } from "./api.js";
import { Router, navigate } from "./router.js";
import * as today from "./views/today.js";
import * as boards from "./views/boards.js";
import * as trends from "./views/trends.js";
import * as data from "./views/data.js";
import * as sources from "./views/sources.js";
import * as more from "./views/more.js";

const VIEWS = [today, boards, trends, data, sources, more];
const NAV = VIEWS.map((v) => v.meta);
const TABS = NAV.filter((m) => m.tab);
const BUILD = window.__BUILD__ || "dev";

window.__BUILD__ = BUILD;

const router = new Router({
  host: $("#viewHost"),
  routes: VIEWS.map((v) => ({ path: v.meta.path, title: v.meta.title, kicker: v.meta.kicker, render: v.render })),
  fallback: "today",
  onBefore(route) {
    document.title = `${route.title} — 热点晨报`;
    $("#viewTitle").textContent = route.title;
    $("#viewKicker").textContent = route.kicker || "";
    markActive(route.path);
  },
});

/* ---------------- 导航 ---------------- */

function renderNav() {
  $("#navList").innerHTML = NAV.map((m) => `
    <li class="nav-item" data-path="${esc(m.path)}">
      <a href="#/${esc(m.path)}" ${location.hash.startsWith(`#/${m.path}`) ? 'aria-current="page"' : ""}>
        ${icon(m.icon)}<span>${esc(m.title)}</span>
      </a>
    </li>`).join("");

  $("#tabList").innerHTML = TABS.map((m) => `
    <li class="tab-item" data-path="${esc(m.path)}">
      <a href="#/${esc(m.path)}">${icon(m.icon)}<span>${esc(m.title.replace("分类", "").replace("排名", "").replace("实用数据", "数据"))}</span></a>
    </li>`).join("");
}

function markActive(path) {
  $$(".nav-item, .tab-item").forEach((li) => {
    const on = li.dataset.path === path;
    li.classList.toggle("active", on);
    const a = li.querySelector("a");
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

/* ---------------- 模式提示 ---------------- */

function paintMode() {
  const mode = state.mode;
  const badge = $("#modeBadge");
  badge.dataset.mode = mode === "live" ? "live" : mode === "static" ? "static" : mode === "legacy" ? "live" : "error";
  badge.textContent = modeLabel();

  const banner = $("#modeBanner");
  if (mode === "static") {
    banner.hidden = false;
    banner.dataset.tone = "";
    banner.innerHTML = `静态快照 · 采集于 ${esc(state.snapshotAt ? new Date(state.snapshotAt).toLocaleString("zh-CN", { hour12: false }) : "未知时间")}。
      实时接口未连接，页面内容不会自动更新。<a href="#/sources">查看数据源状态</a>`;
  } else if (mode === "error") {
    banner.hidden = false;
    banner.dataset.tone = "error";
    banner.textContent = `数据服务不可用：${state.lastError || "无法连接"}。页面可能只显示本地缓存内容。`;
  } else if (mode === "legacy") {
    banner.hidden = false;
    banner.dataset.tone = "";
    banner.textContent = "已连接本地 Node 服务（兼容模式）：实时数据可用，实用数据与影视榜需部署 Cloudflare Worker。";
  } else {
    banner.hidden = true;
  }

  const total = state.sources.length;
  const loaded = state.boards.size;
  const ok = [...state.boards.values()].filter((b) => b.status === "ok").length;
  $("#sideStatus").innerHTML = !total
    ? "等待数据…"
    : loaded < total
      ? `采集 <b>${loaded}</b>/${total} 源`
      : `可用 <b>${ok}</b> / ${total} 源`;
  $("#colophonMeta").textContent = [
    `模式 ${modeLabel()}`,
    state.snapshotAt ? `快照 ${new Date(state.snapshotAt).toISOString().slice(0, 16).replace("T", " ")}` : "",
    `构建 ${BUILD}`,
  ].filter(Boolean).join(" · ");
}

/* ---------------- 检索 ---------------- */

const searchInput = $("#globalSearch");
const searchClear = $("#searchClear");

function runSearch() {
  const q = searchInput.value.trim();
  if (!q) return;
  navigate("boards", { query: { q } });
  searchInput.blur();
}

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runSearch(); }
  if (e.key === "Escape") { searchInput.value = ""; searchClear.hidden = true; searchInput.blur(); }
});
searchInput.addEventListener("input", () => { searchClear.hidden = !searchInput.value; });
searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.hidden = true;
  searchInput.focus();
});

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (e.key === "Escape" && document.activeElement === searchInput) {
    searchInput.blur();
  }
});

/* ---------------- 刷新与在线状态 ---------------- */

$("#refreshBtn").addEventListener("click", async () => {
  const btn = $("#refreshBtn");
  btn.setAttribute("aria-busy", "true");
  try {
    await fetchBoards({});
    router.key = "";
    await router.render();
    paintMode();
    toast("已重新采集");
  } catch (e) {
    toast(`刷新失败：${e.message}`, { tone: "error" });
  } finally {
    btn.removeAttribute("aria-busy");
  }
});

window.addEventListener("hotspot:boards", () => paintMode());

window.addEventListener("online", () => {
  toast("网络已恢复");
  router.key = "";
  router.render();
});
window.addEventListener("offline", () => toast("网络已断开，显示缓存内容", { tone: "error" }));

window.addEventListener("hashchange", () => {
  const q = new URLSearchParams(location.hash.split("?")[1] || "").get("q");
  if (q != null) {
    searchInput.value = q;
    searchClear.hidden = !q;
  }
});

/* ---------------- 启动 ---------------- */

function applyPrefs() {
  const theme = readPref("theme", "auto");
  const density = readPref("density", "comfortable");
  if (theme !== "auto") document.documentElement.dataset.theme = theme;
  if (density === "compact") document.documentElement.dataset.density = "compact";
}

async function boot() {
  applyPrefs();
  renderNav();
  $("#modeBadge").dataset.mode = "live";
  $("#sideStatus").textContent = "正在检测数据源…";

  await init();
  window.__SOURCES__ = state.sources;
  window.__API_MODE__ = state.mode;

  paintMode();
  await router.render();

  // 后台补齐榜单，用于侧栏状态与速览（失败不阻塞）
  if (state.mode !== "static" && state.mode !== "error") {
    fetchBoards({}).then(() => {
      paintMode();
      router.key = "";
      if (router.current?.path === "today") router.render();
    }).catch(() => {});
  }
}

boot();
