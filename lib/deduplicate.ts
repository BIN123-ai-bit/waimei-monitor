// 搜索结果去重
// 处理来自 Bing 和搜狗微信的双源数据重复问题

export interface SearchItem {
  title: string;
  url: string;
  date: string;
  [key: string]: unknown;
}

/**
 * 对搜索结果去重
 * 策略：仅按 URL 去重
 * 重要：同一条新闻稿被多家媒体转发时，每家都保留（用户需要看到完整发稿列表）
 */
export function deduplicate<T extends SearchItem>(items: T[]): T[] {
  if (items.length <= 1) return items;

  const seenUrls = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const cleanUrl = normalizeUrl(item.url);

    // URL 完全相同 → 去重
    if (seenUrls.has(cleanUrl)) {
      continue;
    }
    seenUrls.add(cleanUrl);
    result.push(item);
  }

  return result;
}

/**
 * 标准化 URL：去除追踪参数、统一协议
 */
function normalizeUrl(url: string): string {
  try {
    // 先处理没有协议的 URL
    const urlWithProtocol = url.startsWith("http") ? url : `https://${url}`;
    const parsed = new URL(urlWithProtocol);
    // 去掉 www
    const hostname = parsed.hostname.replace(/^www\./, "");
    // 去掉常见的追踪参数
    const stripParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "from",
      "source",
      "refer",
      "spm",
      "scm",
      "share_id",
    ];
    for (const param of stripParams) {
      parsed.searchParams.delete(param);
    }
    return `${hostname}${parsed.pathname}${parsed.search}`;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
  }
}

