# Requires Windows PowerShell 5.1. Keep this file UTF-8 with BOM for Chinese text.
[CmdletBinding()]
param(
    [ValidateRange(1, 600)]
    [int]$StartupTimeoutSeconds = 90,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 3000
$url = 'http://127.0.0.1:3000'

function Assert-PortAvailable {
    # Exact local TCP port, including IPv4 and IPv6; never terminate its owner.
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if (@($listeners | Where-Object { $_.Port -eq $port }).Count -gt 0) {
        throw "端口 $port 已被占用。未关闭任何进程。若本项目已启动，请使用原窗口；否则请确认占用程序并自行关闭后重试。"
    }
}

function Test-OwnedListener([System.Diagnostics.Process]$server) {
    $server.Refresh()
    if ($server.HasExited) { return $false }

    # A preflight check alone cannot prevent another app taking the port.
    # Only accept listeners belonging to this invocation's npm/cmd/Next tree.
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $ownedIds = [System.Collections.Generic.HashSet[uint32]]::new()
    [void]$ownedIds.Add([uint32]$server.Id)
    do {
        $added = $false
        foreach ($process in $processes) {
            if ($ownedIds.Contains([uint32]$process.ParentProcessId) -and
                $process.CreationDate -ge $server.StartTime -and
                $ownedIds.Add([uint32]$process.ProcessId)) {
                $added = $true
            }
        }
    } while ($added)

    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -eq $port })
    if ($listeners.Count -eq 0) { return $false }
    foreach ($listener in $listeners) {
        if (-not $ownedIds.Contains([uint32]$listener.OwningProcess)) { return $false }
    }
    $server.Refresh()
    return -not $server.HasExited
}

function Test-HttpReady {
    $response = $null
    $request = [System.Net.HttpWebRequest]::Create($url)
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 2000
    $request.ReadWriteTimeout = 2000
    try {
        $response = $request.GetResponse()
        return ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300)
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { $_.Exception.Response.Close() }
        return $false
    } finally {
        if ($response) { $response.Close() }
        $request.Abort()
    }
}

try {
    Set-Location -LiteralPath $projectRoot
    Write-Host '========================================'
    Write-Host '  外媒发稿统计助手'
    Write-Host '========================================'

    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw '未检测到 Node.js，请先从 https://nodejs.org/ 安装 Node.js（包含 npm）。'
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw '未检测到 npm.cmd，请重新安装 Node.js（包含 npm），然后重新打开启动窗口。'
    }
    & node.exe --version
    if ($LASTEXITCODE -ne 0) { throw 'Node.js 无法运行，请检查安装。' }
    Assert-PortAvailable

    # Failed installs may leave node_modules behind; check both entry points.
    if (-not (Test-Path -LiteralPath 'node_modules/.bin/next.cmd') -or
        -not (Test-Path -LiteralPath 'node_modules/next/dist/bin/next')) {
        Write-Host '首次启动或依赖不完整，正在安装依赖，请耐心等待...'
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查上方错误和网络后重试。' }
        if (-not (Test-Path -LiteralPath 'node_modules/.bin/next.cmd') -or
            -not (Test-Path -LiteralPath 'node_modules/next/dist/bin/next')) {
            throw '依赖安装未生成 Next.js 启动文件，请检查上方安装日志。'
        }
    }

    # Installation can take minutes. Recheck, and preserve Next's own cache.
    Assert-PortAvailable
    Write-Host "正在启动服务，等待页面就绪（最多 $StartupTimeoutSeconds 秒）..."
    Write-Host '请保留本窗口；关闭此窗口可停止本次启动的服务。'
    $server = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', 'npm.cmd run dev -- --port 3000 --hostname 127.0.0.1' -NoNewWindow -PassThru
    # Retain the handle so ExitCode remains available after the process exits.
    $null = $server.Handle
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    while ($timer.Elapsed.TotalSeconds -lt $StartupTimeoutSeconds) {
        $server.Refresh()
        if ($server.HasExited) {
            throw "服务在就绪前退出（退出码 $($server.ExitCode)），请检查上方日志。"
        }
        if ((Test-OwnedListener $server) -and (Test-HttpReady) -and
            (Test-OwnedListener $server)) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        throw "服务启动超时（$StartupTimeoutSeconds 秒），或页面尚未返回成功状态。请检查上方日志；服务可能仍在运行，请关闭本窗口后再重试。"
    }

    Write-Host "服务已就绪：$url"
    if (-not $NoBrowser) {
        try { Start-Process -FilePath $url }
        catch { Write-Warning "无法自动打开浏览器，请手动访问 $url" }
    }
    $server.WaitForExit()
    if ($server.ExitCode -ne 0) {
        throw "服务已退出（退出码 $($server.ExitCode)），请检查上方日志。"
    }
    exit 0
} catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    # Never guess at PIDs or kill a process, including on inspection failure.
    if ($server -and -not $server.HasExited) {
        Write-Host '本次服务进程仍可能运行，请关闭本窗口后再重试。'
    }
    exit 1
}
