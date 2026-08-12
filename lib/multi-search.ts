// 新闻搜索聚合
// Google News RSS（主力，免费稳定）+ 搜狗微信（补充）

export interface NewsResult {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
}

/**
 * Google News RSS 搜索
 * 免费，无需 API Key，稳定不封杀
 * RSS URL: https://news.google.com/rss/search?q=KEYWORD&hl=zh-CN&gl=CN&ceid=CN:zh-Hans
 */
async function searchGoogleNews(
  keyword: string,
  _daysBack: number,
  maxResults: number
): Promise<NewsResult[]> {
  try {
    const encoded = encodeURIComponent(keyword);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;

    const xml = await fetchWithRetry(url);
    if (!xml) return [];

    return parseGoogleNewsRSS(xml, maxResults);
  } catch {
    return [];
  }
}

/**
 * 解析 Google News RSS XML
 *
 * 结构：
 * <item>
 *   <title>文章标题 - 媒体名</title>
 *   <link>https://news.google.com/...</link>
 *   <pubDate>Wed, 12 Aug 2026 10:30:00 GMT</pubDate>
 *   <description>摘要内容</description>
 *   <source url="...">媒体名</source>
 * </item>
 */
function parseGoogleNewsRSS(xml: string, maxResults: number): NewsResult[] {
  const results: NewsResult[] = [];

  // 匹配每个 <item> 块
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  let count = 0;

  while ((itemMatch = itemRe.exec(xml)) !== null && count < maxResults) {
    const item = itemMatch[1];

    // 提取标题
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    let title = titleMatch[1]
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();

    // Google News 标题格式："文章标题 - 媒体名"
    // 提取媒体名
    let media = "";
    const lastDash = title.lastIndexOf(" - ");
    if (lastDash > 0) {
      media = title.slice(lastDash + 3).trim();
      title = title.slice(0, lastDash).trim();
    }

    // 提取链接
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
    const url = linkMatch ? linkMatch[1].trim() : "";

    // 如果 media 没从标题提取到，尝试 <source> 标签
    if (!media) {
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      media = sourceMatch ? sourceMatch[1].trim() : "";
    }

    // 提取日期
    const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    let date = "";
    if (dateMatch) {
      date = parsePubDate(dateMatch[1].trim());
    }

    // 提取摘要
    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/i);
    let snippet = "";
    if (descMatch) {
      snippet = descMatch[1]
        .replace(/<!\[CDATA\[|\]\]>/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim()
        .slice(0, 200);
    }

    if (title && title.length >= 4) {
      results.push({
        title,
        url,
        date,
        media: media || "未知来源",
        snippet,
      });
      count++;
    }
  }

  return results;
}

/**
 * 解析 RSS pubDate 格式
 * "Wed, 12 Aug 2026 10:30:00 GMT" → "2026-08-12"
 */
function parsePubDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split("T")[0];
    }
  } catch {}
  return dateStr;
}

/**
 * 聚合搜索
 */
export async function searchAllNews(
  keyword: string,
  daysBack: number = 30,
  maxResults: number = 40
): Promise<NewsResult[]> {
  const results = await searchGoogleNews(keyword, daysBack, maxResults);
  console.log(`[新闻搜索] Google News RSS: ${results.length} 条`);
  return results;
}

export function expandKeywords(keyword: string): string[] {
  const base = keyword.trim();
  if (!base) return [];
  return [base];
}

async function fetchWithRetry(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; NewsAggregator/1.0)",
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          "Accept-Language": "zh-CN,zh;q=0.9",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) continue;

      const text = await response.text();
      if (text.length < 200) continue;
      return text;
    } catch {
      continue;
    }
  }
  return null;
}
