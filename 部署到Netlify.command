#!/bin/bash
# ============================================
# 一键部署到 Netlify（国内可直接访问）
#
# 为什么不能直接部署？
#   项目在 exFAT 移动硬盘上，Mac 会自动生成 ._ 垃圾文件，
#   会导致 Netlify 构建失败。所以先复制到内置硬盘再构建。
#
# 2026-08-14 修复（重要）：
#   Netlify API 新规则：正式部署必须带 branch，而 CLI 的
#   --prod 不带 branch 会 403；带 branch 的部署又不会自动
#   发布到生产，需要 restore 提升。本脚本自动完成这两步。
#
# 用法：双击本文件，等待完成即可
# ============================================

cd "$(dirname "$0")"

DEST="/Users/liuxuebin/netlify-deploy/waimei-monitor"
SITE_ID="502816c2-2c12-40fd-84e4-74bbe821d762"
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
npm install --include=dev --silent 2>&1 | tail -2

echo "🔧 检查部署工具补丁..."
PATCH_TARGET="node_modules/netlify-cli/dist/commands/deploy/deploy.js"
if [ ! -f "$PATCH_TARGET" ]; then
  echo "❌ 未找到本地 netlify 部署工具（netlify-cli 依赖缺失），请检查 package.json"
  exit 1
fi
sed -i '' 's/const alias = options.alias || options.branch;/const alias = options.alias || options.branch || "main";/g' "$PATCH_TARGET"
PATCH_COUNT=$(grep -c 'const alias = options.alias || options.branch || "main";' "$PATCH_TARGET")
if [ "$PATCH_COUNT" -lt 1 ]; then
  echo "❌ 部署工具补丁失败（netlify-cli 版本可能有变化），请让 Claude 检查"
  exit 1
fi
echo "   补丁已应用 ✓"

echo "🚀 开始构建并部署..."
npx netlify deploy --build --prod
if [ $? -ne 0 ]; then
  echo "❌ 部署失败，请把上面的错误信息发给 Claude"
  exit 1
fi

echo "🔄 正在把新版本设为线上正式版..."
DEPLOY_ID=$(npx netlify api listSiteDeploys --data "{\"site_id\":\"$SITE_ID\",\"per_page\":1}" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
if [ -n "$DEPLOY_ID" ]; then
  npx netlify api restoreSiteDeploy --data "{\"site_id\":\"$SITE_ID\",\"deploy_id\":\"$DEPLOY_ID\"}" > /dev/null 2>&1
  echo "   已设为线上正式版 ✓"
else
  echo "⚠️ 未取到部署编号，新版可能只在分支地址，请让 Claude 检查"
fi

echo ""
echo "✅ 完成！线上地址：https://waimei-monitor.netlify.app"
echo "（网页可能有几分钟缓存，稍等片刻再刷新）"
