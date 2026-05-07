'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Loader2, AlertCircle, Check, ChevronUp, ChevronDown, UserPlus, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Modal, GlassButton } from '@/components/ui';
import { useTableStore } from '@/stores/tableStore';
import type { WattdataPerson } from '@/lib/wattdata-api';

interface AddWattdataModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  workbookId?: string;
  onComplete: (newSheetId?: string) => void;
}

interface Trait {
  trait_hash: string;
  name: string;
  value: string;
  domain: string;
  similarity_score: number;
  size: string;
}

const OUTPUT_COLUMNS = [
  { name: 'Person ID', type: 'text', key: 'id' },
  { name: 'Full Name', type: 'text', key: 'name' },
  { name: 'First Name', type: 'text', key: 'first_name' },
  { name: 'Last Name', type: 'text', key: 'last_name' },
  { name: 'Email 1', type: 'email', key: 'email1' },
  { name: 'Email 2', type: 'email', key: 'email2' },
  { name: 'Email 3', type: 'email', key: 'email3' },
  { name: 'Phone 1', type: 'text', key: 'phone1' },
  { name: 'Phone 2', type: 'text', key: 'phone2' },
  { name: 'Title', type: 'text', key: 'title' },
  { name: 'Company', type: 'text', key: 'company' },
  { name: 'Age Range', type: 'text', key: 'age_range' },
  { name: 'Gender', type: 'text', key: 'gender' },
  { name: 'Location', type: 'text', key: 'location' },
  { name: 'Country', type: 'text', key: 'country' },
];

function NumberInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const numVal = value ? Number(value) : 0;
  return (
    <div>
      <label className="text-xs text-white/50 mb-1 block">{label}</label>
      <div className="flex border border-white/10 overflow-hidden focus-within:border-emerald-400">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder={placeholder || ''}
          className="flex-1 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        <div className="flex flex-col border-l border-white/10 bg-white/[0.03]">
          <button type="button" onClick={() => onChange(String(numVal + 100))}
            className="flex items-center justify-center w-7 flex-1 hover:bg-white/10 text-white/40 hover:text-white">
            <ChevronUp className="w-3 h-3" />
          </button>
          <div className="border-t border-white/10" />
          <button type="button" onClick={() => onChange(String(Math.max(0, numVal - 100)))}
            className="flex items-center justify-center w-7 flex-1 hover:bg-white/10 text-white/40 hover:text-white">
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs text-white/50 mb-1 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-400"
      />
    </div>
  );
}

