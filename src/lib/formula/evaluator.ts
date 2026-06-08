import * as formulajs from 'formulajs';
import _ from 'lodash';
import vm from 'node:vm';

interface Column {
  id: string;
  name: string;
}

interface CellValue {
  value: string | number | null;
  status?: string;
  error?: string;
}

interface EvaluatorContext {
  row: Record<string, CellValue>;
  columns: Column[];
}

interface EvaluationResult {
  value: string | number | null;
  error?: string;
}

// Hard wall-clock budget for a single formula evaluation, enforced via vm so a
// runaway/infinite-loop formula can't pin the Node event loop and take the whole
// backend down (QA findings B-009 / C2-015).
const FORMULA_TIMEOUT_MS = 1000;

// Reserved words / non-identifiers can't be vm globals — formulajs exposes a
// reserved `default` export (FORMULA-EVAL-DEFAULT-KEY) — so filter them out.
const RESERVED_WORDS = new Set([
  'default', 'arguments', 'eval', 'let', 'const', 'var', 'function', 'return',
  'this', 'new', 'class', 'delete', 'typeof', 'instanceof', 'in', 'of', 'do',
  'if', 'else', 'switch', 'case', 'for', 'while', 'with', 'try', 'catch',
  'finally', 'throw', 'void', 'yield', 'await', 'super', 'import', 'export',
  'extends', 'enum', 'null', 'true', 'false', 'break', 'continue', 'debugger',
]);

// Whitelisted globals available inside formulas. Built ONCE and shared across all
// evaluations (the globals never change; only the formula string varies), which
// also avoids rebuilding a ~450-entry vm context per row.
const EVAL_GLOBALS: Record<string, unknown> = Object.fromEntries(
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
const EVAL_CONTEXT = vm.createContext(EVAL_GLOBALS);

/**
 * Safely evaluates a JavaScript formula with column value substitution.
 *
 * Available in formulas:
 * - Standard JavaScript: Math, String, Array, Date, RegExp, Number, Object, JSON
 * - Lodash: _ (e.g., _.capitalize, _.trim, _.get)
 * - Excel/Google Sheets functions via FormulaJS
 * - Column references: {{Column Name}} syntax
 */
export function evaluateFormula(
  formula: string,
  context: EvaluatorContext
): EvaluationResult {
  try {
    if (!formula || !formula.trim()) {
      return { value: null, error: 'Empty formula' };
    }

    // Replace {{Column Name}} with actual values
    let processedFormula = formula;

    for (const col of context.columns) {
      const placeholder = `{{${col.name}}}`;
      const cellData = context.row[col.id];
      const value = cellData?.value ?? null;

      // Escape special regex characters in column name
      const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Replace with JSON-stringified value to handle strings, numbers, null properly
      processedFormula = processedFormula.replace(
        new RegExp(escapedPlaceholder, 'g'),
        JSON.stringify(value)
      );
    }

    // Evaluate inside the shared vm context with a hard timeout. The timeout
    // interrupts long-running synchronous code via V8's watchdog, so a runaway
    // formula returns an error instead of hanging the event loop (B-009 / C2-015).
    const result = vm.runInContext(`"use strict";\n(${processedFormula})`, EVAL_CONTEXT, {
      timeout: FORMULA_TIMEOUT_MS,
      displayErrors: false,
    });

    // Normalize the result
    if (result === undefined) {
      return { value: null };
    }

    if (typeof result === 'boolean') {
      // Convert booleans to string representation
      return { value: result ? 'true' : 'false' };
    }

    if (typeof result === 'object' && result !== null) {
      // Convert objects/arrays to string representation
      return { value: JSON.stringify(result) };
    }

    return { value: result as string | number | null };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { value: null, error: errorMessage };
  }
}

/**
 * Validates a formula without executing it on real data.
 * Uses sample values to test the formula structure.
 */
export function validateFormula(
  formula: string,
  columns: Column[]
): { valid: boolean; error?: string } {
  // Create mock row data with sample values
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
 * Extracts column references from a formula.
 * Returns array of column names referenced in {{Column Name}} syntax.
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
