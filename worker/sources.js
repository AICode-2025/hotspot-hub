// 数据源注册表与上游配置（Worker 专用，已修正 60s 端点路径）
export const CATS = ["全部", "国内", "国际", "科技", "财经", "社会"];

// adapters 按序尝试；s60 的第二个参数必须是真实端点（如 baidu/hot），不是源 id
export const SOURCES = [
  { id: "weibo", name: "微博", cat: "国内", adapters: ["s60:weibo"] },
  { id: "zhihu", name: "知乎", cat: "国内", adapters: ["s60:zhihu"] },
  { id: "baidu", name: "百度", cat: "国内", adapters: ["s60:baidu/hot", "newsnow:baidu"] },
  { id: "douyin", name: "抖音", cat: "国内", adapters: ["s60:douyin"] },
  { id: "toutiao", name: "今日头条", cat: "国内", adapters: ["s60:toutiao"] },
  { id: "kuaishou", name: "快手", cat: "国内", adapters: ["newsnow:kuaishou"] },
  { id: "bilibili", name: "哔哩哔哩", cat: "国内", adapters: ["s60:bili", "newsnow:bilibili"] },
  { id: "tieba", name: "百度贴吧", cat: "国内", adapters: ["s60:baidu/tieba", "newsnow:tieba"] },
  { id: "rednote", name: "小红书", cat: "国内", adapters: ["s60:rednote", "newsnow:rednote"] },
  { id: "thepaper", name: "澎湃新闻", cat: "国内", adapters: ["newsnow:thepaper"] },
  { id: "ifeng", name: "凤凰网", cat: "国内", adapters: ["newsnow:ifeng"] },
  { id: "tencent", name: "腾讯新闻", cat: "国内", adapters: ["newsnow:tencent"] },
  { id: "cankaoxiaoxi", name: "参考消息", cat: "国内", adapters: ["newsnow:cankaoxiaoxi"] },
  { id: "kaopu", name: "靠谱新闻", cat: "国内", adapters: ["newsnow:kaopu"] },
  { id: "chongbuluo", name: "冲不部落", cat: "国内", adapters: ["newsnow:chongbuluo"] },

  { id: "zaobao", name: "联合早报", cat: "国际", adapters: ["newsnow:zaobao"] },
  { id: "sputniknewscn", name: "卫星通讯社", cat: "国际", adapters: ["rss:sputnik", "newsnow:sputniknewscn"] },
  { id: "mktnews", name: "MktNews", cat: "国际", adapters: ["newsnow:mktnews"] },
  { id: "hackernews", name: "Hacker News", cat: "国际", adapters: ["hn", "newsnow:hackernews"] },
  { id: "producthunt", name: "Product Hunt", cat: "国际", adapters: ["newsnow:producthunt"] },

  { id: "github", name: "GitHub Trending", cat: "科技", adapters: ["github", "newsnow:github"] },
  { id: "36kr", name: "36氪", cat: "科技", adapters: ["newsnow:36kr"] },
  { id: "ithome", name: "IT之家", cat: "科技", adapters: ["newsnow:ithome"] },
  { id: "juejin", name: "掘金", cat: "科技", adapters: ["newsnow:juejin"] },
  { id: "sspai", name: "少数派", cat: "科技", adapters: ["newsnow:sspai"] },
  { id: "solidot", name: "Solidot", cat: "科技", adapters: ["newsnow:solidot"] },
  { id: "freebuf", name: "FreeBuf", cat: "科技", adapters: ["newsnow:freebuf"] },
  { id: "v2ex", name: "V2EX", cat: "科技", adapters: ["newsnow:v2ex"] },
  { id: "linuxdo", name: "Linux.do", cat: "科技", adapters: ["newsnow:linuxdo"] },
  { id: "coolapk", name: "酷安", cat: "科技", adapters: ["newsnow:coolapk"] },
  { id: "nowcoder", name: "牛客网", cat: "科技", adapters: ["newsnow:nowcoder"] },
  { id: "ghxi", name: "果核剥壳", cat: "科技", adapters: ["newsnow:ghxi"] },
  { id: "pcbeta", name: "远景论坛", cat: "科技", adapters: ["newsnow:pcbeta"] },
  { id: "aihot", name: "AI 热榜", cat: "科技", adapters: ["newsnow:aihot"] },
  { id: "quark", name: "夸克热点", cat: "科技", adapters: ["s60:quark"] },

  { id: "wallstreetcn", name: "华尔街见闻", cat: "财经", adapters: ["wscn", "newsnow:wallstreetcn"] },
  { id: "cls", name: "财联社", cat: "财经", adapters: ["newsnow:cls"] },
  { id: "gelonghui", name: "格隆汇", cat: "财经", adapters: ["newsnow:gelonghui"] },
  { id: "jin10", name: "金十数据", cat: "财经", adapters: ["newsnow:jin10"] },
  { id: "xueqiu", name: "雪球", cat: "财经", adapters: ["newsnow:xueqiu"] },
  { id: "fastbull", name: "法布财经", cat: "财经", adapters: ["newsnow:fastbull"] },

  { id: "douban", name: "豆瓣", cat: "社会", adapters: ["s60:douban/weekly/movie", "newsnow:douban"] },
  { id: "hupu", name: "虎扑", cat: "社会", adapters: ["newsnow:hupu"] },
  { id: "dongqiudi", name: "懂球帝", cat: "社会", adapters: ["newsnow:dongqiudi"] },
  { id: "steam", name: "Steam", cat: "社会", adapters: ["newsnow:steam"] },
  { id: "smzdm", name: "什么值得买", cat: "社会", adapters: ["newsnow:smzdm"] },
  { id: "iqiyi", name: "爱奇艺", cat: "社会", adapters: ["newsnow:iqiyi"] },
  { id: "qqvideo", name: "腾讯视频", cat: "社会", adapters: ["newsnow:qqvideo"] },
  { id: "dongchedi", name: "懂车帝", cat: "社会", adapters: ["s60:dongchedi", "newsnow:dongchedi"] },
];

// 官方推荐实例（2026-09 文档）：大陆可用 + HTTPS
export const S60_INSTANCES = [
  "https://60s.okbaike.com",
  "https://60api.09cdn.xyz",
  "https://60s.zeabur.app",
  "https://60s.tmini.net",
  "https://60s.7se.cn",
  "https://60s.crystelf.top",
  "https://60s.viki.moe",
];

export const NEWSNOW_BASES = ["https://newsnow.busiyi.world"];

export const RSS_MAP = {
  sputnik: "https://sputniknews.cn/export/rss2/archive/index.xml",
};

// 60s 实用数据（模块 -> 端点）
export const METRIC_ENDPOINTS = {
  gold: "gold-price",
  oil: "fuel-price",
  exchange: "exchange-rate",
  weatherNow: "weather/realtime",
  weatherForecast: "weather/forecast",
  history: "today-in-history",
  epic: "epic",
  aiNews: "ai-news",
  itNews: "it-news",
};

export const MEDIA_ENDPOINTS = {
  "maoyan.allMovie": "maoyan/all/movie",
  "maoyan.realtimeMovie": "maoyan/realtime/movie",
  "maoyan.realtimeTv": "maoyan/realtime/tv",
  "maoyan.realtimeWeb": "maoyan/realtime/web",
  "douban.movie": "douban/weekly/movie",
  "douban.tv_chinese": "douban/weekly/tv_chinese",
  "douban.tv_global": "douban/weekly/tv_global",
  "douban.show_chinese": "douban/weekly/show_chinese",
  "douban.show_global": "douban/weekly/show_global",
  "baidu.teleplay": "baidu/teleplay",
};