export function AddWattdataModal({ isOpen, onClose, tableId, workbookId, onComplete }: AddWattdataModalProps) {
  const { fetchTable, fetchWorkbook } = useTableStore();
  const abortRef = useRef<AbortController | null>(null);

  const [step, setStep] = useState<'configure' | 'previewing' | 'preview' | 'searching' | 'results'>('configure');

  // Filters
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [limit, setLimit] = useState('1000');

  // Search state
  const [searchStatus, setSearchStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [estimatedTotal, setEstimatedTotal] = useState<number | null>(null);
  const [previewPeople, setPreviewPeople] = useState<WattdataPerson[]>([]);
  const [discoveredTraits, setDiscoveredTraits] = useState<Trait[]>([]);
  const [resultPeople, setResultPeople] = useState<WattdataPerson[]>([]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep('configure');
      setError(null);
      setPreviewPeople([]);
      setResultPeople([]);
      setDiscoveredTraits([]);
      setSearchStatus('');
      setEstimatedTotal(null);
    }
  }, [isOpen]);

  const buildFilters = () => {
    const filters: Record<string, unknown> = { query: query.trim() };
    if (city.trim() || country.trim()) {
      filters.location = {
        ...(city.trim() && { city: city.trim() }),
        ...(country.trim() && { country: country.trim() }),
      };
    }
    return filters;
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      setError('Please describe your audience');
      return;
    }

    setStep('previewing');
    setError(null);
    setSearchStatus('Discovering matching traits...');

    try {
      abortRef.current = new AbortController();
      const filters = buildFilters();

      const res = await fetch('/api/add-wattdata-data/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Preview failed' }));
        throw new Error(err.error || `Error ${res.status}`);
      }

      const data = await res.json();
      const total = data.estimatedTotal || 0;
      setEstimatedTotal(total);
      setPreviewPeople(data.preview || []);
      setDiscoveredTraits(data.traits || []);

      if (total === 0) {
        setError('No matching audience found. Try a different description.');
        setStep('configure');
        return;
      }

      setStep('preview');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStep('configure');
        return;
      }
      setError((err as Error).message);
      setStep('configure');
    }
  };

  const handleFetchAll = async () => {
    setStep('searching');
    setError(null);

    try {
      abortRef.current = new AbortController();
      const filters = buildFilters();
      const searchLimit = Number(limit) || 1000;
      const fetchCount = Math.min(searchLimit, estimatedTotal || searchLimit);

      setSearchStatus(`Fetching ${fetchCount.toLocaleString()} results from Wattdata...`);

      const res = await fetch('/api/add-wattdata-data/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, limit: searchLimit }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Search failed' }));
        throw new Error(err.error || `Error ${res.status}`);
      }

      const data = await res.json();
      setResultPeople(data.people || []);
      setStep('results');
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStep('preview');
        return;
      }
      setError((err as Error).message);
      setStep('preview');
    }
  };

  const handleAddToTable = async () => {
    if (resultPeople.length === 0) return;

    setStep('searching');
    setSearchStatus('Creating new sheet...');

    try {
      let targetTableId = tableId;

      if (workbookId) {
        const res = await fetch('/api/tables', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: workbookId, name: 'People (Wattdata)' }),
        });
        if (!res.ok) throw new Error('Failed to create new sheet');
        const newTable = await res.json();
        targetTableId = newTable.id;
      }

      setSearchStatus('Adding columns...');
      const colIdMap: Record<string, string> = {};
      for (const outCol of OUTPUT_COLUMNS) {
        const res = await fetch('/api/columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: targetTableId, name: outCol.name, type: outCol.type }),
        });
        const col = await res.json();
        colIdMap[outCol.key] = col.id;
      }

      const rowData = resultPeople.map(item => {
        const data: Record<string, { value: string }> = {};
        for (const outCol of OUTPUT_COLUMNS) {
          const colId = colIdMap[outCol.key];
          if (colId) {
            const val = (item as unknown as Record<string, unknown>)[outCol.key];
            data[colId] = { value: val != null ? String(val) : '' };
          }
        }
        return data;
      });

      const BATCH_SIZE = 200;
      for (let i = 0; i < rowData.length; i += BATCH_SIZE) {
        const batch = rowData.slice(i, i + BATCH_SIZE);
        await fetch('/api/rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableId: targetTableId, rows: batch }),
        });
        setSearchStatus(`Added ${Math.min(i + BATCH_SIZE, rowData.length)} / ${rowData.length} rows...`);
      }

      if (workbookId && targetTableId !== tableId) {
        await fetchWorkbook(workbookId, targetTableId);
        onComplete(targetTableId);
      } else {
        await fetchTable(tableId);
        onComplete();
      }
    } catch (err) {
      setError((err as Error).message);
      setStep('results');
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setStep('configure');
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Wattdata" size="full">
      <div className="max-h-[70vh] overflow-y-auto">

        {/* ─── Step 1: Configure ─────────────────── */}
        {step === 'configure' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-emerald-300">Powered by Wattdata — emails delivered directly, no separate finder needed</span>
            </div>

            <div>
              <label className="text-sm font-medium text-white/70 mb-1 block">Describe your audience</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. 'Marketing directors at SaaS companies in Australia'&#10;'C-suite executives in healthcare 100-1000 employees'&#10;'Real estate investors in California'"
                rows={5}
                className="w-full bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-400 resize-none"
              />
              <p className="text-xs text-white/40 mt-1">Wattdata will use semantic search to find matching traits. Be as specific as possible.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <TextInput label="City (optional)" value={city} onChange={setCity} placeholder="Sydney" />
              <TextInput label="Country (optional)" value={country} onChange={setCountry} placeholder="Australia" />
            </div>

            <NumberInput label="Results Limit" value={limit} onChange={setLimit} placeholder="1000" />

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <GlassButton variant="primary" className="w-full" onClick={handleSearch}>
              <Search className="w-4 h-4 mr-1.5" />
              Search Wattdata
            </GlassButton>
          </div>
        )}

        {/* ─── Previewing (loading) ─────────────── */}
        {step === 'previewing' && (
          <div className="p-8 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
            <p className="text-white/70 text-center">{searchStatus || 'Discovering audience...'}</p>
            <GlassButton variant="ghost" size="sm" onClick={handleCancel}>Cancel</GlassButton>
          </div>
        )}

        {/* ─── Preview (confirmation) ─────────────── */}
        {step === 'preview' && (() => {
          const fetchCount = Math.min(Number(limit) || 1000, estimatedTotal || 1000);
          return (
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20">
                <Search className="w-6 h-6 text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="text-lg font-semibold text-white">~{(estimatedTotal || 0).toLocaleString()} People</p>
                  <p className="text-xs text-white/50">match your audience description</p>
                </div>
              </div>

              {discoveredTraits.length > 0 && (
                <div>
                  <p className="text-xs text-white/50 mb-2">Matched traits ({discoveredTraits.length}):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {discoveredTraits.slice(0, 8).map(t => (
                      <span key={t.trait_hash} className="text-[11px] px-2 py-1 bg-white/5 border border-white/10 text-white/60">
                        {t.name}: <span className="text-white/80">{t.value}</span>
                        <span className="text-white/30 ml-1">({Math.round(t.similarity_score * 100)}%)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {previewPeople.length > 0 && (
                <div className="border border-white/10 overflow-hidden">
                  <p className="px-3 py-2 text-xs text-white/50 bg-white/[0.03] border-b border-white/10">
                    Sample preview ({previewPeople.length} of ~{(estimatedTotal || 0).toLocaleString()})
                  </p>
                  <div className="overflow-x-auto max-h-52">
                    <table className="w-full text-sm">
                      <thead className="bg-white/[0.02]">
                        <tr>
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-white/50">Name</th>
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-white/50">Email</th>
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-white/50">Title</th>
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-white/50">Location</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {previewPeople.map((p, i) => (
                          <tr key={i} className="hover:bg-white/[0.02]">
                            <td className="px-3 py-1.5 text-white/80">{p.name || `${p.first_name} ${p.last_name}`}</td>
                            <td className="px-3 py-1.5 text-emerald-300">{p.email1}</td>
                            <td className="px-3 py-1.5 text-white/60">{p.title}</td>
                            <td className="px-3 py-1.5 text-white/60">{p.location || p.country}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <GlassButton variant="ghost" onClick={() => setStep('configure')}>Back to Filters</GlassButton>
                <GlassButton variant="primary" className="flex-1" onClick={handleFetchAll}>
                  <Search className="w-4 h-4 mr-1" />
                  Fetch {fetchCount.toLocaleString()} People
                </GlassButton>
              </div>
            </div>
          );
        })()}

        {/* ─── Searching (full fetch) ─────────────── */}
        {step === 'searching' && (
          <div className="p-8 flex flex-col items-center justify-center gap-4">
            <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
            <p className="text-white/70 text-center">{searchStatus || 'Fetching results...'}</p>
            <GlassButton variant="ghost" size="sm" onClick={handleCancel}>Cancel</GlassButton>
          </div>
        )}

        {/* ─── Results ─────────────── */}
        {step === 'results' && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20">
              <Check className="w-5 h-5 text-emerald-400" />
              <p className="text-sm text-emerald-400">
                Fetched {resultPeople.length} people
                {estimatedTotal && estimatedTotal > resultPeople.length && (
                  <span className="text-white/40"> (out of ~{estimatedTotal.toLocaleString()})</span>
                )}
              </p>
            </div>

            {resultPeople.length > 0 && (
              <div className="border border-white/10 overflow-hidden">
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-sm">
                    <thead className="bg-white/[0.03]">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Name</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Email</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Phone</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Title</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-white/50">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {resultPeople.slice(0, 20).map((p, i) => (
                        <tr key={i} className="hover:bg-white/[0.02]">
                          <td className="px-3 py-1.5 text-white/80">{p.name || `${p.first_name} ${p.last_name}`}</td>
                          <td className="px-3 py-1.5 text-emerald-300">{p.email1}</td>
                          <td className="px-3 py-1.5 text-white/60">{p.phone1}</td>
                          <td className="px-3 py-1.5 text-white/60">{p.title}</td>
                          <td className="px-3 py-1.5 text-white/60">{p.location || p.country}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {resultPeople.length > 20 && (
                  <p className="px-3 py-2 text-xs text-white/40 border-t border-white/10">
                    Showing 20 of {resultPeople.length}
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <GlassButton variant="ghost" onClick={() => setStep('configure')}>Back</GlassButton>
              <GlassButton variant="primary" className="flex-1" onClick={handleAddToTable} disabled={resultPeople.length === 0}>
                <UserPlus className="w-4 h-4 mr-1" />
                Add {resultPeople.length} People to Table
              </GlassButton>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
