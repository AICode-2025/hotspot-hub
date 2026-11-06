# 60s 能力差距核查与还原方案

> 核查时间：2026-11-06。对象：线上 `https://aicode-2025.github.io/hotspot-hub/`、本地工作区 `f:/热点`、上游 `vikiboss/60s`（main，MIT，5,894 stars，2026-10-28 推送）。
> 结论基于实测与源码，不含推测；本文件只做诊断与方案，不含代码改动。

## 0. 结论摘要

**60s 并没有被删除，而是「只接了一小部分 + 线上部署的还是旧版 + 旧快照里混着占位数据」三件事叠加。**

三个事实：

1. **部署版本落后**：线上 `app.js` 13,786 字节（旧版单页），工作区 `public/app.js` 已 41,467 字节（7 视图新版），且 `git status` 显示 8 个文件改动**尚未提交**。线上跑的是旧代码。
2. **60s 覆盖极窄**：60s 官方共 **62 个端点、4 大模块**，当前项目只接了 **13 个**（1 个日报 + 12 个热榜），其余 49 个完全缺失；且 12 个热榜里有 **4 个端点路径是错的**（`/v2/baidu`、`/v2/tieba`、`/v2/douban`、`/v2/hupu` 实测 404）。
3. **线上快照含模拟数据**：线上 `demo.json` 中 **21 个源**的 `adapter` 是 `demo`、条目是「×× · 示例热点 ①（静态演示）」。本地新快照已为 0 个——说明线上快照是旧脚本产物，与 README「不生成或展示任何模拟热点」的承诺相矛盾。

由此，用户感知到的「看不到 60s 的内容」是真实的：页面上 60s 只剩一块 15 条日报和不到 10 个真实热榜，其余是占位卡片。

---

## 1. 线上现状核查（实测证据）

| 检查项 | 线上 Pages | 本地工作区 | 判断 |
|---|---|---|---|
| `app.js` | 13,786 B / MD5 `d58a52…` | 41,467 B / MD5 `38c008…` | 线上是旧版，差异 3 倍 |
| `index.html` | 4,444 B | 3,339 B | 结构已重构，线上未更新 |
| `demo.json` `generatedAt` | 2026-11-06T12:52 | 2026-11-06T13:29 | 快照在刷新，但内容是旧格式 |
| `digest`（日报） | 有，15 条，date=2026-11-06 | 有，15 条 | **日报没丢** |
| 占位源 `adapter=demo` | **21 个** | **0 个** | 线上仍展示「示例热点」 |
| 前端视图 | 单页：日报 + 热榜卡片 + 伪趋势 | 7 视图：概览/分类/时间线/标签/趋势/数据源/内容后台 | 线上功能严重缺失 |

补充实测（无头 Edge 截图）：线上首屏正常渲染「每天 60 秒读懂世界」15 条 + 「实时热榜」微博/知乎/百度/抖音各 30 条。**日报与 60s 热榜是可见的**，但页面没有任何 60s 的特色数据（金价、油价、天气、票房、Epic、AI 资讯等），且下方大量卡片是「示例热点」。

另一个隐藏问题：线上旧版 `app.js` 的「趋势曲线」是用 `seeded()` 随机数生成的 12 点假曲线（源码注释写着「演示时间线」），不是真实历史。工作区新版才改为 `/api/topic` 真实快照。

---

## 2. 60s 官方能力全景

60s 是「一套热点 + 实用数据 + 娱乐」的开放 API 集合，统一前缀 `/v2`，全部 GET（少数 ALL），支持 `encoding=json|text|markdown`（默认 json），时间字段区分 `updated`（字符串）与 `updated_at`（13 位时间戳），链接统一 `link`、封面统一 `cover`。

