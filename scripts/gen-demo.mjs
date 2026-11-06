// 生成静态数据快照 demo.json
// 用法：node scripts/gen-demo.mjs [输出目录]
// 环境变量 LIVE_API_BASE 指定线上/本地 API 地址（默认 http://localhost:4173）
//
// 原则：只为真实采集成功的源写入真实条目。不可达源写入 status=unavailable + 原因，
//       绝不生成「示例热点」之类的模拟内容，避免静态预览误导读者。

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.LIVE_API_BASE || "http://localhost:4173").replace(/\/$/, "");
const OUT_DIR = path.resolve(process.argv[2] || "public");

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function unavailable(s, reason) {
  return {
    id: s.id,
    name: s.name,
    cat: s.cat,
    status: "unavailable",
    reason,
    verifiedAt: new Date().toISOString(),
    items: [],
    trends: {},
  };
}

const main = async () => {
  const meta = await getJson(`${BASE}/api/sources`);
  const sources = meta.data.sources;
  const cats = meta.data.cats;
  const boards = {};
  let live = 0;

  const queue = [...sources];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const s = queue.shift();
        if (!s) return;
        try {
          const json = await getJson(`${BASE}/api/board/${s.id}?limit=30`);
          if (json.code !== 200 || !json.data?.items?.length) throw new Error("empty");
          boards[s.id] = { status: "ok", verifiedAt: new Date().toISOString(), data: json.data };
          live++;
        } catch {
          boards[s.id] = unavailable(s, "该上游在此采集环境未返回数据（官方实例/网络限制或源端故障）");
        }
      }
    })
  );

  let digest = null;
  try {
    const d = await getJson(`${BASE}/api/60s/60s`);
    if (d.code === 200 && d.data?.news) digest = d.data;
  } catch {
    // 日报缺失时前端展示明确的不可用状态
  }

  // 时间线：服务端真实快照批次 + 当前批次的真实变动事件
  let batches = [];
  try {
    const tl = await getJson(`${BASE}/api/timeline`);
    batches = tl?.data?.batches || [];
  } catch {
    // 快照历史不可用时不编造时间线
  }
  const current = { t: Date.now(), sources: [], events: [], current: true };
  for (const s of sources) {
    const b = boards[s.id];
    if (b.status !== "ok") continue;
    current.sources.push({ id: s.id, name: s.name, cat: s.cat, count: b.data.items.length });
    b.data.items.forEach((it, i) => {
      const t = b.data.trends?.[it.title];
      if (!t) return;
      if (t.isNew) current.events.push({ kind: "new", source: s.name, id: s.id, title: it.title, rank: i + 1 });
      else if (typeof t.delta === "number" && t.delta >= 5)
        current.events.push({ kind: "up", source: s.name, id: s.id, title: it.title, rank: i + 1, delta: t.delta });
    });
  }
  const timeline = { batches: [current, ...batches].slice(0, 10) };

  const out = {
    generatedAt: new Date().toISOString(),
    source: BASE,
    liveSources: live,
    snapshotPolicy: "仅写入真实采集数据；不可达源标记 status=unavailable，不生成模拟条目",
    cats,
    sources,
    digest,
    boards,
    timeline,
  };
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "demo.json"), JSON.stringify(out));
  console.log(`demo.json 已生成：${live}/${sources.length} 源为真实采集数据；其余标记不可用，输出 ${OUT_DIR}`);
};

main().catch((e) => {
  console.error("生成失败：", e.message);
  process.exit(1);
});
