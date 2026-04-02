'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Check, ChevronDown } from 'lucide-react';

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

export default function APIDocsPage() {
  const router = useRouter();
  const H = `Authorization: Bearer YOUR_API_KEY`;
  const B = BASE_URL;

  return (
    <div className="min-h-screen bg-[#0d0d39] text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-midnight/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => router.push('/')} className="text-white/70 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">DataFlow API Documentation</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-2">
        {/* Auth */}
        <div className="p-4 bg-lavender/10 border border-lavender/20 rounded-xl space-y-3">
          <h2 className="text-lg font-semibold text-white">Authentication</h2>
          <p className="text-sm text-white/60">All requests require a Bearer token:</p>
          <div className="flex items-center gap-2">
            <pre className="text-sm text-lavender bg-black/20 rounded-lg px-3 py-2 font-mono flex-1">Authorization: Bearer YOUR_API_KEY</pre>
            <CopyButton text="Authorization: Bearer YOUR_API_KEY" />
          </div>
          <pre className="text-xs text-emerald-400/80 bg-black/20 rounded-lg p-3 font-mono">
{`curl -H "${H}" ${B}/api/stats`}
          </pre>
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
          <Endpoint method="GET" path="/api/rows?tableId={id}" description="List all rows"
            curl={`curl -H "${H}" "${B}/api/rows?tableId=TABLE_ID"`}
            response={`[{"id":"...","data":{"col-id":{"value":"Stripe"}}}]`} />
          <Endpoint method="POST" path="/api/rows" description="Create rows (bulk)"
            body={`{"tableId":"table-id","rows":[{"col-1":{"value":"Stripe"},"col-2":{"value":"stripe.com"}}]}`}
            curl={`curl -X POST -H "${H}" -H "Content-Type: application/json" \\\n  ${B}/api/rows \\\n  -d '{"tableId":"TABLE_ID","rows":[{"COL_ID":{"value":"data"}}]}'`} />
          <Endpoint method="PATCH" path="/api/rows/{id}" description="Update single row (merge)"
            body={`{"data":{"col-id":{"value":"Updated"}}}`} />
          <Endpoint method="PATCH" path="/api/rows" description="Bulk update rows"
            body={`{"updates":[{"id":"row-1","data":{"col-id":{"value":"New"}}},{"id":"row-2","data":{"col-id":{"value":"Other"}}}]}`} />
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
          <Endpoint method="POST" path="/api/enrichment" description="Create enrichment config"
            body={`{"name":"Research","model":"gpt-5-mini","prompt":"Research {{Company}}","inputColumns":["col-id"],"outputFormat":"json","temperature":0.7}`} />
          <Endpoint method="GET" path="/api/enrichment/{id}" description="Get enrichment config" />
          <Endpoint method="PATCH" path="/api/enrichment/{id}" description="Update config"
            body={`{"prompt":"Updated prompt","temperature":0.5}`} />
          <Endpoint method="POST" path="/api/enrichment/run" description="Run enrichment on rows (sync)"
            body={`{"configId":"config-id","tableId":"table-id","targetColumnId":"col-id","rowIds":["row-1","row-2"]}`}
            response={`{"results":[{"rowId":"...","success":true,"cost":0.001}],"totalCost":0.002}`} />
          <Endpoint method="POST" path="/api/enrichment/batch" description="Submit batch job (async, 1-24hrs)"
            body={`{"configId":"config-id","tableId":"table-id","targetColumnId":"col-id","model":"gpt-4.1-mini"}`} />
          <Endpoint method="GET" path="/api/enrichment/batch/status?tableId={id}" description="Check batch status" />
          <Endpoint method="DELETE" path="/api/enrichment/batch/cancel?columnId={id}" description="Cancel batch job" />
          <Endpoint method="POST" path="/api/enrichment/retry-cell" description="Retry single cell"
            body={`{"rowId":"row-id","columnId":"col-id","tableId":"table-id"}`} />
          <Endpoint method="POST" path="/api/enrichment/optimize-prompt" description="AI optimize prompt"
            body={`{"prompt":"Research company","columns":[{"name":"Company","type":"text"}]}`} />
          <Endpoint method="POST" path="/api/enrichment/extract-datapoint" description="Extract field to new column"
            body={`{"tableId":"table-id","sourceColumnId":"enrichment-col","dataKey":"industry"}`} />
          <Endpoint method="GET" path="/api/enrichment/jobs?columnId={id}" description="List enrichment jobs" />
        </Section>

        {/* Formula */}
        <Section title="Formula">
          <Endpoint method="POST" path="/api/formula" description="Create formula config"
            body={`{"name":"Full Name","formula":"{{First Name}} + ' ' + {{Last Name}}"}`} />
          <Endpoint method="POST" path="/api/formula/run" description="Run formula on rows"
            body={`{"tableId":"table-id","formula":"{{First}} + ' ' + {{Last}}","outputColumnName":"Full Name"}`}
            response={`{"jobId":"...","columnId":"new-col-id"}`} />
          <Endpoint method="POST" path="/api/formula/rerun" description="Re-run existing formula"
            body={`{"columnId":"formula-col-id","formula":"updated expression"}`} />
          <Endpoint method="POST" path="/api/formula/generate" description="AI generate formula"
            body={`{"description":"Extract domain from email","columns":[{"name":"Email","type":"email","sampleValue":"john@stripe.com"}]}`}
            response={`{"formula":"{{Email}}?.split('@')[1] || ''"}`} />
          <Endpoint method="GET" path="/api/formula/run?jobId={id}" description="Check formula progress"
            response={`{"completed":50,"total":100,"status":"running"}`} />
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
          <Endpoint method="POST" path="/api/add-data/search" description="Search people or companies"
            body={`{"searchType":"people","domains":["stripe.com"],"filters":{"job_title_keywords":["Engineer"],"seniority_levels":["senior"],"limit":100}}`}
            response={`{"people":[{"first_name":"...","last_name":"...","job_title":"...","company_domain":"...","linkedin_url":"..."}],"totalCount":100,"mode":"full"}`} />
        </Section>

        {/* Stats */}
        <Section title="Stats">
          <Endpoint method="GET" path="/api/stats" description="Storage and resource counts"
            curl={`curl -H "${H}" ${B}/api/stats`}
            response={`{"counts":{"projects":5,"tables":12,"rows":5000},"storage":{"estimatedMB":2.38,"maxGB":9}}`} />
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
          </div>
        </div>

        <div className="h-12" />
      </main>
    </div>
  );
}
