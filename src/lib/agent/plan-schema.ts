// Hand-rolled validator for the structured Campaign Plan the planner produces.
// Drizzle/zod aren't wired into the existing codebase, so we keep this small
// and self-contained. Validation is "shape-correct enough to send to the
// existing /api/campaigns endpoint, which does its own deeper validation".

import type { CampaignStep, CampaignStepType } from '@/lib/db/schema';

export interface CampaignStage {
  title: string;
  summary: string;
  notes?: string[];
  steps: Array<{
    type: CampaignStepType;
    params: Record<string, unknown>;
  }>;
}

export interface CampaignPlan {
  name: string;
  rationale: string;
  source: 'ai-ark' | 'clay';
  stages: CampaignStage[];
}

const VALID_STEP_TYPES = new Set<CampaignStepType>([
  'create_workbook',
  'use_existing_workbook',
  'use_existing_sheet',
  'import_csv',
  'search_companies',
  'search_people',
  'create_sheet',
  'import_rows',
  'filter_rows',
  'find_domains',
  'qualify_titles',
  'find_emails',
  'find_emails_waterfall',
  'clean_company_name',
  'clean_person_name',
  'materialize_send_ready',
  'lookup',
  'enrich',
  'cleanup',
]);

export type ValidationResult =
  | { valid: true; plan: CampaignPlan }
  | { valid: false; error: string };

export function validatePlan(plan: unknown): ValidationResult {
  if (!plan || typeof plan !== 'object') {
    return { valid: false, error: 'plan must be an object' };
  }
  const p = plan as Record<string, unknown>;
  if (typeof p.name !== 'string' || !p.name.trim()) {
    return { valid: false, error: 'plan.name must be a non-empty string' };
  }
  if (typeof p.rationale !== 'string') {
    return { valid: false, error: 'plan.rationale must be a string' };
  }
  if (p.source !== 'ai-ark' && p.source !== 'clay') {
    return { valid: false, error: `plan.source must be "ai-ark" or "clay" (got ${JSON.stringify(p.source)})` };
  }
  if (!Array.isArray(p.stages) || p.stages.length === 0) {
    return { valid: false, error: 'plan.stages must be a non-empty array' };
  }

  for (let i = 0; i < p.stages.length; i++) {
    const s = p.stages[i] as Record<string, unknown>;
    if (typeof s.title !== 'string') {
      return { valid: false, error: `stage[${i}].title must be a string` };
    }
    if (typeof s.summary !== 'string') {
      return { valid: false, error: `stage[${i}].summary must be a string` };
    }
    if (s.notes !== undefined && !Array.isArray(s.notes)) {
      return { valid: false, error: `stage[${i}].notes must be an array if present` };
    }
    if (!Array.isArray(s.steps) || s.steps.length === 0) {
      return { valid: false, error: `stage[${i}].steps must be a non-empty array` };
    }
    for (let j = 0; j < s.steps.length; j++) {
      const step = s.steps[j] as Record<string, unknown>;
      if (typeof step.type !== 'string') {
        return { valid: false, error: `stage[${i}].steps[${j}].type must be a string` };
      }
      if (!VALID_STEP_TYPES.has(step.type as CampaignStepType)) {
        return {
          valid: false,
          error: `stage[${i}].steps[${j}].type "${step.type}" is not a recognized CampaignStepType`,
        };
      }
      if (step.params !== undefined && (typeof step.params !== 'object' || step.params === null)) {
        return { valid: false, error: `stage[${i}].steps[${j}].params must be an object if present` };
      }
    }
  }
  return { valid: true, plan: p as unknown as CampaignPlan };
}

// Flatten validated plan into the steps[] body that POST /api/campaigns expects.
// All steps start as 'pending'; the campaign engine sets their status as it runs.
export function flattenPlanToSteps(plan: CampaignPlan): CampaignStep[] {
  const out: CampaignStep[] = [];
  for (const stage of plan.stages) {
    for (const step of stage.steps) {
      out.push({
        type: step.type,
        params: step.params || {},
        status: 'pending',
      });
    }
  }
  return out;
}

// Find the first search-company-or-people step in the plan. Used by the
// /preview endpoint to give the user a count before launching the campaign.
export function findFirstSearchStep(plan: CampaignPlan):
  | { type: 'search_companies' | 'search_people'; params: Record<string, unknown>; stageIndex: number; stepIndex: number }
  | null {
  for (let i = 0; i < plan.stages.length; i++) {
    const stage = plan.stages[i];
    for (let j = 0; j < stage.steps.length; j++) {
      const step = stage.steps[j];
      if (step.type === 'search_companies' || step.type === 'search_people') {
        return {
          type: step.type,
          params: step.params || {},
          stageIndex: i,
          stepIndex: j,
        };
      }
    }
  }
  return null;
}

// Apply a confirmed result limit to the first search step. Mutates a deep copy
// of the plan and returns the new plan unchanged otherwise.
export function applySearchLimit(plan: CampaignPlan, confirmedLimit: number): CampaignPlan {
  const cloned = JSON.parse(JSON.stringify(plan)) as CampaignPlan;
  const first = findFirstSearchStep(cloned);
  if (!first) return cloned;
  const filters = (first.params.filters as Record<string, unknown>) || {};
  filters.limit = confirmedLimit;
  cloned.stages[first.stageIndex].steps[first.stepIndex].params = {
    ...first.params,
    filters,
  };
  return cloned;
}
