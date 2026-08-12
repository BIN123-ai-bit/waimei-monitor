import { NextRequest, NextResponse } from "next/server";
import { searchAllNews, expandKeywords } from "@/lib/multi-search";
import { searchWechatArticles } from "@/lib/wechat-search";
import {
  classifyResults,
  classifyWithAI,
  applyAIClassifications,
  sortByCategory,
  type ClassifiedResult,
} from "@/lib/media-classifier";
import { deduplicate } from "@/lib/deduplicate";

export async function POST(request: NextRequest) {
  try {
    const { keyword, dateFrom, dateTo } = await request.json();

    // ============================================================
    // 1. 参数校验
    // ============================================================
    if (!keyword || typeof keyword !== "string" || !keyword.trim()) {
      return NextResponse.json({ error: "请输入搜索关键词" }, { status: 400 });
    }

    if (!dateFrom || !dateTo) {
      return NextResponse.json(
        { error: "请选择日期范围" },
        { status: 400 }
      );
    }

    const kw = keyword.trim();
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { error: "日期格式不正确" },
        { status: 400 }
      );
    }

    if (from > to) {
      return NextResponse.json(
        { error: "开始日期不能晚于结束日期" },
        { status: 400 }
      );
    }

    // 计算天数差
    const daysBack = Math.max(
      1,
      Math.ceil((Date.now() - from.getTime()) / 86400000)
    );

    // ============================================================
    // 2. 并行搜索（百度新闻 + 搜狗微信）
    // ============================================================
    const keywords = expandKeywords(kw);

    // 多源新闻搜索 + 微信公众号搜索 并行
    const newsPromises = keywords.map((k) =>
      searchAllNews(k, daysBack, 50)
    );
    const [newsResults, wechatResults] = await Promise.all([
      Promise.all(newsPromises).then((arr) => arr.flat()),
      searchWechatArticles(kw, 30),
    ]);

    // ============================================================
    // 3. 结果合并 + 日期过滤
    // ============================================================
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

    // 按日期范围过滤
    const dateFiltered = allResults.filter((r) => {
      if (!r.date) return true;
      return r.date >= dateFrom && r.date <= dateTo;
    });

    // 内容过滤：排除招聘、纯政府公告、无关内容
    const contentFiltered = dateFiltered.filter((r) => {
      const t = r.title + r.snippet;
      // 排除招聘相关
      if (/招聘|求职|招人|诚聘|年薪|五险一金|岗位|社招|校招/i.test(t))
        return false;
      // 排除纯政府公告/通知（不涉及具体项目）
      if (
        /^(关于|关于做好|关于组织|关于征集|关于推荐|关于开展).*(通知|公告)$/.test(
          r.title
        )
      )
        return false;
      // 排除招标/中标（过于技术性的招标信息）
      if (
        /招标公告|中标候选人公示|中标结果公告|竞争性谈判|询价采购/.test(r.title)
      )
        return false;
      return true;
    });

    // ============================================================
    // 4. 去重
    // ============================================================
    const deduplicated = deduplicate(contentFiltered);

    // ============================================================
    // 5. 媒体分类（数据库匹配）
    // ============================================================
    const { classified, unknownMedia } = classifyResults(deduplicated);

    // ============================================================
    // 6. AI 兜底分类（对数据库无法识别的媒体）
    // ============================================================
    let finalResults = classified;
    if (unknownMedia.length > 0) {
      const aiResults = await classifyWithAI(unknownMedia);
      finalResults = applyAIClassifications(classified, aiResults);
    }

    // ============================================================
    // 7. 排序
    // ============================================================
    finalResults.sort(sortByCategory);

    // ============================================================
    // 8. 统计
    // ============================================================
    const byCategory: Record<string, number> = {};
    const byDate: Record<string, number> = {};
    let newsCount = 0;
    let wechatCount = 0;

    for (const r of finalResults) {
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      byDate[r.date] = (byDate[r.date] || 0) + 1;
      if (r.source === "news") newsCount++;
      else wechatCount++;
    }

    // ============================================================
    // 9. 返回结果
    // ============================================================
    return NextResponse.json({
      keyword: kw,
      dateRange: { from: dateFrom, to: dateTo },
      totalCount: finalResults.length,
      results: finalResults,
      stats: {
        byCategory,
        byDate,
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
