# Re-verification of Part-3 batch-1 backend fixes against LIVE prod.
# Creates a throwaway sandbox workbook, asserts each fixed finding now behaves,
# then deletes the workbook. Mostly free; one tiny paid call that should be
# SKIPPED by the cost cap (so ~$0).
$ErrorActionPreference = 'Stop'
$key  = (Get-Content .env.local | Select-String 'DATAFLOW_API_KEY').ToString().Split('"')[1]
$base = 'https://dataflow-pi.vercel.app'
$h    = @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' }
$script:pass = 0; $script:fail = 0
function PASS($m){ Write-Host "  PASS: $m" -ForegroundColor Green; $script:pass++ }
function FAIL($m){ Write-Host "  FAIL: $m" -ForegroundColor Red; $script:fail++ }
function STEP($m){ Write-Host ""; Write-Host "== $m ==" -ForegroundColor Yellow }

# Returns @{ status; body } without throwing on 4xx/5xx.
function Req($method, $url, $bodyObj){
  $p = @{ Method=$method; Uri=$url; Headers=$h; UseBasicParsing=$true; TimeoutSec=90 }
  if ($null -ne $bodyObj){ $p.Body = ($bodyObj | ConvertTo-Json -Depth 12) }
  try {
    $r = Invoke-WebRequest @p
    $b = $null; try { $b = $r.Content | ConvertFrom-Json } catch {}
    return @{ status=[int]$r.StatusCode; body=$b; headers=$r.Headers }
  } catch {
    $code = 0; if ($_.Exception.Response){ $code = [int]$_.Exception.Response.StatusCode.value__ }
    $b = $null; try { $b = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
    return @{ status=$code; body=$b }
  }
}

$rid = 'reverify_' + (Get-Date -Format 'MMddHHmmss')
$wb = Req POST "$base/api/projects" @{ name="QA-REVERIFY__$rid"; type='workbook' }
$wbId = $wb.body.id
Write-Host "sandbox workbook=$wbId"

# Two sheets, each with a Domain + Name column
$s1 = (Req POST "$base/api/tables" @{ projectId=$wbId; name='Sheet1' }).body
$s2 = (Req POST "$base/api/tables" @{ projectId=$wbId; name='Sheet2' }).body
$c1Name = (Req POST "$base/api/columns" @{ tableId=$s1.id; name='Name'; type='text' }).body
$c1Dom  = (Req POST "$base/api/columns" @{ tableId=$s1.id; name='Domain'; type='text' }).body
$c2Dom  = (Req POST "$base/api/columns" @{ tableId=$s2.id; name='Domain'; type='text' }).body

try {
  STEP "WRITE-PATH-NO-SCOPE (A-022/023/C1-006/C-003/C-017)"
  # POST row to Sheet1 with Sheet2's columnId -> 400
  $r = Req POST "$base/api/rows" @{ tableId=$s1.id; rows=@(@{ "$($c2Dom.id)" = @{ value='x' } }) }
  if ($r.status -eq 400){ PASS "POST /rows foreign columnId -> 400" } else { FAIL "POST foreign col expected 400, got $($r.status)" }

  # Seed a legit row in Sheet1
  $seed = Req POST "$base/api/rows" @{ tableId=$s1.id; rows=@(@{ "$($c1Name.id)"=@{value='Alice'}; "$($c1Dom.id)"=@{value='dupe.com'} }) }
  $rowId = $seed.body[0].id
  # PATCH /rows/[id] with foreign col -> 400
  $r = Req PATCH "$base/api/rows/$rowId" @{ data=@{ "$($c2Dom.id)"=@{value='x'} } }
  if ($r.status -eq 400){ PASS "PATCH /rows/[id] foreign columnId -> 400" } else { FAIL "PATCH [id] foreign expected 400, got $($r.status)" }
  # bulk PATCH foreign -> 400
  $r = Req PATCH "$base/api/rows" @{ updates=@(@{ id=$rowId; data=@{ "$($c2Dom.id)"=@{value='x'} } }) }
  if ($r.status -eq 400){ PASS "bulk PATCH foreign columnId -> 400" } else { FAIL "bulk PATCH foreign expected 400, got $($r.status)" }
  # enrichment/run foreign targetColumnId -> 400 (need a config)
  $cfg = Req POST "$base/api/enrichment" @{ name='rv'; prompt='hi {{Name}}'; model='gpt-5-nano'; inputColumns=@($c1Name.id) }
  if ($cfg.body.id){
    $r = Req POST "$base/api/enrichment/run" @{ configId=$cfg.body.id; tableId=$s1.id; targetColumnId='00000000-0000-0000-0000-000000000000'; rowIds=@($rowId); forceRerun=$true }
    if ($r.status -eq 400){ PASS "enrichment/run foreign targetColumnId -> 400 (no charge)" } else { FAIL "enrichment/run foreign target expected 400, got $($r.status)" }
  } else { FAIL "could not create enrichment config to test target-scope" }

  STEP "DELETE scope + count (A-015/016)"
  $r = Req DELETE "$base/api/rows" @{ ids=@($rowId) }   # no tableId
  if ($r.status -eq 400){ PASS "DELETE /rows without tableId -> 400" } else { FAIL "DELETE no tableId expected 400, got $($r.status)" }
  $r = Req DELETE "$base/api/rows" @{ ids=@('does-not-exist-id'); tableId=$s1.id }
  if ($r.status -eq 200 -and $r.body.deletedCount -eq 0){ PASS "DELETE non-existent id -> deletedCount 0 (not fabricated)" } else { FAIL "DELETE nonexistent expected count 0, got $($r.body.deletedCount)" }

  STEP "Pagination clamps + 404 (C2-007/008, C4-016)"
  # seed 3 rows
  1..3 | ForEach-Object { Req POST "$base/api/rows" @{ tableId=$s1.id; rows=@(@{ "$($c1Name.id)"=@{value="n$_"} }) } | Out-Null }
  $r = Req GET "$base/api/rows?tableId=$($s1.id)&limit=-1" $null
  $cnt = @($r.body).Count
  if ($cnt -ge 3){ PASS "limit=-1 does not drop rows (got $cnt)" } else { FAIL "limit=-1 dropped rows (got $cnt)" }
  $r = Req GET "$base/api/rows?tableId=$($s1.id)&offset=-5" $null
  if (@($r.body).Count -ge 3){ PASS "offset=-5 returns from start (got $(@($r.body).Count))" } else { FAIL "offset=-5 returned empty" }
  $r = Req GET "$base/api/rows?tableId=00000000-0000-0000-0000-000000000000" $null
  if ($r.status -eq 404){ PASS "GET unknown tableId -> 404" } else { FAIL "GET unknown table expected 404, got $($r.status)" }

  STEP "LOOKUP dup-key + scope + source-404 (C-002/003/004)"
  # Sheet2 (source): two rows same domain, different Industry
  $c2Ind = (Req POST "$base/api/columns" @{ tableId=$s2.id; name='Industry'; type='text' }).body
  Req POST "$base/api/rows" @{ tableId=$s2.id; rows=@(@{ "$($c2Dom.id)"=@{value='dupe.com'}; "$($c2Ind.id)"=@{value='Alpha'} }) } | Out-Null
  Req POST "$base/api/rows" @{ tableId=$s2.id; rows=@(@{ "$($c2Dom.id)"=@{value='dupe.com'}; "$($c2Ind.id)"=@{value='Beta'} }) } | Out-Null
  # target column on Sheet1
  $lkCol = (Req POST "$base/api/columns" @{ tableId=$s1.id; name='Lookup'; type='enrichment'; actionKind='lookup' }).body
  # foreign inputColumnId (Sheet2 col on Sheet1 run) -> 400
  $r = Req POST "$base/api/lookup/run" @{ tableId=$s1.id; sourceTableId=$s2.id; inputColumnId=$c2Dom.id; matchColumnId=$c2Dom.id; targetColumnId=$lkCol.id }
  if ($r.status -eq 400){ PASS "lookup foreign inputColumnId -> 400" } else { FAIL "lookup foreign input expected 400, got $($r.status)" }
  # unknown sourceTableId -> 404
  $r = Req POST "$base/api/lookup/run" @{ tableId=$s1.id; sourceTableId='00000000-0000-0000-0000-000000000000'; inputColumnId=$c1Dom.id; matchColumnId=$c2Dom.id; targetColumnId=$lkCol.id }
  if ($r.status -eq 404){ PASS "lookup unknown sourceTableId -> 404" } else { FAIL "lookup unknown source expected 404, got $($r.status)" }
  # valid lookup: dupe key -> duplicateKeyCount=1, first match (Alpha)
  $r = Req POST "$base/api/lookup/run" @{ tableId=$s1.id; sourceTableId=$s2.id; inputColumnId=$c1Dom.id; matchColumnId=$c2Dom.id; targetColumnId=$lkCol.id }
  if ($r.body.duplicateKeyCount -ge 1){ PASS "lookup reports duplicateKeyCount=$($r.body.duplicateKeyCount)" } else { FAIL "lookup duplicateKeyCount missing/0" }
  $aliceNow = (Req GET "$base/api/rows?tableId=$($s1.id)" $null).body | Where-Object { $_.data.($c1Dom.id).value -eq 'dupe.com' } | Select-Object -First 1
  $ind = $aliceNow.data.($lkCol.id).enrichmentData.Industry
  if ($ind -eq 'Alpha'){ PASS "dup-key first-match wins (Industry=Alpha)" } else { FAIL "dup-key expected first match Alpha, got '$ind'" }

  STEP "FIND-EMAIL scope (C-017) - 400 before any provider call"
  $r = Req POST "$base/api/find-email/run" @{ tableId=$s1.id; rowIds=@($aliceNow.id); inputMode='full_name'; fullNameColumnId=$c1Name.id; domainColumnId=$c1Dom.id; resultColumnId=$c2Dom.id }
  if ($r.status -eq 400){ PASS "find-email foreign resultColumnId -> 400 (no provider call)" } else { FAIL "find-email foreign result expected 400, got $($r.status)" }

  STEP "CSV import timestamp + type inference (A-026, A-024/#9)"
  $csv = @(
    @{ Person='Bob'; WorkEmail='' },
    @{ Person='Carol'; WorkEmail='carol@acme.com' },
    @{ Person='Dave'; WorkEmail='dave@acme.com' }
  )
  $imp = Req POST "$base/api/import/csv" @{ tableId=$s1.id; data=$csv }
  if ($imp.status -eq 200){ PASS "csv import ok ($($imp.body.rowsImported) rows, $($imp.body.columnsCreated) cols)" } else { FAIL "csv import failed $($imp.status)" }
  $cols = (Req GET "$base/api/columns?tableId=$($s1.id)" $null).body
  $emailCol = $cols | Where-Object { $_.name -eq 'WorkEmail' } | Select-Object -First 1
  if ($emailCol.type -eq 'email'){ PASS "type inference used first NON-EMPTY value (WorkEmail=email)" } else { FAIL "WorkEmail inferred as '$($emailCol.type)' (expected email)" }
  $allRows = (Req GET "$base/api/rows?tableId=$($s1.id)" $null).body
  $years = @($allRows | ForEach-Object { try { ([datetime]$_.createdAt).Year } catch { 9999 } })
  $bad = @($years | Where-Object { $_ -lt 2000 -or $_ -gt 2100 })
  if ($bad.Count -eq 0){ PASS "all createdAt years sane (e.g. $($years[0]))" } else { FAIL "insane createdAt years present: $($bad -join ',') (timestamp bug)" }

  STEP "EXPORT enrichment value (C4-011)"
  $exp = Req GET "$base/api/export/csv?tableId=$($s1.id)" $null
  $csvText = if ($exp.body) { $exp.body } else { (Invoke-WebRequest -Uri "$base/api/export/csv?tableId=$($s1.id)" -Headers $h -UseBasicParsing).Content }
  if ($csvText -match 'Alpha'){ PASS "export surfaces real lookup data (Alpha) not just token" } else { FAIL "export missing real lookup data" }

  STEP "COST-CAP enforced (B-008) - 1 paid attempt, should SKIP"
  $cfg2 = Req POST "$base/api/enrichment" @{ name='rvcap'; prompt='Write 3 sentences about {{Name}}'; model='gpt-5-nano'; inputColumns=@($c1Name.id); costLimitEnabled=$true; maxCostPerRow=0.00001 }
  $capCol = (Req POST "$base/api/columns" @{ tableId=$s1.id; name='Capped'; type='enrichment'; enrichmentConfigId=$cfg2.body.id }).body
  $r = Req POST "$base/api/enrichment/run" @{ configId=$cfg2.body.id; tableId=$s1.id; targetColumnId=$capCol.id; rowIds=@($aliceNow.id); forceRerun=$true }
  $capCell = (Req GET "$base/api/rows?tableId=$($s1.id)" $null).body | Where-Object { $_.id -eq $aliceNow.id } | Select-Object -First 1
  $cv = $capCell.data.($capCol.id)
  if ($cv.status -eq 'error' -and ($cv.error -match 'cap')){ PASS "cost cap skipped the row (no spend): $($cv.error)" } else { FAIL "cost cap not enforced: status=$($cv.status) value=$($cv.value)" }
}
finally {
  STEP "Cleanup"
  Req DELETE "$base/api/projects/$wbId" $null | Out-Null
  Write-Host "deleted sandbox workbook $wbId"
}

Write-Host ""
$color = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "RESULT: $($script:pass) passed, $($script:fail) failed" -ForegroundColor $color
if ($script:fail -gt 0){ exit 1 }
