# Live verification of the formula eval timeout (B-009) against prod.
# An infinite-loop formula must produce an 'error' cell (timed out) within a few
# seconds and must NOT hang the request or take the backend down.
$ErrorActionPreference = 'Stop'
$key  = (Get-Content .env.local | Select-String 'DATAFLOW_API_KEY').ToString().Split('"')[1]
$base = 'https://dataflow-pi.vercel.app'
$h    = @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' }
$script:pass = 0; $script:fail = 0
function PASS($m){ Write-Host "  PASS: $m" -ForegroundColor Green; $script:pass++ }
function FAIL($m){ Write-Host "  FAIL: $m" -ForegroundColor Red; $script:fail++ }
function J($o){ $o | ConvertTo-Json -Depth 12 }

$rid = 'rvet_' + (Get-Date -Format 'MMddHHmmss')
$wb = (Invoke-RestMethod -Uri "$base/api/projects" -Method POST -Headers $h -Body (J @{ name="QA-RVET__$rid"; type='workbook' })).id
try {
  $sheet = (Invoke-RestMethod -Uri "$base/api/tables" -Method POST -Headers $h -Body (J @{ projectId=$wb; name='S' }))
  $nameCol = (Invoke-RestMethod -Uri "$base/api/columns" -Method POST -Headers $h -Body (J @{ tableId=$sheet.id; name='Name'; type='text' }))
  $row = (Invoke-RestMethod -Uri "$base/api/rows" -Method POST -Headers $h -Body (J @{ tableId=$sheet.id; rows=@(@{ "$($nameCol.id)"=@{value='x'} }) }))[0]

  Write-Host ""; Write-Host "== Formula eval timeout (B-009): infinite-loop formula must error, not hang ==" -ForegroundColor Yellow
  $t0 = Get-Date
  $run = Invoke-RestMethod -Uri "$base/api/formula/run" -Method POST -Headers $h -TimeoutSec 60 -Body (J @{
    tableId=$sheet.id; outputColumnName='Loop'; formula='((function(){ while (true) {} })())'
  })
  $reqMs = ((Get-Date) - $t0).TotalMilliseconds
  if ($reqMs -lt 30000) { PASS "formula/run returned fast ($([int]$reqMs) ms) - request not blocked by the runaway formula" } else { FAIL "formula/run blocked $([int]$reqMs) ms" }
  $colId = $run.columnId

  # Poll the cell until terminal (error expected) - bounded
  $status = 'pending'; $err = $null
  for ($i=0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    $r = (Invoke-RestMethod -Uri "$base/api/rows?tableId=$($sheet.id)" -Headers $h | Where-Object { $_.id -eq $row.id })
    $cell = $r.data.$colId
    $status = $cell.status; $err = $cell.error
    if ($status -eq 'error' -or $status -eq 'complete') { break }
  }
  if ($status -eq 'error') { PASS "runaway formula cell -> error in ~${i}s (eval timeout fired): '$err'" }
  elseif ($status -eq 'complete') { FAIL "cell completed (loop did not run?) - inconclusive" }
  else { FAIL "cell still '$status' after ~15s - eval may be hanging" }

  # Backend still responsive?
  $ok = $true
  try { Invoke-RestMethod -Uri "$base/api/rows?tableId=$($sheet.id)" -Headers $h -TimeoutSec 20 | Out-Null } catch { $ok = $false }
  if ($ok) { PASS "backend responsive after the runaway formula" } else { FAIL "backend not responding after runaway formula" }
}
finally {
  Invoke-RestMethod -Uri "$base/api/projects/$wb" -Method DELETE -Headers $h | Out-Null
  Write-Host "deleted sandbox workbook $wb"
}
Write-Host ""
$color = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "RESULT: $($script:pass) passed, $($script:fail) failed" -ForegroundColor $color
if ($script:fail -gt 0){ exit 1 }
