# 热点中枢（Hotspot Hub）整合方案

> 整合 [vikiboss/60s](https://github.com/vikiboss/60s)、[newsnext/newsnow](https://github.com/newsnext/newsnow)、[sansan0/TrendRadar](https://github.com/sansan0/TrendRadar) 三个开源项目的核心能力，构建「采集 → 存储 → 分析 → 开放 API → 呈现/推送」的一体化热点站点。
>
> 交互原型：`public/prototype.html`（含晨报 / 热榜 / 趋势 / 监控台 / API 探索器五个可交互视图）

## 一、三仓库核心能力与互补关系

| 能力维度 | 60s API | NewsNow | TrendRadar | 整合后归属 |
|---|---|---|---|---|
| 数据源 | 每日新闻摘要（60s 读懂世界）、微博/抖音/知乎/头条/小红书等热榜、金价天气等实用数据 | 30+ 平台热榜聚合（含百度、B站等 60s 缺失源）、RSS | 依赖 newsnow API | **采集层**：两者互为数据源与故障转移备份 |
| 采集框架 | 定时抓取 + CDN 缓存 + 多实例 | 自适应抓取间隔（最短 2 分钟）、30 分钟缓存、db0 存储抽象 | 调度时间线 timeline.yaml | **采集/调度层**：借用 newsnow 自适应思想 + TrendRadar 排程 |
| 趋势分析 | — | — | 快照对比、排名时间线、🆕/🔺🔻、热度权重算法 | **分析层**：完整继承 |
| 筛选能力 | — | — | 关键词词法（+/!/@/正则）+ AI 智能筛选 | **分析层**：完整继承 |
| 内容消费 | 现成日报素材 | 优雅阅读 UI | HTML 报告 | **呈现层**：晨报页（60s 内容）+ 榜单页（newsnow 式阅读流）+ 报告 |
| 触达 | — | — | 9 种推送渠道（飞书/钉钉/企微/TG/邮件/ntfy/Bark/Slack/Webhook） | **推送层**：完整继承 |
| 对外接口 | REST（encoding=json/text/markdown） | MCP Server | MCP（21+ 分析工具） | **服务层**：统一 /api/v1 + 可选 MCP 网关 |

**互补关系一句话**：60s 与 newsnow 解决「**数据从哪来**」（且互为容灾），TrendRadar 解决「**数据怎么用**」（趋势、筛选、推送、报告），本方案在其上补齐「**数据怎么存、怎么开放**」——结构化存储与标准化 API，这是三者都未完整提供的部分。

## 二、功能模块划分

```
hotspot-hub/
├── core/                  # 纯逻辑，运行时无关（Cloudflare 与 VPS 共用）
│   ├── collectors/        # 适配器：60sAdapter / newsnowAdapter / rssAdapter
│   ├── analysis/          # 快照对比（趋势/新增/峰值）、关键词词法引擎、热度权重
│   ├── storage/           # 存储接口 + 两套实现：d1.js（CF）/ sqlite.js（VPS）
│   ├── push/              # webhook/飞书/钉钉/TG/邮件 通道（均为 fetch，双端通用）
│   └── api/               # /api/v1 路由处理函数（返回统一信封）
├── runtimes/
│   ├── cloudflare/        # wrangler.toml、Workers 入口、Cron Triggers、Pages 配置
│   └── vps/               # Node 入口、node-cron、Dockerfile、systemd 示例
└── web/                   # 前端（原生/轻框架，静态资产，双端同构）
```

### 1. 采集层（Collector）
- 数据源注册表：每源声明适配器、抓取间隔、权重、启用状态
- 60s 适配器：多公共实例故障转移 + 业务码校验（已在本会话验证，`okbaike`/`7se` 可用，两代格式已适配）
- newsnow 适配器：官方实例 + 中转兜底；自部署实例可配置
- 自适应间隔：源更新频率低则自动拉长间隔（借鉴 newsnow，防封禁）
- 失败降级：源级熔断，连续失败 N 次后暂停并告警，不影响其他源

### 2. 存储层（Storage）—— 本方案新增的核心价值
统一接口（与 db0 同思路）：`get/put/query`，双实现：

```sql
sources(id, name, adapter, weight, enabled)          -- 数据源
snapshots(id, source, taken_at)                      -- 采集快照
items(id, snapshot_id, title, url, rank, hot_value)  -- 快照条目
topics(source, title_norm, url, first_seen, last_seen, peak_rank, board_count)  -- 话题聚合
digest(date, news_json, tip, image_url)              -- 60s 日报归档
keyword_groups(id, pattern, limit_n, channels)       -- 监控词组配置
matches(id, group_id, source, title, url, rank, hit_at)  -- 命中流水
push_logs(id, channel, payload, status, sent_at)     -- 推送记录
```
- 快照默认 5 分钟/次，单源保留 48 点（≈4 小时细粒度）+ 小时级降采样长期保留
- Cloudflare：D1（SQLite 兼容，SQL 零改动）+ KV 做热缓存
- VPS：better-sqlite3 单文件库，定时 VACUUM + 备份

### 3. 分析层（Analysis）
- 趋势引擎：对比相邻快照 → `delta`（排名变化）、`is_new`（新上榜）、峰值/在榜时段统计；热度分 = 0.6·rank + 0.3·freq + 0.1·hotness（TrendRadar 权重可调）
- 词法引擎：完整支持 TrendRadar 语法（普通词任一、`+`必须、`!`排除、`@N`限量、空行分组、正则）
- AI 扩展（可选）：兴趣描述 → 自动标签打分；日报 AI 摘要。接口预留 `ai.disabled` 即纯规则模式，无外部依赖也能跑

### 4. 服务层（API）—— 对外标准化输出
统一信封，CORS 全开放，可选 `Authorization: Bearer <token>`（双端各自实现校验）：

| 端点 | 说明 |
|---|---|
| `GET /api/v1/sources` | 源目录 + 健康状态 |
| `GET /api/v1/boards/:source?limit=&format=json\|markdown` | 当前榜单（含趋势标注） |
| `GET /api/v1/trends/:source?hours=` | 排名时间线 + 聚合统计 |
| `GET /api/v1/digest` | 每天 60 秒读懂世界 |
| `GET /api/v1/matches?words=&sources=` | 关键词命中查询（供外部选题系统轮询） |
| `GET /api/v1/history/:source?limit=` | 原始快照导出（分析/语料用） |
| `GET /api/v1/healthz` | 健康检查 |

`format=markdown` 借鉴 60s 的 encoding 设计，方便直接投喂 LLM/笔记工具。后续可加 MCP 网关（复用 TrendRadar 的 21+ 工具定义）。

### 5. 呈现层（Web）
五个视图（见原型）：晨报（60s 日报）、热榜（多源阅读流 + 筛选）、趋势（时间线 + Sparkline）、监控台（词组编辑 → 实时命中 → 推送预览）、API 文档。静态资产双端共用。

### 6. 推送层（Push）
TrendRadar 三种模式（daily/current/incremental）+ 渠道配置存 `keyword_groups.channels`；飞书/钉钉/TG/webhook 均为 HTTPS POST，双端一致。Cloudflare 用 Cron Triggers 触发，VPS 用 node-cron。

## 三、部署兼容设计（Cloudflare ⇄ VPS）

| 关注点 | 兼容策略 |
|---|---|
| 存储 | core 只面向 storage 接口；D1 与 SQLite 同为 SQL 方言，schema 一份维护 |
| 调度 | 调度配置一份 JSON：CF 映射为 Cron Triggers 表达式；VPS 映射为 node-cron |
| 无长驻进程依赖 | 采集/推送均为无状态短任务（fetch in → write DB → webhook out），天然适配 Workers |
| 环境变量 | 统一 `.env` 键名；CF 用 `[vars]` + Secrets，VPS 用 `.env` 文件，core 通过注入的 `env` 对象读取 |
| 超时 | Workers CPU 受限 → 采集任务分批（每 Cron 周期处理 ≤N 源）；VPS 无此限制但同样分批以复用代码 |
| 回退 | 任一环境故障，切换部署目标只需改 DNS，数据可用 `history` 导出迁移 |

## 四、演进路线

1. **P0（原型已验证）**：多源采集 + 快照趋势 + 关键词筛选 + 统一 API —— 即本会话已跑通的 server.js 增强版
2. **P1**：SQLite 落库（topics 长期聚合）+ 调度排程 + 1 个推送渠道（飞书）
3. **P2**：Cloudflare Workers/D1 适配器 + Pages 前端；`/api/v1` 加 Token
4. **P3**：AI 筛选/摘要（LiteLLM 可插拔）+ MCP 网关 + 报告导出