| 模块 | 端点 | 用途 | 当前是否接入 |
|---|---|---|---|
| 周期资讯 | `/v2/60s` | 每天 60 秒读懂世界 | ✅ 已接（快照） |
| | `/v2/60s/rss` | 日报 RSS | ❌ |
| | `/v2/ai-news` | AI 资讯快报（日更） | ❌ |
| | `/v2/it-news`、`/v2/it-news/rank` | 实时 IT 资讯 + 榜单 | ❌ |
| | `/v2/bing` | 必应每日壁纸 | ❌ |
| | `/v2/exchange-rate` | 当日货币汇率 | ❌ |
| | `/v2/today-in-history` | 历史上的今天 | ❌ |
| | `/v2/epic` | Epic 免费游戏（周更） | ❌ |
| 热榜 | `/v2/weibo`、`/v2/zhihu`、`/v2/douyin`、`/v2/toutiao`、`/v2/bili`、`/v2/quark`、`/v2/rednote`、`/v2/dongchedi`、`/v2/changya` | 各平台热搜 | ✅ 多数已接（部分不稳定） |
| | `/v2/baidu/hot`、`/v2/baidu/teleplay`、`/v2/baidu/tieba` | 百度热搜/电视剧/贴吧 | ⚠️ 百度路径错，后两个未接 |
| | `/v2/maoyan/all/movie`、`/v2/maoyan/realtime/{movie,tv,web}` | 猫眼票房 4 榜 | ❌ |
| | `/v2/douban/weekly/{movie,tv_chinese,tv_global,show_chinese,show_global}` | 豆瓣口碑 5 榜 | ⚠️ 路径错且只用到 1 个 |
| | `/v2/ncm-rank/list`、`/v2/ncm-rank/:id` | 网易云榜单 | ❌ |
| | `/v2/hacker-news/{new,top,best}` | HN 三档 | ⚠️ 项目改用 Algolia 直连 |
| 实用功能 | `/v2/gold-price`、`/v2/fuel-price` | 金价、油价 | ❌ |
| | `/v2/weather/realtime`、`/v2/weather/forecast` | 天气、预报 | ❌ |
| | `/v2/fanyi`、`/v2/fanyi/langs` | 翻译（109 语言） | ❌ |
| | `/v2/qrcode`、`/v2/baike`、`/v2/whois`、`/v2/ip`、`/v2/og`、`/v2/hash` | 工具类 | ❌ |
| | `/v2/moyu`、`/v2/lyric`、`/v2/health`、`/v2/password`、`/v2/password/check`、`/v2/color/random`、`/v2/color/palette` | 摸鱼/歌词/健康/密码/配色 | ❌ |
| | `/v2/olympics`、`/v2/olympics/events` | 奥运奖牌榜 | ❌ |
| | `/v2/lunar`（beta） | 农历 | ❌（日报里已带 `lunar_date`） |
| 消遣娱乐 | `/v2/answer`、`/v2/duanzi`、`/v2/fabing`、`/v2/hitokoto`、`/v2/kfc`、`/v2/luck`、`/v2/awesome-js`、`/v2/dad-joke`、`/v2/chemical`（失效） | 随机内容 9 项 | ❌ |
| 通用 | `/`、`/endpoints`、`/health` | 自描述与健康检查 | ❌ |

**覆盖率：13 / 62 ≈ 21%。**

---

## 3. 逐项差异清单

### 3.1 已接但路径错误（4 个，属于「看起来接了、其实常失败」）

| 源 | 当前请求 | 实测 | 正确端点 |
|---|---|---|---|
| 百度 | `/v2/baidu` | **404** | `/v2/baidu/hot` |
| 百度贴吧 | `/v2/tieba` | **404** | `/v2/baidu/tieba` |
| 豆瓣 | `/v2/douban` | **404** | `/v2/douban/weekly/movie` 等 5 个 |
| 虎扑 | `/v2/hupu` | **404** | 60s 无此接口，只能走 newsnow |

实测环境：`60s.okbaike.com`（2026-11-06）。注意线上历史快照里百度/贴吧/虎扑显示 `adapter=s60` 且有 30 条，说明**不同公共实例对路径的实现不一致**（记忆中的版本差异：`okbaike` 新版、`7se` 旧版），这类「碰巧成功」不可依赖。

