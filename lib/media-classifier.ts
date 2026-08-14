// 媒体分类引擎
// 双重分类机制：数据库匹配 + AI 兜底

import { classifyMedia, batchClassify, type MediaCategory } from "@/data/media-database";

export type { MediaCategory };

export interface ClassifiedResult {
  date: string;
  title: string;
  media: string;
  category: MediaCategory;
  url: string;
  snippet: string;
  source: "news" | "wechat";
}

/**
 * 用数据库对结果进行分类
 * 返回已分类的结果 + 未分类的媒体列表
 */
export function classifyResults(
  results: Array<{
    date: string;
    title: string;
    media: string;
    url: string;
    snippet: string;
    source: "news" | "wechat";
  }>
): {
  classified: ClassifiedResult[];
  unknownMedia: string[];
} {
  const classified: ClassifiedResult[] = [];
  const unknownMedia: string[] = [];

  for (const item of results) {
    const category = classifyMedia(item.media);

    if (category === "未分类") {
      unknownMedia.push(item.media);
    }

    classified.push({
      ...item,
      category,
    });
  }

  return { classified, unknownMedia };
}

/**
 * 使用 DeepSeek AI 对未知媒体进行分类
 * @param unknownMedia 未分类的媒体名称列表
 * @returns 媒体名称 → 分类 的映射
 */
export async function classifyWithAI(
  unknownMedia: string[],
  deekSeekApiKey?: string
): Promise<Map<string, MediaCategory>> {
  const result = new Map<string, MediaCategory>();

  if (!unknownMedia || unknownMedia.length === 0) {
    return result;
  }

  const apiKey = deekSeekApiKey || process.env.AI_API_KEY;
  if (!apiKey) {
    // 没有 AI Key，全部归为"未分类"
    for (const media of unknownMedia) {
      result.set(media, "未分类");
    }
    return result;
  }

  const uniqueMedia = [...new Set(unknownMedia)];

  try {
    const prompt = `你是一位中国媒体分类专家。请根据以下媒体名称，判断每个媒体的类别。

分类标准：
- "人民日报/央视"：人民日报、人民网、央视、CCTV等最高级别官方媒体
- "央广"：中央人民广播电台及其频率（中国之声、经济之声等）
- "中央级"：新华社、光明日报、经济日报、中国青年报、解放军报等国家级媒体
- "省部级"：省级党报、直辖市报纸、部委主管媒体、主流商业网站（新浪、搜狐、网易、腾讯、凤凰等）
- "地方"：地市级及以下报纸、县级融媒体中心
- "行业"：建筑、工程、交通、能源等行业专业媒体
- "微信公众号"：微信公众号

请对以下媒体逐一分类，只返回 JSON 格式：{"媒体名称": "类别", ...}

待分类媒体列表：
${uniqueMedia.map((m, i) => `${i + 1}. ${m}`).join("\n")}

只返回 JSON，不要任何其他文字。`;

    const response = await fetch(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      console.warn("DeepSeek API 分类失败，使用默认分类");
      for (const media of unknownMedia) {
        result.set(media, "未分类");
      }
      return result;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      for (const media of unknownMedia) {
        result.set(media, "未分类");
      }
      return result;
    }

    try {
      const classifications = JSON.parse(jsonMatch[0]);
      for (const [media, category] of Object.entries(classifications)) {
        const validCategories: MediaCategory[] = [
          "人民日报/央视",
          "央广",
          "中央级",
          "省部级",
          "地方",
          "行业",
          "微信公众号",
          "未分类",
        ];
        const cat = category as string;
        if (validCategories.includes(cat as MediaCategory)) {
          result.set(media, cat as MediaCategory);
        } else {
          result.set(media, "未分类");
        }
      }

      // 确保所有未知媒体都有分类
      for (const media of uniqueMedia) {
        if (!result.has(media)) {
          result.set(media, "未分类");
        }
      }
    } catch {
      for (const media of unknownMedia) {
        result.set(media, "未分类");
      }
    }
  } catch (error) {
    console.error("AI 分类异常:", error);
    for (const media of unknownMedia) {
      result.set(media, "未分类");
    }
  }

  return result;
}

/**
 * 应用 AI 分类结果到已分类列表
 */
export function applyAIClassifications(
  classified: ClassifiedResult[],
  aiResults: Map<string, MediaCategory>
): ClassifiedResult[] {
  return classified.map((item) => {
    if (item.category === "未分类" && aiResults.has(item.media)) {
      return { ...item, category: aiResults.get(item.media)! };
    }
    return item;
  });
}

/**
 * 按媒体级别排序（高级别在前）
 */
const CATEGORY_SORT_ORDER: Record<MediaCategory, number> = {
  "人民日报/央视": 0,
  央广: 1,
  中央级: 2,
  省部级: 3,
  地方: 4,
  行业: 5,
  微信公众号: 6,
  未分类: 7,
};

export function sortByCategory(a: ClassifiedResult, b: ClassifiedResult): number {
  const orderA = CATEGORY_SORT_ORDER[a.category] ?? 99;
  const orderB = CATEGORY_SORT_ORDER[b.category] ?? 99;
  if (orderA !== orderB) return orderA - orderB;

  // 同类别：先按报道评分降序（质量高的在前），再按日期倒序
  const scoreA = (a as unknown as { score?: number }).score ?? 0;
  const scoreB = (b as unknown as { score?: number }).score ?? 0;
  if (scoreA !== scoreB) return scoreB - scoreA;

  return b.date.localeCompare(a.date);
}
