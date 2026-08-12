// ============================================================
// 报道质量评分器
// 基于中建八局西北公司内蒙古分公司 2023-2025 年度
// 1271 条真实对外投稿数据训练
// ============================================================

// ============================================================
// 一、报道特征词库（从1271条真实台账提取）
// ============================================================

/**
 * 报道事件关键词（台账高频事件词，频次≥3）
 * 标题包含这些词 → 强烈表明这是一篇新闻报道
 */
const REPORT_EVENT_KEYWORDS = [
  "封顶", "竣工", "验收", "开工", "复工", "启用", "完工",
  "全面复工", "复工复产", "冲刺", "新进展", "最新进展",
  "突破", "落成", "开馆", "试运行", "启动", "传来最新消息",
  "又有新进展", "建设进入", "进入冲刺", "全力冲刺",
  "全面封顶", "圆满完成", "首座", "通过验收", "正式投用",
  "正式对外开放", "具备条件", "对外开放",
  // 补充：台账中频次较低但仍具识别力的词
  "结构封顶", "主体完工", "交付", "投入使用", "投运",
  "贯通", "揭牌", "开工仪式", "通车", "合龙", "亮灯",
  "授牌", "签约", "奠基", "上线",
] as const;

/**
 * 报道进展描述词（辅助识别）
 */
const PROGRESS_KEYWORDS = [
  "进展", "最新", "新进展", "进度", "进入",
  "按下加速键", "跑出加速度", "步入", "迎来",
  "即将", "预计", "计划", "顺利", "圆满",
  "全力", "全面", "有序", "积极",
] as const;

/**
 * 建设内容关键词（台账中报道标题频繁包含）
 */
const CONSTRUCTION_CONTENT_KEYWORDS = [
  "建设", "施工", "主体结构", "钢结构", "航站楼",
  "跑道", "飞行区", "站前广场", "配套", "装修",
  "安装", "机电", "幕墙", "精装", "园林",
  "道路", "管网", "绿化", "停车场", "停机坪",
  "登机桥", "跑道", "滑行道", "塔台",
] as const;

// ============================================================
// 二、噪音过滤器（绝对排除）
// ============================================================

/**
 * 高优先级排除词 — 只要标题包含就排除
 */
const ABSOLUTE_EXCLUDE_PATTERNS = [
  // 招聘/求职
  /招聘|求职|招人|诚聘|年薪|五险一金|岗位|社招|校招|实习|管培生|猎头|内推|急招|高薪/,
  // 招标/中标/采购
  /招标公告|中标候选|中标公示|招标文件|采购公告|询价公告|竞争性磋商|比选公告|流标|废标|中标结果|招投标|投标/,
  // 股票/金融
  /股票|基金净值|A股|港股|涨停|跌停|收盘|开盘|K线|市盈率|市净率|分红/,
  // 广告/营销
  /广告|推广|促销|优惠|限时|打折|免费领取|秒杀|团购|满减|狂欢|大促/,
  // 纯通知/公告（无报道价值）
  /^关于.*(通知|公告|公示|通告)$/,
  /(放假|调休|闭馆|闭园|暂停营业|停水|停电|停气).*(通知|公告)/,
  // 企业内部管理
  /述职|竞聘|绩效考核|考勤|周报|月报|日报|会议纪要|内部培训|员工手册/,
];

/**
 * 低质量内容排除
 */
const LOW_QUALITY_EXCLUDE_PATTERNS = [
  // 自媒体聚合（非真实媒体报道）
  /搜狐网|新浪财经|网易号|企鹅号|大鱼号|大风号|一点号|看点快报|360快传/,
  // 低质量内容农场
  /快照|百度快照|网页快照|缓存/,
  // 日期格式异常
  /^\d{4}-\d{2}-\d{2}$/, // 标题仅有日期，无实际内容
];

// ============================================================
// 三、评分规则
// ============================================================

export interface ScoredResult {
  date: string;
  title: string;
  media: string;
  url: string;
  snippet: string;
  source: "news" | "wechat";
  /** 报道质量分 (0-100) */
  score: number;
  /** 评分详情 */
  scoreDetail: string[];
}

/**
 * 对单条搜索结果进行报道质量评分
 * @returns 评分后的结果，score < 15 的会被判定为「非报道」
 */