其余端点实测：`/v2/60s` 200、`/v2/weibo` 200、`/v2/quark` 200、`/v2/gold-price` 200、`/v2/weather/realtime` 200；`/v2/rednote` **500**、`/v2/dongchedi` **500**、`/v2/maoyan/realtime/movie` **500**（上游源侧故障/风控，非路径问题）。

### 3.2 完全缺失的模块（按与本项目的相关度分级）

**P1 高价值（热点站定位契合，建议优先补）**

- 周期资讯 6 项：`ai-news`、`it-news`（+rank）、`bing`（每日壁纸，可做晨报视觉）、`exchange-rate`、`today-in-history`、`epic`
- 影视内容榜 10 项：`maoyan` ×4、`douban/weekly` ×5、`baidu/teleplay`
- 时效专题：`olympics`、`olympics/events`

**P2 中价值（可做「实用数据」小板块）**

- `gold-price`、`fuel-price`、`weather/realtime`、`weather/forecast`、`moyu`、`lyric`、`baike`、`qrcode`、`fanyi` + `fanyi/langs`

**P3 低价值（与热点站定位弱相关，可跳过或折叠）**

- `whois`、`ip`、`og`、`hash`、`health`、`password` ×2、`color` ×2、`lunar`（beta）、`ncm-rank` ×2、`changya`、消遣 9 项、`beta/kuan`、`beta/qq/profile`

### 3.3 通用能力缺失

| 能力 | 60s 官方 | 当前实现 | 影响 |
|---|---|---|---|
| 响应格式 | `encoding=json/text/markdown` | 只按 JSON 解析 | 无法直接投喂 LLM / 纯文本渠道 |
| 字段规范 | `link`、`cover`、`updated_at` | 只取 `title`/`url`/`hot` | 丢封面、丢时间戳、无法做时序 |
| 实例容灾 | 官方推荐 12 个公共实例 + 自建 | 写死 3 个（`okbaike`/`7se`/`viki.moe`） | 主域名 `60s.viki.moe` 部分地区超时，容灾不足 |
| 日报归档 | `60s/rss` + 按日期 | 只存「最新一份」 | 无法回看历史晨报 |
| 健康检查 | `/health`、`/endpoints` | 仅自定义 `/api/health` | 无法自描述端点 |

### 3.4 部署形态导致的「看不见」

- Pages 无后端，日报取自**构建时快照**（工作流 `schedule` 每 6 小时一次）。若构建失败或仓库 60 天无活动被暂停 schedule，页面会长期停留在旧日期 → 表现为「60s 内容消失」。
- 线上旧版只有单页，没有「数据源」「时间线」「标签」视图，用户无法确认哪些源来自 60s、哪些已失效。

---

## 4. 为什么会有「看不到 60s」的体感

按可能性排序：

1. **版本滞后**：线上是旧单页，60s 只占一块日报；新版 7 视图未部署。
2. **占位数据淹没**：21 个源显示「示例热点 ①（静态演示）」，真实内容只覆盖约 12 个源，整体观感「空空如也」。
3. **快照过期**：日报只有构建那一刻的版本，隔天再看仍是旧日期。
4. **特色能力为零**：60s 最实用的金价/油价/天气/汇率/票房/Epic/AI 资讯，项目里一个都没有。

---

## 5. 还原与集成方案（分阶段，先方案后代码）

### 阶段 0：先让线上与本地一致（0 行代码，10 分钟）

- 提交并推送工作区 8 个改动文件（`app.js`/`index.html`/`style.css`/`demo.json`/`server.js`/`gen-demo.mjs`/`README.md`/`docs/deployment.md`），触发 Pages 重新构建。
- 验证清单：7 个视图可切换；日报 15 条；`demo.json` 中 `adapter=demo` 数量为 **0**；49 源状态可查。
- 这一步能立刻消除「旧版 + 假数据」两个最刺眼的问题。

