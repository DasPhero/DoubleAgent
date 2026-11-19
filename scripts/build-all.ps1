param(
    [switch]$SkipTests,
    [switch]$RequireLinux
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

# Ensure the Wails CLI is available. `go install` drops it into $GOPATH\bin,
# which is often not on PATH, so add it and install the module-pinned version if missing.
$GoBinDir = (go env GOBIN)
if (-not $GoBinDir) { $GoBinDir = Join-Path (go env GOPATH) "bin" }
if ($env:Path -notlike "*$GoBinDir*") { $env:Path = "$GoBinDir;$env:Path" }
if (-not (Get-Command wails -ErrorAction SilentlyContinue)) {
    $WailsVersion = (go list -m -f '{{.Version}}' github.com/wailsapp/wails/v2 2>$null)
    if (-not $WailsVersion) { $WailsVersion = "v2.17.1" }
    Write-Host "==> Wails CLI not found; installing $WailsVersion into $GoBinDir..." -ForegroundColor Cyan
    go install "github.com/wailsapp/wails/v2/cmd/wails@$WailsVersion"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "==> Building Frontend (creates frontend/dist for the Go embed)..." -ForegroundColor Cyan
if (-not (Test-Path frontend/node_modules)) {
    npm --prefix frontend ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Checking Go (Windows native + Linux cross-vet/build)..." -ForegroundColor Cyan
go vet ./...
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:GOOS = "linux"
$env:GOARCH = "amd64"
go vet ./backend/...
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go build ./backend/...
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Remove-Item Env:GOOS -ErrorAction SilentlyContinue
Remove-Item Env:GOARCH -ErrorAction SilentlyContinue

if (-not $SkipTests) {
    Write-Host "==> Running Go & Frontend tests..." -ForegroundColor Cyan
    go test -count=1 ./...
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    & ./frontend/node_modules/.bin/tsc -p frontend/tsconfig.json --noEmit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm --prefix frontend run lint
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm --prefix frontend run test -- --run
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "==> Building Windows amd64 standalone binary..." -ForegroundColor Cyan
wails build -platform windows/amd64 -o DoubleAgent.exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Build Linux amd64 binary via Docker or WSL (Wails v2 Linux GUI requires CGo + GTK3 + WebKit2GTK)
$linuxBuilt = $false

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host "==> Docker detected: building Linux amd64 binary via Dockerfile.linux-build..." -ForegroundColor Cyan
    docker build -f Dockerfile.linux-build -t doubleagent-linux-builder .
    if ($LASTEXITCODE -eq 0) {
        docker run --rm -v "${RootDir}:/src" -w /src doubleagent-linux-builder
        if ($LASTEXITCODE -eq 0) {
            $linuxBuilt = $true
        }
    }
}

if (-not $linuxBuilt -and (Get-Command wsl -ErrorAction SilentlyContinue)) {
    $prevErrPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $wslCheck = (& wsl -l -q 2>$null)
    $wslCode = $LASTEXITCODE
    $ErrorActionPreference = $prevErrPref
    if ($wslCode -eq 0 -and ($wslCheck | Where-Object { $_ -and $_.Trim() -ne "" })) {
        Write-Host "==> WSL detected: building Linux amd64 binary via WSL..." -ForegroundColor Cyan
        $wslPath = (wsl wslpath -a ($RootDir -replace '\\', '/')).Trim()
        wsl bash -lc "cd '$wslPath' && if pkg-config --exists webkit2gtk-4.1; then wails build -tags webkit2_41 -platform linux/amd64 -o DoubleAgent-linux-amd64 -s; else wails build -platform linux/amd64 -o DoubleAgent-linux-amd64 -s; fi"
        if ($LASTEXITCODE -eq 0) {
            $linuxBuilt = $true
        }
    }
}

if (-not $linuxBuilt) {
    $msg = "Linux GUI binary (build/bin/DoubleAgent-linux-amd64) was skipped because neither Docker nor an installed WSL distro is available on this Windows host. Wails v2 on Linux links against GTK3 + WebKit2GTK via CGo. Install Docker Desktop or WSL2 (Ubuntu/Kali), or let GitHub Actions CI build both platforms."
    if ($RequireLinux) {
        Write-Error $msg
        exit 1
    } else {
        Write-Warning $msg
    }
} else {
    Write-Host "==> Linux binary built: build/bin/DoubleAgent-linux-amd64" -ForegroundColor Green
}

Write-Host "==> Windows binary built: build/bin/DoubleAgent.exe" -ForegroundColor Green
