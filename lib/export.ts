// Excel 导出功能
// 使用 xlsx 库生成 Excel 文件

import type { ClassifiedResult, MediaCategory } from "./media-classifier";

/**
 * 导出搜索结果为 Excel（在服务器端生成 Buffer）
 * 注：此函数在服务器端运行，使用动态 import 避免客户端报错
 */
export async function generateExcelBuffer(
  keyword: string,
  dateFrom: string,
  dateTo: string,
  results: ClassifiedResult[],
  stats: Record<string, number>
): Promise<Buffer> {
  // 动态导入 xlsx（仅服务器端可用）
  const XLSX = await import("xlsx");

  // 创建工作簿
  const wb = XLSX.utils.book_new();

  // ============================================================
  // Sheet 1: 搜索结果
  // ============================================================
  const rows = results.map((item, index) => ({
    序号: index + 1,
    日期: item.date,
    文章标题: item.title,
    刊发媒体: item.media,
    媒体类别: categoryLabel(item.category),
    媒体链接: item.url,
    摘要: item.snippet,
    数据来源: item.source === "news" ? "多源新闻" : "微信公众号",
  }));

  const ws1 = XLSX.utils.json_to_sheet(rows);

  // 设置列宽
  ws1["!cols"] = [
    { wch: 6 }, // 序号
    { wch: 12 }, // 日期
    { wch: 50 }, // 文章标题
    { wch: 25 }, // 刊发媒体
    { wch: 12 }, // 媒体类别
    { wch: 60 }, // 媒体链接
    { wch: 40 }, // 摘要
    { wch: 10 }, // 数据来源
  ];

  XLSX.utils.book_append_sheet(wb, ws1, "发稿列表");

  // ============================================================
  // Sheet 2: 统计摘要
  // ============================================================
  const statsRows = [
    { 项目: "搜索关键词", 内容: keyword },
    { 项目: "日期范围", 内容: `${dateFrom} 至 ${dateTo}` },
    { 项目: "发稿总数", 内容: String(results.length) },
    { 项目: "", 内容: "" },
    { 项目: "===== 按媒体类别统计 =====", 内容: "" },
  ];

  const categoryOrder: MediaCategory[] = [
    "人民日报/央视",
    "央广",
    "中央级",
    "省部级",
    "地方",
    "行业",
    "微信公众号",
    "未分类",
  ];

  for (const cat of categoryOrder) {
    const count = stats[cat] || 0;
    if (count > 0) {
      statsRows.push({ 项目: categoryLabel(cat), 内容: String(count) });
    }
  }

  statsRows.push(
    { 项目: "", 内容: "" },
    { 项目: "===== 按数据来源统计 =====", 内容: "" },
    {
      项目: "多源新闻",
      内容: String(
        results.filter((r) => r.source === "news").length
      ),
    },
    {
      项目: "微信公众号",
      内容: String(
        results.filter((r) => r.source === "wechat").length
      ),
    }
  );

  const ws2 = XLSX.utils.json_to_sheet(statsRows);
  ws2["!cols"] = [{ wch: 30 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws2, "统计摘要");

  // 生成 Buffer
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buffer);
}

/**
 * 导出搜索结果为 CSV（轻量方案，客户端可用）
 */
export function generateCSV(results: ClassifiedResult[]): string {
  const headers = ["序号", "日期", "文章标题", "刊发媒体", "媒体类别", "媒体链接", "摘要"];

  const rows = results.map((item, index) =>
    [
      index + 1,
      item.date,
      `"${item.title.replace(/"/g, '""')}"`,
      item.media,
      categoryLabel(item.category),
      item.url,
      `"${(item.snippet || "").replace(/"/g, '""')}"`,
    ].join(",")
  );

  // 添加 BOM 以支持 Excel 正确识别中文
  return "﻿" + headers.join(",") + "\n" + rows.join("\n");
}

/**
 * 媒体类别标签
 */
function categoryLabel(category: MediaCategory): string {
  const labels: Record<MediaCategory, string> = {
    "人民日报/央视": "人民日报/央视",
    央广: "央广",
    中央级: "中央级",
    省部级: "省部级",
    地方: "地方",
    行业: "行业",
    个人账号: "个人账号",
    微信公众号: "微信公众号",
    未分类: "未分类",
  };
  return labels[category] || category;
}
