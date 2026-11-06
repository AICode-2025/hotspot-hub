# 热点晨报（Hotspot Hub）

国内外热点聚合站：**每天 60 秒读懂世界 + 49 路热点源**（国内 / 国际 / 科技 / 财经 / 社会），支持分类热榜、关键词表达式筛选、真实排名走势、实用数据与影视榜。数据来自 [vikiboss/60s](https://github.com/vikiboss/60s) 与 [newsnext/newsnow](https://github.com/newsnext/newsnow)，筛选与趋势思路参考 [sansan0/TrendRadar](https://github.com/sansan0/TrendRadar)。

## 架构

```
GitHub Pages（纯静态前端）
        │  fetch  /api/v1/*
        ▼
Cloudflare Worker（hotspot-api）
        │  Cron */10 * * * *
        ├──► 60s / NewsNow / HN / GitHub / 华尔街见闻 / RSS
        └──► Cloudflare D1（快照、日报归档、指标、影视榜、源健康）
```

| 层 | 位置 | 说明 |
|---|---|---|
| 前端 | `public/` → GitHub Pages | 原生 ES Module，零依赖，6 个视图，hash 路由 |
| API | `worker/index.js` → Cloudflare Workers | `/api/v1/*`，边缘缓存 + D1 持久化 |
| 数据 | `worker/migrations/` → Cloudflare D1 | 6 张表，保留 48 批快照 / 90 天日报 |
| 部署 | `.github/workflows/deploy.yml` | push 同时发布 Pages 与 Worker，含 D1 迁移与冒烟 |

## 本地开发

```bash
# 前端（静态，读 demo.json 快照）
cd public && python -m http.server 8080

# 完整功能（Node 版后端，兼容旧 /api/*）
npm start                      # http://localhost:4173

# Cloudflare Worker（本地 D1）
npx wrangler d1 migrations apply hotspot --local
npx wrangler dev --local --port 8787
```

前端读取 API 地址的顺序：`?api=` → `window.__API_BASE__`（`public/config.js`）→ `<meta name="api-base">` → 同源 → 静态快照 `demo.json`。

## 页面

| 路由 | 视图 | 主要内容 |
|---|---|---|
| `#/today` | 今日晨报 | 60 秒日报 15 条、封面、农历/星期、往期归档、跨源热词与头条 |
| `#/boards` | 分类热榜 | 分类/状态筛选、关键词表达式、卡片/列表、跨源检索 |
| `#/trends` | 排名走势 | 源→话题→真实排名曲线、涨跌榜、采集批次时间线 |
| `#/data` | 实用数据 | 金价、油价、汇率、天气、历史上的今天、Epic、AI/IT 快讯 |
| `#/data?tab=media` | 影视榜 | 猫眼 4 榜、豆瓣 5 榜、百度电视剧 |
| `#/sources` | 数据源 | 49 源健康、通道、条目数、单源重试 |
| `#/more` | 更多 | 主题/密度、API 清单、内容后台（本地）、导出 |

## API v1

| 端点 | 说明 |
|---|---|
| `GET /api/v1/meta` | 分类与数据源目录 |
| `GET /api/v1/boards?cat=&ids=&limit=` | 批量榜单（含趋势与采集通道） |
| `GET /api/v1/board/:id` | 单源榜单 |
| `GET /api/v1/digest?date=` | 60 秒日报（默认今天） |
| `GET /api/v1/trends?id=&title=&hours=` | 单话题排名序列 |
| `GET /api/v1/timeline` | 采集批次与变动 |
| `GET /api/v1/metrics` | 金价/油价/汇率/天气/历史今天/Epic/AI/IT |
| `GET /api/v1/media` | 猫眼/豆瓣/百度影视榜 |
| `GET /api/v1/sources` · `/api/v1/health` | 源健康、服务健康 |

统一返回 `{ code, message, data }`；CORS 白名单由 `wrangler.toml` 的 `ALLOW_ORIGINS` 控制。

## 部署

完整步骤见 [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md)。最短路径：

```bash
npx wrangler d1 create hotspot          # 首次
# 把 database_id 填入 wrangler.toml
npx wrangler d1 migrations apply hotspot --remote
npx wrangler deploy
```

仓库 Secrets 配好 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，Variables 配 `API_BASE` 后，push 即自动部署两端。

## 数据真实性约定

- 未接入的源显示不可用及具体原因，**不生成任何模拟热点**；`demo.json` 只写真实采集成功的源。
- 趋势曲线只来自 `/api/topic` 与 `/api/v1/trends` 的真实快照，样本不足时显示「样本不足」而不是画假线。
- 「内容后台」录入的内容固定标注「人工录入」，仅存本机 localStorage，不参与趋势与热词。

## 文档

| 文件 | 内容 |
|---|---|
| [`docs/design-spec.md`](docs/design-spec.md) | 前端设计规格：IA、页面职责、交互、响应式、视觉约束、验收标准 |
| [`docs/deploy-cloudflare.md`](docs/deploy-cloudflare.md) | 部署边界、D1 绑定、GitHub→Cloudflare 自动触发 |
| [`docs/blueprint.md`](docs/blueprint.md) | 早期整合方案（存储/分析/推送分层设计） |
| [`docs/60s-gap-analysis.md`](docs/60s-gap-analysis.md) | 与 60s 的能力差距核查与补齐方案 |
| [`docs/newsnow-vs-trendradar.md`](docs/newsnow-vs-trendradar.md) | 两个上游项目的定位对比 |

## 数据来源与许可

- 60s API：MIT，[vikiboss/60s](https://github.com/vikiboss/60s)
- NewsNow：MIT，[newsnext/newsnow](https://github.com/newsnext/newsnow)
- TrendRadar：GPL-3.0（仅参考其筛选与趋势设计，未复制代码）

本项目内容由上游接口聚合，仅供参考。
