import vm from 'node:vm';
import {
  substituteFormula,
  normalizeFormulaResult,
  EVAL_GLOBALS,
  type EvaluatorContext,
  type EvaluationResult,
} from './evaluator';

// SERVER-ONLY formula evaluation. Imports node:vm, so it must never be pulled
// into a client bundle — only API routes / server jobs import this.

// Hard wall-clock budget for a single evaluation. Enforced via vm so a runaway/
// infinite-loop formula can't pin the Node event loop and take the whole
// single-container backend down (QA findings B-009 / C2-015).
const FORMULA_TIMEOUT_MS = 1000;

// Built once and shared across all evaluations (the globals never change; only
// the formula string varies), which also avoids rebuilding a ~450-entry context
// per row.
const EVAL_CONTEXT = vm.createContext({ ...EVAL_GLOBALS });

/**
 * Evaluate a formula on the server with a hard timeout. Same signature and
 * return shape as the client-safe evaluateFormula, but a runaway formula returns
 * an error instead of hanging the event loop.
 */
export function evaluateFormulaSafe(formula: string, context: EvaluatorContext): EvaluationResult {
  try {
    if (!formula || !formula.trim()) {
      return { value: null, error: 'Empty formula' };
    }
    const processedFormula = substituteFormula(formula, context);
    const result = vm.runInContext(`"use strict";\n(${processedFormula})`, EVAL_CONTEXT, {
      timeout: FORMULA_TIMEOUT_MS,
      displayErrors: false,
    });
    return normalizeFormulaResult(result);
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}
