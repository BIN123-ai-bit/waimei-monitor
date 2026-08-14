#!/bin/bash
# ============================================
# 一键部署到 Netlify（国内可直接访问）
#
# 为什么不能直接部署？
#   项目在 exFAT 移动硬盘上，Mac 会自动生成 ._ 垃圾文件，
#   会导致 Netlify 构建失败。所以先复制到内置硬盘再构建。
#
# 用法：双击本文件，等待完成即可
# ============================================

cd "$(dirname "$0")"

DEST="/Users/liuxuebin/netlify-deploy/waimei-monitor"
mkdir -p "$DEST"

echo "📦 正在复制项目到内置硬盘..."
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude '.netlify' \
  --exclude '.vercel' \
  --exclude '._*' \
  ./ "$DEST/"

cd "$DEST"

echo "📦 检查依赖..."
npm install --silent 2>&1 | tail -2

echo "🚀 开始构建并部署..."
npx netlify deploy --build --prod

echo ""
echo "✅ 完成！线上地址：https://waimei-monitor.netlify.app"
echo "（网页可能有几分钟缓存，稍等片刻再刷新）"
