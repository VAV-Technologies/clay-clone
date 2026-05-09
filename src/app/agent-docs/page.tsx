// /agent-docs — Read-only view of how Agent X is configured: the model,
// the system prompt the planner sends to gpt-5-mini, and the country ->
// revenue/employee table the prompt references. Renders server-side so it
// can pull straight from the planner module without exposing AI client
// internals to the browser bundle.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  PLANNER_SYSTEM_PROMPT,
  PLANNER_MODEL,
  PLANNER_TEMPERATURE,
  PLANNER_MAX_OUTPUT_TOKENS,
} from '@/lib/agent/planner';
import { COUNTRY_REVENUE_PER_EMPLOYEE_USD } from '@/lib/agent/revenue-employee-table';

export const metadata = {
  title: 'Agent X Configuration — DataFlow',
  description: 'How the in-app campaign builder agent is wired',
};

export default function AgentDocsPage() {
  const countries = Object.entries(COUNTRY_REVENUE_PER_EMPLOYEE_USD)
    .filter(([k]) => k !== '__default__' && !k.endsWith('_alt'))
    .sort(([a], [b]) => a.localeCompare(b));
  const defaultRatio = COUNTRY_REVENUE_PER_EMPLOYEE_USD.__default__;

  return (
    <div className="min-h-screen relative">
      {/* Header */}
      <header className="relative z-10 border-b border-white/10 bg-midnight/50 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 hover:bg-white/5 transition flex items-center gap-2 text-white/60 hover:text-white text-sm"
            title="Back to home"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Home</span>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-display text-white tracking-tight">Agent X Configuration</h1>
            <p className="text-xs text-white/40 mt-0.5">
              How the in-app campaign builder thinks. Updates automatically
              when planner.ts changes — this is the same prompt the model sees.
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-8 space-y-10">
        {/* Runtime config */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-white/40 mb-3">Runtime</h2>
          <div className="border border-white/10 divide-y divide-white/5">
            <ConfigRow label="Model" value={PLANNER_MODEL} />
            <ConfigRow label="Temperature" value={String(PLANNER_TEMPERATURE)} />
            <ConfigRow label="Max output tokens" value={PLANNER_MAX_OUTPUT_TOKENS.toLocaleString()} />
            <ConfigRow label="Tool calling" value="Disabled (single-shot JSON)" />
            <ConfigRow
              label="Expected output"
              value="JSON: { assistantText, planJson, clarifyingQuestions, nextAction }"
            />
            <ConfigRow
              label="History format"
              value='Conversation flattened to text — "USER: ... ASSISTANT: ..."'
            />
            <ConfigRow
              label="Default data source"
              value="AI Ark — REST API at api.ai-ark.com/api/developer-portal/v1 (X-TOKEN header). Full filter schema in the system prompt below."
            />
            <ConfigRow
              label="AI Ark people filters"
              value="Account: companyDomain, companyName, industries(±), accountLocation, employeeSize, technology, revenue. Contact: fullName, linkedinUrl, contactLocation, seniority, departments, titleKeywords/Mode, skills, certifications, schoolNames, languages. Results: limit, limitPerCompany."
            />
            <ConfigRow
              label="AI Ark company filters"
              value="domain, name, lookalikeDomains (≤5), industries(±), keywords, location, employeeSize, technology, fundingType, fundingTotalMin/Max, revenueMin/Max, foundedYearMin/Max, limit."
            />
          </div>
        </section>

        {/* System prompt */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-white/40 mb-3">
            System prompt (verbatim)
          </h2>
          <p className="text-sm text-white/55 mb-3">
            This is sent as the <code className="text-white/70 bg-white/5 px-1">system</code> message
            on every turn. The conversation history follows as a single
            <code className="text-white/70 bg-white/5 px-1">user</code> message.
          </p>
          <pre
            className="border border-white/10 bg-black/30 p-5 text-[12px] text-white/85
                       font-mono leading-relaxed whitespace-pre-wrap overflow-x-auto"
          >
            {PLANNER_SYSTEM_PROMPT}
          </pre>
        </section>

        {/* Country revenue table */}
        <section>
          <h2 className="text-xs uppercase tracking-wider text-white/40 mb-3">
            Country → revenue / employee ratios
          </h2>
          <p className="text-sm text-white/55 mb-3">
            Used by the planner to convert a user's revenue threshold (e.g.
            "$10M+") into a search-friendly{' '}
            <code className="text-white/70 bg-white/5 px-1">employeeSize</code> range. The
            employee range it emits is roughly <strong>0.4×</strong> to{' '}
            <strong>3×</strong> of <code className="text-white/70 bg-white/5 px-1">revenue ÷ ratio</code>.
          </p>
          <div className="border border-white/10">
            <div className="grid grid-cols-2 gap-px bg-white/10">
              {countries.map(([country, ratio]) => (
                <div
                  key={country}
                  className="flex items-center justify-between px-4 py-2 bg-midnight/40 text-sm"
                >
                  <span className="text-white/85">{country}</span>
                  <span className="text-white/55 font-mono">
                    ${ratio.toLocaleString()}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-2 bg-midnight/40 text-sm col-span-2 border-t border-white/10">
                <span className="text-white/55 italic">Default (any country not listed)</span>
                <span className="text-white/55 font-mono">${defaultRatio.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Footer link */}
        <section className="border-t border-white/10 pt-6">
          <p className="text-sm text-white/50">
            Need the workbook/sheet/row API instead?{' '}
            <Link href="/api-docs" className="text-lavender hover:underline">
              Open API docs →
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3 text-sm">
      <span className="w-44 flex-shrink-0 text-white/50">{label}</span>
      <span className="text-white/85 font-mono text-[13px] leading-relaxed">{value}</span>
    </div>
  );
}
