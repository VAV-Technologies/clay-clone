import { describe, it, expect } from 'vitest';
import {
  evaluateFormula,
  extractColumnReferences,
  validateFormula,
} from '@/lib/formula/evaluator';
import { evaluateFormulaSafe } from '@/lib/formula/evaluator-server';

const cols = [
  { id: 'c1', name: 'First Name' },
  { id: 'c2', name: 'Last Name' },
  { id: 'c3', name: 'Email' },
];
function ctx(row: Record<string, { value: string | number | null }>) {
  return { row, columns: cols };
}

// Regression for FORMULA-EVAL-DEFAULT-KEY: formulajs exposes a reserved `default`
// export that used to leak into new Function() params and break every eval in a
// pure-ESM runtime. The evaluator now filters its context to valid identifiers,
// so these pass in every runtime.
describe('evaluateFormula', () => {
  it('concatenates two column values', () => {
    const r = evaluateFormula('({{First Name}} + " " + {{Last Name}}).trim()', ctx({ c1: { value: 'Jane' }, c2: { value: 'Doe' } }));
    expect(r.error).toBeUndefined();
    expect(r.value).toBe('Jane Doe');
  });

  it('does arithmetic on numeric cells', () => {
    expect(evaluateFormula('{{First Name}} * 2', ctx({ c1: { value: 21 } })).value).toBe(42);
  });

  it('handles null cell values without throwing', () => {
    expect(evaluateFormula('{{First Name}}?.toUpperCase() || "EMPTY"', ctx({ c1: { value: null } })).value).toBe('EMPTY');
  });

  it('extracts domain from email', () => {
    expect(evaluateFormula('{{Email}}?.split("@")[1] || ""', ctx({ c3: { value: 'jane@acme.com' } })).value).toBe('acme.com');
  });

  it('stringifies array/object results', () => {
    expect(evaluateFormula('[{{First Name}}, {{Last Name}}]', ctx({ c1: { value: 'a' }, c2: { value: 'b' } })).value).toBe('["a","b"]');
  });

  it('exposes a formulajs function (UPPER) without the reserved default key breaking eval', () => {
    expect(evaluateFormula('UPPER({{First Name}})', ctx({ c1: { value: 'jane' } })).value).toBe('JANE');
  });

  // B-009 / C2-015: the SERVER evaluator (evaluateFormulaSafe) must evaluate
  // normally AND abort a runaway formula via its vm timeout, not hang the event
  // loop. If this ever times out instead of asserting, the vm timeout regressed.
  it('evaluateFormulaSafe evaluates normally and aborts an infinite loop', () => {
    expect(evaluateFormulaSafe('{{First Name}} + "!"', ctx({ c1: { value: 'Jane' } })).value).toBe('Jane!');
    const r = evaluateFormulaSafe('((function(){ while (true) {} })())', ctx({ c1: { value: 'x' } }));
    expect(r.value).toBeNull();
    expect(r.error).toBeTruthy();
  }, 8000);

  it('returns an error string for invalid syntax instead of throwing', () => {
    const r = evaluateFormula('{{First Name}} +++ ', ctx({ c1: { value: 'x' } }));
    expect(r.error).toBeTruthy();
    expect(r.value).toBeNull();
  });

  it('returns an error for an empty formula', () => {
    expect(evaluateFormula('   ', ctx({})).error).toBeTruthy();
  });
});

describe('validateFormula', () => {
  it('marks a formula over known columns as valid', () => {
    expect(validateFormula('{{First Name}}.length', cols).valid).toBe(true);
  });
});

describe('extractColumnReferences', () => {
  it('returns unique referenced column names', () => {
    expect(extractColumnReferences('{{A}} + {{B}} + {{A}}')).toEqual(['A', 'B']);
  });
});
