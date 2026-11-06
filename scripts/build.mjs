// 构建前端静态产物：public → dist，并注入运行时配置
// 用法：npm run build（等价于 node scripts/build.mjs dist）
// 环境变量：API_BASE（Worker 地址）、BUILD（提交短 SHA）、LIVE_API_BASE（可选，刷新快照）
import { cp, mkdir, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(process.argv[2] || "dist");
const SRC = path.resolve("public");
const API_BASE = String(process.env.API_BASE || "").replace(/\/$/, "");
const BUILD = String(process.env.BUILD || process.env.GITHUB_SHA || "dev").slice(0, 7);

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

if (!(await exists(path.join(SRC, "index.html")))) {
  console.error(`[build] 源目录缺少 index.html：${SRC}`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(SRC, OUT, { recursive: true });

await writeFile(
  path.join(OUT, "config.js"),
  `// 由 scripts/build.mjs 生成，请勿手动修改\nwindow.__API_BASE__ = ${JSON.stringify(API_BASE)};\nwindow.__BUILD__ = ${JSON.stringify(BUILD)};\n`
);

// 可选：从线上 API 刷新静态快照（由 CI 单独执行 npm run snapshot，避免构建耦合）
if (process.env.LIVE_API_BASE) {
  console.log(`[build] LIVE_API_BASE=${process.env.LIVE_API_BASE}（快照刷新请单独运行 npm run snapshot）`);
}

const required = ["index.html", "style.css", "config.js", "js/app.js", "js/views/today.js", "demo.json"];
const missing = [];
for (const f of required) if (!(await exists(path.join(OUT, f)))) missing.push(f);
if (missing.length) {
  console.error(`[build] 产物缺少必需文件：${missing.join(", ")}`);
  process.exit(1);
}

console.log(`[build] OK → ${OUT}  API_BASE=${API_BASE || "(同源/静态)"}  BUILD=${BUILD}`);
