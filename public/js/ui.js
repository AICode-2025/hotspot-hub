// 通用工具与状态组件：所有插值必须经过 esc 或 textContent
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function icon(name, cls = "ico") {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function debounce(fn, ms = 260) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function fmtHot(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    if (v >= 1e8) return (v / 1e8).toFixed(1) + "亿";
    if (v >= 1e4) return (v / 1e4).toFixed(1) + "万";
    return String(v);
  }
  const s = String(v);
  return /w$/i.test(s) ? s.replace(/w$/i, "万") : s;
}

const TZ = "Asia/Shanghai";

export function fmtDate(ts) {
  const d = ts ? new Date(ts) : new Date();
  return new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, month: "numeric", day: "numeric" }).format(d);
}

export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff >= 0 && diff < 3600e3) {
    const m = Math.max(1, Math.round(diff / 60e3));
    return `${m} 分钟前`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d).replace(/\//g, "-");
}

export function fmtClock(ts) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ts || Date.now()));
}

export function todayISO() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());
}

export function skeleton(lines = 4, widths = [92, 78, 88, 64]) {
  return `<div class="skel-lines" aria-hidden="true">${Array.from({ length: lines })
    .map((_, i) => `<span class="skeleton" style="inline-size:${widths[i % widths.length]}%;margin-block-end:.5rem"></span>`)
    .join("")}</div>`;
}

export function emptyState({ title = "暂无内容", why = "", actions = [] } = {}) {
  return `<div class="empty">
    <span class="state-mark">${esc(title)}</span>
    ${why ? `<p class="state-why">${esc(why)}</p>` : ""}
    ${actions.length ? `<div class="state-actions">${actions.join("")}</div>` : ""}
  </div>`;
}

export function errorState({ title = "加载失败", message = "", code = "", retry = "" } = {}) {
  return `<div class="error-box">
    <span class="state-mark">${esc(title)}</span>
    ${message ? `<p class="state-why">${esc(message)}</p>` : ""}
    ${code ? `<p class="state-code">${esc(code)}</p>` : ""}
    ${retry ? `<div class="state-actions"><button class="btn btn--quiet" data-retry="${esc(retry)}">重试</button></div>` : ""}
  </div>`;
}

export function toast(message, { tone = "info", timeout = 3200 } = {}) {
  const host = $("#toastStack");
  if (!host) return;
  const node = document.createElement("div");
  node.className = "toast";
  node.dataset.tone = tone;
  node.innerHTML = `<span>${esc(message)}</span><button type="button" aria-label="关闭">${icon("close")}</button>`;
  node.querySelector("button").addEventListener("click", () => node.remove());
  host.appendChild(node);
  setTimeout(() => node.remove(), timeout);
}

export function openDialog({ title, body, actions = [], onMount } = {}) {
  const root = $("#dialogRoot");
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop";
  backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>
    <div class="dialog-body">${body || ""}</div>
    ${actions.length ? `<div class="dialog-actions">${actions.join("")}</div>` : ""}
  </div>`;
  root.appendChild(backdrop);
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(".dialog").addEventListener("click", (e) => e.stopPropagation());
  actions.forEach((html, i) => {
    const btn = backdrop.querySelectorAll(".dialog-actions button")[i];
    if (btn) btn.dataset.action = String(i);
  });
  onMount?.(backdrop, close);
  return close;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制");
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    toast(ok ? "已复制" : "复制失败，请手动选择", { tone: ok ? "info" : "error" });
    return ok;
  }
}

/* ---------------- 关键词表达式：+必含 !排除 /正则/ @限量 ---------------- */

export function parseKeyword(raw) {
  const q = String(raw || "").trim();
  const out = { plain: [], must: [], excl: [], re: [], limit: 0, valid: true, error: "" };
  if (!q) return out;

  let rest = q;
  const limitMatch = rest.match(/(?:^|\s)@(\d{1,3})(?=\s|$)/);
  if (limitMatch) {
    out.limit = Math.min(parseInt(limitMatch[1], 10) || 0, 200);
    rest = rest.replace(limitMatch[0], " ");
  }

  const tokens = [];
  const reSrc = /(^|\s)\/((?:\\.|[^/])+)\/(?=\s|$)/g;
  let m;
  while ((m = reSrc.exec(rest))) tokens.push({ type: "re", value: m[2] });
  rest = rest.replace(reSrc, " ");

  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("+") && tok.length > 1) out.must.push(tok.slice(1));
    else if (tok.startsWith("!") && tok.length > 1) out.excl.push(tok.slice(1));
    else if (/^\/.*\/$/.test(tok)) tokens.push({ type: "re", value: tok.slice(1, -1) });
    else out.plain.push(tok);
  }

  for (const t of tokens) {
    try {
      out.re.push(new RegExp(t.value, "i"));
    } catch {
      out.valid = false;
      out.error = `正则不合法：/${t.value}/`;
    }
  }
  return out;
}

export function matchKeyword(title, kw) {
  if (!kw) return true;
  const t = String(title || "");
  if (kw.excl.some((w) => t.includes(w))) return false;
  if (kw.must.length && !kw.must.every((w) => t.includes(w))) return false;
  if (kw.plain.length && !kw.plain.some((w) => t.includes(w))) return false;
  if (kw.re.length && !kw.re.some((re) => re.test(t))) return false;
  return true;
}

export function trendBadge(t) {
  if (!t) return "";
  if (t.isNew) return `<span class="trend" data-k="new" title="新上榜">新</span>`;
  if (typeof t.delta === "number" && t.delta > 0) return `<span class="trend" data-k="up" title="上升 ${t.delta} 位">▲${t.delta}</span>`;
  if (typeof t.delta === "number" && t.delta < 0) return `<span class="trend" data-k="down" title="下降 ${-t.delta} 位">▼${-t.delta}</span>`;
  if (t.delta === 0) return `<span class="trend" data-k="flat" title="持平">—</span>`;
  return "";
}

export function readPref(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`hotspot.${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(`hotspot.${key}`, JSON.stringify(value));
  } catch { /* 隐私模式下忽略 */ }
}
