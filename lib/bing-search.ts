// Bing News Search API v7 封装
// 用于搜索传统新闻媒体发稿

export interface BingNewsResult {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
  imageUrl?: string;
}

interface BingNewsResponse {
  value?: Array<{
    name: string;
    url: string;
    datePublished: string;
    description: string;
    provider?: Array<{ name: string }>;
    image?: { thumbnail?: { contentUrl: string } };
  }>;
  totalEstimatedMatches?: number;
}

/**
 * 调用 Bing News Search API
 * @param keyword 搜索关键词
 * @param daysBack 搜索多少天内的新闻（默认30天）
 * @param count 返回数量（默认20，最大100）
 */
export async function searchBingNews(
  keyword: string,
  daysBack: number = 30,
  count: number = 20
): Promise<BingNewsResult[]> {
  const apiKey = process.env.BING_API_KEY;

  if (!apiKey) {
    console.warn("⚠️ Bing API Key 未配置，跳过 Bing 搜索");
    return [];
  }

  // 计算 freshness 参数
  // Bing 支持的 freshness: Day, Week, Month（不支持自定义天数范围）
  let freshness = "Month";
  if (daysBack <= 1) freshness = "Day";
  else if (daysBack <= 7) freshness = "Week";

  const url = new URL("https://api.bing.microsoft.com/v7.0/news/search");
  url.searchParams.set("q", keyword);
  url.searchParams.set("freshness", freshness);
  url.searchParams.set("mkt", "zh-CN");
  url.searchParams.set("setLang", "zh-Hans");
  url.searchParams.set("count", String(Math.min(count, 100)));
  url.searchParams.set("sortBy", "Date");
  url.searchParams.set("textFormat", "Raw");
  url.searchParams.set("safeSearch", "Off");

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
      signal: AbortSignal.timeout(15000), // 15秒超时
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(`Bing API 错误 (${response.status}): ${errorText}`);
      return [];
    }

    const data: BingNewsResponse = await response.json();

    if (!data.value || data.value.length === 0) {
      return [];
    }

    // 转换为统一格式
    const results: BingNewsResult[] = data.value.map((item) => ({
      title: item.name || "无标题",
      url: item.url || "",
      date: formatBingDate(item.datePublished),
      media: item.provider?.[0]?.name || extractMediaFromUrl(item.url),
      snippet: item.description || "",
      imageUrl: item.image?.thumbnail?.contentUrl,
    }));

    return results;
  } catch (error) {
    console.error("Bing 搜索异常:", error);
    return [];
  }
}

/**
 * 格式化 Bing 返回的日期
 * Bing 返回格式：2026-08-12T10:30:00.0000000Z
 * 转为：2026-08-12
 */
function formatBingDate(dateStr: string): string {
  try {
    const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toISOString().split("T")[0];
  } catch {
    return dateStr;
  }
}

/**
 * 从 URL 中提取媒体名称（当 Bing 未返回 provider 时使用）
 */
function extractMediaFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // 去掉 www. 前缀
    return hostname.replace(/^www\./, "");
  } catch {
    return "未知来源";
  }
}

/**
 * 扩展搜索：用多个关键词组合提高覆盖率
 * @param keyword 原始关键词
 * @returns 扩展后的关键词列表
 */
export function expandKeywords(keyword: string): string[] {
  const base = keyword.trim();
  if (!base) return [];

  // 基础关键词：原词 + 引号精确匹配
  const keywords = [`"${base}"`, base];

  // 如果包含公司/单位名，添加简称变体
  if (base.length > 4) {
    // 去掉"有限公司"、"集团"等后缀
    const shortName = base
      .replace(/有限公司|股份有限公司|集团有限公司|集团|有限责任公司/g, "")
      .trim();
    if (shortName !== base && shortName.length >= 2) {
      keywords.push(shortName);
    }
  }

  return keywords;
}
