# check-openrouter.ps1
# Verifies OpenRouter connectivity + deepseek/deepseek-chat visibility.
# Does NOT read or echo your API key. You set the env var yourself; this
# script only checks whether it's present and whether the API accepts it.

$ErrorActionPreference = 'Stop'

# 1. Check the key is set in THIS shell. If you set it via the DSH GUI,
#    it lives in $DSH_HOME/.credentials.yaml, NOT $env:OPENROUTER_API_KEY.
#    In that case, paste the key into $env:OPENROUTER_API_KEY for this
#    session only (don't save the script with the value in it):
#        $env:OPENROUTER_API_KEY = "sk-or-v1-..."
if (-not $env:OPENROUTER_API_KEY) {
  Write-Host "[1/3] OPENROUTER_API_KEY is not set in this PowerShell session." -ForegroundColor Yellow
  Write-Host "      The GUI-managed key is NOT automatically exposed here." -ForegroundColor Yellow
  Write-Host "      Either: (a) export it for this session, or" -ForegroundColor Yellow
  Write-Host "              (b) run the test from inside DSH's shell." -ForegroundColor Yellow
  exit 1
}

# Mask the key for display: show only the last 4 chars.
$masked = $env:OPENROUTER_API_KEY.Substring(0, 8) + '...' + $env:OPENROUTER_API_KEY.Substring($env:OPENROUTER_API_KEY.Length - 4)
Write-Host "[1/3] Key present ($masked), length=$($env:OPENROUTER_API_KEY.Length)" -ForegroundColor Green

# 2. Confirm auth + account. /auth/key returns {data:{label,limit,usage,...}}
#    on success and {error:{...}} with HTTP 401 on bad keys. This is the
#    OpenRouter-supported way to validate an API key (NOT /models).
Write-Host "[2/3] Calling GET /auth/key ..." -ForegroundColor Cyan
try {
  $authResp = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/auth/key' `
                                -Headers @{ Authorization = "Bearer $env:OPENROUTER_API_KEY" } `
                                -Method GET `
                                -TimeoutSec 15
  Write-Host "      [OK] Key valid. Label: $($authResp.data.label)" -ForegroundColor Green
  Write-Host "           Limit: $($authResp.data.limit)  Usage: $($authResp.data.usage)  Free tier: $($authResp.data.is_free_tier)" -ForegroundColor Green
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  $body   = $_.ErrorDetails.Message
  Write-Host "      [FAIL] HTTP $status — $body" -ForegroundColor Red
  exit 2
}

# 3. Confirm deepseek/deepseek-chat is reachable through your key.
#    We write the body to a temp file to avoid any PowerShell quoting
#    issue with -Body / -d.
Write-Host "[3/3] POST /chat/completions with model=deepseek/deepseek-chat ..." -ForegroundColor Cyan
$bodyJson = '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"Reply with the single word: pong"}],"max_tokens":16}'
$tmpBody  = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'or-body.json')
[System.IO.File]::WriteAllText($tmpBody, $bodyJson, [System.Text.UTF8Encoding]::new($false))

try {
  $chatResp = Invoke-RestMethod -Uri 'https://openrouter.ai/api/v1/chat/completions' `
                                -Headers @{ Authorization = "Bearer $env:OPENROUTER_API_KEY" } `
                                -Method POST `
                                -ContentType 'application/json' `
                                -InFile  $tmpBody `
                                -TimeoutSec 30
  $content = $chatResp.choices[0].message.content
  $model   = $chatResp.model
  Write-Host "      [OK] HTTP 200, model=$model, reply=$content" -ForegroundColor Green
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  $body   = $_.ErrorDetails.Message
  Write-Host "      [FAIL] HTTP $status — $body" -ForegroundColor Red
  exit 3
} finally {
  Remove-Item -Path $tmpBody -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "All three checks passed. OpenRouter is wired correctly." -ForegroundColor Green
