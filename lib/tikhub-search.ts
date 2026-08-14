// ============================================================
// 微信搜索双引擎
// 主力：TikHub 微信搜一搜 API（稳定，高质量）
// 备用：搜狗微信搜索抓取（免费，自动降级）
// 双路并行，互备互补
// ============================================================

import { generateSearchQueries } from "@/data/project-keywords";
import { searchWechatArticles as searchSogouWechat } from "./wechat-search";

export interface WechatArticle {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
}

/**
 * 通过 TikHub 微信搜一搜 API 搜索公众号文章
 */
async function searchTikHub(
  keyword: string,
  apiKey: string,
  maxResults: number
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
          // 不限时间（接口只支持 all/day/week/half_year，没有"一年"档），
          // 返回结果由 API 层的日期过滤按用户选择的范围把关
          time_range: "all",
          count: Math.min(maxResults, 30),
          offset: 0,
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      console.warn(`[TikHub] API 返回 ${response.status}`);
      return [];
    }

    const json = await response.json();
    const items = json?.data?.results?.data?.[0]?.items || [];
    console.log(`[TikHub] "${keyword}": ${items.length} 条`);

    return items
      .filter((item: Record<string, unknown>) => item.title && item.doc_url)
      .map((item: Record<string, unknown>) => ({
        title: cleanHtml(String(item.title || "")),
        url: String(item.doc_url || ""),
        date: formatTimestamp(Number(item.timestamp || 0)),
        media: (item.source as Record<string, string>)?.title || "微信公众号",
        snippet: cleanHtml(String(item.desc || "")).slice(0, 200),
      }));
  } catch {
    return [];
  }
}

/**
 * 主入口：双引擎搜索微信公众号文章
 * TikHub 主力 + 搜狗微信备用
 */
export async function searchWechatArticles(
  keyword: string,
  maxResults: number = 40
): Promise<WechatArticle[]> {
  const apiKey = process.env.TIKHUB_API_KEY;

  // 智能多路查询
  const queries = generateSearchQueries(keyword);
  const topQueries = queries.slice(0, 3); // 最多3个查询词

  console.log(`[微信搜索] "${keyword}" → 查询词: ${topQueries.join(", ")}`);

  // ============================================================
  // 策略1：TikHub（如果有 API Key）
  // ============================================================
  const tikhubResults: WechatArticle[] = [];

  if (apiKey) {
    const perQuery = Math.ceil(maxResults / topQueries.length);
    const tikHubPromises = topQueries.map((q) =>
      searchTikHub(q, apiKey, perQuery).catch(() => [] as WechatArticle[])
    );
    const tikHubBatches = await Promise.all(tikHubPromises);

    const seen = new Set<string>();
    for (const batch of tikHubBatches) {
      for (const article of batch) {
        const key = article.url.slice(0, 120);
        if (!seen.has(key)) {
          seen.add(key);
          tikhubResults.push(article);
        }
      }
    }
  }

  console.log(`[微信搜索] TikHub 合计: ${tikhubResults.length} 条`);

  // ============================================================
  // 策略2：搜狗微信（备用/补充）
  // TikHub 不足 10 条时启动搜狗，或始终并行补充
  // ============================================================
  let sogouResults: WechatArticle[] = [];

  if (tikhubResults.length < maxResults) {
    const sogouPromises = topQueries.map((q) =>
      searchSogouWechat(q, Math.ceil((maxResults - tikhubResults.length) / topQueries.length))
        .catch(() => [] as WechatArticle[])
    );
    const sogouBatches = await Promise.all(sogouPromises);

    const seen = new Set<string>(tikhubResults.map((r) => r.url.slice(0, 120)));
    for (const batch of sogouBatches) {
      for (const article of batch) {
        const key = article.url.slice(0, 120);
        if (!seen.has(key)) {
          seen.add(key);
          sogouResults.push(article);
        }
      }
    }

    console.log(`[微信搜索] 搜狗补充: ${sogouResults.length} 条`);
  }

  // ============================================================
  // 合并：TikHub 优先，搜狗补充
  // ============================================================
  const allResults = [...tikhubResults, ...sogouResults];

  // 去重（以 TikHub 优先）
  const deduped = deduplicateWechat(allResults);

  console.log(`[微信搜索] 最终: ${deduped.length} 条（TikHub=${tikhubResults.length} + 搜狗=${sogouResults.length}）`);
  return deduped.slice(0, maxResults);
}

// ============================================================
// 工具函数
// ============================================================

function deduplicateWechat(articles: WechatArticle[]): WechatArticle[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const result: WechatArticle[] = [];

  for (const a of articles) {
    const cleanUrl = a.url.slice(0, 120);
    const cleanTitle = a.title.trim();

    if (seenUrls.has(cleanUrl)) continue;
    // 标题完全相同 → 去重
    if (seenTitles.has(cleanTitle)) continue;

    seenUrls.add(cleanUrl);
    seenTitles.add(cleanTitle);
    result.push(a);
  }

  return result;
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

function formatTimestamp(ts: number): string {
  if (!ts || ts < 1000000000) return "";
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}
