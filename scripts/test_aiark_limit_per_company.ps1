$ErrorActionPreference = 'Stop'
$key = (Get-Content .env.local | Select-String 'DATAFLOW_API_KEY').ToString().Split('"')[1]
$base = 'https://dataflow-pi.vercel.app'
$h = @{ Authorization = "Bearer $key"; 'Content-Type' = 'application/json' }

function PASS($m) { Write-Host "  PASS: $m" -ForegroundColor Green }
function FAIL($m) { Write-Host "  FAIL: $m" -ForegroundColor Red; $script:fails++ }
function INFO($m) { Write-Host "  INFO: $m" -ForegroundColor Cyan }
function STEP($m) { Write-Host ""; Write-Host "=== $m ===" -ForegroundColor Yellow }
$script:fails = 0

STEP "AI Ark people search WITHOUT limitPerCompany"
$bodyA = @{
  searchType = 'people'
  limit = 30
  filters = @{
    titleKeywords = @('Software Engineer')
    titleMode = 'SMART'
    employeeSize = @(@{ start = 50; end = 5000 })
    limit = 30
  }
} | ConvertTo-Json -Depth 10
$resA = Invoke-RestMethod -Uri "$base/api/add-aiarc-data/search" -Method POST -Headers $h -Body $bodyA -TimeoutSec 240
$peopleA = $resA.people
INFO "got $($peopleA.Count) people, totalCount=$($resA.totalCount)"
$domainsA = $peopleA | ForEach-Object {
  $d = $_.company_domain
  if ($null -eq $d) { '' } else { $d.ToString().ToLower() }
} | Where-Object { $_ }
$uniqA = $domainsA | Sort-Object -Unique
$dupesA = $domainsA.Count - $uniqA.Count
INFO "$($uniqA.Count) unique domains across $($peopleA.Count) people ($dupesA repeated)"

STEP "AI Ark people search WITH limitPerCompany=1"
$bodyB = @{
  searchType = 'people'
  limit = 30
  filters = @{
    titleKeywords = @('Software Engineer')
    titleMode = 'SMART'
    employeeSize = @(@{ start = 50; end = 5000 })
    limit = 30
    limitPerCompany = 1
  }
} | ConvertTo-Json -Depth 10
$resB = Invoke-RestMethod -Uri "$base/api/add-aiarc-data/search" -Method POST -Headers $h -Body $bodyB -TimeoutSec 240
$peopleB = $resB.people
INFO "got $($peopleB.Count) people, totalCount=$($resB.totalCount)"

# Group by company_domain (case-insensitive). Each domain should appear at most once.
$grouped = $peopleB | Group-Object {
  $d = $_.company_domain
  if ($null -eq $d) { '' } else { $d.ToString().ToLower() }
}
$violations = $grouped | Where-Object { $_.Count -gt 1 }
if ($violations.Count -eq 0) {
  PASS "every company_domain appears at most once"
} else {
  $vSummary = ($violations | ForEach-Object { "$($_.Name) x$($_.Count)" }) -join ', '
  FAIL "$($violations.Count) domain(s) appeared more than once: $vSummary"
}

if ($peopleB.Count -le 30) { PASS "result count <= limit (30)" } else { FAIL "got $($peopleB.Count) > limit 30" }
if ($peopleB.Count -le $peopleA.Count) {
  PASS "capped run returned <= uncapped run ($($peopleB.Count) <= $($peopleA.Count))"
} else {
  INFO "capped returned more than uncapped - possible if AI Ark dedup differs across requests"
}

Write-Host ""
if ($script:fails -eq 0) {
  Write-Host "PASSED" -ForegroundColor Green
} else {
  Write-Host ("{0} failures" -f $script:fails) -ForegroundColor Red
  exit 1
}
