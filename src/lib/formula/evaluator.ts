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

interface EvaluatorContext {
  row: Record<string, CellValue>;
  columns: Column[];
}

interface EvaluationResult {
  value: string | number | null;
  error?: string;
}

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

    // Create safe evaluation context with whitelisted globals
    const evalContext: Record<string, unknown> = {
      // Lodash
      _,

      // FormulaJS Excel functions (spread all functions)
      ...formulajs,

      // Standard JavaScript globals (safe subset)
      Math,
      String,
      Array,
      Date,
      RegExp,
      Number,
      Object,
      JSON,
      Boolean,

      // Utility functions
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,

      // Common string utilities
      trim: (s: string) => s?.trim() ?? '',
      lower: (s: string) => s?.toLowerCase() ?? '',
      upper: (s: string) => s?.toUpperCase() ?? '',
      capitalize: (s: string) => _.capitalize(s),

      // Null-safe helpers
      ifEmpty: (val: unknown, fallback: unknown) =>
        (val === null || val === undefined || val === '') ? fallback : val,
      coalesce: (...args: unknown[]) =>
        args.find(arg => arg !== null && arg !== undefined && arg !== ''),
    };

    // Evaluate using Function constructor (safer than eval)
    // This creates a new function with controlled scope
    const contextKeys = Object.keys(evalContext);
    const contextValues = Object.values(evalContext);

    // Wrap the formula to return its result
    const functionBody = `"use strict"; return (${processedFormula});`;

    // Create and execute the function
    const fn = new Function(...contextKeys, functionBody);
    const result = fn(...contextValues);

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