export function scoreReportQuality(result: {
  date: string;
  title: string;
  media: string;
  url: string;
  snippet: string;
  source: "news" | "wechat";
}): ScoredResult {
  const { title, snippet, media } = result;
  const text = title + snippet;
  let score = 0;
  const detail: string[] = [];

  // ============================================================
  // 第一关：绝对排除
  // ============================================================
  for (const pattern of ABSOLUTE_EXCLUDE_PATTERNS) {
    if (pattern.test(title) || pattern.test(text)) {
      return { ...result, score: -100, scoreDetail: ["绝对排除: " + pattern.source] };
    }
  }

  for (const pattern of LOW_QUALITY_EXCLUDE_PATTERNS) {
    if (pattern.test(title) || pattern.test(media)) {
      return { ...result, score: -50, scoreDetail: ["低质量源排除"] };
    }
  }

  // ============================================================
  // 第二关：标题长度检查
  // ============================================================
  // 台账数据：86% 的报道标题在 10-29 字范围内
  if (title.length < 5) {
    return { ...result, score: 0, scoreDetail: ["标题过短(<5字)"] };
  }
  if (title.length >= 10 && title.length <= 29) {
    score += 10;
    detail.push("标题长度优(10-29字)");
  } else if (title.length >= 5 && title.length <= 39) {
    score += 5;
    detail.push("标题长度正常");
  }

  // ============================================================
  // 第三关：报道事件词命中（核心权重）
  // ============================================================
  let eventHits = 0;
  for (const kw of REPORT_EVENT_KEYWORDS) {
    if (title.includes(kw)) {
      eventHits++;
    }
  }

  if (eventHits >= 2) {
    score += 30;
    detail.push("多事件词命中(" + eventHits + "个)");
  } else if (eventHits === 1) {
    score += 20;
    detail.push("报道事件词命中");
  }

  // ============================================================
  // 第四关：进展描述词
  // ============================================================
  let progressHits = 0;
  for (const kw of PROGRESS_KEYWORDS) {
    if (title.includes(kw)) progressHits++;
  }
  if (progressHits >= 2) {
    score += 10;
    detail.push("进展描述+" + progressHits);
  }

  // ============================================================
  // 第五关：标题结构特征
  // ============================================================
  // 台账报道标题常见结构：
  // 1. [项目名] + [事件]  e.g. "呼和浩特盛乐国际机场航空口岸通过验收"
  // 2. [事件]！+ [项目名]  e.g. "树起文化新地标——内蒙古博物院新址试运行效果纵览"
  // 3. [媒体修饰词] + [项目名] + [事件]

  // 破折号/冒号分隔（如"标题——副标题"）
  if (/[-—:：]/.test(title)) score += 5;
  // 感叹号（常用于自媒体/微信标题，但也有部分正式报道用）
  if (/[！!]/.test(title)) score += 2;

  // ============================================================
  // 第六关：来源质量
  // ============================================================
  if (result.source === "news") {
    // Google News / 百度新闻来源本身就过滤了很多噪音
    score += 5;
    detail.push("新闻源");

    // 媒体名含「报」「网」「台」等 → 正规媒体
    if (/[报网台刊社]$/.test(media) || media.includes("新华") || media.includes("人民") || media.includes("央视")) {
      score += 5;
      detail.push("正规媒体");
    }
  }
  if (result.source === "wechat") {
    // 微信公众号文章需要更严格判断
    score += 2;
    // 微信公众号来源额外加权（如果标题像报道）
    if (eventHits > 0) {
      score += 5;
      detail.push("微信+事件词");
    }
  }

  // ============================================================
  // 第七关：URL 质量
  // ============================================================
  try {
    const u = new URL(result.url.startsWith("http") ? result.url : "https://" + result.url);
    // 政府网站加分
    if (u.hostname.includes(".gov.cn")) {
      score += 8;
      detail.push("政府网站");
    }
    // 知名媒体域名
    const knownMedia = [
      "xinhuanet.com", "people.com.cn", "cctv.com", "chinanews.com",
      "gmw.cn", "ce.cn", "huanqiu.com", "cnr.cn", "cri.cn",
      "thepaper.cn", "eastday.com", "youth.cn", "china.com.cn",
    ];
    if (knownMedia.some((d) => u.hostname.includes(d))) {
      score += 5;
      detail.push("知名媒体域名");
    }
  } catch {}

  return { ...result, score, scoreDetail: detail };
}

/**
 * 批量评分 + 过滤
 * @param results 原始搜索结果
 * @param minScore 最低通过分数（默认 15）
 * @returns 通过评分的结果（按分数降序排列）
 */
export function filterByReportQuality(
  results: Array<{
    date: string;
    title: string;
    media: string;
    url: string;
    snippet: string;
    source: "news" | "wechat";
  }>,
  minScore: number = 15
): ScoredResult[] {
  const scored = results.map(scoreReportQuality);

  console.log(
    `[报道评分] 总计=${results.length}, ` +
    `高质(≥30)=${scored.filter((r) => r.score >= 30).length}, ` +
    `合格(15-29)=${scored.filter((r) => r.score >= 15 && r.score < 30).length}, ` +
    `低质(1-14)=${scored.filter((r) => r.score > 0 && r.score < 15).length}, ` +
    `排除(≤0)=${scored.filter((r) => r.score <= 0).length}`
  );

  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

/**
 * 获取报道评分统计
 */
export function getScoreStats(
  results: Array<{
    date: string;
    title: string;
    media: string;
    url: string;
    snippet: string;
    source: "news" | "wechat";
  }>
): { total: number; high: number; ok: number; low: number; excluded: number } {
  const scored = results.map(scoreReportQuality);
  return {
    total: results.length,
    high: scored.filter((r) => r.score >= 30).length,
    ok: scored.filter((r) => r.score >= 15 && r.score < 30).length,
    low: scored.filter((r) => r.score > 0 && r.score < 15).length,
    excluded: scored.filter((r) => r.score <= 0).length,
  };
}
