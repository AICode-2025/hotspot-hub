# 部署架构：GitHub Pages（前端）+ Cloudflare Workers / D1（后端）

> 版本 v2.0 · 2026-11-06
> 目标：前后端彻底分离；前端静态托管免费、后端与数据在 Cloudflare；GitHub 一次 push 同时更新两端。

---

## 一、部署边界（谁负责什么）

| 层 | 承载 | 域名示例 | 内容 | 是否可缓存 | 失败影响 |
|---|---|---|---|---|---|
| **前端** | GitHub Pages | `https://aicode-2025.github.io/hotspot-hub/` | `public/` 下的 HTML/CSS/JS、`demo.json` 快照 | 强缓存（带 hash 或短 TTL） | 页面打不开；API 仍可用 |
| **API** | Cloudflare Workers | `https://api.example.com`（或 `*.workers.dev`） | `/api/v1/*` 路由、适配器、Cron 采集 | 边缘缓存 5 分钟（按 URL） | 前端自动降级到快照模式 |
| **数据** | Cloudflare D1 | 绑定在 Worker 内（无独立域名） | 快照、日报归档、指标、影视榜、源健康 | — | 只影响历史/趋势，实时榜仍可用 |
| **配置** | GitHub Actions Secrets / Cloudflare Vars | — | API Token、D1 ID、CORS 白名单 | — | 部署失败 |

**硬规则**

1. GitHub Pages **只放静态资源**，不跑任何服务端逻辑；`server.js` 不再作为生产后端。
2. 前端**不直连** 60s / NewsNow（避免 CORS 与密钥/限流问题），一律经 Worker。
3. Worker **不托管前端**（不配置 `assets` 绑定），避免与 Pages 双份产物。
4. D1 是唯一持久层；`data/history.json` 仅用于本地 Node 开发。

---

## 二、URL 与跨域

| 环境 | 前端 | API |
|---|---|---|
| 生产 | `https://aicode-2025.github.io/hotspot-hub/` | `https://hotspot-api.<account>.workers.dev` 或自定义域 |
| 预览 | Pages 每次构建的独立 URL | 同一 Worker（`workers.dev` 预览域） |
| 本地 | `http://localhost:8080`（静态） | `http://localhost:8787`（`wrangler dev`） |

前端获取 API 地址的优先级：

1. `window.__API_BASE__`（构建时由 Actions 写入 `public/config.js`）
2. `<meta name="api-base" content="...">`
3. 同源（当 Worker 与前端同域时）
4. 都没有 → 静态模式（读 `demo.json`）

Worker 侧 CORS 白名单（`ALLOW_ORIGINS` 变量，逗号分隔）：

```
https://aicode-2025.github.io,http://localhost:8080,http://localhost:4173
```

预检请求返回 `Access-Control-Allow-Origin: <命中来源>`、`Vary: Origin`，不回 `*`（便于后续加 Token）。

---

## 三、D1 数据库绑定

### 3.1 创建

```bash
npx wrangler d1 create hotspot
# 输出里的 database_id 填入 wrangler.toml
```

### 3.2 `wrangler.toml`

```toml
name = "hotspot-api"
main = "worker/index.js"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"                 # 代码里通过 env.DB 访问
database_name = "hotspot"
database_id = "<你的 database_id>"

[triggers]
crons = ["*/10 * * * *"]       # 每 10 分钟采集热榜

[vars]
ALLOW_ORIGINS = "https://aicode-2025.github.io,http://localhost:8080"
CACHE_TTL = "300"
```

**绑定名必须是 `DB`**：Worker 里统一 `env.DB.prepare(...)`，不要用 `env.hotspot` 之类的别名，避免换环境时改代码。

### 3.3 迁移

```bash
# 本地
npx wrangler d1 migrations apply hotspot --local

# 远程（生产）
npx wrangler d1 migrations apply hotspot --remote
```

迁移文件放 `worker/migrations/0001_init.sql` … 只增不改；每次部署前自动执行（见第四节）。

### 3.4 表结构（与 `worker/schema.sql` 一致）

| 表 | 用途 | 关键字段 |
|---|---|---|
| `snapshots` | 每源每次采集的批次 | `id, source, taken_at` |
| `items` | 批次内条目 | `snapshot_id, rank, title, url, hot` |
| `topics` | 话题聚合 | `source, title_norm, first_seen, last_seen, peak_rank` |
| `digests` | 60s 日报归档 | `date PK, news_json, tip, image, cover, lunar, day_of_week, link` |
| `metrics` | 金价/油价/汇率 | `key, ts, value, raw_json, PK(key,ts)` |
| `media_rank` | 猫眼/豆瓣榜 | `board, ts, rank, title, score` |
| `source_health` | 源可用性 | `source PK, ok, adapter, items, latency_ms, checked_at, error` |

