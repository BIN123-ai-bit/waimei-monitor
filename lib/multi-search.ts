// ============================================================
// 多源新闻搜索聚合
// 双引擎并行：Google News RSS + 百度新闻
// 多查询策略：主名称 + 别名 + 新闻关键词
// ============================================================

import { searchBaiduNews, type BaiduNewsResult } from "./baidu-search";

export interface NewsResult {
  title: string;
  url: string;
  date: string;
  media: string;
  snippet: string;
}

// ============================================================
// Google News RSS 搜索
// 免费，无需 API Key
// ============================================================

async function searchGoogleNews(
  keyword: string,
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

function parseGoogleNewsRSS(xml: string, maxResults: number): NewsResult[] {
  const results: NewsResult[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  let count = 0;

  while ((itemMatch = itemRe.exec(xml)) !== null && count < maxResults) {
    const item = itemMatch[1];

    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/i);
    if (!titleMatch) continue;
    let title = titleMatch[1]
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();

    if (!title || title.length < 4) continue;

    let media = "";
    const lastDash = title.lastIndexOf(" - ");
    if (lastDash > 0) {
      media = title.slice(lastDash + 3).trim();
      title = title.slice(0, lastDash).trim();
    }

    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i);
    const url = linkMatch ? linkMatch[1].trim() : "";

    if (!media) {
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
      media = sourceMatch ? sourceMatch[1].trim() : "";
    }

    const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    let date = "";
    if (dateMatch) {
      date = parsePubDate(dateMatch[1].trim());
    }

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

    results.push({
      title,
      url,
      date,
      media: media || "未知来源",
      snippet,
    });
    count++;
  }

  return results;
}

function parsePubDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split("T")[0];
    }
  } catch {}
  return dateStr;
}

// ============================================================
// 百度新闻搜索
// 免费，国内媒体覆盖全面
// ============================================================

async function searchBaidu(
  keyword: string,
  maxResults: number
): Promise<NewsResult[]> {
  try {
    const results = await searchBaiduNews(keyword, 90, maxResults);
    return results.map((r: BaiduNewsResult) => ({
      title: r.title,
      url: r.url,
      date: r.date,
      media: r.media,
      snippet: r.snippet,
    }));
  } catch {
    return [];
  }
}

// ============================================================
// 辅助函数
// ============================================================

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

// ============================================================
// 去重合并
// ============================================================

function normalizeForDedup(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const hostname = u.hostname.replace(/^www\./, "");
    // 去掉追踪参数
    const stripParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content",
      "from", "source", "refer", "spm", "scm", "share_id",
    ];
    for (const p of stripParams) {
      u.searchParams.delete(p);
    }
    return `${hostname}${u.pathname}${u.search}`.slice(0, 150);
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").slice(0, 150);
  }
}

function titleSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1;
  // 简单的字符重叠度
  const setA = new Set(la);
  const setB = new Set(lb);
  let overlap = 0;
  for (const c of setA) {
    if (setB.has(c)) overlap++;
  }
  return overlap / Math.max(setA.size, setB.size);
}

/**
 * 合并两个来源的结果，去重
 * 策略：URL 完全相同去重 + 标题高度相似去重（保留来源信息更全的）
 */
function mergeResults(
  googleResults: NewsResult[],
  baiduResults: NewsResult[]
): NewsResult[] {
  const all: NewsResult[] = [];
  const seenUrls = new Set<string>();
  const seenTitles: { title: string; index: number }[] = [];

  for (const batch of [baiduResults, googleResults]) {
    for (const item of batch) {
      const cleanUrl = normalizeForDedup(item.url);

      // URL 去重
      if (seenUrls.has(cleanUrl)) continue;

      // 标题去重（相似度 > 0.85 视为重复）
      const dupTitle = seenTitles.find(
        (t) => titleSimilarity(t.title, item.title) > 0.85
      );
      if (dupTitle) {
        // 保留 snippet 更长的
        const existing = all[dupTitle.index];
        if (item.snippet.length > existing.snippet.length) {
          all[dupTitle.index] = item;
          seenTitles[dupTitle.index] = { title: item.title, index: dupTitle.index };
        }
        continue;
      }

      seenUrls.add(cleanUrl);
      seenTitles.push({ title: item.title, index: all.length });
      all.push(item);
    }
  }

  return all;
}

// ============================================================
// 内容精度过滤
// ============================================================

/**
 * 过滤噪音内容（招聘、招标、纯通知等）
 */
