<#
.SYNOPSIS
    一键把 WordNov-iOS 工程推到 GitHub，然后触发 Actions 云编译 IPA。

.EXAMPLE
    # 方式 A：已登录 gh CLI（推荐，自动建仓库并推送）
    .\一键上传GitHub.ps1 -Repo "yourname/wordnov-ios" -Create

.EXAMPLE
    # 方式 B：用 Personal Access Token（需 repo 权限）
    $env:GH_TOKEN = "ghp_xxx"
    .\一键上传GitHub.ps1 -Repo "yourname/wordnov-ios" -Create

.EXAMPLE
    # 方式 C：仓库已在网页上建好，只推送
    .\一键上传GitHub.ps1 -Repo "yourname/wordnov-ios"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [string]$Token = $env:GH_TOKEN,
    [switch]$Create,
    [switch]$Public,
    [string]$Branch = "main",
    [string]$Message = "WordNov iOS: Capacitor wrapper + ad-neutralizer + GitHub Actions IPA build"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Warn($msg) { Write-Host "!!  $msg" -ForegroundColor Yellow }
function Ok  ($msg) { Write-Host "OK  $msg" -ForegroundColor Green }

# ---------------------------------------------------------------- 预检
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "未找到 git，请先安装 Git for Windows" }
Step "工作目录：$root"

if (-not (Test-Path (Join-Path $root "www\index.html"))) { throw "缺少 www/index.html，工程不完整" }
if (-not (Test-Path (Join-Path $root ".github\workflows\build-ipa.yml"))) { throw "缺少 GitHub Actions 工作流" }
if (-not (Test-Path (Join-Path $root "www\noadblock.js"))) { throw "缺少去广告补丁 www/noadblock.js" }

$sizeMB = [math]::Round(((Get-ChildItem $root -Recurse -File -Exclude ".git" | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "    工程体积：$sizeMB MB / $((Get-ChildItem $root -Recurse -File | Measure-Object).Count) 个文件"

# ---------------------------------------------------------------- Git 初始化
if (-not (Test-Path (Join-Path $root ".git"))) {
    Step "git init（分支 $Branch）"
    git init -b $Branch | Out-Null
} else {
    Step "已存在 .git，复用当前仓库"
}

$userName = git config user.name
if (-not $userName) { git config user.name "WordNov Builder"; Warn "未设置 git user.name，已临时设为 WordNov Builder" }
$userEmail = git config user.email
if (-not $userEmail) { git config user.email "builder@example.com"; Warn "未设置 git user.email，已临时设值（可在 .gitconfig 中修改）" }

# ---------------------------------------------------------------- 提交
Step "暂存全部文件（约 $sizeMB MB，首次可能耗时几十秒）"
git add -A
$staged = (git diff --cached --name-only | Measure-Object).Count
Write-Host "    暂存文件数：$staged"

if ($staged -gt 0) {
    Step "提交"
    git commit -m $Message | Out-Null
    Ok "提交完成"
} else {
    Warn "没有新变更，跳过提交"
}

# ---------------------------------------------------------------- 远程
$origin = ""
try { $origin = (git remote get-url origin) } catch { $origin = "" }

$hasGh = Get-Command gh -ErrorAction SilentlyContinue
$ghAuthed = $false
if ($hasGh) {
    try { gh auth status 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $ghAuthed = $true } } catch { $ghAuthed = $false }
}

if ($Create) {
    if ($hasGh -and $ghAuthed) {
        Step "用 gh CLI 创建仓库 $Repo"
        $vis = "@('--private','--public')[[int]$Public]"
        gh repo create $Repo --source . --remote origin --push --description "WordNov iOS IPA via GitHub Actions" $vis
        Ok "仓库已创建并推送"
    } elseif ($Token) {
        Step "用 token 创建仓库 $Repo"
        $visFlag = if ($Public) { "false" } else { "true" }
        $body = @{ name = ($Repo.Split('/')[-1]); private = [bool](-not $Public); description = "WordNov iOS IPA via GitHub Actions" } | ConvertTo-Json
        $headers = @{ Authorization = "token $Token"; "User-Agent" = "WordNov-Builder"; Accept = "application/vnd.github+json" }
        $null = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $headers -Body $body -ContentType "application/json"
        git remote remove origin 2>$null
        git remote add origin "https://x-access-token:$Token@github.com/$Repo.git"
        git push -u origin $Branch
        Ok "仓库已创建并推送"
    } else {
        Warn "既没有可用的 gh 登录，也没有 GH_TOKEN；请在网页上新建空仓库后重跑本脚本（去掉 -Create）"
    }
} else {
    if (-not $origin) {
        if (-not $Token) {
            throw "仓库还没配置 origin。请先在 GitHub 网页新建空仓库，然后运行：`n  .\一键上传GitHub.ps1 -Repo `"$Repo`" -Token `"<你的PAT>`""
        }
        git remote add origin "https://x-access-token:$Token@github.com/$Repo.git"
    } elseif ($Token) {
        git remote set-url origin "https://x-access-token:$Token@github.com/$Repo.git"
    }
    Step "推送到 $Repo ($Branch)"
    git push -u origin $Branch
    Ok "推送完成"
}

# ---------------------------------------------------------------- 收尾
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  1) 打开 https://github.com/$Repo/actions"
Write-Host "  2) 选择 “Build iOS IPA” → Run workflow（可改 bundle id / 显示名 / 版本）"
Write-Host "  3) 约 8–15 分钟后在本次运行页面底部下载 Artifact：WordNov-IPA-*"
Write-Host "  4) 解压得到 WordNov-2.1.0-unsigned.ipa，用 TrollStore / Sideloadly / ESign 安装"
Write-Host ""
Write-Host "如需直接产出已签名 IPA，在仓库 Settings → Secrets and variables → Actions 添加：" -ForegroundColor Cyan
Write-Host "  BUILD_CERTIFICATE_BASE64 / P12_PASSWORD / PROVISIONING_PROFILE_BASE64 / APPLE_TEAM_ID"
Write-Host ""