写入策略：
- 热榜每 10 分钟一批，单源保留最近 48 批（`DELETE` 旧批次，避免 D1 膨胀）。
- 日报每天一条，保留 90 天。
- 指标按小时降采样，保留 30 天。

---

## 四、GitHub push → Cloudflare 自动部署

### 方案 A（推荐）：GitHub Actions 统一编排

一个工作流同时完成「前端 Pages + 后端 Worker + D1 迁移」，顺序执行、失败即停，避免前后端版本错位。

`.github/workflows/deploy.yml`：

```yaml
name: Deploy Pages + Worker
on:
  push:
    branches: [main]
    paths: ["public/**", "worker/**", "scripts/**", "wrangler.toml", ".github/workflows/deploy.yml"]
  schedule: [{ cron: "0 */6 * * *" }]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: true

jobs:
  frontend:
    runs-on: ubuntu-latest
    permissions: { contents: read, pages: write, id-token: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Inject API base
        run: node scripts/gen-config.mjs public
        env: { API_BASE: "${{ vars.API_BASE }}" }
      - name: Refresh snapshot (optional)
        if: ${{ vars.LIVE_API_BASE != '' }}
        run: node scripts/gen-demo.mjs public
        env: { LIVE_API_BASE: "${{ vars.LIVE_API_BASE }}" }
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Apply D1 migrations
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply hotspot --remote
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
      - name: Smoke test
        run: |
          curl -fsS "${{ vars.API_BASE }}/api/v1/health" | grep -q '"ok":true'
```

**Secrets / Variables 清单**

| 名称 | 类型 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | 权限：Workers Scripts:Edit、D1:Edit、Account Settings:Read |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | 账户 ID |
| `API_BASE` | Variable | Worker 公开地址，如 `https://hotspot-api.xxx.workers.dev` |
| `LIVE_API_BASE` | Variable（可选） | 若配置，构建时刷新 `demo.json` 真实快照 |

> `CLOUDFLARE_API_TOKEN` 只授予上述最小权限，不要用 Global API Key。

### 方案 B（备选）：Cloudflare Workers Builds（Git 直连）

适合不希望把部署逻辑放在 GitHub Actions 的团队：

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Worker** → **Connect to Git**
2. 选择仓库 `AICode-2025/hotspot-hub`，分支 `main`
3. 构建配置：
   - Root directory: `/`
   - Build command: `npx wrangler deploy`
   - Deploy command: `npx wrangler deploy`
4. 环境变量填入 `ALLOW_ORIGINS`；D1 绑定在 Dashboard → Settings → Bindings 添加（binding 名 `DB`）
5. 之后每次 push 到 `main` 自动构建并部署 Worker；构建日志在 Worker 详情页可见

**面板字段对照（Workers Builds）**

| 字段 | 值 | 说明 |
|---|---|---|
| Root directory | `/` | 仓库根目录，`wrangler.toml` 在此 |
| Build command | `npm run build` | 由 `scripts/build.mjs` 产出 `dist/`（前端静态资源），对 Worker 部署无副作用 |
| Deploy command | `npx wrangler deploy` | 读取 `wrangler.toml`，上传 `worker/index.js` |
| Build variables | `API_BASE`（可选） | 构建前端时注入 Worker 地址；不部署前端可留空 |
| Bindings | D1 → `DB` | 也可由 `wrangler.toml` 的 `[[d1_databases]]` 自动带上 |

> **常见报错**：`npm error Missing script: "build"`。
> 原因：早期 `package.json` 只有 `start`，没有 `build`。已在 v2.0 补齐，并新增 `scripts/build.mjs`、`wrangler` devDependency 与 `package-lock.json`（供 `npm ci` 使用）。
> 若不想构建前端、只部署 Worker，可把 Build command 留空，Deploy command 仍为 `npx wrangler deploy`。

> **不要同时开启方案 A 与方案 B**：两者都会部署 `hotspot-api`，后执行的会覆盖前一个版本。用 Workers Builds 时，请把 `.github/workflows/deploy.yml` 的 `backend` job 关掉（或删除），只保留 `frontend` job。

注意：
- 方案 B 只覆盖 **Worker**，前端仍需 GitHub Pages 的 Actions；两者可并存，但**不要同时用 A/B 部署同一个 Worker**，避免版本互相覆盖。
- Workers Builds 不支持自动跑 D1 迁移，迁移仍需手动或在 GitHub Actions 里单独跑。

