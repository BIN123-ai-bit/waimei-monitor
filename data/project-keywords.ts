// 中建八局西北公司内蒙古分公司 — 项目关键词数据库
// 基于 2023-2025 年度宣传台账（1774条记录）实际数据提取
// 所有名称均为台账中实际出现过的表述

export interface ProjectKeyword {
  primary: string;
  aliases: string[];
  type: string;
  years: string[];
}

// ============================================================
// 核心项目列表（按台账中出现频率排序，仅包含实际出现的名称）
// ============================================================

export const PROJECT_KEYWORDS: ProjectKeyword[] = [
  {
    // 台账中出现 500+ 次，最高频项目
    // 2023-2024称"呼和浩特新机场"，2024年命名获批后称"呼和浩特盛乐国际机场"
    primary: "呼和浩特盛乐国际机场",
    aliases: [
      "呼和浩特新机场",
      "盛乐国际机场",
      "呼和浩特盛乐机场",
      "呼市新机场",
      "和林格尔盛乐国际机场",
      "呼和浩特新机场航站区",
      "呼和浩特新机场航站楼",
      "呼和浩特新机场项目",
    ],
    type: "机场建设",
    years: ["2023", "2024", "2025", "2026"],
  },
  {
    // 台账中"蒙牛"出现84次
    primary: "蒙牛乳业",
    aliases: [
      "蒙牛",
      "蒙牛集团",
      "蒙牛产业园",
      "蒙牛乳业产业园",
      "蒙牛工厂",
      "蒙牛项目",
    ],
    type: "产业园区",
    years: ["2023", "2024", "2025"],
  },
  {
    // 台账中"博物院"出现63次
    primary: "内蒙古博物院",
    aliases: [
      "博物院",
      "内蒙古博物院新址",
      "内蒙古博物馆",
      "博物院新馆",
    ],
    type: "文化场馆",
    years: ["2024", "2025", "2026"],
  },
  {
    // 台账中"万象城"出现49次
    primary: "呼和浩特万象城",
    aliases: ["万象城", "呼和浩特万象城", "呼市万象城"],
    type: "商业综合体",
    years: ["2025"],
  },
  {
    // 台账中"数据中心"38次，"乌兰察布"38次，"银保信"34次
    primary: "中国银保信乌兰察布数据中心",
    aliases: [
      "乌兰察布数据中心",
      "银保信数据中心",
      "中银保信乌兰察布数据中心",
      "银保信乌兰察布",
      "乌兰察布数据",
      "银保信项目",
    ],
    type: "数据中心",
    years: ["2023", "2024", "2025"],
  },
  {
    // 台账中"大黑河"20次，"军事公园"8次
    primary: "大黑河军事公园",
    aliases: [
      "大黑河",
      "军事公园",
      "大黑河军事主题公园",
      "大黑河项目",
    ],
    type: "文旅项目",
    years: ["2023"],
  },
  {
    // 台账中"冰雪节"3次（2023年初），但欢乐冰雪节是独立项目
    primary: "呼和浩特欢乐冰雪节",
    aliases: [
      "欢乐冰雪节",
      "呼和浩特冰雪节",
      "冰雪节",
      "大黑河冰雪节",
      "大黑河军事公园冰雪节",
    ],
    type: "活动",
    years: ["2023", "2024", "2025"],
  },
  {
    // 台账中"中学"25次，"一中"高频
    primary: "呼和浩特市第一中学",
    aliases: ["呼和浩特一中", "一中", "一中新校区", "呼市一中"],
    type: "学校",
    years: ["2024", "2025"],
  },
  {
    primary: "伊利现代智慧健康谷",
    aliases: ["伊利健康谷", "伊利智慧谷", "伊利", "伊利项目"],
    type: "产业园区",
    years: ["2023", "2024", "2025"],
  },
  {
    primary: "呼和浩特市妇幼保健院",
    aliases: ["妇幼保健院", "呼市妇幼", "呼和浩特妇幼"],
    type: "医院",
    years: ["2024", "2025"],
  },
  {
    primary: "内蒙古电力生产调度中心",
    aliases: ["电力调度中心", "内蒙古电力", "电力调度"],
    type: "办公建筑",
    years: ["2024", "2025"],
  },
  {
    primary: "中国移动呼和浩特数据中心",
    aliases: [
      "中国移动数据中心",
      "移动呼和浩特数据中心",
      "移动数据中心",
      "移动项目",
    ],
    type: "数据中心",
    years: ["2024", "2025"],
  },
];

