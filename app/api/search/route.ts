import { NextRequest, NextResponse } from "next/server";
import { searchAllNews, type SearchOptions } from "@/lib/multi-search";
import { searchWechatArticles } from "@/lib/tikhub-search";
import {
  classifyResults,
  classifyWithAI,
  applyAIClassifications,
  sortByCategory,
  type ClassifiedResult,
} from "@/lib/media-classifier";
import { deduplicate } from "@/lib/deduplicate";
import { matchProjectKeywords, generateSearchQueries } from "@/data/project-keywords";

// ============================================================
// 类型
// ============================================================

interface SearchOneProjectResult {
  results: ClassifiedResult[];
  projectName: string;
}

interface FailedProject {
  keyword: string;
  error: string;
}

// ============================================================
// 搜索单个项目（容错包装）
// ============================================================

async function searchOneProject(
  keyword: string,
  dateFrom: string,
  dateTo: string
): Promise<SearchOneProjectResult> {
  // 1. 匹配项目关键词库获取别名
  const matched = matchProjectKeywords(keyword);
  const projectName = matched.length > 0 ? matched[0].matched.primary : keyword;

  // 2. 生成搜索查询词列表
  let searchQueries: string[];
  let aliases: string[];

  if (matched.length > 0) {
    const best = matched[0].matched;
    aliases = [best.primary, ...best.aliases];
    // 生成多路查询：主名称 + 前2个别名 + 新闻关键词组合
    const generated = generateSearchQueries(keyword);
    searchQueries = generated.length > 0 ? generated : [best.primary];
  } else {
    aliases = [keyword];
    searchQueries = [keyword];
  }

  console.log(`[项目搜索] "${keyword}" → 项目名: ${projectName}`);
  console.log(`[项目搜索] 搜索查询: ${searchQueries.slice(0, 4).join(" | ")}`);
  console.log(`[项目搜索] 过滤别名: ${aliases.slice(0, 5).join(", ")}`);

  // 3. 并发搜索：新闻 + 微信
  const [newsResults, wechatResults] = await Promise.all([
    searchAllNews({
      queries: searchQueries,
      filterTerms: aliases,
      daysBack: 365, // 放宽到一年
      maxPerQuery: 20,
      maxTotal: 80,
    }).catch((err) => {
      console.error(`[新闻搜索失败] ${keyword}:`, err);
      return [];
    }),
    searchWechatArticles(projectName, 50).catch((err) => {
      console.error(`[微信搜索失败] ${keyword}:`, err);
      return [];
    }),
  ]);

  console.log(`[项目搜索] ${projectName}: 新闻=${newsResults.length}, 微信=${wechatResults.length}`);

  // 4. 合并新闻 + 微信
  const allResults = [
    ...newsResults.map((r) => ({
      date: r.date,
      title: r.title,
      media: r.media,
      url: r.url,
      snippet: r.snippet,
      source: "news" as const,
    })),
    ...wechatResults.map((r) => ({
      date: r.date,
      title: r.title,
      media: r.media,
      url: r.url,
      snippet: r.snippet,
      source: "wechat" as const,
    })),
  ];

  // 5. 日期过滤
  const dateFiltered = allResults.filter((r) => {
    if (!r.date) return true; // 无法解析日期的保留
    return r.date >= dateFrom && r.date <= dateTo;
  });

  // 6. 内容噪音过滤
  const contentFiltered = dateFiltered.filter((r) => {
    const t = r.title + r.snippet;

    // 招聘/求职
    if (/招聘|求职|招人|诚聘|年薪|五险一金|岗位|社招|校招|实习|管培生/.test(t))
      return false;

    // 招标/中标
    if (/招标公告|中标候选人|中标公示|招标文件|采购公告|询价公告|竞争性磋商|比选公告/.test(t))
      return false;

    // 纯通知
    if (/^(关于|关于做好|关于组织|关于开展|关于召开).*(通知|公告)$/.test(r.title))
      return false;

    // 股票/基金
    if (/股票|基金净值|A股|港股|涨停|跌停/.test(t))
      return false;

    return true;
  });

  // 7. 精度过滤：结果必须至少匹配一个别名
  const precisionFiltered = contentFiltered.filter((r) => {
    const text = r.title + r.snippet;
    return aliases.some((alias) => text.includes(alias));
  });

  console.log(
    `[项目搜索] ${projectName}: 原始=${allResults.length} → 日期过滤=${dateFiltered.length} → 内容过滤=${contentFiltered.length} → 精度过滤=${precisionFiltered.length}`
  );

  // 8. 去重
  const deduplicated = deduplicate(precisionFiltered);

  // 9. 媒体分类（数据库 + AI 兜底）
  const { classified, unknownMedia } = classifyResults(deduplicated);
  let finalResults = classified;
  if (unknownMedia.length > 0) {
    const aiResults = await classifyWithAI(unknownMedia).catch(() => new Map());
    finalResults = applyAIClassifications(classified, aiResults);
  }

  finalResults.sort(sortByCategory);

  return { results: finalResults, projectName };
}

