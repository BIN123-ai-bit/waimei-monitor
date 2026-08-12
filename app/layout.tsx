import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "外媒发稿统计助手",
  description: "输入名称 + 日期范围，一键搜索全网媒体发稿，自动分类统计",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
        {/* Header */}
        <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              搜
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-none">
                外媒发稿统计助手
              </h1>
              <p className="text-xs text-zinc-500 mt-1">
                搜索 · 分类 · 统计 · 导出
              </p>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1">{children}</main>

        {/* Footer */}
        <footer className="border-t border-zinc-200 dark:border-zinc-800 py-4 text-center text-xs text-zinc-400">
          外媒发稿统计助手 · 数据来源：百度新闻 + 搜狗微信搜索
        </footer>
      </body>
    </html>
  );
}