function filterNoise(results: NewsResult[]): NewsResult[] {
  return results.filter((r) => {
    const t = r.title + r.snippet;

    // 招聘/求职
    if (/招聘|求职|招人|诚聘|年薪|五险一金|岗位|社招|校招|实习|管培生/.test(t))
      return false;

    // 招标/中标公告
    if (/招标公告|中标候选人|中标公示|招标文件|采购公告|询价公告|竞争性磋商/.test(t))
      return false;

    // 纯通知
    if (/^(关于|关于做好|关于组织).*(通知|公告)$/.test(r.title))
      return false;

    // 股票/基金
    if (/股票|基金净值|A股|港股|涨停|跌停|收盘|开盘/.test(t))
      return false;

    // 广告
    if (/广告|推广|促销|优惠|打折|免费领取/.test(t))
      return false;

    return true;
  });
}

/**
 * 精度过滤：结果必须与搜索词有一定相关性
 * @param results 搜索结果
 * @param searchTerms 用于匹配的搜索词列表（项目名+别名）
 * @param minTerms 最少匹配几个搜索词（默认1）
 */
function precisionFilter(
  results: NewsResult[],
  searchTerms: string[],
  minTerms: number = 1
): NewsResult[] {
  if (searchTerms.length === 0) return results;

  return results.filter((r) => {
    const text = r.title + r.snippet;
    const matchCount = searchTerms.filter((term) => text.includes(term)).length;
    return matchCount >= minTerms;
  });
}

// ============================================================
// 主入口：双引擎并行搜索
// ============================================================

export interface SearchOptions {
  /** 搜索词列表（主名称+别名） */
  queries: string[];
  /** 用于精度过滤的词（通常和 queries 一样） */
  filterTerms: string[];
  /** 日期范围（向前推多少天） */
  daysBack?: number;
  /** 每个查询最大返回结果数 */
  maxPerQuery?: number;
  /** 最终返回的最大结果数 */
  maxTotal?: number;
}

export async function searchAllNews(options: SearchOptions): Promise<NewsResult[]> {
  const {
    queries,
    filterTerms,
    daysBack = 90,
    maxPerQuery = 15,
    maxTotal = 60,
  } = options;

  if (queries.length === 0) return [];

  // 取前3个最重要的查询（避免请求太多）
  const topQueries = queries.slice(0, 3);

  console.log(`[多源搜索] 查询词: ${topQueries.join(", ")}`);

  // ============================================================
  // 并行搜索：每个查询词 → 同时搜 Google + 百度
  // ============================================================
  const allResults: NewsResult[] = [];

  for (const query of topQueries) {
    // Google 和百度并行
    const [googleResults, baiduResults] = await Promise.all([
      searchGoogleNews(query, maxPerQuery).catch(() => [] as NewsResult[]),
      searchBaidu(query, maxPerQuery).catch(() => [] as NewsResult[]),
    ]);

    // 合并去重
    const merged = mergeResults(googleResults, baiduResults);
    console.log(
      `[多源搜索] "${query}": Google=${googleResults.length}, 百度=${baiduResults.length}, 合并=${merged.length}`
    );

    allResults.push(...merged);
  }

  // ============================================================
  // 全局去重
  // ============================================================
  const globalDeduped = mergeResults(allResults, []);
  console.log(`[多源搜索] 全局去重: ${allResults.length} → ${globalDeduped.length}`);

  // ============================================================
  // 噪音过滤
  // ============================================================
  const cleaned = filterNoise(globalDeduped);
  console.log(`[多源搜索] 噪音过滤: ${globalDeduped.length} → ${cleaned.length}`);

  // ============================================================
  // 精度过滤
  // ============================================================
  const precise = precisionFilter(cleaned, filterTerms, 1);
  console.log(`[多源搜索] 精度过滤: ${cleaned.length} → ${precise.length}`);

  return precise.slice(0, maxTotal);
}

/**
 * 便捷方法：用单个关键词搜索（向后兼容）
 */
export async function searchAllNewsSimple(
  keyword: string,
  daysBack: number = 90,
  maxResults: number = 60
): Promise<NewsResult[]> {
  return searchAllNews({
    queries: [keyword],
    filterTerms: [keyword],
    daysBack,
    maxPerQuery: Math.ceil(maxResults / 2),
    maxTotal: maxResults,
  });
}

export function expandKeywords(keyword: string): string[] {
  const base = keyword.trim();
  if (!base) return [];
  return [base];
}
