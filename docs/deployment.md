# 部署说明：GitHub Pages（静态预览）+ Node 服务（完整功能）

本项目有两种运行形态，二者共用 `public/` 前端资产：

| 形态 | 地址 | 后端 | 数据 |
|---|---|---|---|
| GitHub Pages（本工作流） | `https://<owner>.github.io/<repo>/` | 无（纯静态） | `demo.json` 部署时的真实采集快照；未接入的源标明原因且不展示任何模拟内容，可在「内容后台」人工录入并显式标注 |
| Node 服务（VPS / Cloudflare Workers） | 自有域名 | `server.js` | 49 源实时采集 + 趋势快照 + `/api/*` 开放接口 |

## 一、Pages 自动部署流程

1. 推送 `main` / `master` 分支（或每 6 小时定时 / 手动 `workflow_dispatch`）触发 `.github/workflows/deploy-pages.yml`
2. `build` 任务：`public/` → `dist/`；若配置了 `vars.LIVE_API_BASE`，则调用 `scripts/gen-demo.mjs` 从线上 Node 服务重新抓取 49 源快照写入 `dist/demo.json`；若配置了 `vars.CUSTOM_DOMAIN`，写入 `dist/CNAME`
3. `upload-pages-artifact@v3` 上传 `dist/`，`deploy-pages@v4` 发布到 `github-pages` 环境
4. 校验步骤 `curl` 公开地址必须为 HTTP 200，否则工作流失败

前端自动判断形态：`api/sources` 可用 → 实时模式；不可用（Pages）→ 回退 `demo.json` 静态模式。所有资源使用**相对路径**，兼容 Pages 项目子路径 `/<repo>/`。

## 二、所需配置项

**仓库 Settings → Pages**：Source 选择 **GitHub Actions**（本工作流自动配置 `build_type=workflow`）。

**Settings → Secrets and variables → Actions → Variables**（均为可选）：

| 变量 | 作用 |
|---|---|
| `LIVE_API_BASE` | 已部署的 Node 服务地址（如 `https://hub.example.com`）；配置后每次构建刷新真实数据快照，配合 6 小时定时可让 Pages 站点持续更新 |
| `CUSTOM_DOMAIN` | 自定义域名；设置后自动在产物中生成 `CNAME`。需同时在 DNS 服务商添加 `CNAME → <owner>.github.io`，并在 Pages 设置中启用 Enforce HTTPS |

权限由工作流内的 `permissions: contents: read / pages: write / id-token: write` 声明，无需额外 PAT。

## 三、完整功能部署（Node 服务）

```bash
npm start          # 零依赖，Node ≥ 18，默认 4173 端口
```

- VPS：`node server.js`（或 `node-cron` / systemd 定时；反向代理 Nginx 到 4173）
- Cloudflare Workers：复用 `core/` 逻辑 + D1 存储 + Cron Triggers（见 `docs/blueprint.md`）

## 四、常见问题定位

| 现象 | 原因 | 处理 |
|---|---|---|
| Actions 报 `HttpError: Resource not accessible` | 仓库 Pages 未启用或 GITHUB_TOKEN 权限不足 | Settings → Pages → Source 选 GitHub Actions；Settings → Actions → Workflow permissions 设为 Read/Write |
| 站点 404 / CSS 失效 | 使用了绝对路径 `/style.css` | 已全部改为 `./` 相对路径；确认 `dist/index.html` 存在（工作流内有断言） |
| 页面显示「数据源目录加载失败」 | `demo.json` 缺失或格式错误 | 检查 `public/demo.json` 是否提交；执行 `node scripts/gen-demo.mjs public` 重新生成 |
| 页面显示「静态预览」横幅 | 预期行为：Pages 无后端，仅展示部署时采集的真实快照 | 配置 `LIVE_API_BASE` 指向已部署 Node 服务以刷新快照，或在 VPS/CF 上直接运行 Node 版本 |
| 自定义域名证书错误 | DNS 未生效 / 未开启 HTTPS | 确认 CNAME 解析到 `<owner>.github.io`，等待证书签发后勾选 Enforce HTTPS |
| 首次推送后 Actions 列表为空 | 空仓库的初始 push 通常不会触发该 push 内新增的工作流 | 在 Actions 页手动运行一次 `workflow_dispatch`；之后凡涉及 `public/**`、`scripts/gen-demo.mjs`、工作流文件的 push 都会自动触发（本次上线已验证） |
| 改了文档却没有新构建 | 工作流 `paths` 过滤仅监听站点资产相关路径 | 属于预期行为；需要重新部署时可手动 dispatch，或刷新 `public/demo.json` 后推送 |
| 定时构建未触发 | 仓库 60 天无活动时 GitHub 会暂停 schedule | 手动触发一次 `workflow_dispatch`，或改用外部 cron 调 API 触发 |
| 构建时 `gen-demo.mjs` 失败 | `LIVE_API_BASE` 指向的服务不可达 | 脚本对单源失败会标记 `status=unavailable` 并记录原因（绝不生成模拟条目）；整体失败时检查该地址 `/api/health` |

## 五、本地验证静态模式

```bash
cd public
python -m http.server 8080
# 打开 http://localhost:8080 —— 无 /api/* 时应进入静态预览模式，顶部横幅说明快照时间与真实源数量
```
