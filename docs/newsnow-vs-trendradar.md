# NewsNow 与 TrendRadar 对比分析：到底重不重复？

> 数据核实时间：2026-11-06。仓库元数据取自 GitHub API，功能描述取自两项目官方 README（TrendRadar v6.11.0 / MCP v4.1.1，NewsNow main 分支）。

## 一句话结论

**有重叠，但不是功能重复，而是「上游数据源 → 下游应用」的依赖关系 + 两种完全不同的使用形态。**

重叠只发生在**「多平台热榜聚合」这一层能力**上；而这一层在 TrendRadar 里并不是自己实现的——它直接调用 NewsNow 的公开 API。换句话说：**NewsNow 是 TrendRadar 的数据供应商，TrendRadar 是 NewsNow 的一个重度下游消费者。**

TrendRadar 官方 README「数据支持」章节原文：

> 本项目使用 [newsnow](https://github.com/ourongxing/newsnow) 项目的 API 获取多平台数据，特别感谢作者提供的服务。

并且 v6.7.0 更新日志明确支持：

> **自定义热榜 API 地址**：支持自部署 newsnow 并配置 `api_url` 使用自己的数据源

这是判断「是否重复」最硬的证据：如果两者功能重复，TrendRadar 不会把数据层交给 NewsNow，更不会提供「指向你自部署的 NewsNow」的配置项。

---

## 二、基本面速览

| 项目 | NewsNow（newsnext/newsnow） | TrendRadar（sansan0/TrendRadar） |
|---|---|---|
| 自我定位 | Elegant reading of real-time and hottest news（优雅地阅读实时热点） | AI 舆情监控与热点筛选助手，最快 30 秒部署，「告别无效刷屏」 |
| 主语言 | TypeScript | Python |
| 许可证 | **MIT**（宽松，可商用/闭源二次开发） | **GPL-3.0**（传染性，衍生分发需开源） |
| Stars / Forks | 22.3k / 6.2k | 63.5k / 24.9k |
| 创建时间 | 2024-09 | 2025-04 |
| 最近推送 | 2026-10-13 | 2026-11-05 |
| 官方实例/站点 | newsnow.busiyi.world | trendradar.sandev.cc（+ GitHub Pages 在线配置编辑器） |
| 产品形态 | 可交互的**网页阅读器 + 开放数据 API + MCP** | **定时任务流水线 + 推送机器人 + AI 简报 + 静态报告页 + MCP** |

补充事实：NewsNow 已从个人仓库 `ourongxing/newsnow` 迁移到组织仓库 `newsnext/newsnow`（TrendRadar README 里的致谢链接仍是旧地址），官方实例只读、作者已声明当前版本不再接受贡献，下一代 NewsNext 在等待名单阶段——这构成对下游的**供应链风险**（见第六节）。

---

## 三、六维对比

### 1. 目标用户

| 维度 | NewsNow | TrendRadar |
|---|---|---|
| 核心人群 | 普通读者、信息爱好者、前端/全栈开发者、需要热榜数据的产品方 | 自媒体运营、市场/品牌、投资人/交易员、公关舆情、企业管理者、内容创作者 |
| 使用动机 | 「一次看完所有榜」，替代装十几个 App | 「只看到我关心的」，避免信息过载与被算法牵着走 |
| 技术门槛 | 只看不用部署；自部署需 Node 20 + pnpm + CF/Vercel/Docker | 完全不写代码也能用（fork + 配 Secrets）；进阶需改 YAML |
| 付费/成本 | 免费公共实例；自部署成本极低（CF Pages 免费额度） | 免费；AI 分析/翻译需自备大模型 API Key（可选） |

**判断：用户画像部分重叠（都关注中文热点），但使用动机相反——一个是「看得更全」，一个是「看得更少」。**

### 2. 核心功能

| 能力 | NewsNow | TrendRadar |
|---|---|---|
| 多平台热榜聚合 | ✅ 66 条源定义，覆盖国内/国际/科技/财经/社会 | ✅ 默认 11 个平台，可增配；**数据经 NewsNow API 获得** |
| 实时阅读界面 | ✅ 核心卖点：统一卡片、优雅排版、实时刷新 | ❌ 只有定时生成的 `index.html` 报告，非实时浏览站 |
| RSS/Atom 订阅 | ❌ | ✅ 与热榜统一格式、统一关键词过滤、合并推送、新鲜度过滤 |
| 关键词筛选 | ❌ | ✅ 完整词法：`+`必含、`!`排除、`@N`限量、`[GLOBAL_FILTER]`、`/正则/`、`=> 显示名`、`[组别名]`、`#`注释 |
| AI 智能筛选 | ❌ | ✅ 自然语言描述兴趣 → 打标签 → 打分阈值，失败回退关键词 |
| 历史快照/趋势 | ❌ 仅 30 分钟缓存，无长期历史 | ✅ 时间轴、排名变化、🆕新增、持续性、跨平台对比、可调热度权重 |
| 推送/告警 | ❌ | ✅ 9 类渠道：企微(+微信)、飞书、钉钉、TG、邮件、ntfy、Bark、Slack、Webhook；三种模式（daily / current / incremental） |
| 调度 | 自适应抓取间隔（最短 2 分钟） | ✅ 按周逐日逐时段编排，5 种预设，支持工作日/周末差异化、跨午夜、时段冲突检测 |
| AI 翻译 / AI 分析简报 | ❌ | ✅ LiteLLM 接 100+ 模型商，支持备用模型；翻译任意语言 |
| 登录与个性化 | ✅ GitHub OAuth 登录 + 数据同步 | ❌ 无账号体系，配置即个性化 |
| MCP | ✅ `newsnow-mcp-server`（npx 即用） | ✅ 21 个工具 + 4 个资源（21 工具含趋势/情感/聚合/对比/报告） |
| 开放 REST API | ✅ `/api/s?id=` 等，可直接当数据接口用 | ❌ 对外只有 MCP；无通用 REST 接口 |
| 存储 | db0 抽象（CF D1 推荐），主要存用户态 | S3 兼容云存储（R2/OSS/COS）或本地 SQLite，存新闻快照与历史 |

**判断：除「聚合热榜」外几乎无交集。NewsNow 是「读」，TrendRadar 是「筛 + 存 + 算 + 推」。**

### 3. 数据来源（决定性差异）

- **NewsNow：自建采集层。** 66 条源定义，每源独立解析器（`shared/sources` + `server/sources`），自适应抓取间隔、30 分钟缓存、失败退化，覆盖微博/知乎/抖音/B站/头条/百度/贴吧/小红书/澎湃/凤凰/腾讯新闻/参考消息/联合早报/卫星社/HN/Product Hunt/GitHub Trending/36氪/IT之家/掘金/少数派/Solidot/FreeBuf/V2EX/Linux.do/酷安/牛客/果核/远景/AI 热榜/华尔街见闻/财联社/格隆汇/金十/雪球/法布财经/豆瓣/虎扑/懂球帝/Steam/什么值得买/爱奇艺/腾讯视频/懂车帝/快手等。
- **TrendRadar：不自建采集层。** 默认 11 个平台（知乎、抖音、B站热搜、华尔街见闻、贴吧、百度热搜、财联社、澎湃、凤凰、今日头条、微博），全部通过 NewsNow API 拉取；再加自配 RSS/Atom。想扩平台有两条路：改 `platforms` 配置（仍走 NewsNow 源），或用官网的「AI 自建热榜数据源」。

**结论：这一层是「复用」而非「重复实现」。TrendRadar 的源覆盖上限 = NewsNow 的源覆盖 + RSS。**

### 4. 使用方式与部署

| | NewsNow | TrendRadar |
|---|---|---|
| 零部署 | 直接开官方实例 | 无官方托管实例（只有配置编辑器在线体验）；需 fork 自己的仓库 |
| 部署路径 | Fork → Cloudflare Pages / Vercel；或 `docker compose up` | **Use this template** fork → GitHub Actions 定时跑（30 秒级）；或 Docker；或本地 Python；报告页可发 GitHub Pages / Cloudflare Pages |
| 配置方式 | 环境变量 + `wrangler.toml`；一般用户零配置 | `config/config.yaml` + `frequency_words.txt` + `ai_interests.txt`；提供 Web 可视化配置编辑器 |
| 触发方式 | 用户访问即拉取（有缓存） | 定时 Cron / 手动触发，无人访问也照跑 |
| 典型交互 | 打开网页 → 浏览 → 点标题跳转 | 配好关键词 → 到点收推送 → 需要时打开报告页或问 MCP |

### 5. 输出形态

- NewsNow：**交互式网页**（卡片流、分类切换、刷新状态、更新时间）+ **JSON API** + **MCP 工具返回**。
- TrendRadar：**IM/邮件推送消息**（纯文本或 HTML，含 🆕/🔺🔻、分组、独立展示区）+ **静态 HTML 报告**（宽屏、Tab、暗色、搜索、快捷键，渐进增强）+ **MCP 对话分析**。

### 6. 技术与许可

- NewsNow：TS + Vue/Nitro 系，MIT，适合被嵌入、二次开发、商业产品集成。
- TrendRadar：Python + LiteLLM，GPL-3.0，功能强但**闭源商用/分发需谨慎**（GPL 传染）。

---

## 四、重叠范围到底有多大

| 重叠点 | 重叠性质 | 是否构成「功能重复」 |
|---|---|---|
| 多平台热榜聚合 | TrendRadar **调用** NewsNow API，不是各写一套 | 否，属上下游依赖 |
| 覆盖平台（微博/知乎/抖音/B站/头条/百度/贴吧/澎湃/凤凰/华尔街见闻/财联社） | 同一批数据，同源 | 否，同一份数据被两种产品消费 |
| MCP 接入 AI 客户端 | 两者都有，但工具语义不同：NewsNow 是「取榜」，TrendRadar 是「查历史/趋势/情感/对比/报告」 | 边缘重叠，互补 |
| 自部署 / 数据自持 | 都能自托管 | 否，属于同类项目的共性，不构成定位重复 |
| 中文热点场景 | 同一赛道 | 否，赛道相同 ≠ 产品重复 |

**不重叠（各自独有）**

- 仅 NewsNow：实时阅读 UI、66 源覆盖、开放 REST API、GitHub OAuth、MIT 许可、Vercel/CF 一键托管。
- 仅 TrendRadar：关键词词法引擎、AI 筛选/翻译/简报、9 渠道推送、三模式 + 调度、历史快照与趋势分析、RSS 统一管理、静态报告与可视化配置器。

---

## 五、能否相互替代

| 需求 | 用 NewsNow | 用 TrendRadar | 结论 |
|---|---|---|---|
| 每天快速浏览全网热榜 | ✅ 最佳 | ⚠️ 只能看 11 个平台生成的静态报告 | NewsNow 胜 |
| 只要「AI/新能源/某公司」相关热点并推送到微信 | ❌ 做不到 | ✅ 强项 | TrendRadar 胜 |
| 分析某话题 7 天排名走势、跨平台热度差 | ❌ 无历史 | ✅ 强项 | TrendRadar 胜 |
| 把热榜数据接进自己的产品/脚本 | ✅ 开放 API + MIT | ❌ 无 REST，GPL 限制 | NewsNow 胜 |
| 在 Claude/Cursor 里问「现在微博在烧什么」 | ✅ 轻量 MCP | ✅ 也能，但需先有自己的数据 | 平手（NewsNow 更省事） |
| 团队/企业做舆情日报 | ⚠️ 只能人工看 | ✅ 定时 + 多渠道 + AI 简报 | TrendRadar 胜 |
| 完全离线/数据自持、不依赖第三方 | ⚠️ 需自部署采集 | ⚠️ **数据层仍依赖 NewsNow API**（可自部署 NewsNow 并用 `api_url` 指过去） | 组合才彻底 |

**替代性判定：**

1. **NewsNow → 替代 TrendRadar：不能。** 缺筛选、推送、历史、调度、AI，这些是 TrendRadar 的全部价值。
2. **TrendRadar → 替代 NewsNow：不能。** 数据源只有 11 个且来自 NewsNow；没有实时阅读界面；没有开放 API；GPL 不适合嵌入商业产品。
3. **单向可替代的窄场景：** 如果需求只是「看热榜」，NewsNow 可以完全覆盖 TrendRadar 的那部分能力，反之不成立。
4. **本质关系：** NewsNow 是**基础设施/数据层**，TrendRadar 是**应用层**。基础设施可以被应用层调用，但不能被应用层替代。

---

## 六、各自更适合什么场景

**选 NewsNow：**
- 个人日常信息消费，要「一屏看完、排版好看、手机上顺手」。
- 开发者要热榜数据做二次开发、做自己的聚合站、接 AI Agent（MIT + REST + MCP）。
- 想零成本托管（Cloudflare Pages 免费额度即可）。
- 需要覆盖长尾平台（豆瓣、Steam、什么值得买、懂车帝、酷安、Linux.do 等）。

**选 TrendRadar：**
- 有明确关注领域（行业、竞品、股票、政策），不想看无关热搜。
- 需要「到点自动推到手机/群」，而不是主动去刷网页。
- 需要日报/简报、AI 摘要、翻译、情感与趋势判断。
- 需要历史回溯（某话题什么时候上榜、排名怎么变）。
- 不想写代码，愿意用 fork + Secrets + 可视化配置器。
- 能接受 GPL-3.0（自用完全没问题）。

**两者组合（推荐，也是本仓库 `f:/热点` 的做法）：**
- NewsNow 负责**采集与数据接口**（可自部署，规避公共实例限流/停服）。
- TrendRadar 负责**筛选、分析、推送、报告**，并把 `api_url` 指向自部署的 NewsNow。
- 自己的站点在此之上补**结构化存储 + 标准化 API + 统一呈现**——这正是两者都没完整提供的部分（NewsNow 无长期历史，TrendRadar 无开放 REST）。

---

## 七、风险与注意事项

1. **NewsNow 维护状态**：官方 README 标注「NewsNext 即将到来，当前版本不再接受贡献」，官方实例 `newsnow.busiyi.world` 是唯一公共数据源。若其限流、迁移或停服，TrendRadar 默认配置会**直接失去数据**。生产使用应自部署 NewsNow 并配置 `api_url`。
2. **TrendRadar 的「35+ 平台」说法**：官方 README 明确默认 11 个平台；「35+」多为第三方文章的口径（把可扩展源/RSS 计入）。以 README 为准，不要按 35 个平台做容量规划。
3. **许可差异**：把 TrendRadar 代码并入闭源商业产品有 GPL-3.0 合规风险；NewsNow MIT 无此问题。
4. **推送频率**：TrendRadar 作者明确请求 Docker 部署时控制频率，避免对 NewsNow 公共 API 造成压力。

---

## 八、最终结论

| 问题 | 回答 |
|---|---|
| 功能是否重复？ | **部分重叠，不构成重复。** 重叠仅在「聚合多平台热榜」，且该层是 TrendRadar 复用 NewsNow 的结果，不是两套独立实现。 |
| 是否同一类产品？ | 不是。NewsNow = 热榜阅读器 + 数据 API；TrendRadar = 热点监控与推送流水线。 |
| 能否互相替代？ | 不能。只有「纯浏览」这一窄场景可由 NewsNow 覆盖 TrendRadar。 |
| 正确关系 | **上下游 + 互补**：NewsNow 供数据，TrendRadar 做筛选、分析、推送、报告。 |
| 选型一句话 | 想「看」选 NewsNow，想「盯」选 TrendRadar，要「既看又盯还自持数据」就两个一起用。 |

---

### 参考来源

- NewsNow 官方 README（main，中文版）：功能特性、部署、MCP、缓存与自适应抓取、MIT 许可
- TrendRadar 官方 README（master，v6.11.0）：核心功能、关键词语法、推送模式与渠道、AI 能力、MCP 工具、存储与部署、数据支持章节
- GitHub API 仓库元数据（stars/forks/license/语言/更新时间），2026-11-06 读取
- NewsNow `shared/sources.json`：66 条源定义（2026-11-06 读取）