### 阶段 1：修正 60s 适配器（约 0.5 天，收益最高）

1. **端点与源解耦**：`SOURCES` 里不要再用 `s60:<源id>` 隐式拼路径，改为显式 `s60:<endpoint>` 映射：

   | 源 | 新 endpoint |
   |---|---|
   | 百度 | `baidu/hot` |
   | 贴吧 | `baidu/tieba` |
   | 豆瓣 | `douban/weekly/movie`（电影）；剧集/综艺另设源 |
   | 虎扑 | 移除 s60，仅 newsnow |
   | 微博/知乎/抖音/头条/B站/夸克/小红书/懂车帝 | 维持原 endpoint |

2. **实例池扩容**：从 3 个扩到 6–8 个（官方推荐列表：`60api.09cdn.xyz`、`60s.zeabur.app`、`60s.crystelf.top`、`60s.tmini.net`、`60s.7se.cn`、`60s.okbaike.com` 等），并保留「业务码校验 + 单实例熔断 + 失败短缓存」。
3. **显式声明格式**：所有请求追加 `encoding=json`，避免实例默认格式差异；同时保留 text/markdown 透传能力。
4. **失败可观测**：每个源记录「实际命中的实例 + HTTP 码 + 业务码」，在「数据源」视图展示，避免再次出现「显示 s60 成功、实际是别的通道」的误判。

### 阶段 2：补齐 P1 模块（约 2–3 天）

新增三个板块（不改现有信息架构，作为新视图插入侧栏）：

- **实用速览**：天气（实时 + 预报）、金价、油价、汇率、历史上的今天、Epic 免费游戏、AI 资讯、IT 资讯（8 张卡片，2×4 栅格）。
- **影视榜单**：猫眼 4 榜 + 豆瓣 5 榜 + 百度电视剧（统一卡片，标注更新频率）。
- **晨报增强**：日报按日期归档，支持「前一天/后一天」翻看；补 `cover` 封面图、`lunar_date`、`day_of_week`、原文 `link`。

数据模型建议（与 `docs/blueprint.md` 的 storage 接口对齐）：

```sql
digests(date TEXT PRIMARY KEY, news_json TEXT, tip TEXT, image TEXT, cover TEXT,
        lunar TEXT, day_of_week TEXT, link TEXT, fetched_at INTEGER)
metrics(key TEXT, ts INTEGER, value REAL, raw_json TEXT, PRIMARY KEY(key, ts))   -- 金价/油价/汇率
media_rank(board TEXT, rank INTEGER, title TEXT, score TEXT, ts INTEGER,
           PRIMARY KEY(board, rank, ts))                                        -- 猫眼/豆瓣
```

### 阶段 3：对外能力对齐（约 1–2 天）

- `/api/v1/digest?date=YYYY-MM-DD`：单日/历史日报
- `/api/v1/metrics/:key?days=30`：金价/油价/汇率时序
- `/api/v1/rank/:board`：影视榜单
- 统一 `format=json|text|markdown`，字段对齐 60s 的 `link`/`cover`/`updated_at`
- `/api/v1/endpoints`：自描述，便于外部发现

### 阶段 4：让静态站也「实时」（关键取舍）

三条路线，按成本排序：

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| A. 前端直连 | Pages 前端直接 fetch 60s 公共实例，失败回退 `demo.json` | 零后端、真正实时 | 依赖实例 CORS；暴露客户端 IP；多实例轮询逻辑在前端 |
| B. 提高快照频率 | Actions `schedule` 6h → 1h | 改动最小 | 日报最多滞后 1h；Actions 配额与 60 天休眠风险 |
| C. 轻后端 | VPS/Cloudflare Workers 跑 `server.js`，`LIVE_API_BASE` 指向它 | 能力最完整（归档/趋势/推送） | 需要一台常驻服务 |

推荐：**C 为主 + A 兜底**。有后端时走 `/api/*`；纯静态时前端直连 60s 并标注「实时直连」；两者都失败才回退快照。

