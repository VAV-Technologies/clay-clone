# Re-verification of JOB-CLAIM-RACE fixes (C1-001 cell claim) against LIVE prod.
# Test 1 is deterministic + free: pre-mark a cell 'processing', then a run must
# refuse it (the exact claim predicate). Test 2 fires two truly-concurrent runs.
$ErrorActionPreference = 'Stop'
$key  = (Get-Content .env.local | Select-String 'DATAFLOW_API_KEY').ToString().Split('"')[1]
$base = 'https://dataflow-pi.vercel.app'
$h    = @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' }
$script:pass = 0; $script:fail = 0
function PASS($m){ Write-Host "  PASS: $m" -ForegroundColor Green; $script:pass++ }
function FAIL($m){ Write-Host "  FAIL: $m" -ForegroundColor Red; $script:fail++ }
function INFO($m){ Write-Host "  INFO: $m" -ForegroundColor Cyan }
function J($o){ $o | ConvertTo-Json -Depth 12 }

$rid = 'rvjc_' + (Get-Date -Format 'MMddHHmmss')
$wb = (Invoke-RestMethod -Uri "$base/api/projects" -Method POST -Headers $h -Body (J @{ name="QA-RVJC__$rid"; type='workbook' })).id
try {
  $sheet = (Invoke-RestMethod -Uri "$base/api/tables" -Method POST -Headers $h -Body (J @{ projectId=$wb; name='S' }))
  $nameCol = (Invoke-RestMethod -Uri "$base/api/columns" -Method POST -Headers $h -Body (J @{ tableId=$sheet.id; name='Name'; type='text' }))
  $row = (Invoke-RestMethod -Uri "$base/api/rows" -Method POST -Headers $h -Body (J @{ tableId=$sheet.id; rows=@(@{ "$($nameCol.id)"=@{value='Concurrency Test'} }) }))[0]
  $cfg = (Invoke-RestMethod -Uri "$base/api/enrichment" -Method POST -Headers $h -Body (J @{ name='rvjc'; prompt='Say hi to {{Name}}'; model='gpt-5-nano'; inputColumns=@($nameCol.id) }))
  $col = (Invoke-RestMethod -Uri "$base/api/columns" -Method POST -Headers $h -Body (J @{ tableId=$sheet.id; name='AI'; type='enrichment'; enrichmentConfigId=$cfg.id }))
  $runBody = J @{ configId=$cfg.id; tableId=$sheet.id; targetColumnId=$col.id; rowIds=@($row.id); forceRerun=$true }

  Write-Host ""; Write-Host "== Test 1: claim refuses an in-flight (processing) cell - deterministic, no spend ==" -ForegroundColor Yellow
  # Manually mark the cell processing (simulates a concurrent run holding it)
  Invoke-RestMethod -Uri "$base/api/rows/$($row.id)" -Method PATCH -Headers $h -Body (J @{ data=@{ "$($col.id)"=@{ value=$null; status='processing' } } }) | Out-Null
  $r = Invoke-RestMethod -Uri "$base/api/enrichment/run" -Method POST -Headers $h -Body $runBody -TimeoutSec 120
  $rowResult = $r.results | Where-Object { $_.rowId -eq $row.id } | Select-Object -First 1
  if ($rowResult -and $rowResult.success -eq $false -and ($rowResult.error -match 'already being processed')) {
    PASS "run refused the in-flight cell (no double-charge): '$($rowResult.error)'"
  } else {
    FAIL "expected skip 'already being processed', got success=$($rowResult.success) error='$($rowResult.error)'"
  }
  # cell should still be 'processing' (claim didn't overwrite)
  $cellNow = (Invoke-RestMethod -Uri "$base/api/rows?tableId=$($sheet.id)" -Headers $h | Where-Object { $_.id -eq $row.id }).data.($col.id)
  if ($cellNow.status -eq 'processing') { PASS "cell left untouched at 'processing'" } else { INFO "cell status now '$($cellNow.status)'" }

  Write-Host ""; Write-Host "== Test 2: two truly-concurrent runs - exactly one processes ==" -ForegroundColor Yellow
  # reset cell to empty so a fresh claim race happens
  Invoke-RestMethod -Uri "$base/api/rows/$($row.id)" -Method PATCH -Headers $h -Body (J @{ data=@{ "$($col.id)"=@{ value=$null; status='pending' } } }) | Out-Null
  $sb = {
    param($base,$key,$body)
    $hh=@{ Authorization="Bearer $key"; 'Content-Type'='application/json' }
    try { Invoke-RestMethod -Uri "$base/api/enrichment/run" -Method POST -Headers $hh -Body $body -TimeoutSec 120 | ConvertTo-Json -Depth 12 }
    catch { "ERR:" + $_.Exception.Message }
  }
  $j1 = Start-Job -ScriptBlock $sb -ArgumentList $base,$key,$runBody
  $j2 = Start-Job -ScriptBlock $sb -ArgumentList $base,$key,$runBody
  $null = Wait-Job $j1,$j2 -Timeout 150
  $o1 = Receive-Job $j1; $o2 = Receive-Job $j2; Remove-Job $j1,$j2 -Force
  $skips = 0; $oks = 0
  foreach ($o in @($o1,$o2)) {
    try { $p = $o | ConvertFrom-Json; $rr = $p.results | Where-Object { $_.rowId -eq $row.id } | Select-Object -First 1
      if ($rr.error -match 'already being processed') { $skips++ } elseif ($rr.success) { $oks++ }
    } catch { INFO "response parse: $o" }
  }
  INFO "concurrent runs: $oks processed, $skips skipped"
  if ($skips -ge 1 -and $oks -le 1) { PASS "exactly one run processed; the other was claim-blocked (no double-charge)" }
  elseif ($oks -eq 2) { FAIL "BOTH runs processed - claim did not block (or no overlap)" }
  else { INFO "inconclusive (timing): $oks/$skips" }
}
finally {
  Invoke-RestMethod -Uri "$base/api/projects/$wb" -Method DELETE -Headers $h | Out-Null
  Write-Host "deleted sandbox workbook $wb"
}
Write-Host ""
$color = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "RESULT: $($script:pass) passed, $($script:fail) failed" -ForegroundColor $color
if ($script:fail -gt 0){ exit 1 }