// ============================================================
// 通用搜索扩展词（从台账中提取的高频新闻关键词）
// ============================================================

export const NEWS_KEYWORDS = [
  "封顶",
  "竣工",
  "验收",
  "开工",
  "中标",
  "贯通",
  "交付",
  "启用",
  "投运",
  "通过",
  "进展",
  "冲刺",
  "复工",
  "复工复产",
  "节点",
  "突破",
  "获奖",
  "表彰",
  "签约",
  "开工仪式",
];

// ============================================================
// 模板匹配
// ============================================================

export function matchProjectKeywords(
  userInput: string
): { matched: ProjectKeyword; score: number }[] {
  const results: { matched: ProjectKeyword; score: number }[] = [];
  const input = userInput.trim();

  for (const pk of PROJECT_KEYWORDS) {
    let score = 0;

    // 1. 项目名包含用户输入（反向匹配 — 用户搜简称）
    if (pk.primary.includes(input)) {
      score += 15;
    }

    // 2. 用户输入包含项目名（正向匹配 — 用户搜全称+其他词）
    if (input.includes(pk.primary)) {
      score += 12;
    }

    // 3. 别名反向匹配
    for (const alias of pk.aliases) {
      if (alias.includes(input)) {
        score += 10;
        break;
      }
    }

    // 4. 别名正向匹配
    for (const alias of pk.aliases) {
      if (input.includes(alias)) {
        score += 8;
        break;
      }
    }

    // 5. 2字碎片匹配
    const fragments = extractFragments(input, 2);
    const primaryFrags = extractFragments(pk.primary, 2);
    for (const f of fragments) {
      if (primaryFrags.has(f)) {
        score += 3;
      }
    }

    // 6. 别名碎片匹配
    for (const alias of pk.aliases) {
      const aliasFrags = extractFragments(alias, 2);
      for (const f of fragments) {
        if (aliasFrags.has(f)) {
          score += 2;
          break;
        }
      }
    }

    if (score > 0) {
      results.push({ matched: pk, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function extractFragments(text: string, n: number): Set<string> {
  const fragments = new Set<string>();
  for (let i = 0; i <= text.length - n; i++) {
    fragments.add(text.slice(i, i + n));
  }
  return fragments;
}

// ============================================================
// 生成搜索关键词
// ============================================================

export function generateSearchQueries(userInput: string): string[] {
  const queries: string[] = [];

  const matched = matchProjectKeywords(userInput);

  if (matched.length > 0) {
    const best = matched[0].matched;

    // 1. 主名称（最精准）
    queries.push(best.primary);

    // 2. 按重要性取前5个别名
    const topAliases = best.aliases.slice(0, 5);
    for (const alias of topAliases) {
      queries.push(alias);
    }

    // 3. 主名称 + 新闻关键词
    queries.push(`${best.primary} ${NEWS_KEYWORDS.slice(0, 3).join(" ")}`);

    // 4. 第一个别名 + 新闻关键词
    if (topAliases.length > 0) {
      queries.push(`${topAliases[0]} ${NEWS_KEYWORDS.slice(0, 2).join(" ")}`);
    }
  }

  // 原始输入兜底
  if (!queries.includes(userInput.trim())) {
    queries.push(userInput.trim());
  }

  return queries.slice(0, 8); // 最多8个查询
}
