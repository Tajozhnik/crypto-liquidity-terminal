# Build a zip archive of the project, excluding build artifacts.
$ErrorActionPreference = "Stop"

$Source = (Get-Location).Path
$Stage = Join-Path $env:TEMP "crypto-market-screener-stage"
$ZipPath = Join-Path $Source "crypto-market-screener.zip"

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
New-Item -ItemType Directory -Path $Stage | Out-Null

# Patterns to exclude (any folder/file whose path matches will be skipped).
$Excludes = @(
  "\\node_modules\\",
  "\\\.next\\",
  "\\dist\\",
  "\\coverage\\",
  "\\\.git\\",
  "\\\.turbo\\",
  "\\\.pnpm-store\\",
  "\\build-log\\.txt$",
  "\\\.tsbuildinfo$",
  "\\\.log$"
)

function ShouldExclude($path) {
  foreach ($p in $Excludes) {
    if ($path -match $p) { return $true }
  }
  return $false
}

$files = Get-ChildItem -Path $Source -Recurse -Force -File | Where-Object { -not (ShouldExclude $_.FullName) }
Write-Output "Staging $($files.Count) files..."

foreach ($f in $files) {
  $rel = $f.FullName.Substring($Source.Length).TrimStart('\','/')
  $dest = Join-Path $Stage $rel
  $destDir = Split-Path $dest -Parent
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
  Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
}

Write-Output "Compressing..."
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -CompressionLevel Optimal -Force

Remove-Item -Recurse -Force $Stage

$size = (Get-Item $ZipPath).Length
Write-Output "Archive created: $ZipPath"
Write-Output ("Size: {0:N2} MB" -f ($size / 1MB))
