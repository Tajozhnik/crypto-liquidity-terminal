# Rate-limit smoke test. Sends RATE_LIMIT_MAX+1 requests to /health and prints the first 429.
$last = ""
$retryAfter = ""
$body = ""
for ($i = 1; $i -le 130; $i++) {
  $code = curl.exe -s -o $null -w "%{http_code}" http://localhost:4000/health
  if ($code -eq "429") {
    $last = $code
    Write-Output "First 429 on request #$i"
    $body = curl.exe -s -i http://localhost:4000/health
    break
  }
}
if (-not $last) {
  Write-Output "No 429 received in 130 requests; check RATE_LIMIT_MAX env"
} else {
  Write-Output "---- Response ----"
  Write-Output $body
}
