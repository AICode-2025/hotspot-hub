// 更多：关于、API、内容后台（本地）、偏好
import { $, esc, readPref, writePref, toast, copyText, openDialog, icon } from "../ui.js";

export const meta = { path: "more", title: "更多", kicker: "第 VI 栏", icon: "more", nav: true, tab: true };

const OVERRIDE_KEY = "hotspot.overrides";

export async function render() {
  const host = $("#viewHost");
  host.innerHTML = `
    <section class="section">
      <div class="section-head">
        <h2 class="section-title">关于与设置</h2>
        <span class="note note--mono">v2.0 · 前端 ${esc(window.__BUILD__ || "dev")}</span>
      </div>

      <div class="prose">
        <p>热点晨报把「每天 60 秒读懂世界」与 49 路国内外热榜放在同一份刊物里。每条内容都标注来源与采集通道，不可用就明确说不可用，不用示例数据凑数。</p>
        <ul>
          <li>日报与热榜数据来自 <a href="https://github.com/vikiboss/60s" target="_blank" rel="noopener">60s API</a>（MIT）</li>
          <li>国际与垂类榜单来自 <a href="https://github.com/newsnext/newsnow" target="_blank" rel="noopener">NewsNow</a>（MIT）</li>
          <li>筛选、趋势与推送思路参考 <a href="https://github.com/sansan0/TrendRadar" target="_blank" rel="noopener">TrendRadar</a>（GPL-3.0）</li>
        </ul>
      </div>

      <div class="section" style="margin-block-start:var(--sp-6)">
        <div class="section-head"><h2 class="section-title">偏好</h2></div>
        <div class="pref-row">
          <div><b>主题</b><p class="note">跟随系统时，夜晚自动切换为墨纸底色。</p></div>
          <div class="seg" id="themeSeg" role="group" aria-label="主题">
            <button type="button" data-theme="auto">跟随系统</button>
            <button type="button" data-theme="paper">纸</button>
            <button type="button" data-theme="night">夜</button>
          </div>
        </div>
        <div class="pref-row">
          <div><b>信息密度</b><p class="note">紧凑模式会压缩行距，适合一屏看更多。</p></div>
          <div class="seg" id="densitySeg" role="group" aria-label="密度">
            <button type="button" data-density="comfortable">舒适</button>
            <button type="button" data-density="compact">紧凑</button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <h2 class="section-title">开放接口</h2>
          <button class="btn btn--quiet" id="copyApi" type="button">复制接口清单</button>
        </div>
        <div class="table-wrap api-table">
          <table>
            <thead><tr><th>端点</th><th>说明</th></tr></thead>
            <tbody>
              ${[
                ["GET /api/v1/meta", "数据源目录与分类"],
                ["GET /api/v1/boards?cat=&ids=&limit=", "批量榜单（含趋势与通道）"],
                ["GET /api/v1/board/:id", "单源榜单"],
                ["GET /api/v1/digest?date=", "60 秒日报（默认今天）"],
                ["GET /api/v1/trends?id=&title=&hours=", "单话题排名序列"],
                ["GET /api/v1/timeline", "采集批次与变动事件"],
                ["GET /api/v1/metrics", "金价/油价/汇率/天气/历史今天/Epic"],
                ["GET /api/v1/media", "猫眼/豆瓣/百度影视榜"],
                ["GET /api/v1/sources", "源健康状态"],
                ["GET /api/v1/health", "服务健康与版本"],
              ].map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(v)}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
        <p class="note" style="margin-block-start:var(--sp-2)">所有接口 GET，返回 <code>{ code, message, data }</code>；可选 <code>format=text|markdown</code> 输出。</p>
      </div>

      <div class="section">
        <div class="section-head">
          <h2 class="section-title">内容后台</h2>
          <span class="note">仅保存在本机浏览器，不参与趋势与热词</span>
        </div>
        <form class="form-grid" id="overrideForm" novalidate>
          <div class="field">
            <label for="ovSource">数据源</label>
            <select id="ovSource" name="source" required></select>
          </div>
          <div class="field field--wide">
            <label for="ovTitle">标题</label>
            <input id="ovTitle" name="title" required maxlength="120" placeholder="例如：某地发布高温橙色预警" />
          </div>
          <div class="field field--wide">
            <label for="ovUrl">链接（可选）</label>
            <input id="ovUrl" name="url" type="url" placeholder="https://" />
          </div>
          <div class="field field--wide">
            <label for="ovNote">备注（可选）</label>
            <input id="ovNote" name="note" maxlength="80" placeholder="来源说明、核实方式" />
          </div>
          <div class="field field--wide" style="flex-direction:row;gap:.5rem">
            <button class="btn btn--primary" type="submit">保存到本机</button>
            <button class="btn btn--quiet" type="button" id="exportOverrides">导出 JSON</button>
            <button class="btn btn--quiet" type="button" id="clearOverrides">清空</button>
          </div>
        </form>
        <div class="override-list" id="overrideList" style="margin-block-start:var(--sp-4)"></div>
      </div>
    </section>`;

  /* ---------- 偏好 ---------- */
  const theme = readPref("theme", "auto");
  const density = readPref("density", "comfortable");
  syncSeg("#themeSeg", "theme", theme);
  syncSeg("#densitySeg", "density", density);

  $("#themeSeg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (!btn) return;
    const v = btn.dataset.theme;
    writePref("theme", v);
    applyTheme(v);
    syncSeg("#themeSeg", "theme", v);
  });
  $("#densitySeg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-density]");
    if (!btn) return;
    const v = btn.dataset.density;
    writePref("density", v);
    applyDensity(v);
    syncSeg("#densitySeg", "density", v);
  });

  $("#copyApi")?.addEventListener("click", () =>
    copyText(`GET /api/v1/meta\nGET /api/v1/boards?cat=&ids=&limit=\nGET /api/v1/board/:id\nGET /api/v1/digest?date=\nGET /api/v1/trends?id=&title=&hours=\nGET /api/v1/timeline\nGET /api/v1/metrics\nGET /api/v1/media\nGET /api/v1/sources\nGET /api/v1/health`));

  /* ---------- 内容后台 ---------- */
  const sel = $("#ovSource");
  sel.innerHTML = `<option value="">选择数据源</option>` + (window.__SOURCES__ || [])
    .map((s) => `<option value="${esc(s.name)}">${esc(s.name)} · ${esc(s.cat)}</option>`).join("");

  const paintOverrides = () => {
    const list = loadOverrides();
    const host2 = $("#overrideList");
    if (!list.length) {
      host2.innerHTML = `<div class="empty"><span class="state-mark">还没有人工录入</span>
        <p class="state-why">当某个源暂时不可用时，你可以手动记录一条已核实的内容，导出后交给编辑流程处理。</p></div>`;
      return;
    }
    host2.innerHTML = list.map((o, i) => `
      <div class="override-item">
        <div>
          <b>${esc(o.title)}</b>
          <span class="note">${esc(o.source)} · 人工录入 · ${esc(new Date(o.at).toLocaleString("zh-CN", { hour12: false }))}</span>
          ${o.note ? `<span class="note">${esc(o.note)}</span>` : ""}
          ${o.url ? `<a class="note" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.url)}</a>` : ""}
        </div>
        <button class="btn btn--quiet" style="min-height:30px;padding:.2rem .5rem" data-del="${i}" type="button" aria-label="删除">${icon("close")}</button>
      </div>`).join("");
    host2.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const list2 = loadOverrides();
        list2.splice(Number(btn.dataset.del), 1);
        saveOverrides(list2);
        paintOverrides();
        toast("已删除");
      }));
  };

  $("#overrideForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const source = sel.value;
    const title = $("#ovTitle").value.trim();
    const url = $("#ovUrl").value.trim();
    const note = $("#ovNote").value.trim();
    if (!source) return toast("请选择数据源", { tone: "error" });
    if (title.length < 4) return toast("标题至少 4 个字", { tone: "error" });
    if (url && !/^https?:\/\//i.test(url)) return toast("链接需以 http(s):// 开头", { tone: "error" });
    const list = loadOverrides();
    list.unshift({ source, title, url, note, at: Date.now() });
    saveOverrides(list);
    $("#ovTitle").value = "";
    $("#ovUrl").value = "";
    $("#ovNote").value = "";
    paintOverrides();
    toast("已保存到本机");
  });

  $("#exportOverrides").addEventListener("click", () => {
    const list = loadOverrides();
    if (!list.length) return toast("没有可导出的记录", { tone: "error" });
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hotspot-overrides-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出");
  });

  $("#clearOverrides").addEventListener("click", () => {
    if (!loadOverrides().length) return;
    openDialog({
      title: "清空人工录入？",
      body: `<p class="state-why">这会删除本机保存的全部人工条目，且不可恢复。建议先导出 JSON。</p>`,
      actions: [`<button class="btn btn--quiet" data-close>取消</button>`, `<button class="btn btn--primary" data-ok>清空</button>`],
      onMount(root, close) {
        root.querySelector("[data-close]").addEventListener("click", close);
        root.querySelector("[data-ok]").addEventListener("click", () => {
          saveOverrides([]);
          paintOverrides();
          close();
          toast("已清空");
        });
      },
    });
  });

  paintOverrides();
  return () => {};
}

function loadOverrides() {
  try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || "[]"); } catch { return []; }
}
function saveOverrides(list) {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(list.slice(0, 200)));
}
function syncSeg(sel, attr, value) {
  $(sel)?.querySelectorAll(`[data-${attr}]`).forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset[attr] === value)));
}
export function applyTheme(v) {
  const root = document.documentElement;
  if (v === "auto") delete root.dataset.theme;
  else root.dataset.theme = v;
}
export function applyDensity(v) {
  const root = document.documentElement;
  if (v === "compact") root.dataset.density = "compact";
  else delete root.dataset.density;
}
