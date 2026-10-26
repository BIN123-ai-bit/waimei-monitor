@echo off
setlocal
chcp 65001 >nul
title 外媒发稿统计助手

pushd "%~dp0"
if errorlevel 1 (
    echo 无法进入项目目录，请将项目解压到本地文件夹后重试。
    pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
set "LAUNCH_EXIT_CODE=%errorlevel%"
echo.
pause
popd
exit /b %LAUNCH_EXIT_CODE%
