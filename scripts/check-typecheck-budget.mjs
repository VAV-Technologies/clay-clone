// Typecheck ratchet: run `tsc --noEmit`, count errors, fail if over the budget
// in tests/typecheck-budget.json. Lets CI block NEW type errors without forcing
// the pre-existing backlog to zero on day one. Usage: node scripts/check-typecheck-budget.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const budget = JSON.parse(fs.readFileSync('tests/typecheck-budget.json', 'utf8')).maxErrors;

let out = '';
try {
  out = execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  out = `${e.stdout || ''}${e.stderr || ''}`;
}

const count = (out.match(/error TS\d+/g) || []).length;
console.log(`tsc errors: ${count} (budget: ${budget})`);

if (count > budget) {
  console.error(`\nTypecheck regressed: ${count} > ${budget}. Fix the new error(s) or they will block the deploy.`);
  process.exit(1);
}
if (count < budget) {
  console.log(`Below budget — lower "maxErrors" in tests/typecheck-budget.json to ${count} to lock in the gain.`);
}
process.exit(0);
