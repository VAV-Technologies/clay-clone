import * as formulajs from 'formulajs';
import _ from 'lodash';

interface Column {
  id: string;
  name: string;
}

interface CellValue {
  value: string | number | null;
  status?: string;
  error?: string;
}

export interface EvaluatorContext {
  row: Record<string, CellValue>;
  columns: Column[];
}

export interface EvaluationResult {
  value: string | number | null;
  error?: string;
}

// Reserved words / non-identifiers can't be eval globals — formulajs exposes a
// reserved `default` export (FORMULA-EVAL-DEFAULT-KEY) — so filter them out.
const RESERVED_WORDS = new Set([
  'default', 'arguments', 'eval', 'let', 'const', 'var', 'function', 'return',
  'this', 'new', 'class', 'delete', 'typeof', 'instanceof', 'in', 'of', 'do',
  'if', 'else', 'switch', 'case', 'for', 'while', 'with', 'try', 'catch',
  'finally', 'throw', 'void', 'yield', 'await', 'super', 'import', 'export',
  'extends', 'enum', 'null', 'true', 'false', 'break', 'continue', 'debugger',
]);

// Whitelisted globals available inside formulas. Built once; filtered to valid,
// non-reserved identifier names. Shared by the client-safe evaluator (below) and
// the server-only vm evaluator (evaluator-server.ts). Pure data — no Node deps,
// so this module stays safe to import from client components (FormulaPanel).
export const EVAL_GLOBALS: Record<string, unknown> = Object.fromEntries(
  Object.entries({
    _,
    ...formulajs,
    Math, String, Array, Date, RegExp, Number, Object, JSON, Boolean,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    trim: (s: string) => s?.trim() ?? '',
    lower: (s: string) => s?.toLowerCase() ?? '',
    upper: (s: string) => s?.toUpperCase() ?? '',
    capitalize: (s: string) => _.capitalize(s),
    ifEmpty: (val: unknown, fallback: unknown) =>
      (val === null || val === undefined || val === '') ? fallback : val,
    coalesce: (...args: unknown[]) =>
      args.find((arg) => arg !== null && arg !== undefined && arg !== ''),
  }).filter(([k]) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !RESERVED_WORDS.has(k))
);

/** Replaces {{Column Name}} placeholders with JSON-encoded cell values. */
export function substituteFormula(formula: string, context: EvaluatorContext): string {
  let processed = formula;
  for (const col of context.columns) {
    const placeholder = `{{${col.name}}}`;
    const value = context.row[col.id]?.value ?? null;
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    processed = processed.replace(new RegExp(escaped, 'g'), JSON.stringify(value));
  }
  return processed;
}

/** Normalizes a raw evaluation result into the EvaluationResult shape. */
export function normalizeFormulaResult(result: unknown): EvaluationResult {
  if (result === undefined) return { value: null };
  if (typeof result === 'boolean') return { value: result ? 'true' : 'false' };
  if (typeof result === 'object' && result !== null) return { value: JSON.stringify(result) };
  return { value: result as string | number | null };
}

/**
 * Client-safe formula evaluation (used for live preview in FormulaPanel).
 *
 * Uses the Function constructor — there is NO hard timeout here, so a runaway
 * formula would hang only the caller's own context. On the SERVER, formula runs
 * go through evaluateFormulaSafe (evaluator-server.ts) which adds a vm timeout
 * so a bad formula can't pin the backend event loop (B-009).
 *
 * Available in formulas: Math, String, Array, Date, RegExp, Number, Object,
 * JSON, lodash (`_`), FormulaJS functions, and {{Column Name}} references.
 */
export function evaluateFormula(formula: string, context: EvaluatorContext): EvaluationResult {
  try {
    if (!formula || !formula.trim()) {
      return { value: null, error: 'Empty formula' };
    }
    const processedFormula = substituteFormula(formula, context);
    const keys = Object.keys(EVAL_GLOBALS);
    const values = Object.values(EVAL_GLOBALS);
    const fn = new Function(...keys, `"use strict"; return (${processedFormula});`);
    return normalizeFormulaResult(fn(...values));
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Validates a formula without executing it on real data, using sample values.
 */
export function validateFormula(
  formula: string,
  columns: Column[]
): { valid: boolean; error?: string } {
  const mockRow: Record<string, CellValue> = {};
  for (const col of columns) {
    mockRow[col.id] = { value: 'sample_value' };
  }
  const result = evaluateFormula(formula, { row: mockRow, columns });
  if (result.error) {
    return { valid: false, error: result.error };
  }
  return { valid: true };
}

/**
 * Extracts column references from a formula ({{Column Name}} syntax).
 */
export function extractColumnReferences(formula: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(formula)) !== null) {
    if (!matches.includes(match[1])) {
      matches.push(match[1]);
    }
  }
  return matches;
}

/**
 * Provides formula suggestions based on common patterns.
 */
export const FORMULA_EXAMPLES = [
  {
    description: 'Extract domain from email',
    formula: '{{Email}}?.split("@")[1] || ""',
  },
  {
    description: 'Combine first and last name',
    formula: '({{First Name}} + " " + {{Last Name}}).trim()',
  },
  {
    description: 'Extract text after @ in Twitter handle',
    formula: '{{Twitter}}?.replace(/^@/, "") || ""',
  },
  {
    description: 'Get first word from text',
    formula: '{{Text}}?.split(" ")[0] || ""',
  },
  {
    description: 'Convert to uppercase',
    formula: '{{Text}}?.toUpperCase() || ""',
  },
  {
    description: 'Check if value exists (boolean)',
    formula: '{{Value}} ? "Yes" : "No"',
  },
  {
    description: 'Extract numbers from string',
    formula: '{{Text}}?.replace(/[^0-9]/g, "") || ""',
  },
  {
    description: 'Concatenate with separator',
    formula: '[{{Col1}}, {{Col2}}, {{Col3}}].filter(Boolean).join(", ")',
  },
];
