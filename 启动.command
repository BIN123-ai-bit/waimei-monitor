#!/bin/bash
# 外媒发稿统计助手 - Mac 一键启动脚本
# 双击本文件即可启动

cd "$(dirname "$0")"

echo "========================================"
echo "  外媒发稿统计助手"
echo "  搜索 · 分类 · 统计 · 导出"
echo "========================================"
echo ""

# 检查 Node.js 是否安装
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到 Node.js，请先安装 Node.js"
    echo "   下载地址：https://nodejs.org/"
    echo ""
    read -p "按回车键退出..."
    exit 1
fi

echo "✅ Node.js 版本: $(node -v)"

# 清理上次可能残留的进程
EXISTING_PID=$(lsof -ti :3000 2>/dev/null)
if [ -n "$EXISTING_PID" ]; then
    echo "🧹 清理上一次残留的服务进程 (PID: $EXISTING_PID)..."
    kill $EXISTING_PID 2>/dev/null
    sleep 2
    echo "✅ 旧进程已清理"
fi
echo ""

# 首次使用：安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 首次启动，正在安装依赖（约需 1-3 分钟）..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 依赖安装失败，请检查网络后重试"
        read -p "按回车键退出..."
        exit 1
    fi
    echo "✅ 依赖安装完成"
    echo ""
fi

# 检查 DeepSeek API Key 配置
if ! grep -q "AI_API_KEY=sk-" .env.local 2>/dev/null; then
    echo "⚠️  提示：DeepSeek API Key 尚未配置"
    echo "   AI 智能分类功能将不可用"
    echo "   编辑 .env.local 填入你的 DeepSeek API Key"
    echo ""
fi

# 清理 Turbopack 缓存
rm -rf .next 2>/dev/null

echo "🚀 正在启动服务..."
echo ""

# 后台启动服务
npm run dev &
DEV_PID=$!

# 等待服务就绪
echo "  正在编译页面，首次启动约需 20-50 秒，请耐心等待..."
echo "  之后每次启动只需 5-10 秒"
echo ""
echo -n "  "
WAIT_COUNT=0
while [ $WAIT_COUNT -lt 90 ]; do
    if ! kill -0 $DEV_PID 2>/dev/null; then
        echo ""
        echo "❌ 服务进程异常退出，请查看上方错误信息"
        read -p "按回车键退出..."
        exit 1
    fi

    if curl -s -o /dev/null http://localhost:3000 2>/dev/null; then
        echo ""
        echo ""
        echo "✅ 服务已就绪！（耗时约 ${WAIT_COUNT} 秒）"
        sleep 1
        open "http://localhost:3000"
        echo ""
        echo "========================================"
        echo "  浏览器已打开 http://localhost:3000"
        echo "  关闭此窗口即可停止服务"
        echo "========================================"
        wait $DEV_PID 2>/dev/null
        exit 0
    fi

    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ $((WAIT_COUNT % 10)) -eq 0 ]; then
        echo -n "[${WAIT_COUNT}s] "
    fi
done

echo ""
echo "❌ 服务启动超时（90秒），请尝试以下方法："
echo "   1. 关闭本窗口，重新双击启动脚本"
echo "   2. 检查是否有防火墙阻止了本地服务"
echo "   3. 尝试在终端手动运行: npm run dev"
echo ""
read -p "按回车键退出..."
kill $DEV_PID 2>/dev/null
exit 1
