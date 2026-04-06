'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Check, ChevronDown, Download, Terminal } from 'lucide-react';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://dataflow-pi.vercel.app';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handle} className="p-1 hover:bg-white/10 rounded transition-colors" title="Copy">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
    </button>
  );
}

function Endpoint({ method, path, description, body, response, curl }: {
  method: string; path: string; description: string; body?: string; response?: string; curl?: string;
}) {
  const [open, setOpen] = useState(false);
  const methodColors: Record<string, string> = {
    GET: 'bg-emerald-500/20 text-emerald-400',
    POST: 'bg-blue-500/20 text-blue-400',
    PATCH: 'bg-amber-500/20 text-amber-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left"
      >
        <span className={`px-2 py-0.5 text-xs font-mono font-bold rounded ${methodColors[method] || 'bg-white/10 text-white/60'}`}>
          {method}
        </span>
        <code className="text-sm text-white/80 font-mono flex-1">{path}</code>
        <span className="text-xs text-white/40 hidden sm:block">{description}</span>
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-white/[0.08] p-4 space-y-3 bg-white/[0.01]">
          <p className="text-sm text-white/60">{description}</p>

          {body && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-white/40 font-medium">Request Body</span>
                <CopyButton text={body} />
              </div>
              <pre className="text-xs text-white/70 bg-black/20 rounded-lg p-3 overflow-x-auto font-mono">{body}</pre>
            </div>
          )}

          {response && (
            <div>
              <span className="text-xs text-white/40 font-medium">Response</span>
              <pre className="text-xs text-white/70 bg-black/20 rounded-lg p-3 overflow-x-auto font-mono mt-1">{response}</pre>
            </div>
          )}

          {curl && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-white/40 font-medium">curl</span>
                <CopyButton text={curl} />
              </div>
              <pre className="text-xs text-emerald-400/80 bg-black/20 rounded-lg p-3 overflow-x-auto font-mono">{curl}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-white mt-8 mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function WorkflowStep({ step, title, description, endpoint, curl, notes }: {
  step: number; title: string; description: string; endpoint?: string; curl?: string; notes?: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left">
        <span className="w-7 h-7 rounded-full bg-lavender/20 text-lavender text-xs font-bold flex items-center justify-center flex-shrink-0">{step}</span>
        <span className="text-sm text-white font-medium flex-1">{title}</span>
        {endpoint && <code className="text-xs text-white/40 font-mono hidden sm:block">{endpoint}</code>}
        <ChevronDown className={`w-4 h-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-white/[0.08] p-4 space-y-3 bg-white/[0.01]">
          <p className="text-sm text-white/60">{description}</p>
          {curl && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-white/40 font-medium">API Call</span>
                <CopyButton text={curl} />
              </div>
              <pre className="text-xs text-emerald-400/80 bg-black/20 rounded-lg p-3 overflow-x-auto font-mono whitespace-pre-wrap">{curl}</pre>
            </div>
          )}
          {notes && notes.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs text-white/40 font-medium">Agent Notes</span>
              <ul className="text-xs text-white/50 space-y-1">
                {notes.map((n, i) => <li key={i} className="flex gap-2"><span className="text-lavender/60">-</span>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function APIDocsPage() {
  const router = useRouter();
  const H = `Authorization: Bearer YOUR_API_KEY`;
  const B = BASE_URL;

  return (
    <div className="fixed inset-0 bg-[#0d0d39] text-white overflow-y-auto">
      {/* Header */}
      <header className="border-b border-white/10 bg-midnight/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => router.push('/')} className="text-white/70 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">DataFlow API Documentation</h1>
          <button
            onClick={() => {
              fetch('/api/docs/download').then(r => r.blob()).then(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'DATAFLOW-API-REFERENCE.md'; a.click();
                URL.revokeObjectURL(url);
              });
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-sm text-white/70 hover:text-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download MD</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-2">
        {/* Auth + API Key */}
        <div className="p-4 bg-lavender/10 border border-lavender/20 rounded-xl space-y-3">
          <h2 className="text-lg font-semibold text-white">Authentication &amp; API Key</h2>
          <p className="text-sm text-white/60">All API requests require a Bearer token in the Authorization header:</p>
          <div className="flex items-center gap-2">
            <pre className="text-sm text-lavender bg-black/20 rounded-lg px-3 py-2 font-mono flex-1">Authorization: Bearer YOUR_API_KEY</pre>
            <CopyButton text="Authorization: Bearer YOUR_API_KEY" />
          </div>
          <div className="text-sm text-white/50 space-y-2 pt-1">
            <p className="text-white/70 font-medium text-xs">Where to get your API key:</p>
            <div className="space-y-1 text-xs">
              <p>1. Set the <code className="text-lavender/80 bg-black/20 px-1.5 py-0.5 rounded">DATAFLOW_API_KEY</code> environment variable in your <code className="text-lavender/80 bg-black/20 px-1.5 py-0.5 rounded">.env.local</code> file:</p>
              <pre className="text-emerald-400/80 bg-black/20 rounded-lg p-2 font-mono">DATAFLOW_API_KEY=your-secret-key-here</pre>
              <p>2. For production (Vercel), set it via CLI: <code className="text-lavender/80 bg-black/20 px-1.5 py-0.5 rounded">vercel env add DATAFLOW_API_KEY</code></p>
              <p>3. Use any string as your key — there is no signup. You define the key, the API checks it.</p>
            </div>
          </div>
          <pre className="text-xs text-emerald-400/80 bg-black/20 rounded-lg p-3 font-mono">
{`# Test your key:\ncurl -H "${H}" ${B}/api/stats`}
          </pre>
        </div>

        {/* Claude Code Launcher */}
        <div className="p-4 bg-emerald-500/5 border border-emerald-500/15 rounded-xl space-y-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Use with Claude Code</h2>
          </div>
          <p className="text-sm text-white/50">Launch Claude Code with the full DataFlow API context pre-loaded. Just describe what you want and it executes the campaign end-to-end.</p>
          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-white/40 font-medium">Slash command (from the project directory)</span>
                <CopyButton text='/campaign Find companies in Jakarta with 50+ employees and get their CMOs&apos; emails' />
              </div>
              <pre className="text-xs text-emerald-400/80 bg-black/20 rounded-lg p-3 font-mono">/campaign Find companies in Jakarta with 50+ employees and get their CMOs&apos; emails</pre>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-white/40 font-medium">Or launch directly from terminal</span>
                <CopyButton text='claude "/campaign Find SaaS companies in Berlin with 200+ employees, get their VP Sales, and find emails"' />
              </div>
              <pre className="text-xs text-emerald-400/80 bg-black/20 rounded-lg p-3 font-mono">claude &quot;/campaign Find SaaS companies in Berlin with 200+ employees, get their VP Sales, and find emails&quot;</pre>
            </div>
          </div>
          <div className="text-xs text-white/40 space-y-1 pt-1">
            <p>The <code className="text-emerald-400/60 bg-black/20 px-1 py-0.5 rounded">/campaign</code> command is defined in <code className="text-emerald-400/60 bg-black/20 px-1 py-0.5 rounded">.claude/commands/campaign.md</code> — it reads the full API reference, picks the right workflow, and executes step by step via curl.</p>
            <p>Works with: company search, people search, email finding, AI enrichment, data cleaning, cross-sheet lookup, CSV export — the full pipeline.</p>
          </div>
        </div>

        {/* AI Agent Workflow Guide */}
        <div className="mt-8 space-y-4">
          <div className="p-4 bg-lavender/5 border border-lavender/15 rounded-xl space-y-2">
            <h2 className="text-lg font-semibold text-white">AI Agent Workflow Guide</h2>
            <p className="text-sm text-white/50">Step-by-step playbooks for end-to-end campaign execution. Each workflow shows exactly which endpoints to call, in what order, with what data. Designed so an AI agent can mechanically execute a full campaign from a natural language request.</p>
          </div>

          {/* Workflow 1: Company → People → Emails */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/80 mt-6 mb-2">Workflow: &quot;Find companies in [location] with [criteria] and get [role] emails&quot;</h3>
            <p className="text-xs text-white/40 mb-3">Example: &quot;Build a list of companies in Jakarta with 50+ employees and get me each of their CMOs&apos; emails&quot;</p>

            <WorkflowStep step={1} title="Create a workbook" endpoint="POST /api/projects"
              description="Create a new workbook to hold all sheets for this campaign."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/projects \\\n  -d '{"name":"Jakarta CMO Campaign","type":"workbook"}'`}
              notes={['Save the returned id as workbookId — you need it for every sheet you create']} />

            <WorkflowStep step={2} title="Search for companies" endpoint="POST /api/add-data/search"
              description="Search Clay for companies matching the criteria. All filters are optional — combine as needed."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/add-data/search \\\n  -d '{"searchType":"companies","filters":{"country_names":["Indonesia"],"locations":["Jakarta"],"minimum_member_count":50,"limit":1000}}'`}
              notes={[
                'Response: { companies: [...], totalCount, mode }',
                'Each company has: name, domain, size, industry, country, location, linkedin_url, description, annual_revenue',
                'Company sizes use comma format: "501-1,000" not "501-1000"',
                'Use minimum_member_count for "50+ employees" (more precise than size ranges)',
                'limit defaults to 25000 max. Set lower for faster searches',
              ]} />

            <WorkflowStep step={3} title="Create Sheet 1: Companies" endpoint="POST /api/tables"
              description="Create a sheet inside the workbook for company data."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables \\\n  -d '{"projectId":"WORKBOOK_ID","name":"Companies"}'`}
              notes={[
                'Save the returned table id as companiesTableId',
                'Sheet starts empty — add columns next',
              ]} />

            <WorkflowStep step={4} title="Add columns to Companies sheet" endpoint="POST /api/columns"
              description="Create columns for each company field you want to store. Call once per column."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/columns \\\n  -d '{"tableId":"COMPANIES_TABLE_ID","name":"Company Name","type":"text"}'\n\n# Repeat for: Domain (url), Size (text), Industry (text), Location (text), LinkedIn (url), Description (text)`}
              notes={[
                'Save every column id — you need them to import data and for lookup later',
                'The Domain column is critical — it links companies to people',
                'Column types: text, number, email, url, date',
              ]} />

            <WorkflowStep step={5} title="Import company data into sheet" endpoint="POST /api/rows"
              description="Map the search results into rows. Each row's data is keyed by column ID."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"tableId":"COMPANIES_TABLE_ID","rows":[{"COL_NAME_ID":{"value":"PT Maju Jaya"},"COL_DOMAIN_ID":{"value":"majujaya.id"},"COL_SIZE_ID":{"value":"501-1,000"}}]}'`}
              notes={[
                'Send all companies in one bulk call (up to 100k rows)',
                'Cell format: { "columnId": { "value": "data" } }',
                'Save returned row IDs for filtering later',
              ]} />

            <WorkflowStep step={6} title="Filter out companies without domains" endpoint="GET /api/rows + DELETE /api/rows"
              description="Find rows where Domain is empty and delete them — they're useless for email finding."
              curl={`# Step 1: Get rows with empty domain\ncurl -H "${H}" "${B}/api/rows?tableId=COMPANIES_TABLE_ID&filters=%5B%7B%22columnId%22%3A%22COL_DOMAIN_ID%22%2C%22operator%22%3A%22is_empty%22%7D%5D"\n\n# Step 2: Delete those rows\ncurl -X DELETE -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"ids":["row-1","row-2"],"tableId":"COMPANIES_TABLE_ID"}'`}
              notes={[
                'filters param is URL-encoded JSON: [{"columnId":"...","operator":"is_empty"}]',
                'Collect the IDs from the filtered response, then bulk delete',
                'This ensures every remaining company has a domain for people search',
              ]} />

            <WorkflowStep step={7} title="Search for people (CMOs) at those companies" endpoint="POST /api/add-data/search"
              description="Search Clay for people matching the role at the company domains from Step 5."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/add-data/search \\\n  -d '{"searchType":"people","domains":["majujaya.id","other.co.id"],"filters":{"job_title_keywords":["Chief Marketing Officer","CMO","VP Marketing","Head of Marketing"],"job_title_mode":"smart","seniority_levels":["c-suite","vp","director"],"limit":1000,"limit_per_company":3}}'`}
              notes={[
                'Pass ALL company domains from Step 5 in the domains array',
                'Use job_title_mode: "smart" for fuzzy matching (catches variations)',
                'limit_per_company prevents one large company from dominating results',
                'Response: { people: [...], totalCount, mode }',
                'Each person has: first_name, last_name, full_name, job_title, company_domain, location, linkedin_url',
              ]} />

            <WorkflowStep step={8} title="Create Sheet 2: People" endpoint="POST /api/tables"
              description="Create a second sheet in the same workbook for the people data."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables \\\n  -d '{"projectId":"WORKBOOK_ID","name":"CMOs"}'`}
              notes={[
                'Save as peopleTableId',
                'Add columns: First Name (text), Last Name (text), Full Name (text), Job Title (text), Company Domain (url), Location (text), LinkedIn (url)',
                'The Company Domain column must contain clean domains (no https://, no www.)',
              ]} />

            <WorkflowStep step={9} title="Add columns + import people data" endpoint="POST /api/columns + POST /api/rows"
              description="Create columns for each person field, then import all people as rows."
              curl={`# Create columns (one call each)\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/columns \\\n  -d '{"tableId":"PEOPLE_TABLE_ID","name":"Full Name","type":"text"}'\n# ... repeat for: First Name, Last Name, Job Title, Company Domain, Location, LinkedIn\n\n# Import rows\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"tableId":"PEOPLE_TABLE_ID","rows":[{"COL_FULLNAME":{"value":"Budi Santoso"},"COL_DOMAIN":{"value":"majujaya.id"},"COL_TITLE":{"value":"CMO"}}]}'`}
              notes={[
                'Save all column IDs — especially Full Name, Company Domain (needed for email finder)',
                'Save all returned row IDs (needed for email finder)',
              ]} />

            <WorkflowStep step={10} title="Use Lookup to pull company info into People sheet" endpoint="POST /api/lookup/run"
              description="VLOOKUP: match Company Domain in People sheet against Domain in Companies sheet, pull in Industry, Size, etc."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/lookup/run \\\n  -d '{"tableId":"PEOPLE_TABLE_ID","sourceTableId":"COMPANIES_TABLE_ID","inputColumnId":"PEOPLE_DOMAIN_COL","matchColumnId":"COMPANIES_DOMAIN_COL","returnColumnId":"COMPANIES_INDUSTRY_COL","newColumnName":"Company Industry"}'`}
              notes={[
                'Run this once per field you want to pull (Industry, Size, etc.)',
                'Matching is case-insensitive and trims whitespace',
                'Creates a new column in the People sheet if newColumnName is provided',
                'Or writes to targetColumnId if you already created the column',
              ]} />

            <WorkflowStep step={11} title="Find emails for all people" endpoint="POST /api/find-email/run"
              description="Use Ninjer API to find professional emails for each person using their name + company domain."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/find-email/run \\\n  -d '{"tableId":"PEOPLE_TABLE_ID","rowIds":["row-1","row-2"],"inputMode":"full_name","fullNameColumnId":"COL_FULLNAME","domainColumnId":"COL_DOMAIN"}'`}
              notes={[
                'inputMode: "full_name" uses one column, "first_last" uses separate first/last name columns',
                'domainColumnId must point to clean domains (no protocol, no www)',
                'Processes 2 concurrent requests with 100ms delay. 90s timeout per call',
                'Automatically creates "Email" and "Email Status" columns if not specified',
                'Or pass emailColumnId / emailStatusColumnId to use existing columns',
                'Response: { processedCount, foundCount, errorCount }',
                'For large lists (500+ rows), this can take several minutes',
              ]} />

            <WorkflowStep step={12} title="Clean up: remove rows without emails" endpoint="GET /api/rows + DELETE /api/rows"
              description="Filter out people where email wasn't found, leaving only actionable contacts."
              curl={`# Get rows where Email is empty\ncurl -H "${H}" "${B}/api/rows?tableId=PEOPLE_TABLE_ID&filters=%5B%7B%22columnId%22%3A%22EMAIL_COL_ID%22%2C%22operator%22%3A%22is_empty%22%7D%5D"\n\n# Delete them\ncurl -X DELETE -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"ids":["row-3","row-7"],"tableId":"PEOPLE_TABLE_ID"}'`}
              notes={[
                'Final table now has: Name, Title, Company, Domain, Email — ready for outreach',
                'Alternatively, filter for email status "found" only to get highest confidence matches',
              ]} />

            <WorkflowStep step={13} title="(Optional) AI enrich for personalization" endpoint="POST /api/enrichment/run"
              description="Use AI to generate personalized intro lines, research notes, or any custom data point for each contact."
              curl={`# First create enrichment config\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/enrichment \\\n  -d '{"name":"Personalized Intro","model":"gpt-5-mini","prompt":"Write a 1-sentence personalized cold email opener for {{Full Name}}, who is {{Job Title}} at a company in the {{Company Industry}} industry. Reference their role specifically.","inputColumns":["FULLNAME_COL","TITLE_COL","INDUSTRY_COL"],"outputFormat":"text","temperature":0.8}'\n\n# Then run it\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/enrichment/run \\\n  -d '{"configId":"CONFIG_ID","tableId":"PEOPLE_TABLE_ID","targetColumnId":"INTRO_COL","rowIds":["row-1","row-2"]}'`}
              notes={[
                'Use {{Column Name}} syntax in prompts to reference row data',
                'Models: gpt-5-mini (fast/cheap), gpt-4.1-mini (balanced), gpt-4o (best quality)',
                'Monitor progress: GET /api/jobs/status or GET /api/columns/{id}/progress',
                'For large batches (1000+), use POST /api/enrichment/batch for async processing',
              ]} />

            <WorkflowStep step={14} title="Export final list" endpoint="GET /api/export/csv"
              description="Download the final email list as CSV, or read all rows via API."
              curl={`# Export as CSV file\ncurl -H "${H}" "${B}/api/export/csv?tableId=PEOPLE_TABLE_ID" -o cmo-emails.csv\n\n# Or get as JSON\ncurl -H "${H}" "${B}/api/rows?tableId=PEOPLE_TABLE_ID"`}
              notes={[
                'CSV includes all visible columns',
                'JSON response includes full cell data with status metadata',
              ]} />
          </div>

          {/* Workflow 2: People in a location (no companies) */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/80 mt-6 mb-2">Workflow: &quot;Find [role] people in [location] and get their emails&quot;</h3>
            <p className="text-xs text-white/40 mb-3">Direct people search — no company step needed. Example: &quot;Find marketing managers in Singapore&quot;</p>

            <WorkflowStep step={1} title="Create workbook" endpoint="POST /api/projects"
              description="Create a workbook to hold the campaign."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/projects \\\n  -d '{"name":"Singapore Marketing Managers","type":"workbook"}'`}
              notes={['Save workbookId from response']} />

            <WorkflowStep step={2} title="Search people directly (no domains)" endpoint="POST /api/add-data/search"
              description="Search Clay for people across all companies. Omit the domains field entirely — this triggers cross-company search mode."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/add-data/search \\\n  -d '{"searchType":"people","filters":{"job_title_keywords":["Marketing Manager","Head of Marketing","Marketing Director"],"job_title_mode":"smart","seniority_levels":["manager","director","senior"],"countries_include":["Singapore"],"limit":500}}'`}
              notes={[
                'No "domains" field = searches across ALL companies',
                'Each result includes company_domain — needed for email finding later',
                'Combine multiple title variations for broader coverage',
                'job_title_mode "smart" catches abbreviations and similar titles',
              ]} />

            <WorkflowStep step={3} title="Create sheet + columns + import" endpoint="POST /api/tables + POST /api/columns + POST /api/rows"
              description="Create a People sheet, add columns for each field, then bulk import all search results."
              curl={`# Create sheet\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables -d '{"projectId":"WORKBOOK_ID","name":"People"}'\n\n# Create columns (repeat per field)\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/columns -d '{"tableId":"TABLE_ID","name":"Full Name","type":"text"}'\n# Also: First Name, Last Name, Job Title, Company Domain (url), Location, LinkedIn (url)\n\n# Import rows\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"tableId":"TABLE_ID","rows":[{"COL_FULLNAME":{"value":"Wei Lin"},"COL_DOMAIN":{"value":"company.sg"},"COL_TITLE":{"value":"Marketing Manager"}}]}'`}
              notes={[
                'Save every column ID — you need Full Name + Company Domain for email finding',
                'Save all returned row IDs for the find-email step',
              ]} />

            <WorkflowStep step={4} title="Find emails" endpoint="POST /api/find-email/run"
              description="Find professional emails using name + company domain."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/find-email/run \\\n  -d '{"tableId":"TABLE_ID","rowIds":["row-1","row-2"],"inputMode":"full_name","fullNameColumnId":"COL_FULLNAME","domainColumnId":"COL_DOMAIN"}'`}
              notes={[
                'Automatically creates Email + Email Status columns',
                'Rate: 2 concurrent requests, 100ms delay, 90s timeout per call',
                'For 500 people, expect ~4-5 minutes',
              ]} />

            <WorkflowStep step={5} title="Clean up and export" endpoint="GET /api/rows + DELETE /api/rows + GET /api/export/csv"
              description="Remove rows without emails, then export the clean list."
              curl={`# Filter rows with no email\ncurl -H "${H}" "${B}/api/rows?tableId=TABLE_ID&filters=%5B%7B%22columnId%22%3A%22EMAIL_COL%22%2C%22operator%22%3A%22is_empty%22%7D%5D"\n\n# Delete those rows\ncurl -X DELETE -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows -d '{"ids":["row-3","row-7"],"tableId":"TABLE_ID"}'\n\n# Export\ncurl -H "${H}" "${B}/api/export/csv?tableId=TABLE_ID" -o marketing-managers.csv`}
              notes={['5 steps total. No companies sheet needed — straightforward pipeline']} />
          </div>

          {/* Workflow 3: Find companies only */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/80 mt-6 mb-2">Workflow: &quot;Find companies matching [criteria]&quot;</h3>
            <p className="text-xs text-white/40 mb-3">Company search only — no people, no emails. Example: &quot;Find SaaS companies in Germany with 200+ employees&quot;</p>

            <WorkflowStep step={1} title="Create workbook" endpoint="POST /api/projects"
              description="Create a workbook for the company list."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/projects -d '{"name":"German SaaS Companies","type":"workbook"}'`} />

            <WorkflowStep step={2} title="Search companies" endpoint="POST /api/add-data/search"
              description="Search Clay for companies. Use filters to narrow by location, size, industry, revenue, tech stack, etc."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/add-data/search \\\n  -d '{"searchType":"companies","filters":{"country_names":["Germany"],"industries":["Software Development","Information Technology"],"semantic_description":"SaaS software as a service","minimum_member_count":200,"limit":1000}}'`}
              notes={[
                'semantic_description is a natural language AI search — great for "SaaS", "B2B fintech", etc.',
                'Stack filters: industry + location + size + keywords for precision',
                'Returns: name, domain, size, industry, country, location, linkedin_url, description, annual_revenue',
              ]} />

            <WorkflowStep step={3} title="Create sheet + columns + import" endpoint="POST /api/tables + POST /api/columns + POST /api/rows"
              description="Create a Companies sheet with all relevant columns and import the results."
              curl={`# Create sheet\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables -d '{"projectId":"WORKBOOK_ID","name":"Companies"}'\n\n# Columns: Company Name, Domain, Size, Industry, Location, LinkedIn, Description, Revenue\n# Import all results as rows`}
              notes={[
                'Map all fields from search results to columns',
                'That is it — 3 steps for a pure company list',
              ]} />

            <WorkflowStep step={4} title="(Optional) AI enrich for deeper research" endpoint="POST /api/enrichment/run"
              description="Use AI to research each company further — competitors, tech stack, recent news, funding, etc."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/enrichment \\\n  -d '{"name":"Company Deep Dive","model":"gpt-5-mini","prompt":"Research {{Company Name}} ({{Domain}}). Return: 1) Main product/service 2) Key competitors 3) Recent funding or news 4) Target customer segment","inputColumns":["NAME_COL","DOMAIN_COL"],"outputFormat":"json","temperature":0.3}'`}
              notes={[
                'Use outputColumns to auto-create separate columns for each data point',
                'Or use POST /api/enrichment/extract-datapoint after to split the enrichment data',
              ]} />
          </div>

          {/* Workflow 4: Research existing list */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/80 mt-6 mb-2">Workflow: &quot;I have a list — enrich it and find emails&quot;</h3>
            <p className="text-xs text-white/40 mb-3">When you already have a CSV or list of companies/people and need to add data. Example: &quot;Here&apos;s my CRM export, find missing emails and research each company.&quot;</p>

            <WorkflowStep step={1} title="Create workbook + sheet" endpoint="POST /api/projects + POST /api/tables"
              description="Create workspace and a sheet for the imported data."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/projects -d '{"name":"CRM Enrichment","type":"workbook"}'\n\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables -d '{"projectId":"WORKBOOK_ID","name":"Leads"}'`} />

            <WorkflowStep step={2} title="Import existing data" endpoint="POST /api/import/csv or POST /api/rows"
              description="Import from CSV with column mapping, or build rows from structured data."
              curl={`# Option A: CSV import (auto-creates columns)\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/import/csv \\\n  -d '{"tableId":"TABLE_ID","data":[{"Name":"John Smith","Company":"Stripe","Domain":"stripe.com","Title":"VP Sales"}]}'\n\n# Option B: Structured rows (requires columns to exist first)\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"tableId":"TABLE_ID","rows":[{"COL_NAME":{"value":"John Smith"},"COL_DOMAIN":{"value":"stripe.com"}}]}'`}
              notes={[
                'CSV import auto-creates columns from headers if they do not exist',
                'CSV import auto-detects column types (email, url, number, text)',
                'For structured data, create columns first with POST /api/columns',
              ]} />

            <WorkflowStep step={3} title="AI enrich missing fields" endpoint="POST /api/enrichment"
              description="Fill in gaps: research companies, find titles, generate descriptions."
              curl={`# Create enrichment config for company research\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/enrichment \\\n  -d '{"name":"Fill Gaps","model":"gpt-5-mini","prompt":"Given {{Name}} at {{Company}} ({{Domain}}), find: 1) Their current job title 2) Company industry 3) Company size estimate. Return as JSON.","inputColumns":["NAME_COL","COMPANY_COL","DOMAIN_COL"],"outputColumns":["Job Title","Industry","Company Size"],"outputFormat":"json","temperature":0.3}'\n\n# Run on rows missing data\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/enrichment/run \\\n  -d '{"configId":"CONFIG_ID","tableId":"TABLE_ID","targetColumnId":"ENRICH_COL","rowIds":["row-1"],"onlyEmpty":true}'`}
              notes={[
                'onlyEmpty: true skips rows that already have data — only fills gaps',
                'For 1000+ rows, use POST /api/enrichment/batch for async processing (cheaper, 1-24hr)',
                'Monitor: GET /api/jobs/status for ETA',
              ]} />

            <WorkflowStep step={4} title="Find emails for rows missing them" endpoint="POST /api/find-email/run"
              description="Run email finder only on rows where email is empty."
              curl={`# First get rows with empty email\ncurl -H "${H}" "${B}/api/rows?tableId=TABLE_ID&filters=%5B%7B%22columnId%22%3A%22EMAIL_COL%22%2C%22operator%22%3A%22is_empty%22%7D%5D"\n\n# Run email finder on those rows only\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/find-email/run \\\n  -d '{"tableId":"TABLE_ID","rowIds":["row-ids-from-filter"],"inputMode":"full_name","fullNameColumnId":"NAME_COL","domainColumnId":"DOMAIN_COL"}'`}
              notes={[
                'Filter first to avoid re-processing rows that already have emails',
                'If you have separate first/last name columns, use inputMode: "first_last"',
              ]} />

            <WorkflowStep step={5} title="Export enriched data" endpoint="GET /api/export/csv"
              description="Download the complete enriched dataset."
              curl={`curl -H "${H}" "${B}/api/export/csv?tableId=TABLE_ID" -o enriched-leads.csv`} />
          </div>

          {/* Workflow 5: Cross-reference two datasets */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/80 mt-6 mb-2">Workflow: &quot;Cross-reference list A with list B&quot;</h3>
            <p className="text-xs text-white/40 mb-3">Connect data between two sheets using a shared key. Example: &quot;I have a company list and a people list — connect them by domain.&quot;</p>

            <WorkflowStep step={1} title="Import both datasets into separate sheets" endpoint="POST /api/tables + POST /api/import/csv"
              description="Create two sheets in the same workbook and import each dataset."
              curl={`# Sheet 1: Companies\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables -d '{"projectId":"WORKBOOK_ID","name":"Companies"}'\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/import/csv -d '{"tableId":"COMPANIES_TABLE","data":[...]}'\n\n# Sheet 2: People\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables -d '{"projectId":"WORKBOOK_ID","name":"People"}'\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/import/csv -d '{"tableId":"PEOPLE_TABLE","data":[...]}'`}
              notes={[
                'Both sheets must be in the same workbook for Lookup to work',
                'Identify the shared key column (usually domain, email, or company name)',
              ]} />

            <WorkflowStep step={2} title="Run Lookup to pull data across sheets" endpoint="POST /api/lookup/run"
              description="VLOOKUP: match rows between sheets and pull fields. Run once per field you want to transfer."
              curl={`# Pull Industry from Companies → People (match by domain)\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/lookup/run \\\n  -d '{"tableId":"PEOPLE_TABLE","sourceTableId":"COMPANIES_TABLE","inputColumnId":"PEOPLE_DOMAIN_COL","matchColumnId":"COMPANIES_DOMAIN_COL","returnColumnId":"COMPANIES_INDUSTRY_COL","newColumnName":"Company Industry"}'\n\n# Pull Revenue\ncurl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/lookup/run \\\n  -d '{"tableId":"PEOPLE_TABLE","sourceTableId":"COMPANIES_TABLE","inputColumnId":"PEOPLE_DOMAIN_COL","matchColumnId":"COMPANIES_DOMAIN_COL","returnColumnId":"COMPANIES_REVENUE_COL","newColumnName":"Company Revenue"}'`}
              notes={[
                'Run ONCE per field you want to pull (Industry, Size, Revenue = 3 calls)',
                'Matching is case-insensitive and trims whitespace',
                'newColumnName creates the column automatically',
                'Or use targetColumnId if the column already exists',
                'Unmatched rows get empty strings — filter them later if needed',
              ]} />
          </div>

          {/* Workflow 6: Formula-based data cleaning */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white/80 mt-6 mb-2">Workflow: &quot;Clean and transform my data&quot;</h3>
            <p className="text-xs text-white/40 mb-3">Use formulas for data transformations — no AI cost, runs instantly. Example: &quot;Extract domains from email addresses, combine first+last name.&quot;</p>

            <WorkflowStep step={1} title="Extract domain from email" endpoint="POST /api/formula/run"
              description="Create a formula column that extracts the domain part of an email address."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/formula/run \\\n  -d '{"tableId":"TABLE_ID","formula":"{{Email}}?.split(\\\"@\\\")[1] || \\\"\\\"","outputColumnName":"Domain"}'`}
              notes={[
                'Formula uses {{Column Name}} syntax to reference other columns',
                'Supports JavaScript expressions, lodash (_), and FormulaJS functions',
                'Runs instantly — no AI cost',
              ]} />

            <WorkflowStep step={2} title="Combine first + last name" endpoint="POST /api/formula/run"
              description="Create a full name column from separate first/last name fields."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/formula/run \\\n  -d '{"tableId":"TABLE_ID","formula":"[{{First Name}}, {{Last Name}}].filter(Boolean).join(\\\" \\\")","outputColumnName":"Full Name"}'`} />

            <WorkflowStep step={3} title="Clean URLs (strip protocol)" endpoint="POST /api/formula/run"
              description="Remove https://, http://, www. from URLs to get clean domains."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/formula/run \\\n  -d '{"tableId":"TABLE_ID","formula":"({{Website}} || \\\"\\\").replace(/^https?:\\\\/\\\\//,\\\"\\\").replace(/^www\\\\./,\\\"\\\").replace(/\\\\/.*/,\\\"\\\")","outputColumnName":"Clean Domain"}'`} />

            <WorkflowStep step={4} title="Conditional logic" endpoint="POST /api/formula/run"
              description="Tag or categorize rows based on conditions."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/formula/run \\\n  -d '{"tableId":"TABLE_ID","formula":"Number({{Employee Count}}) > 500 ? \\\"Enterprise\\\" : Number({{Employee Count}}) > 50 ? \\\"Mid-Market\\\" : \\\"SMB\\\"","outputColumnName":"Segment"}'`}
              notes={[
                'Use Number() to cast text to numbers for comparison',
                'Ternary operator for if/else logic',
                'Can reference multiple columns in one formula',
              ]} />

            <WorkflowStep step={5} title="AI-generated formula" endpoint="POST /api/formula/generate"
              description="Describe what you want in plain English and let AI write the formula."
              curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/formula/generate \\\n  -d '{"description":"Extract the first word from the job title to get the seniority level","columns":[{"name":"Job Title","type":"text","sampleValue":"Senior VP of Marketing"}]}'`}
              notes={[
                'Returns { formula: "..." } — review before running',
                'Pass sample values so the AI can test its formula',
              ]} />
          </div>

          {/* ═══════════════ BEST PRACTICES ═══════════════ */}
          <div className="p-4 bg-lavender/5 border border-lavender/15 rounded-xl space-y-2 mt-8">
            <h2 className="text-lg font-semibold text-white">Best Practices &amp; Agent Optimization</h2>
            <p className="text-sm text-white/50">Rules and patterns for the AI agent to always follow.</p>
          </div>

          {/* Decision routing */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">1. Routing: Which workflow to use</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">User says companies + people + emails</span> → Workflow 1 (full pipeline). &quot;Find SaaS companies in Berlin and get their CTOs&apos; emails&quot;</p>
              <p><span className="text-white/70 font-medium">User says people + emails, no company criteria</span> → Workflow 2 (people-direct). &quot;Find marketing managers in Singapore&quot;</p>
              <p><span className="text-white/70 font-medium">User says companies only</span> → Workflow 3 (companies only). &quot;List all fintech companies in London with 100+ employees&quot;</p>
              <p><span className="text-white/70 font-medium">User provides their own data</span> → Workflow 4 (enrich existing). &quot;Here&apos;s my spreadsheet, fill in missing info and find emails&quot;</p>
              <p><span className="text-white/70 font-medium">User has two datasets to connect</span> → Workflow 5 (cross-reference). &quot;Match these companies with these contacts by domain&quot;</p>
              <p><span className="text-white/70 font-medium">User wants to transform/clean data</span> → Workflow 6 (formula). &quot;Extract domains from emails, combine first+last name&quot;</p>
              <p className="text-white/40 italic pt-1">Tip: Many requests combine workflows. &quot;Find companies in Jakarta, get their CMOs, find emails, and write personalized intros&quot; = Workflow 1 + AI enrichment at the end.</p>
            </div>
          </div>

          {/* Search strategy */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">2. Search Strategy: Getting the best results</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">Company search — use specific filters first, then broaden.</span> Start with country + industry + size. If too few results, remove the industry filter or use semantic_description instead (AI-powered fuzzy matching).</p>
              <p><span className="text-white/70 font-medium">People search — always include seniority_levels.</span> Without it, you get everyone from interns to CEOs. Match seniority to the request: &quot;decision-makers&quot; = [&quot;c-suite&quot;,&quot;vp&quot;,&quot;director&quot;], &quot;managers&quot; = [&quot;manager&quot;,&quot;senior&quot;], &quot;everyone&quot; = omit the filter.</p>
              <p><span className="text-white/70 font-medium">Job titles — use multiple variations.</span> &quot;CMO&quot; should also search [&quot;Chief Marketing Officer&quot;, &quot;CMO&quot;, &quot;VP Marketing&quot;, &quot;Head of Marketing&quot;]. Set job_title_mode to &quot;smart&quot; for fuzzy matching.</p>
              <p><span className="text-white/70 font-medium">People at companies — pass domains, not company names.</span> The domains array scopes the search to specific companies. Without it, you get results from ALL companies.</p>
              <p><span className="text-white/70 font-medium">limit_per_company prevents domination.</span> If one company has 500 engineers and another has 5, set limit_per_company: 10 to balance results.</p>
              <p><span className="text-white/70 font-medium">Company sizes use comma format.</span> Always &quot;501-1,000&quot; not &quot;501-1000&quot;. Valid values: &quot;1&quot;, &quot;2-10&quot;, &quot;11-50&quot;, &quot;51-200&quot;, &quot;201-500&quot;, &quot;501-1,000&quot;, &quot;1,001-5,000&quot;, &quot;5,001-10,000&quot;, &quot;10,001+&quot;</p>
              <p><span className="text-white/70 font-medium">For &quot;50+ employees&quot;, use minimum_member_count: 50</span> instead of listing every size range. More precise.</p>
            </div>
          </div>

          {/* Data quality */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">3. Data Quality: Always clean before processing</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">Always filter out rows with empty domains before Find Email.</span> Email finding requires a domain. Rows without one will always fail — delete them first to save time and API calls.</p>
              <p><span className="text-white/70 font-medium">Clean domains before use.</span> Domains must be bare: &quot;stripe.com&quot; not &quot;https://www.stripe.com/about&quot;. If data comes from user import, use a Formula to strip protocol/www/paths first.</p>
              <p><span className="text-white/70 font-medium">Deduplicate before expensive operations.</span> Before running Find Email or AI Enrichment, check for duplicate domains/names. Use filters: GET /api/rows with sortBy to spot duplicates, or use a formula to flag them.</p>
              <p><span className="text-white/70 font-medium">After email finding, always clean up.</span> Filter for is_empty on the Email column and delete those rows. This leaves only actionable contacts.</p>
              <p><span className="text-white/70 font-medium">Validate data at each stage.</span> After company search, check domain coverage (how many have domains). After people search, verify you got results for most domains. After email finding, check foundCount vs processedCount.</p>
            </div>
          </div>

          {/* Tool selection */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">4. Tool Selection: When to use what</h3>
            <div className="text-xs space-y-1">
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50">
                <span className="text-white/70 font-medium">Tool</span>
                <span className="text-white/70 font-medium">Use when</span>
                <span className="text-white/70 font-medium">Do NOT use when</span>
              </div>
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50 border-t border-white/5 pt-1">
                <span className="text-white/60">Add Data (Clay)</span>
                <span>Finding new companies or people you don&apos;t have yet</span>
                <span>You already have the data and just need to process it</span>
              </div>
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50 border-t border-white/5 pt-1">
                <span className="text-white/60">Find Email</span>
                <span>You have a person&apos;s full name AND their company domain</span>
                <span>You only have a name (no domain), or you want generic contact info</span>
              </div>
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50 border-t border-white/5 pt-1">
                <span className="text-white/60">Lookup</span>
                <span>Connecting data between two sheets via a shared key (domain, email, name)</span>
                <span>You need to search for new data — Lookup only matches existing records</span>
              </div>
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50 border-t border-white/5 pt-1">
                <span className="text-white/60">AI Enrichment</span>
                <span>Generating new insights: research, summaries, scoring, personalization</span>
                <span>Data already exists somewhere — try Lookup or Clay search first</span>
              </div>
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50 border-t border-white/5 pt-1">
                <span className="text-white/60">Batch Enrichment</span>
                <span>1000+ rows of AI enrichment (cheaper, runs 1-24hrs via Azure)</span>
                <span>Under 1000 rows — use real-time enrichment instead</span>
              </div>
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50 border-t border-white/5 pt-1">
                <span className="text-white/60">Formula</span>
                <span>Data transformations: split, combine, clean, convert, calculate</span>
                <span>You need external data or AI reasoning — use enrichment instead</span>
              </div>
              <div className="grid grid-cols-[120px_1fr_1fr] gap-2 text-white/50 border-t border-white/5 pt-1">
                <span className="text-white/60">Filters</span>
                <span>Narrowing down rows: find empty cells, match values, segment data</span>
                <span>You need to modify data — filters only view, use PATCH to change</span>
              </div>
            </div>
          </div>

          {/* Ordering and dependencies */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">5. Operation Order: What depends on what</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">Always create workbook → sheet → columns → rows, in that order.</span> Each step needs the ID from the previous step.</p>
              <p><span className="text-white/70 font-medium">Search BEFORE creating sheets.</span> Run the Clay search first, then create columns based on what fields the search returned. Do not guess column names upfront.</p>
              <p><span className="text-white/70 font-medium">Import data BEFORE running Find Email or Enrichment.</span> These tools operate on row IDs — the rows must exist in the database first.</p>
              <p><span className="text-white/70 font-medium">Lookup requires both sheets to have data.</span> Import the source sheet fully before running Lookup against it.</p>
              <p><span className="text-white/70 font-medium">Clean data BETWEEN steps, not just at the end.</span> Remove bad rows after company import (no domain), after people import (no name), and after email finding (no email). Each cleanup makes the next step more efficient.</p>
              <p><span className="text-white/70 font-medium">AI Enrichment and Formula can run at any time</span> after rows exist. They add new columns — they do not depend on other operations.</p>
            </div>
          </div>

          {/* Performance */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">6. Performance &amp; Timing</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">Company search:</span> 100-1000 results in 30s-2min. 5000+ results in 3-5min.</p>
              <p><span className="text-white/70 font-medium">People search:</span> Similar to company search. Up to 25,000 results. Large searches (10k+) take ~4-5 min.</p>
              <p><span className="text-white/70 font-medium">Find Email:</span> 2 concurrent, 100ms delay. ~12 emails/sec. 100 rows ≈ 8sec. 500 rows ≈ 40sec. 5000 rows ≈ 7min.</p>
              <p><span className="text-white/70 font-medium">Real-time AI Enrichment:</span> Depends on model. gpt-5-nano ~200 rows/min. gpt-5-mini ~100 rows/min. gpt-4o ~50 rows/min.</p>
              <p><span className="text-white/70 font-medium">Batch AI Enrichment:</span> 1-24 hours. 50% cheaper than real-time. Use for 1000+ rows where time is not critical.</p>
              <p><span className="text-white/70 font-medium">Formula:</span> Instant. 10,000 rows in under 2 seconds.</p>
              <p><span className="text-white/70 font-medium">Lookup:</span> Instant. Builds an in-memory hash map — 100,000 lookups in under 1 second.</p>
              <p><span className="text-white/70 font-medium">Monitoring:</span> For any operation over 100 rows, poll GET /api/jobs/status every 10-30 seconds. For cell-level detail, use GET /api/columns/{'{id}'}/progress.</p>
            </div>
          </div>

          {/* Cost optimization */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">7. Cost Optimization</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">Use Formula instead of AI when possible.</span> Extracting domains, combining names, cleaning URLs — all free with formulas. AI enrichment costs per row.</p>
              <p><span className="text-white/70 font-medium">Use gpt-5-nano for simple extractions.</span> It is the cheapest model. Use gpt-5-mini for moderate reasoning. Only use gpt-4o for complex research that needs high quality.</p>
              <p><span className="text-white/70 font-medium">Use Batch Enrichment for large jobs.</span> 50% cheaper than real-time, and does not block the API. Use POST /api/enrichment/batch for 1000+ rows.</p>
              <p><span className="text-white/70 font-medium">Filter before enriching.</span> Remove bad/irrelevant rows BEFORE running AI enrichment. Every row costs tokens — do not waste them on rows you will delete later.</p>
              <p><span className="text-white/70 font-medium">Use onlyEmpty: true when re-running.</span> POST /api/enrichment/run with onlyEmpty: true skips rows that already have data. Saves money on retries.</p>
              <p><span className="text-white/70 font-medium">Monitor costs in real-time.</span> GET /api/jobs/status returns cost.totalSoFar and cost.estimatedTotal for every active job. Cancel jobs that are too expensive: DELETE /api/enrichment/jobs?jobId=...</p>
            </div>
          </div>

          {/* Column naming conventions */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">8. Naming Conventions</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">Workbook names:</span> Describe the campaign. &quot;Jakarta CMO Campaign&quot;, &quot;Series A SaaS Companies Q2&quot;, &quot;CRM Enrichment 2026-04&quot;</p>
              <p><span className="text-white/70 font-medium">Sheet names:</span> Describe the data type. &quot;Companies&quot;, &quot;People&quot;, &quot;CMOs&quot;, &quot;Enriched Leads&quot;</p>
              <p><span className="text-white/70 font-medium">Column names:</span> Clear and consistent. Use &quot;Company Name&quot; not &quot;name&quot;. Use &quot;Company Domain&quot; not &quot;domain&quot; (avoids confusion when People sheet also has a domain column).</p>
              <p><span className="text-white/70 font-medium">Standard column sets:</span></p>
              <p className="pl-2">Companies: Company Name, Domain, Size, Industry, Country, Location, LinkedIn URL, Description, Annual Revenue</p>
              <p className="pl-2">People: First Name, Last Name, Full Name, Job Title, Company Domain, Location, LinkedIn URL, Email, Email Status</p>
            </div>
          </div>

          {/* Error handling */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">9. Error Handling</h3>
            <div className="text-xs text-white/50 space-y-2">
              <p><span className="text-white/70 font-medium">Search returns 0 results:</span> Broaden filters. Remove the most restrictive filter (often industry or company size). Try semantic_description instead of hard filters.</p>
              <p><span className="text-white/70 font-medium">Email finder has low success rate (&lt;50%):</span> Common for small/local companies. Their email patterns may not be in public databases. Consider: AI enrichment to find emails from LinkedIn profiles instead.</p>
              <p><span className="text-white/70 font-medium">AI enrichment has errors:</span> Check error samples via GET /api/columns/{'{id}'}/progress. Common issues: prompt too vague, column reference typo, rate limiting. Retry with POST /api/enrichment/retry-cell.</p>
              <p><span className="text-white/70 font-medium">Lookup has many unmatched rows:</span> Check that the matching columns use the same format. Common issue: one sheet has &quot;www.stripe.com&quot; and the other has &quot;stripe.com&quot;. Clean domains with Formula first.</p>
              <p><span className="text-white/70 font-medium">Job appears stuck:</span> Check GET /api/jobs/status. If a job shows no progress for 5+ minutes, cancel it (DELETE /api/enrichment/jobs?jobId=...) and restart.</p>
              <p><span className="text-white/70 font-medium">General 500 errors:</span> Check GET /api/stats for storage limits (9GB max). If near capacity, delete old workbooks/tables with DELETE /api/projects/{'{id}'} or GET /api/nuke-table?id=...</p>
            </div>
          </div>

          {/* Data flow diagrams */}
          <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">Data Flow Patterns</h3>
            <pre className="text-xs text-white/50 font-mono leading-relaxed">{`FULL PIPELINE (Workflow 1):
