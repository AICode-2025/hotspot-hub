// 生成前端运行时配置：public/config.js
// 用法：node scripts/gen-config.mjs [输出目录]
// 环境变量：API_BASE（Worker 地址）、BUILD（提交短 SHA）
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.resolve(process.argv[2] || "public");
const apiBase = String(process.env.API_BASE || "").replace(/\/$/, "");
const build = String(process.env.BUILD || process.env.GITHUB_SHA || "dev").slice(0, 7);

const banner = `// 由 scripts/gen-config.mjs 生成，请勿手动修改\n`;
const body = `window.__API_BASE__ = ${JSON.stringify(apiBase)};\nwindow.__BUILD__ = ${JSON.stringify(build)};\n`;

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, "config.js"), banner + body);
console.log(`config.js 已生成：API_BASE=${apiBase || "(同源/静态)"} BUILD=${build} → ${OUT_DIR}`);
