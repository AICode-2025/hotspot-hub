# 热点晨报（Hotspot Hub）

国内外热点聚合站：**每天 60 秒读懂世界 + 49 路热点源**（国内 / 国际 / 科技 / 财经 / 社会），含趋势追踪与跨源关键词筛选。整合 [vikiboss/60s](https://github.com/vikiboss/60s)、[newsnext/newsnow](https://github.com/newsnext/newsnow)、[sansan0/TrendRadar](https://github.com/sansan0/TrendRadar) 三个开源项目的核心能力。

设计与 API 规范详见 `docs/blueprint.md`，交互原型见 `/prototype.html`。

## 运行

```bash
npm start        # 或 node server.js，Node ≥ 18，零依赖
```

打开 http://localhost:4173 （`PORT` 可改；`NEWSNOW_BASE` 可追加自部署 newsnow 实例）

## 数据源与适配器

每个源配置**适配器链**，运行时按序尝试直到成功（`server.js` 的 `SOURCES`）：

| 适配器 | 说明 |
|---|---|
| `s60:<ep>` | 60s API（3 个公共实例故障转移，兼容两代返回格式） |
| `newsnow:<id>` | newsnow 实例（官方/自部署 + 公共中转兜底） |
| `hn` / `github` / `wscn` / `rss:<url>` | 上游直连（Algolia、GitHub Search、华尔街见闻、RSS） |

源可用性随部署环境自动探测：启动与每 10 分钟并发预热全部源（`/api/health` 查看覆盖情况），失败结果短缓存 2 分钟避免反复超时。

## API

| 端点 | 说明 |
|---|---|
| `GET /api/sources` | 数据源注册表（49 源 + 分类 + 适配器链） |
| `GET /api/board/:id?limit=30` | 归一化榜单（含趋势标注 trends） |
| `GET /api/health` | 健康 + 各源可用性统计 |
| `GET /api/60s/:ep` · `GET /api/newsnow?id=` | 原始透传（兼容保留） |

## 功能

- **晨报**：每天 60 秒读懂世界（15 条要闻 + 微语 + 日报图）
- **热榜**：分类（国内/国际/科技/财经/社会）× 多源卡片网格，跨源关键词筛选（`词A 词B` 任一匹配 · `+必含` · `!排除`）
- **趋势**：排名时间线、🆕 新上榜、🔺🔻 排名变化（快照每 5 分钟，保留 48 点）
