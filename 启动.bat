@echo off
chcp 65001 >nul
title 外媒发稿统计助手

echo ========================================
echo   外媒发稿统计助手
echo   搜索 · 分类 · 统计 · 导出
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js，请先安装 Node.js
    echo    下载地址：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo ✅ Node.js 版本: %%i

:: 清理端口 3000 上的残留进程
echo 🧹 检查端口占用...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING" 2^>nul') do (
    echo    发现残留进程 PID:%%a，正在关闭...
    taskkill /PID %%a /F >nul 2>nul
)
echo.

:: 首次使用：安装依赖
if not exist "node_modules" (
    echo 📦 首次启动，正在安装依赖（约需 1-3 分钟）...
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
    echo ✅ 依赖安装完成
    echo.
)

:: 清理 Turbopack 缓存
if exist ".next" (
    echo 🧹 清理编译缓存...
    rmdir /s /q ".next" >nul 2>nul
)
echo.

echo 🚀 正在启动服务...
echo.
echo   正在编译页面，首次启动约需 20-50 秒，请耐心等待...
echo   之后每次启动只需 5-10 秒
echo.
echo ========================================

:: 启动服务
start "NextJS Server" cmd /c "npm run dev"

:: 等待服务就绪后打开浏览器
echo   等待服务启动...
set /a COUNT=0
:wait_loop
timeout /t 2 /nobreak >nul
set /a COUNT+=2
curl -s -o nul http://localhost:3000 2>nul
if %errorlevel% equ 0 (
    echo.
    echo ✅ 服务已就绪！（耗时约 %COUNT% 秒）
    start http://localhost:3000
    echo ========================================
    echo   浏览器已打开 http://localhost:3000
    echo   关闭 Node.js 窗口即可停止服务
    echo ========================================
    goto :end
)
if %COUNT% geq 90 (
    echo.
    echo ❌ 服务启动超时（90秒），请尝试：
    echo    1. 关闭本窗口，重新双击启动.bat
    echo    2. 检查防火墙设置
    echo.
    pause
    goto :end
)
echo %COUNT%s...
goto :wait_loop

:end
pause