// ============================================================
// API Route
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dateFrom, dateTo } = body;

    const rawKeywords: string[] = body.keywords
      ? body.keywords
      : body.keyword
        ? [body.keyword]
        : [];

    // ============================================================
    // 1. 参数校验
    // ============================================================
    if (rawKeywords.length === 0) {
      return NextResponse.json({ error: "请输入搜索关键词" }, { status: 400 });
    }

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: "请选择日期范围" }, { status: 400 });
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: "日期格式不正确" }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: "开始日期不能晚于结束日期" }, { status: 400 });
    }

    const keywords = [...new Set(rawKeywords.map((k: string) => k.trim()).filter(Boolean))];

    console.log(`\n========================================`);
    console.log(`[批量搜索] 共 ${keywords.length} 个项目`);
    console.log(`[批量搜索] 日期: ${dateFrom} ~ ${dateTo}`);
    console.log(`[批量搜索] 项目列表: ${keywords.join(", ")}`);
    console.log(`========================================\n`);

    // ============================================================
    // 2. 串行搜索每个项目（每个项目内并发新闻+微信，项目之间串行避免限流）
    // ============================================================
    const allProjectResults: ClassifiedResult[] = [];
    const byProject: Record<string, number> = {};
    const failed: FailedProject[] = [];
    const seenUrls = new Set<string>();

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      console.log(`\n[批量搜索 ${i + 1}/${keywords.length}] ${kw}`);

      try {
        const { results, projectName } = await searchOneProject(kw, dateFrom, dateTo);

        // 去重合并到全局结果
        let added = 0;
        for (const r of results) {
          const key = r.url.slice(0, 120);
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          (r as unknown as Record<string, unknown>).project = projectName;
          allProjectResults.push(r);
          added++;
        }

        byProject[projectName] = results.length;
        console.log(`[批量搜索] ✅ ${projectName}: ${results.length} 条（新增 ${added} 条）`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "搜索失败";
        console.error(`[批量搜索] ❌ ${kw}: ${errorMsg}`);
        failed.push({ keyword: kw, error: errorMsg });
        byProject[kw] = 0;
      }
    }

    // ============================================================
    // 3. 全局排序
    // ============================================================
    allProjectResults.sort(sortByCategory);

    // ============================================================
    // 4. 统计
    // ============================================================
    const byCategory: Record<string, number> = {};
    let newsCount = 0;
    let wechatCount = 0;

    for (const r of allProjectResults) {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      if (r.source === "news") newsCount++;
      else wechatCount++;
    }

    // ============================================================
    // 5. 返回
    // ============================================================
    console.log(`\n[批量搜索] 完成！共 ${allProjectResults.length} 条结果`);
    if (failed.length > 0) {
      console.log(`[批量搜索] ⚠️ ${failed.length} 个项目失败: ${failed.map((f) => f.keyword).join(", ")}`);
    }

    return NextResponse.json({
      keywords,
      dateRange: { from: dateFrom, to: dateTo },
      totalCount: allProjectResults.length,
      results: allProjectResults,
      byProject,
      failed: failed.length > 0 ? failed : undefined,
      stats: {
        byCategory,
        bySource: { news: newsCount, wechat: wechatCount },
      },
    });
  } catch (error) {
    console.error("搜索失败:", error);
    const message =
      error instanceof Error ? error.message : "搜索失败，请稍后重试";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
