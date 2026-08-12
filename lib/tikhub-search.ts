// TikHub 微信搜一搜 API 封装
// 通过第三方 API 稳定搜索微信公众号文章

export interface WechatArticle {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
}

/**
 * 通过 TikHub 微信搜一搜 API 搜索公众号文章
 * 双路搜索策略：原始关键词 + 项目相关关键词（自动过滤招聘信息）
 */
export async function searchWechatArticles(
  keyword: string,
  maxResults: number = 30
): Promise<WechatArticle[]> {
  const apiKey = process.env.TIKHUB_API_KEY;
  if (!apiKey) {
    console.warn("[TikHub微信] API Key 未配置");
    return [];
  }

  // 双路搜索
  const queries: string[] = [keyword];
  if (
    /机场|项目|工程|大厦|中心|医院|学校|公路|铁路|桥梁|隧道|场馆|口岸/.test(
      keyword
    )
  ) {
    queries.push(`${keyword} 进展 竣工 验收`);
  }

  const allArticles: WechatArticle[] = [];
  const seenUrls = new Set<string>();

  // 并行搜索两条路（避免第一条全是招聘就停掉）
  const resultsPerQuery = await Promise.all(
    queries.map((q) =>
      fetchTikHubPage(q, apiKey).catch(() => [])
    )
  );

  // 先合并第二条（项目词）的结果，再补第一条的
  const combined = [...(resultsPerQuery[1] || []), ...(resultsPerQuery[0] || [])];

  for (const a of combined) {
    if (allArticles.length >= maxResults) break;
    if (seenUrls.has(a.url)) continue;
    seenUrls.add(a.url);
    allArticles.push(a);
  }

  console.log(`[TikHub微信] 共返回 ${allArticles.length} 条（去重后）`);
  return allArticles;
}

async function fetchTikHubPage(
  keyword: string,
  apiKey: string
): Promise<WechatArticle[]> {
  try {
    const response = await fetch(
      "https://api.tikhub.io/api/v1/wechat_search/v2/fetch_search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          keyword,
          business_type: "article",
          sort: "latest",
          time_range: "half_year",
          count: 30,
          offset: 0,
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      console.warn(`[TikHub微信] API 返回 ${response.status}`);
      return [];
    }

    const json = await response.json();
    const items = json?.data?.results?.data?.[0]?.items || [];
    console.log(`[TikHub微信] 原始结果: ${items.length} 条`);

    return items
      .filter((item: Record<string, unknown>) => item.title && item.doc_url)
      .map((item: Record<string, unknown>) => ({
        title: cleanHtml(String(item.title || "")),
        url: String(item.doc_url || ""),
        date: formatTikHubDate(Number(item.timestamp || 0)),
        media: (item.source as Record<string, string>)?.title || "微信公众号",
        snippet: cleanHtml(String(item.desc || "")).slice(0, 200),
      }));
  } catch {
    return [];
  }
}

function cleanHtml(text: string): string {
  return text
    .replace(/<em[^>]*>/g, "")
    .replace(/<\/em>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&hellip;/g, "…")
    .trim();
}

function formatTikHubDate(ts: number): string {
  if (!ts || ts < 1000000000) return "";
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}
