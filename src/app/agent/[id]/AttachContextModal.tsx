'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, FolderOpen, Upload, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

export interface AttachedCsv {
  name: string;
  headers: string[];
  rowCount: number;
  rows: Array<Record<string, string | number | null>>;
}

export interface AttachedWorkbook {
  id: string;
  name: string;
  sheetCount: number;
}

interface AttachContextModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAttachWorkbook: (wb: AttachedWorkbook) => void;
  onAttachCsv: (csv: AttachedCsv) => void;
}

interface ProjectNode {
  id: string;
  name: string;
  type: 'folder' | 'workbook' | 'table';
  children?: ProjectNode[];
  tables?: Array<{ id: string; name: string }>;
}

const MAX_CSV_ROWS = 10000;

export function AttachContextModal({ isOpen, onClose, onAttachWorkbook, onAttachCsv }: AttachContextModalProps) {
  const [tab, setTab] = useState<'workbook' | 'csv'>('workbook');

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" title="Attach context" description="Start the plan from an existing workbook or a CSV.">
      <div className="border-b border-white/10 -mt-4 -mx-4 px-4 mb-4 flex gap-1">
        <TabButton active={tab === 'workbook'} onClick={() => setTab('workbook')} icon={<FolderOpen className="w-3.5 h-3.5" />} label="Use existing workbook" />
        <TabButton active={tab === 'csv'} onClick={() => setTab('csv')} icon={<FileSpreadsheet className="w-3.5 h-3.5" />} label="Upload CSV" />
      </div>

      {tab === 'workbook' ? (
        <WorkbookPicker onPick={(wb) => { onAttachWorkbook(wb); onClose(); }} />
      ) : (
        <CsvUploader onPick={(csv) => { onAttachCsv(csv); onClose(); }} />
      )}
    </Modal>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition flex items-center gap-1.5 ${
        active ? 'border-lavender text-white' : 'border-transparent text-white/55 hover:text-white/85'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function WorkbookPicker({ onPick }: { onPick: (wb: AttachedWorkbook) => void }) {
  const [nodes, setNodes] = useState<ProjectNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((data: ProjectNode[]) => setNodes(Array.isArray(data) ? data : []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Flatten all workbooks (top-level + nested under folders) for display.
  const workbooks: ProjectNode[] = [];
  const walk = (n: ProjectNode) => {
    if (n.type === 'workbook') workbooks.push(n);
    if (n.children) n.children.forEach(walk);
  };
  nodes.forEach(walk);

  if (loading) {
    return <div className="py-8 text-center text-white/55 text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading workbooks…</div>;
  }
  if (error) {
    return <div className="py-8 text-center text-red-300/80 text-sm">Failed to load workbooks: {error}</div>;
  }
  if (workbooks.length === 0) {
    return <div className="py-8 text-center text-white/55 text-sm">No workbooks found.</div>;
  }

  return (
    <div className="max-h-96 overflow-y-auto -mx-2 px-2">
      <div className="text-xs text-white/45 mb-2 px-1">{workbooks.length} workbook{workbooks.length === 1 ? '' : 's'}. Click one to attach.</div>
      <div className="space-y-1">
        {workbooks.map(wb => (
          <button
            key={wb.id}
            onClick={() => onPick({ id: wb.id, name: wb.name, sheetCount: wb.tables?.length ?? 0 })}
            className="w-full text-left px-3 py-2 border border-white/10 hover:border-white/30 hover:bg-white/[0.03] transition group"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/90 truncate">{wb.name}</span>
              <span className="text-xs text-white/40 flex-shrink-0 ml-3">
                {wb.tables?.length ?? 0} sheet{(wb.tables?.length ?? 0) === 1 ? '' : 's'}
              </span>
            </div>
            {wb.tables && wb.tables.length > 0 && (
              <div className="mt-1 text-xs text-white/40 truncate">
                {wb.tables.map(t => t.name).join(' · ')}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function CsvUploader({ onPick }: { onPick: (csv: AttachedCsv) => void }) {
  const [parsed, setParsed] = useState<AttachedCsv | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setParsing(true);
    try {
      const text = await file.text();
      const result = parseCsv(text);
      if (result.rows.length === 0) {
        throw new Error('CSV is empty or has no data rows');
      }
      if (result.rows.length > MAX_CSV_ROWS) {
        throw new Error(`CSV has ${result.rows.length.toLocaleString()} rows — max is ${MAX_CSV_ROWS.toLocaleString()}. For larger files, use the CLI: \`agent-x api POST /api/import/csv\`.`);
      }
      setParsed({
        name: file.name,
        headers: result.headers,
        rowCount: result.rows.length,
        rows: result.rows,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'parse failed');
    } finally {
      setParsing(false);
    }
  };

  if (parsed) {
    return (
      <div className="space-y-3 text-sm">
        <div className="text-white/85">
          <strong>{parsed.name}</strong> — {parsed.rowCount.toLocaleString()} row{parsed.rowCount === 1 ? '' : 's'}, {parsed.headers.length} column{parsed.headers.length === 1 ? '' : 's'}
        </div>
        <div className="text-xs text-white/55">Headers:</div>
        <div className="text-xs font-mono text-white/80 bg-white/5 border border-white/10 p-2 break-all">{parsed.headers.join(', ')}</div>
        <div className="text-xs text-white/55">First 3 rows:</div>
        <div className="text-xs font-mono text-white/80 bg-white/5 border border-white/10 p-2 max-h-32 overflow-y-auto">
          {parsed.rows.slice(0, 3).map((row, i) => (
            <div key={i} className="truncate">{JSON.stringify(row)}</div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={() => setParsed(null)} className="px-3 py-1.5 text-sm text-white/60 hover:text-white/90 transition">
            Pick a different file
          </button>
          <button onClick={() => onPick(parsed)} className="px-4 py-2 bg-lavender/20 border border-lavender/40 hover:bg-lavender/30 text-white text-sm transition">
            Attach
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-white/15 hover:border-white/30 cursor-pointer transition">
        {parsing ? <Loader2 className="w-6 h-6 text-white/55 animate-spin" /> : <Upload className="w-6 h-6 text-white/55" />}
        <span className="text-sm text-white/70">{parsing ? 'Parsing…' : 'Click to choose a CSV'}</span>
        <span className="text-xs text-white/40">Up to {MAX_CSV_ROWS.toLocaleString()} rows</span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          disabled={parsing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = ''; // allow re-picking same file
          }}
        />
      </label>
      {error && <div className="mt-3 text-xs text-red-300/85">{error}</div>}
    </div>
  );
}

// Minimal RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
// embedded newlines, and "" escaped quotes. Assumes UTF-8 input. ~40 lines.
function parseCsv(text: string): { headers: string[]; rows: Array<Record<string, string>> } {
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cur.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h, idx) => h.trim() || `column_${idx + 1}`);
  const dataRows = rows.slice(1)
    .filter(r => r.some(cell => cell.length > 0))
    .map(r => {
      const obj: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) obj[headers[j]] = (r[j] ?? '').trim();
      return obj;
    });
  return { headers, rows: dataRows };
}
