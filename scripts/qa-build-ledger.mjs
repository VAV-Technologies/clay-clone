// Build the master QA failure ledger from a Part-1 fleet workflow output file.
// Usage: node scripts/qa-build-ledger.mjs <fleet-output.json> <outDir>
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
const OUTDIR = process.argv[3];
if (!SRC || !OUTDIR) { console.error('usage: node scripts/qa-build-ledger.mjs <src> <outDir>'); process.exit(2); }

const parsed = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const result = parsed.result || parsed;
const runId = process.argv[4] || result.runId || 'unknown';
const groups = result.groups || [];
const teardown = result.teardown || null;

// Findings discovered during planning + scaffolding (not from the fleet).
const preFleet = [
  { agentGroup: 'Z_pre_fleet', area: 'formula', endpointOrComponent: 'src/lib/formula/evaluator.ts', dimension: 'functional', result: 'FAIL', severity: 'P1', scenario: 'formulajs "default" export leaks into new Function() params; every formula eval throws in pure ESM', expected: 'formula evaluates', actual: "Unexpected token 'default' (node/vitest). Prod verdict comes from group B formula tests.", suspectedRootCauseHint: 'spread ...formulajs includes reserved key "default"; filter evalContext to valid, non-reserved identifiers', fragileAreaTag: 'FORMULA-EVAL-DEFAULT-KEY' },
  { agentGroup: 'Z_pre_fleet', area: 'search', endpointOrComponent: 'src/lib/clay-api.ts:411,419,451,809', dimension: 'functional', result: 'FAIL', severity: 'P2', scenario: 'clay-api reads/writes estimatedTotal on a type that lacks it', expected: 'estimatedTotal present', actual: 'TS2339/TS2353 property does not exist', suspectedRootCauseHint: 'return type missing estimatedTotal field', fragileAreaTag: 'clay-estimatedTotal' },
  { agentGroup: 'Z_pre_fleet', area: 'enrichment/batch', endpointOrComponent: 'src/app/api/cron/process-batch/route.ts:441', dimension: 'functional', result: 'FAIL', severity: 'P2', scenario: "status compared to 'request sent' which is never a valid value (dead branch)", expected: 'reachable comparison', actual: 'TS2367 types have no overlap', suspectedRootCauseHint: 'stale status literal; dead code path', fragileAreaTag: 'batch-dead-branch' },
  { agentGroup: 'Z_pre_fleet', area: 'import', endpointOrComponent: 'src/app/api/import/csv/route.ts:88,114,115', dimension: 'integrity', result: 'FAIL', severity: 'P3', scenario: 'import/csv column insert omits actionKind/actionConfig (schema drift)', expected: 'insert object matches columns schema', actual: 'TS2345 missing actionKind/actionConfig', suspectedRootCauseHint: 'insert literal not updated when schema gained actionKind/actionConfig', fragileAreaTag: 'schema-drift' },
];

const all = [];
for (const g of groups) {
  const gname = g.agentGroup || 'unknown';
  (g.findings || []).forEach((f, i) => {
    all.push({ findingId: `${runId}-${gname}-${String(i + 1).padStart(3, '0')}`, agentGroup: gname, ...f });
  });
}
preFleet.forEach((f, i) => all.push({ findingId: `${runId}-Zpre-${String(i + 1).padStart(3, '0')}`, ...f }));

const SEV_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3, none: 4, undefined: 5 };
const issues = all.filter((f) => f.result !== 'PASS');
issues.sort((a, b) => (SEV_ORDER[a.severity] ?? 5) - (SEV_ORDER[b.severity] ?? 5));

const count = (key) => all.reduce((m, f) => { const k = f[key] ?? 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});
const byResult = count('result');
const byDimension = count('dimension');
const bySeverity = issues.reduce((m, f) => { const k = f.severity ?? 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});

fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(path.join(OUTDIR, 'qa-ledger.json'), JSON.stringify({
  runId, generatedFrom: SRC, generatedAtNote: 'stamp added by caller',
  counts: { total: all.length, byResult, bySeverity, byDimension },
  groupSummaries: groups.map((g) => ({ agentGroup: g.agentGroup, paidCallsMade: g.paidCallsMade, estCostUsd: g.estCostUsd, summary: g.summary })),
  teardown,
  findings: all,
}, null, 2));

// Markdown
const esc = (s) => String(s ?? '').replace(/\n/g, ' ').replace(/\|/g, '\\|');
let md = `# DataFlow QA Master Ledger — run ${runId}\n\n`;
md += `Source: Part-1 production-readiness fleet (capture-only). Sandbox fully torn down.\n\n`;
md += `## Counts\n\n- Total findings: **${all.length}** (incl. ${preFleet.length} pre-fleet)\n`;
md += `- By result: ${Object.entries(byResult).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
md += `- Issues (non-PASS) by severity: ${Object.entries(bySeverity).map(([k, v]) => `${k}=${v}`).join(', ')}\n`;
md += `- By dimension: ${Object.entries(byDimension).map(([k, v]) => `${k}=${v}`).join(', ')}\n\n`;
md += `## Paid cost\n\n${groups.map((g) => `- ${g.agentGroup}: ${g.paidCallsMade ?? 0} calls, ~$${g.estCostUsd ?? 0}`).join('\n')}\n\n`;
md += `## Issues (non-PASS), severity-sorted\n\n| id | sev | dim | area | scenario | actual | root-cause hint |\n|---|---|---|---|---|---|---|\n`;
for (const f of issues) {
  md += `| ${f.findingId} | ${f.severity ?? ''} | ${f.dimension ?? ''} | ${esc(f.area || f.endpointOrComponent)} | ${esc(f.scenario)} | ${esc(f.actual)} | ${esc(f.suspectedRootCauseHint)} |\n`;
}
md += `\n## Group summaries\n\n${groups.map((g) => `### ${g.agentGroup}\n${g.summary}\n`).join('\n')}\n`;
if (teardown) md += `\n## Teardown\n\n${esc(teardown.summary)}\nfolderDeleted=${teardown.folderDeleted}, deleted=${(teardown.deleted || []).length}, leaked=${(teardown.leaked || []).length}\n`;
fs.writeFileSync(path.join(OUTDIR, 'qa-ledger.md'), md);

// Console digest
console.log(`runId=${runId}  total=${all.length}  issues=${issues.length}`);
console.log(`byResult: ${JSON.stringify(byResult)}`);
console.log(`bySeverity(issues): ${JSON.stringify(bySeverity)}`);
console.log(`byDimension: ${JSON.stringify(byDimension)}`);
console.log('\n=== ALL NON-PASS FINDINGS (sev-sorted) ===');
for (const f of issues) {
  console.log(`[${f.severity ?? '?'}] ${f.findingId} {${f.dimension}} ${f.area || ''} :: ${f.scenario}`);
  console.log(`     actual: ${String(f.actual ?? '').slice(0, 240)}`);
  if (f.suspectedRootCauseHint) console.log(`     hint: ${String(f.suspectedRootCauseHint).slice(0, 200)}`);
}
