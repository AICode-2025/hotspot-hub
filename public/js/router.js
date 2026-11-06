// hash 路由：#/today?date=2026-11-06
const scrollMemo = new Map();

export function parseHash(hash = location.hash) {
  const raw = (hash || "").replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const path = pathPart || "";
  return { path, query: new URLSearchParams(queryPart) };
}

export function buildHash(path, query) {
  const qs = query instanceof URLSearchParams ? query.toString() : new URLSearchParams(query || {}).toString();
  return `#/${path}${qs ? `?${qs}` : ""}`;
}

export function navigate(path, { query, replace = false } = {}) {
  const hash = buildHash(path, query);
  if (replace) {
    history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = hash;
  }
}

export class Router {
  constructor({ host, routes, fallback = "today", onBefore, onAfter }) {
    this.host = host;
    this.routes = routes;
    this.fallback = fallback;
    this.onBefore = onBefore;
    this.onAfter = onAfter;
    this.current = null;
    this.cleanup = null;
    this.key = "";

    window.addEventListener("hashchange", () => this.render());
  }

  resolve(path) {
    return this.routes.find((r) => r.path === path) || null;
  }

  async render() {
    const { path, query } = parseHash();
    const route = this.resolve(path);
    if (!route) {
      if (path === "" || path === "/") {
        navigate(this.fallback, { replace: true });
        return;
      }
      this.renderNotFound(path);
      return;
    }

    const key = `${route.path}?${query.toString()}`;
    if (key === this.key) return;

    // 离开当前视图：记录滚动位置 + 清理
    if (this.current) {
      scrollMemo.set(this.current.path, window.scrollY);
      try { this.cleanup?.(); } catch { /* 忽略视图清理异常 */ }
      this.cleanup = null;
    }

    this.key = key;
    this.current = route;
    this.onBefore?.(route, query);

    this.host.innerHTML = "";
    this.host.classList.remove("view-enter");
    void this.host.offsetWidth;
    this.host.classList.add("view-enter");

    try {
      const result = await route.render({ query, path: route.path, navigate });
      if (typeof result === "function") this.cleanup = result;
      else if (result?.destroy) this.cleanup = () => result.destroy();
    } catch (e) {
      console.error("[view]", route.path, e);
      this.host.innerHTML = `<div class="error-box">
        <span class="state-mark">页面渲染失败</span>
        <p class="state-why">${e?.message || "未知错误"}</p>
        <div class="state-actions"><button class="btn btn--quiet" data-reload>重新加载</button></div>
      </div>`;
      this.host.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
    }

    this.onAfter?.(route, query);

    const y = scrollMemo.get(route.path) ?? 0;
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
  }

  renderNotFound(path) {
    this.onBefore?.({ path: "404", title: "页面不存在", kicker: "第 ? 栏" }, new URLSearchParams());
    this.host.innerHTML = `<div class="empty">
      <span class="state-mark">没有这一栏</span>
      <p class="state-why">地址 <code>#/${path}</code> 不在本刊目录中。</p>
      <div class="state-actions">
        <a class="btn btn--primary" href="#/today">回到今日晨报</a>
        <a class="btn btn--quiet" href="#/boards">去看热榜</a>
      </div>
    </div>`;
  }
}
