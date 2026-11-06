// 生成静态演示数据快照 demo.json
// 用法：node scripts/gen-demo.mjs [输出目录]
// 环境变量 LIVE_API_BASE 指定线上/本地 API 地址（默认 http://localhost:4173）
// GitHub Actions 中若配置了 vars.LIVE_API_BASE，则每次部署/定时构建时刷新快照。

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.LIVE_API_BASE || "http://localhost:4173").replace(/\/$/, "");
const OUT_DIR = path.resolve(process.argv[2] || "public");

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function demoBoard(s) {
  return {
    id: s.id,
    name: s.name,
    cat: s.cat,
    adapter: "demo",
    updated: "",
    trends: {},
    items: [
      { title: `${s.name} · 示例热点 ①（静态演示）`, url: "", hot: null },
      { title: `${s.name} · 示例热点 ②（静态演示）`, url: "", hot: null },
      { title: `${s.name} · 示例热点 ③（静态演示）`, url: "", hot: null },
    ],
  };
}

const main = async () => {
  const meta = await getJson(`${BASE}/api/sources`);
  const sources = meta.data.sources;
  const cats = meta.data.cats;
  const boards = {};
  let live = 0;

  // 并发 8 抓取全部源；不可达源用带明确标识的演示条目填充
  const queue = [...sources];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        try {
          const json = await getJson(`${BASE}/api/board/${s.id}?limit=30`);
          if (json.code !== 200 || !json.data.items?.length) throw new Error("empty");
          boards[s.id] = json.data;
          live++;
        } catch {
          boards[s.id] = demoBoard(s);
        }
      }
    })
  );

  let digest = null;
  try {
    const d = await getJson(`${BASE}/api/60s/60s`);
    if (d.code === 200 && d.data?.news) digest = d.data;
  } catch {
    // 无日报数据时前端会显示错误状态
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: BASE,
    liveSources: live,
    cats,
    sources,
    digest,
    boards,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "demo.json"), JSON.stringify(out));
  console.log(`demo.json 已生成：${live}/${sources.length} 源为实时数据，输出 ${OUT_DIR}`);
};

main().catch((e) => {
  console.error("生成失败：", e.message);
  process.exit(1);
});
