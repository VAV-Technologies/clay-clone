// Rough country-keyed revenue-per-employee ratios for converting a user's
// "$X revenue" threshold into a search-friendly employee-size range. Revenue
// data on the underlying providers (Clay, AI Ark) is sparse and unreliable —
// most rows have no annual_revenue value at all — so the planner does not
// filter on revenue directly. Instead it converts to employees and filters
// on `sizes` / `minimum_member_count`, which are populated for nearly every
// company.
//
// Numbers are conservative country medians for SMB-to-mid-market companies.
// The resulting search range is intentionally wide (~0.4x to 3x of the median
// implied employee count) so the search captures qualified companies even
// when the per-employee ratio varies by industry.

export const COUNTRY_REVENUE_PER_EMPLOYEE_USD: Record<string, number> = {
  // Mature GTM markets — higher per-employee revenue
  'United States': 200_000,
  'United Kingdom': 180_000,
  'Germany': 180_000,
  'France': 160_000,
  'Canada': 180_000,
  'Australia': 180_000,
  'Japan': 200_000,
  'Singapore': 180_000,
  'Israel': 200_000,
  'Netherlands': 180_000,
  'Switzerland': 220_000,
  'Sweden': 180_000,
  Ireland: 200_000,
  Denmark: 180_000,
  Norway: 200_000,
  Finland: 180_000,
  // South & Southeast Asia
  India: 40_000,
  Indonesia: 50_000,
  Philippines: 35_000,
  Vietnam: 40_000,
  Thailand: 60_000,
  Malaysia: 80_000,
  China: 100_000,
  Pakistan: 30_000,
  Bangladesh: 25_000,
  // Latin America
  Brazil: 70_000,
  Mexico: 70_000,
  Argentina: 50_000,
  Colombia: 50_000,
  Chile: 80_000,
  Peru: 50_000,
  // MENA
  'United Arab Emirates': 150_000,
  'Saudi Arabia': 150_000,
  Egypt: 30_000,
  Turkey: 50_000,
  Israel_alt: 200_000,
  // Africa
  'South Africa': 70_000,
  Nigeria: 30_000,
  Kenya: 30_000,
  // Eastern Europe
  Poland: 80_000,
  'Czech Republic': 100_000,
  Romania: 60_000,
  Russia: 60_000,
  Ukraine: 30_000,
  // Default
  __default__: 120_000,
};

export interface EmployeeRange {
  minEmployees: number;
  maxEmployees: number;
  ratioUsed: number;
  rationale: string;
}

export function revenueToEmployeeRange(country: string, annualRevenueUSD: number): EmployeeRange {
  const ratio =
    COUNTRY_REVENUE_PER_EMPLOYEE_USD[country] ??
    COUNTRY_REVENUE_PER_EMPLOYEE_USD.__default__;
  const median = Math.round(annualRevenueUSD / ratio);
  const minEmployees = Math.max(1, Math.round(median * 0.4));
  const maxEmployees = Math.max(minEmployees + 1, Math.round(median * 3));
  return {
    minEmployees,
    maxEmployees,
    ratioUsed: ratio,
    rationale: `${country}: ~$${ratio.toLocaleString()} revenue per employee (rough median). $${(annualRevenueUSD / 1_000_000).toFixed(1)}M revenue ≈ ${minEmployees}-${maxEmployees} employees (around ${median}).`,
  };
}
