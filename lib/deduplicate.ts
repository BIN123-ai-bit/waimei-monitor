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
 * 策略：
 * 1. URL 完全相同 → 去重
 * 2. 标题相似度过高 → 去重
 * 3. 来自不同源的相同文章 → 保留内容更完整的
 */
export function deduplicate<T extends SearchItem>(items: T[]): T[] {
  if (items.length <= 1) return items;

  const seenUrls = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    // 清理 URL（去除追踪参数）
    const cleanUrl = normalizeUrl(item.url);

    // 1. URL 去重
    if (seenUrls.has(cleanUrl)) {
      // 检查是否来自更好的源（比如 Bing 比微信有更多元数据）
      const existing = result.find((r) => normalizeUrl(r.url) === cleanUrl);
      if (existing && item.title.length > existing.title.length) {
        // 用新结果替换旧结果
        const index = result.indexOf(existing);
        result[index] = item;
      }
      continue;
    }
    seenUrls.add(cleanUrl);

    // 2. 标题相似度去重
    const isDuplicate = result.some((existing) =>
      isTitleSimilar(item.title, existing.title)
    );
    if (isDuplicate) continue;

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

/**
 * 判断两个标题是否相似
 * 使用简单的编辑距离比例来判断
 */
function isTitleSimilar(title1: string, title2: string): boolean {
  if (!title1 || !title2) return false;

  // 清理标题（去除标点符号、多余空格）
  const clean1 = cleanTitle(title1);
  const clean2 = cleanTitle(title2);

  if (!clean1 || !clean2) return false;

  // 完全相同
  if (clean1 === clean2) return true;

  // 计算相似度
  const similarity = calculateSimilarity(clean1, clean2);

  // 相似度超过 80% 视为重复
  return similarity > 0.8;
}

/**
 * 清理标题文本
 */
function cleanTitle(title: string): string {
  return title
    .replace(/[，,。！!？?、\s　]/g, "")
    .replace(/[「」『』""''""[\]【】()（）{}]/g, "")
    .replace(/&[a-z]+;/gi, "")
    .trim()
    .toLowerCase();
}

/**
 * 计算两个字符串的相似度（0-1）
 * 使用 Levenshtein 距离
 */
function calculateSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  if (maxLen === 0) return 1;

  // 创建距离矩阵
  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  return 1 - distance / maxLen;
}
