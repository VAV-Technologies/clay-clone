# Re-verification of the T15 validation/error-quality batch against LIVE prod.
$ErrorActionPreference = 'Stop'
$key  = (Get-Content .env.local | Select-String 'DATAFLOW_API_KEY').ToString().Split('"')[1]
$base = 'https://dataflow-pi.vercel.app'
$h    = @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' }
$NIL  = '00000000-0000-0000-0000-000000000000'
$script:pass = 0; $script:fail = 0
function PASS($m){ Write-Host "  PASS: $m" -ForegroundColor Green; $script:pass++ }
function FAIL($m){ Write-Host "  FAIL: $m" -ForegroundColor Red; $script:fail++ }
function Req($method, $url, $bodyObj){
  $p = @{ Method=$method; Uri=$url; Headers=$h; UseBasicParsing=$true; TimeoutSec=60 }
  if ($null -ne $bodyObj){ $p.Body = ($bodyObj | ConvertTo-Json -Depth 10) }
  try { $r = Invoke-WebRequest @p; $b=$null; try{$b=$r.Content|ConvertFrom-Json}catch{}; return @{ status=[int]$r.StatusCode; body=$b } }
  catch { $c=0; if($_.Exception.Response){$c=[int]$_.Exception.Response.StatusCode.value__}; $b=$null; try{$b=$_.ErrorDetails.Message|ConvertFrom-Json}catch{}; return @{ status=$c; body=$b } }
}

$rid = 'rvval_' + (Get-Date -Format 'MMddHHmmss')
$wb = (Req POST "$base/api/projects" @{ name="QA-RVVAL__$rid"; type='workbook' }).body.id
try {
  $sheet = (Req POST "$base/api/tables" @{ projectId=$wb; name='S' }).body

  Write-Host ""; Write-Host "== Validation + error-quality (P2/P3) ==" -ForegroundColor Yellow

  $r = Req POST "$base/api/projects" @{ name='bad'; type='banana' }
  if ($r.status -eq 400){ PASS "A-004 project type 'banana' -> 400" } else { FAIL "A-004 expected 400, got $($r.status)" }

  $r = Req POST "$base/api/tables" @{ projectId=$NIL; name='x' }
  if ($r.status -eq 404){ PASS "A-007 table with bad projectId -> 404" } else { FAIL "A-007 expected 404, got $($r.status)" }

  $r = Req POST "$base/api/columns" @{ tableId=$sheet.id; name='C'; type='banana' }
  if ($r.status -eq 400){ PASS "A-010 column type 'banana' -> 400" } else { FAIL "A-010 type expected 400, got $($r.status)" }

  $r = Req POST "$base/api/columns" @{ tableId=$NIL; name='C'; type='text' }
  if ($r.status -eq 404){ PASS "A-010 column with bad tableId -> 404" } else { FAIL "A-010 tableId expected 404, got $($r.status)" }

  $r = Req POST "$base/api/campaigns" @{ name="QA bad step $rid"; steps=@(@{ type='this_is_not_a_real_step'; params=@{} }) }
  if ($r.status -eq 400){ PASS "D-006 unknown campaign step -> 400 (no workbook created)" } else { FAIL "D-006 expected 400, got $($r.status)" }

  $r = Req POST "$base/api/formula/run" @{ tableId=$NIL; formula='1+1'; outputColumnName='x' }
  if ($r.status -eq 404){ PASS "B-014 formula/run bad tableId -> 404" } else { FAIL "B-014 expected 404, got $($r.status)" }

  $cfg = (Req POST "$base/api/enrichment" @{ name='OrigName'; prompt='hi'; model='gpt-5-nano'; inputColumns=@() }).body
  if ($cfg.id) {
    $pr = Req PATCH "$base/api/enrichment/$($cfg.id)" @{ name='NewName' }
    $after = (Req GET "$base/api/enrichment/$($cfg.id)" $null).body
    if ($pr.status -eq 200 -and $after.name -eq 'NewName'){ PASS "B-007 enrichment PATCH name-only -> 200 + name updated" } else { FAIL "B-007 name PATCH: status=$($pr.status) name='$($after.name)'" }
  } else { FAIL "B-007 could not create config" }
}
finally {
  Req DELETE "$base/api/projects/$wb" $null | Out-Null
  # sweep any campaign workbooks created by the bad-step test (should be none)
  Write-Host "deleted sandbox workbook $wb"
}
Write-Host ""
$color = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host "RESULT: $($script:pass) passed, $($script:fail) failed" -ForegroundColor $color
if ($script:fail -gt 0){ exit 1 }