**推荐组合：A（全部自动化）+ 关闭 B**。

### 部署时序（避免前后端错位）

```
push → (parallel)
  ├─ frontend: 注入 API_BASE → 生成快照 → Pages 发布
  └─ backend: D1 migrate → Worker deploy → /health 冒烟
       ↑ 若 backend 失败，frontend 仍发布，但前端会自动降级为快照模式（可接受）
```

若接口有不兼容变更（如 `/api/v1` → `/api/v2`），先发 Worker（兼容双版本），再发前端。

---

## 五、Worker 运行时要求

| 项 | 要求 |
|---|---|
| 运行时 | Workers（ES Module），`compatibility_date >= 2026-01-01` |
| 入口 | `worker/index.js` 默认导出 `{ fetch, scheduled }` |
| 定时任务 | `scheduled(event, env, ctx)`：每 10 分钟采集热榜；每天 07:00 归档日报 |
| 并发限制 | `ctx.waitUntil()` 包裹写库，不阻塞响应；每批最多并发 8 个上游请求 |
| CPU 时间 | 单次 `scheduled` < 30s（Workers 限制 30s CPU，实际按 wall time 计费需注意） |
| 缓存 | `caches.default` 缓存 GET 响应 300s；`Cache-Control: public, max-age=300, s-maxage=300` |
| 错误 | 统一 `{ code, message, data? }`；上游失败返回 502 + 人话；不泄露堆栈 |
| 日志 | `console.log(JSON.stringify({route, ms, source}))`，便于 `wrangler tail` 排查 |

---

## 六、本地开发与联调

```bash
# 1) 前端静态
cd public && python -m http.server 8080

# 2) Worker（含 D1 本地库）
npx wrangler d1 migrations apply hotspot --local
npx wrangler dev --local --port 8787

# 3) 前端指向本地 Worker
# 访问 http://localhost:8080/?api=http://localhost:8787 或在 config.js 写 __API_BASE__
```

`?api=` 参数仅用于本地调试，优先级最高，生产不使用。

---

## 七、验收标准

| 验收项 | 判定方法 |
|---|---|
| 边界清晰 | Pages 产物中无 `server.js`、无 secrets；Worker 不返回 HTML 页面 |
| D1 绑定 | `wrangler d1 execute hotspot --remote --command "select count(*) from snapshots"` 有数据 |
| 自动触发 | push 后 5 分钟内：Pages 新 commit 生效 + Worker `version` 变化（`/api/v1/health` 返回 `deployedAt`） |
| 迁移幂等 | 连续两次部署不报「table already exists」 |
| 冒烟 | `/api/v1/health` 返回 `ok:true` 且 `sources>0` |
| 跨域 | 从 Pages 域发起请求无 CORS 报错；非白名单域被拒 |
| 降级 | 停掉 Worker 后，前端 3 秒内进入快照模式并显示横幅 |
| 回滚 | `npx wrangler rollback` 可在 1 分钟内回到上一版本 |

---

## 八、成本与配额（参考）

| 资源 | 免费额度 | 本项目预估 |
|---|---|---|
| Workers | 10 万请求/天 | 前端每次访问约 6–10 请求，够用 |
| D1 | 500 万行读/天、10 万行写/天、5GB | 49 源 × 144 批/天 ≈ 7 千行写，远低于上限 |
| Cron | 免费 | 144 次/天 |
| GitHub Pages | 100GB/月 | 静态资源 < 1MB，够用 |

---

## 九、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面能开但全部显示「快照模式」 | `config.js` 的 `API_BASE` 为空或 Worker 未部署 | 检查 Actions 的 `API_BASE` 变量与 Worker 地址 |
| 请求被 CORS 拦截 | `ALLOW_ORIGINS` 未包含 Pages 域 | 在 `wrangler.toml` 的 `[vars]` 补充并重新部署 |
| Worker 部署报 `D1 binding not found` | `wrangler.toml` 缺少 `[[d1_databases]]` 或 binding 名不是 `DB` | 按 3.2 节补齐 |
| 迁移报「no migrations found」 | 目录不是 `worker/migrations` | 迁移文件必须命名 `0001_xxx.sql` 且位于该目录 |
| push 后 Pages 没更新 | 工作流 `paths` 未包含改动文件 | 手动 `workflow_dispatch` 或调整 `paths` |
| D1 写入超限 | 每批写太多条目 | 单源只保留 Top30、48 批，定期清理 |