### 阶段 5：可选——自建 60s 实例

- 60s 支持 Docker / Deno / Bun / Cloudflare Workers / Node.js 部署，MIT 许可。
- 自建后：① 数据自主、不受公共实例版本差异影响；② 可关掉不需要的端点降低被风控概率；③ 解决 `rednote`/`dongchedi`/`maoyan` 在公共实例上 500 的问题。
- 成本：一台 1C1G 或一个 Workers 免费额度即可。

---

## 6. 验收标准（对齐 60s 官方表现）

| 项 | 标准 |
|---|---|
| 端点覆盖 | P1 全部接入；P2 至少 8 项；P3 明确标注「不接入」 |
| 可用性 | 关键 15 个端点连续 7 天成功率 ≥ 95%，P95 响应 < 1.5s |
| 容灾 | 任一实例故障自动切换，页面无白屏、无假数据 |
| 日报 | 可按日期回看 ≥ 30 天，字段与 `/v2/60s` 一致 |
| 格式 | 支持 `format=text`、`format=markdown` 输出 |
| 一致性 | 同一源在页面、`/api`、快照三处的条目数一致（消除「显示 s60 实为其他通道」） |

---

## 7. 风险与注意事项

1. **公共实例无 SLA 且版本不一致**：`okbaike`（新版）与 `7se`（旧版）返回结构不同；同一路径在不同实例上 404/200 不一。必须做「业务码 + 数据结构」双重校验。
2. **部分端点上游本身不稳定**：实测 `rednote`、`dongchedi`、`maoyan` 返回 500，属于源侧问题，需降级展示而非报错。
3. **60s 端点是兼容保留的**：`/v2/today_in_history`、`/v2/baidu/realtime`、`/v2/weather`、`/v2/color` 等旧路径「未来大版本移除」，新代码应只用新路径。
4. **静态站无法根治实时性**：Pages 只能靠快照或前端直连；要「与 60s 一致」，最终仍需一个后端。
5. **许可**：60s 为 MIT，可自由集成；但第三方公共实例会经他人服务器，生产环境建议自建并只传公开数据。

---

## 8. 建议执行顺序（性价比排序）

| 优先级 | 动作 | 工作量 | 收益 |
|---|---|---|---|
| P0 | 提交并部署工作区新版（阶段 0） | 10 分钟 | 立刻消除旧版 + 21 个假数据源 |
| P0 | 修正 4 个错误端点 + 扩实例池（阶段 1） | 0.5 天 | 60s 真实覆盖从「碰巧」变「可控」 |
| P1 | 晨报归档 + 历史回看（阶段 2 的日报部分） | 0.5 天 | 解决「隔天看不到当天 60s」 |
| P1 | 实用速览 + 影视榜单（阶段 2 其余） | 2 天 | 补齐 60s 最具辨识度的能力 |
| P2 | 统一 API 与三种输出格式（阶段 3） | 1–2 天 | 对外可用性对齐 60s |
| P2 | 接入轻后端 / 前端直连兜底（阶段 4） | 1 天 | 静态站也有实时数据 |
| P3 | 自建 60s 实例（阶段 5） | 0.5 天 | 稳定性与合规性最佳 |

---

### 附：本次核查使用的事实来源

- 线上页面与静态资源：`https://aicode-2025.github.io/hotspot-hub/`（`app.js`、`index.html`、`demo.json`，2026-11-06 抓取，含无头 Edge 截图）
- 本地代码：`server.js`（`S_INSTANCES`、`fetch60s`、`SOURCES`）、`public/app.js`、`scripts/gen-demo.mjs`、`docs/deployment.md`
- `git status` / `git show HEAD:public/app.js`：确认线上对应 HEAD 版本
- 60s 官方：仓库元数据（GitHub API）、`src/router.ts` 路由表、文档站「API 参数约定」与「公共实例列表」
- 端点连通性实测：`60s.okbaike.com`，2026-11-06