Workbook
  +-- Sheet: Companies
  |     Clay search → Import → Filter (remove no-domain)
  +-- Sheet: People
        Clay search (at domains) → Import
        ← Lookup (company data from Sheet 1)
        → Find Email → Filter (remove no-email)
        → AI Enrich (optional) → Export

PEOPLE DIRECT (Workflow 2):
Workbook
  +-- Sheet: People
        Clay search (no domains) → Import
        → Find Email → Filter → Export

COMPANIES ONLY (Workflow 3):
Workbook
  +-- Sheet: Companies
        Clay search → Import → (Optional: AI Enrich) → Export

ENRICH EXISTING (Workflow 4):
Workbook
  +-- Sheet: Imported Data
        CSV Import / API Import
        → AI Enrich (fill gaps)
        → Find Email (missing emails)
        → Export

CROSS-REFERENCE (Workflow 5):
Workbook
  +-- Sheet A: Dataset 1
  +-- Sheet B: Dataset 2
        ← Lookup (pull fields from Sheet A by shared key)

DATA CLEANING (Workflow 6):
Any Sheet:
  Formula: extract, combine, clean, convert, tag`}</pre>
          </div>
        </div>

        {/* Folders & Workbooks */}
        <Section title="Folders & Workbooks">
          <Endpoint method="GET" path="/api/projects" description="List all folders and workbooks"
            curl={`curl -H "${H}" ${B}/api/projects`}
            response={`[{"id":"...","name":"My Folder","type":"folder","tables":[...]}]`} />
          <Endpoint method="POST" path="/api/projects" description="Create folder or workbook"
            body={`{"name":"Sales Data","type":"workbook","parentId":null}`}
            curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/projects \\\n  -d '{"name":"Sales Data","type":"workbook"}'`} />
          <Endpoint method="GET" path="/api/projects/{id}" description="Get project with its sheets"
            curl={`curl -H "${H}" ${B}/api/projects/PROJECT_ID`} />
          <Endpoint method="PATCH" path="/api/projects/{id}" description="Rename or move project"
            body={`{"name":"New Name","parentId":"folder-id"}`}
            curl={`curl -X PATCH -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/projects/PROJECT_ID \\\n  -d '{"name":"Renamed"}'`} />
          <Endpoint method="DELETE" path="/api/projects/{id}" description="Delete project (cascading)"
            curl={`curl -X DELETE -H "${H}" ${B}/api/projects/PROJECT_ID`} />
        </Section>

        {/* Sheets */}
        <Section title="Sheets (Tables)">
          <Endpoint method="GET" path="/api/tables?projectId={id}" description="List sheets in a workbook"
            curl={`curl -H "${H}" "${B}/api/tables?projectId=WORKBOOK_ID"`} />
          <Endpoint method="POST" path="/api/tables" description="Create a new sheet"
            body={`{"projectId":"workbook-id","name":"Companies"}`}
            curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/tables \\\n  -d '{"projectId":"WORKBOOK_ID","name":"Sheet 1"}'`} />
          <Endpoint method="GET" path="/api/tables/{id}" description="Get sheet with columns"
            curl={`curl -H "${H}" ${B}/api/tables/TABLE_ID`} />
          <Endpoint method="PATCH" path="/api/tables/{id}" description="Rename or move sheet"
            body={`{"name":"People List"}`} />
          <Endpoint method="DELETE" path="/api/tables/{id}" description="Delete sheet (cascading)" />
        </Section>

        {/* Columns */}
        <Section title="Columns">
          <Endpoint method="GET" path="/api/columns?tableId={id}" description="List columns (ordered)"
            curl={`curl -H "${H}" "${B}/api/columns?tableId=TABLE_ID"`}
            response={`[{"id":"...","name":"Company","type":"text","width":150,"order":0}]`} />
          <Endpoint method="POST" path="/api/columns" description="Create column"
            body={`{"tableId":"table-id","name":"Domain","type":"text"}`}
            curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/columns \\\n  -d '{"tableId":"TABLE_ID","name":"Domain","type":"url"}'`} />
          <Endpoint method="PATCH" path="/api/columns/{id}" description="Update name, type, or width"
            body={`{"name":"Website","type":"url","width":200}`} />
          <Endpoint method="DELETE" path="/api/columns/{id}" description="Delete column" />
        </Section>

        {/* Rows */}
        <Section title="Rows">
          <Endpoint method="GET" path="/api/rows?tableId={id}" description="List rows with sort, filter, pagination"
            curl={`curl -H "${H}" "${B}/api/rows?tableId=TABLE_ID"`}
            response={`[{"id":"...","data":{"col-id":{"value":"Stripe"}}}]\n\nHeaders: X-Total-Count, X-Filtered-Count`}
            body={`Query params:\n  tableId (required)\n  rowIds — comma-separated IDs\n  sortBy — column ID to sort by\n  sortOrder — asc (default) | desc\n  filters — JSON array: [{"columnId":"col","operator":"contains","value":"stripe"}]\n  filterLogic — AND (default) | OR\n  limit — max rows (default 100000)\n  offset — skip rows (default 0)\n\nFilter operators:\n  equals, not_equals, contains, not_contains,\n  is_empty, is_not_empty, starts_with, ends_with,\n  greater_than, less_than, between (value: [min, max])`} />
          <Endpoint method="GET" path="/api/rows?tableId={id}&sortBy={col}&sortOrder=desc" description="Sort rows by column"
            curl={`curl -H "${H}" "${B}/api/rows?tableId=TABLE_ID&sortBy=COL_ID&sortOrder=desc"`} />
          <Endpoint method="GET" path={`/api/rows?tableId={id}&filters=[...]&filterLogic=AND`} description="Filter rows by column values"
            curl={`curl -H "${H}" "${B}/api/rows?tableId=TABLE_ID&filters=%5B%7B%22columnId%22%3A%22COL_ID%22%2C%22operator%22%3A%22contains%22%2C%22value%22%3A%22stripe%22%7D%5D"`} />
          <Endpoint method="POST" path="/api/rows" description="Create rows (bulk)"
            body={`{"tableId":"table-id","rows":[{"col-1":{"value":"Stripe"},"col-2":{"value":"stripe.com"}}]}`}
            curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"tableId":"TABLE_ID","rows":[{"COL_ID":{"value":"data"}}]}'`} />
          <Endpoint method="PATCH" path="/api/rows/{id}" description="Update single row (merge)"
            body={`{"data":{"col-id":{"value":"Updated"}}}`} />
          <Endpoint method="PATCH" path="/api/rows" description="Bulk update rows"
            body={`{"updates":[{"id":"row-1","data":{"col-id":{"value":"New"}}},{"id":"row-2","data":{"col-id":{"value":"Other"}}}]}`} />
          <Endpoint method="DELETE" path="/api/rows/{id}" description="Delete single row" />
          <Endpoint method="DELETE" path="/api/rows" description="Bulk delete rows"
            body={`{"ids":["row-1","row-2"],"tableId":"table-id"}`} />
        </Section>

        {/* Import & Export */}
        <Section title="Import & Export">
          <Endpoint method="POST" path="/api/import/csv" description="Import CSV data into table"
            body={`{"tableId":"table-id","data":[{"Name":"John","Email":"john@example.com"}]}`}
            response={`{"success":true,"rowsImported":100,"columnsCreated":2}`} />
          <Endpoint method="GET" path="/api/export/csv?tableId={id}" description="Export table as CSV"
            curl={`curl -H "${H}" "${B}/api/export/csv?tableId=TABLE_ID" -o export.csv`} />
        </Section>

        {/* AI Enrichment */}
        <Section title="AI Enrichment">
          <Endpoint method="GET" path="/api/enrichment" description="List all enrichment configs"
            curl={`curl -H "${H}" ${B}/api/enrichment`} />
          <Endpoint method="POST" path="/api/enrichment" description="Create enrichment config"
            body={`{"name":"Research","model":"gpt-5-mini","prompt":"Research {{Company}}","inputColumns":["col-id"],"outputFormat":"json","temperature":0.7}`} />
          <Endpoint method="GET" path="/api/enrichment/{id}" description="Get enrichment config" />
          <Endpoint method="PATCH" path="/api/enrichment/{id}" description="Update config"
            body={`{"prompt":"Updated prompt","temperature":0.5}`} />
          <Endpoint method="DELETE" path="/api/enrichment/{id}" description="Delete enrichment config" />
          <Endpoint method="POST" path="/api/enrichment/run" description="Run enrichment on rows (sync)"
            body={`{"configId":"config-id","tableId":"table-id","targetColumnId":"col-id","rowIds":["row-1","row-2"]}`}
            response={`{"results":[{"rowId":"...","success":true,"cost":0.001}],"totalCost":0.002}`} />
          <Endpoint method="POST" path="/api/enrichment/jobs" description="Create background enrichment job"
            body={`{"configId":"config-id","tableId":"table-id","targetColumnId":"col-id","rowIds":["row-1","row-2"]}`}
            response={`{"jobId":"...","status":"pending"}`} />
          <Endpoint method="GET" path="/api/enrichment/jobs?columnId={id}" description="List enrichment jobs"
            curl={`curl -H "${H}" "${B}/api/enrichment/jobs?columnId=COL_ID"`} />
          <Endpoint method="DELETE" path="/api/enrichment/jobs" description="Cancel enrichment jobs"
            body={`Query params (one of):\n  ?jobId={id} — Cancel specific job\n  ?columnId={id} — Cancel all jobs for column\n  ?all=true — Cancel all active jobs\n  ?resetStuck=true — Reset stuck processing cells`} />
          <Endpoint method="POST" path="/api/enrichment/batch" description="Submit batch job (async, 1-24hrs)"
            body={`{"configId":"config-id","tableId":"table-id","targetColumnId":"col-id","model":"gpt-4.1-mini"}`} />
          <Endpoint method="GET" path="/api/enrichment/batch/status?tableId={id}" description="Check batch status" />
          <Endpoint method="DELETE" path="/api/enrichment/batch/cancel?columnId={id}" description="Cancel batch job" />
          <Endpoint method="POST" path="/api/enrichment/batch/process-results" description="Manually process batch results"
            body={`{"jobId":"batch-job-id"}`} />
          <Endpoint method="POST" path="/api/enrichment/retry-cell" description="Retry single cell"
            body={`{"rowId":"row-id","columnId":"col-id","tableId":"table-id"}`} />
          <Endpoint method="POST" path="/api/enrichment/optimize-prompt" description="AI optimize prompt"
            body={`{"prompt":"Research company","columns":[{"name":"Company","type":"text"}]}`} />
          <Endpoint method="POST" path="/api/enrichment/extract-datapoint" description="Extract field to new column"
            body={`{"tableId":"table-id","sourceColumnId":"enrichment-col","dataKey":"industry"}`} />
        </Section>

        {/* Formula */}
        <Section title="Formula">
          <Endpoint method="GET" path="/api/formula" description="List all formula configs"
            curl={`curl -H "${H}" ${B}/api/formula`} />
          <Endpoint method="POST" path="/api/formula" description="Create formula config"
            body={`{"name":"Full Name","formula":"{{First Name}} + ' ' + {{Last Name}}"}`} />
          <Endpoint method="GET" path="/api/formula/{id}" description="Get formula config" />
          <Endpoint method="PATCH" path="/api/formula/{id}" description="Update formula config"
            body={`{"name":"Updated Name","formula":"new expression"}`} />
          <Endpoint method="DELETE" path="/api/formula/{id}" description="Delete formula config" />
          <Endpoint method="POST" path="/api/formula/run" description="Run formula on rows"
            body={`{"tableId":"table-id","formula":"{{First}} + ' ' + {{Last}}","outputColumnName":"Full Name"}`}
            response={`{"jobId":"...","columnId":"new-col-id"}`} />
          <Endpoint method="POST" path="/api/formula/rerun" description="Re-run existing formula"
            body={`{"columnId":"formula-col-id","formula":"updated expression"}`} />
          <Endpoint method="POST" path="/api/formula/generate" description="AI generate formula"
            body={`{"description":"Extract domain from email","columns":[{"name":"Email","type":"email","sampleValue":"john@stripe.com"}]}`}
            response={`{"formula":"{{Email}}?.split('@')[1] || ''"}`} />
          <Endpoint method="GET" path="/api/formula/run?jobId={id}" description="Check formula run progress"
            response={`{"completed":50,"total":100,"status":"running"}`} />
          <Endpoint method="GET" path="/api/formula/rerun?jobId={id}" description="Check formula rerun progress" />
        </Section>

        {/* Find Email */}
        <Section title="Find Email">
          <Endpoint method="POST" path="/api/find-email/run" description="Find emails via Ninjer API"
            body={`{"tableId":"table-id","rowIds":["row-1"],"inputMode":"full_name","fullNameColumnId":"name-col","domainColumnId":"domain-col","emailColumnId":"email-col","emailStatusColumnId":"status-col"}`}
            response={`{"processedCount":10,"foundCount":7,"errorCount":0}`} />
        </Section>

        {/* Look Up */}
        <Section title="Look Up (Cross-Sheet VLOOKUP)">
          <Endpoint method="POST" path="/api/lookup/run" description="Match rows between sheets"
            body={`{"tableId":"people-sheet","sourceTableId":"companies-sheet","inputColumnId":"people-domain-col","matchColumnId":"company-domain-col","returnColumnId":"funding-col","targetColumnId":"new-col-in-people"}`}
            response={`{"processedCount":500,"matchedCount":480,"unmatchedCount":20}`} />
        </Section>

        {/* Add Data */}
        <Section title="Add Data (Clay Search)">
          <Endpoint method="POST" path="/api/add-data/search" description="Search people (with filters)"
            body={`{"searchType":"people","domains":["stripe.com","shopify.com"],"filters":{"job_title_keywords":["Engineer","Developer"],"job_title_exclude_keywords":["Intern"],"job_title_mode":"smart","seniority_levels":["senior","c-suite","vp","director"],"job_functions":["Engineering","Sales"],"countries_include":["United States"],"company_sizes":["201-500","501-1,000"],"limit":1000,"limit_per_company":10}}`}
            response={`{"people":[{"first_name":"...","last_name":"...","job_title":"...","company_domain":"...","linkedin_url":"..."}],"totalCount":1000,"mode":"full"}`}
            curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/add-data/search \\\n  -d '{"searchType":"people","domains":["stripe.com"],"filters":{"seniority_levels":["senior"],"limit":100}}'`} />
          <Endpoint method="POST" path="/api/add-data/search" description="Search companies (with filters)"
            body={`{"searchType":"companies","filters":{"industries":["Software Development"],"sizes":["51-200","201-500"],"country_names":["United States"],"description_keywords":["AI","machine learning"],"annual_revenues":["$10M-$50M"],"limit":500}}`}
            response={`{"companies":[{"name":"...","domain":"...","industry":"...","size":"...","linkedin_url":"..."}],"totalCount":500,"mode":"full"}`} />
        </Section>

        {/* Add Data Filter Reference */}
        <div className="p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-4">
          <h3 className="text-sm font-semibold text-white">Add Data — People Search Filters</h3>
          <div className="grid grid-cols-1 gap-3 text-xs">
            <div>
              <p className="text-white/40 font-medium mb-1">Job & Role</p>
              <code className="text-white/60 block">job_title_keywords (string[]), job_title_exclude_keywords (string[]), job_title_mode (&quot;smart&quot;|&quot;contain&quot;|&quot;exact&quot;), seniority_levels (string[]), job_functions (string[]), job_description_keywords (string[])</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Location</p>
              <code className="text-white/60 block">countries_include/exclude, states_include/exclude, cities_include/exclude, regions_include/exclude (all string[]), search_raw_location (bool)</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Company</p>
              <code className="text-white/60 block">company_sizes (string[]: &quot;1&quot;,&quot;2-10&quot;,&quot;11-50&quot;,&quot;51-200&quot;,&quot;201-500&quot;,&quot;501-1,000&quot;,&quot;1,001-5,000&quot;,&quot;5,001-10,000&quot;,&quot;10,001+&quot;), company_industries_include/exclude (string[]), company_description_keywords/exclude (string[])</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Profile</p>
              <code className="text-white/60 block">headline_keywords, about_keywords, profile_keywords, certification_keywords, school_names, languages, names (all string[])</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Experience & Connections</p>
              <code className="text-white/60 block">connection_count, max_connection_count, follower_count, max_follower_count, experience_count, max_experience_count, current_role_min_months, current_role_max_months (all number), include_past_experiences (bool)</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Results</p>
              <code className="text-white/60 block">limit (number, max 25000), limit_per_company (number)</code>
            </div>
          </div>
          <h3 className="text-sm font-semibold text-white pt-2">Add Data — Company Search Filters</h3>
          <div className="grid grid-cols-1 gap-3 text-xs">
            <div>
              <p className="text-white/40 font-medium mb-1">Identity & Industry</p>
              <code className="text-white/60 block">company_identifier (string[]), types (string[]: &quot;Public&quot;,&quot;Privately Held&quot;,&quot;Non-Profit&quot;), derived_business_types (string[]), industries/industries_exclude (string[]), derived_industries, derived_subindustries/exclude, derived_revenue_streams (string[]), semantic_description (string)</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Size & Location</p>
              <code className="text-white/60 block">sizes (string[]), minimum_member_count, maximum_member_count, minimum_follower_count (number), country_names/exclude, locations/exclude (string[])</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Keywords, Financials & Tech</p>
              <code className="text-white/60 block">description_keywords/exclude (string[]), annual_revenues, funding_amounts (string[]), technographics_main_categories, technographics_parent_categories, technographics_products, technographics_vendors (string[])</code>
            </div>
            <div>
              <p className="text-white/40 font-medium mb-1">Results</p>
              <code className="text-white/60 block">limit (number, max 25000)</code>
            </div>
          </div>
        </div>

        {/* Monitoring */}
        <Section title="Job Monitoring & Progress">
          <Endpoint method="GET" path="/api/jobs/status" description="All active jobs with ETA, cost, throughput"
            curl={`curl -H "${H}" ${B}/api/jobs/status`}
            response={`{"activeJobs":[{"type":"enrichment","tableName":"People","columnName":"AI Research","status":"running","progress":{"total":10000,"completed":3200,"errors":12,"percentComplete":32},"timing":{"rowsPerMinute":160,"estimatedRemainingSeconds":2550},"cost":{"totalSoFar":1.24,"estimatedTotal":3.87}}],"summary":{"totalActiveJobs":1,"totalRowsCompleted":3200}}`} />
          <Endpoint method="GET" path="/api/jobs/status?tableId={id}" description="Active jobs filtered by table" />
          <Endpoint method="GET" path="/api/jobs/status?columnId={id}" description="Active jobs filtered by column" />
          <Endpoint method="GET" path="/api/columns/{id}/progress" description="Cell-level status counts for a column"
            curl={`curl -H "${H}" ${B}/api/columns/COLUMN_ID/progress`}
            response={`{"columnName":"AI Research","totalRows":10000,"cellStatuses":{"complete":3200,"processing":50,"pending":6738,"error":12,"empty":0},"timing":{"rowsPerMinute":160,"estimatedRemainingSeconds":2550},"errors":{"count":12,"samples":[{"rowId":"...","error":"API timeout"}]}}`} />
        </Section>

        {/* Stats */}
        <Section title="Stats">
          <Endpoint method="GET" path="/api/stats" description="Storage and resource counts"
            curl={`curl -H "${H}" ${B}/api/stats`}
            response={`{"counts":{"projects":5,"tables":12,"rows":5000},"storage":{"estimatedMB":2.38,"maxGB":9}}`} />
        </Section>

        {/* Admin & Debug */}
        <Section title="Admin & Debug">
          <Endpoint method="GET" path="/api/admin/batch-status" description="All batch jobs with Azure sync comparison"
            curl={`curl -H "${H}" ${B}/api/admin/batch-status`} />
          <Endpoint method="GET" path="/api/admin/batch-debug?jobId={id}" description="Debug batch job cell states" />
          <Endpoint method="POST" path="/api/admin/batch-debug?jobId={id}" description="Force update stuck job to error" />
          <Endpoint method="POST" path="/api/admin/batch-force-sync?jobId={id}" description="Force-sync batch job with Azure" />
          <Endpoint method="POST" path="/api/admin/batch-mark-complete?jobId={id}" description="Force mark batch job complete" />
          <Endpoint method="POST" path="/api/admin/batch-mark-error?jobId={id}&error={msg}" description="Force mark batch job as error" />
        </Section>

        {/* Cron */}
        <Section title="Cron & Background Processing">
          <Endpoint method="GET" path="/api/cron/process-enrichment" description="Process pending enrichment jobs" />
          <Endpoint method="GET" path="/api/cron/process-batch" description="Poll Azure batch jobs and process completions" />
          <Endpoint method="GET" path="/api/cron/complete-job?jobId={id}" description="Force complete stuck enrichment job" />
        </Section>

        {/* Maintenance */}
        <Section title="Maintenance">
          <Endpoint method="GET" path="/api/nuke-table?id={tableId}" description="Delete table and ALL associated data (irreversible)"
            curl={`curl -H "${H}" "${B}/api/nuke-table?id=TABLE_ID"`} />
        </Section>

        {/* Data Types Reference */}
        <div className="mt-12 p-4 bg-white/[0.03] border border-white/10 rounded-xl space-y-3">
          <h2 className="text-lg font-semibold text-white">Reference</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-white/40 text-xs font-medium mb-1">Column Types</p>
              <code className="text-white/60">text, number, email, url, date, enrichment, formula</code>
            </div>
            <div>
              <p className="text-white/40 text-xs font-medium mb-1">Cell Statuses</p>
              <code className="text-white/60">complete, error, processing, pending, batch_submitted, batch_processing</code>
            </div>
            <div>
              <p className="text-white/40 text-xs font-medium mb-1">Project Types</p>
              <code className="text-white/60">folder, workbook, table</code>
            </div>
            <div>
              <p className="text-white/40 text-xs font-medium mb-1">AI Models</p>
              <code className="text-white/60">gpt-5-mini, gpt-5-nano, gpt-4.1-mini, gpt-4o, deepseek-chat</code>
            </div>
            <div>
              <p className="text-white/40 text-xs font-medium mb-1">Filter Operators</p>
              <code className="text-white/60">equals, not_equals, contains, not_contains, is_empty, is_not_empty, starts_with, ends_with, greater_than, less_than, between</code>
            </div>
            <div>
              <p className="text-white/40 text-xs font-medium mb-1">Filter JSON Format</p>
              <code className="text-white/60">{`[{"columnId":"col-id","operator":"contains","value":"term"}]`}</code>
            </div>
          </div>
        </div>

        <div className="h-12" />
      </main>
    </div>
  );
}
