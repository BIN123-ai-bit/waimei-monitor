// 中建八局西北公司内蒙古分公司 — 项目关键词数据库
// 基于 2023-2025 年度宣传台账（1774条记录）提取
// 用于智能搜索扩展，提高微信搜一搜的精准度

export interface ProjectKeyword {
  /** 项目主名称（正式名称） */
  primary: string;
  /** 别名/变体（提高搜索覆盖率） */
  aliases: string[];
  /** 项目类型标签 */
  type: string;
  /** 关联的年份 */
  years: string[];
}

// ============================================================
// 核心项目列表（按重要性排序）
// ============================================================

export const PROJECT_KEYWORDS: ProjectKeyword[] = [
  {
    primary: "呼和浩特盛乐国际机场",
    aliases: [
      "呼和浩特新机场",
      "盛乐国际机场",
      "呼和浩特盛乐机场",
      "呼和浩特机场",
      "新机场航站区",
      "白塔机场",
      "呼和浩特新机场航站楼",
    ],
    type: "机场建设",
    years: ["2023", "2024", "2025", "2026"],
  },
  {
    primary: "中国银保信乌兰察布数据中心",
    aliases: [
      "中银保信乌兰察布数据中心",
      "银保信数据中心",
      "乌兰察布数据中心",
      "银保信乌兰察布",
    ],
    type: "数据中心",
    years: ["2023", "2024"],
  },
  {
    primary: "呼和浩特万象城",
    aliases: ["呼和浩特万象城", "万象城"],
    type: "商业综合体",
    years: ["2025"],
  },
  {
    primary: "内蒙古博物院",
    aliases: [
      "内蒙古博物院新址",
      "博物院",
      "内蒙古博物馆",
    ],
    type: "文化场馆",
    years: ["2024", "2025", "2026"],
  },
  {
    primary: "大黑河军事公园",
    aliases: [
      "大黑河军事公园",
      "大黑河",
      "军事公园",
      "大黑河军事主题公园",
    ],
    type: "文旅项目",
    years: ["2023"],
  },
  {
    primary: "呼和浩特欢乐冰雪节",
    aliases: [
      "欢乐冰雪节",
      "呼和浩特冰雪节",
      "冰雪节",
      "大黑河冰雪节",
    ],
    type: "活动",
    years: ["2023", "2024", "2025"],
  },
  {
    primary: "中国移动呼和浩特数据中心",
    aliases: [
      "中国移动数据中心",
      "移动呼和浩特数据中心",
      "移动数据中心",
    ],
    type: "数据中心",
    years: ["2024", "2025"],
  },
  {
    primary: "呼和浩特市第一中学",
    aliases: ["呼和浩特一中", "一中新校区"],
    type: "学校",
    years: ["2024", "2025"],
  },
  {
    primary: "伊利现代智慧健康谷",
    aliases: ["伊利健康谷", "伊利智慧谷", "伊利"],
    type: "产业园区",
    years: ["2023", "2024", "2025"],
  },
  {
    primary: "蒙牛乳业产业园",
    aliases: ["蒙牛", "蒙牛产业园", "蒙牛乳业"],
    type: "产业园区",
    years: ["2023", "2024", "2025"],
  },
  {
    primary: "呼和浩特市妇幼保健院",
    aliases: ["妇幼保健院", "呼市妇幼"],
    type: "医院",
    years: ["2024", "2025"],
  },
  {
    primary: "内蒙古电力生产调度中心",
    aliases: ["电力调度中心", "内蒙古电力"],
    type: "办公建筑",
    years: ["2024", "2025"],
  },
];

// ============================================================
// 通用搜索扩展词（从台账中提取的高频关键词）
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
// 根据用户输入自动匹配项目关键词
// ============================================================

export function matchProjectKeywords(
  userInput: string
): { matched: ProjectKeyword; score: number }[] {
  const results: { matched: ProjectKeyword; score: number }[] = [];

  for (const pk of PROJECT_KEYWORDS) {
    let score = 0;

    // 主名称匹配
    if (userInput.includes(pk.primary)) {
      score += 10;
    }

    // 别名匹配
    for (const alias of pk.aliases) {
      if (userInput.includes(alias)) {
        score += 8;
        break;
      }
    }

    // 部分匹配
    const words = pk.primary.split("");
    const inputWords = userInput.split("");
    for (const w of words) {
      if (w.length >= 2 && userInput.includes(w)) {
        score += 2;
      }
    }

    if (score > 0) {
      results.push({ matched: pk, score });
    }
  }

  // 按匹配度排序
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * 根据用户输入生成优化的搜索关键词列表
 * 策略：主名称 + 别名组合 + 新闻词
 */
export function generateSearchQueries(userInput: string): string[] {
  const queries: string[] = [userInput.trim()];

  // 匹配已知项目
  const matched = matchProjectKeywords(userInput);

  if (matched.length > 0) {
    const best = matched[0].matched;

    // 用主名称搜索
    if (!userInput.includes(best.primary)) {
      queries.push(best.primary);
    }

    // 主名称 + 新闻关键词（提高精准度）
    for (const nk of NEWS_KEYWORDS.slice(0, 3)) {
      queries.push(`${best.primary} ${nk}`);
    }

    // 别名搜索（覆盖率更高）
    for (const alias of best.aliases.slice(0, 2)) {
      if (!userInput.includes(alias)) {
        queries.push(`${alias} ${NEWS_KEYWORDS.slice(0, 2).join(" ")}`);
      }
    }
  }

  // 去重，最多5个查询
  const unique = [...new Set(queries)];
  return unique.slice(0, 5);
}
