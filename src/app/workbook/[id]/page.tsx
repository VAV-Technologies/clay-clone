'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Upload, Download, UserPlus } from 'lucide-react';
import Papa from 'papaparse';
import { ToastProvider, useToast } from '@/components/ui';
import { SpreadsheetView } from '@/components/spreadsheet';
import { SheetTabs } from '@/components/spreadsheet/SheetTabs';
import { CSVImportModal } from '@/components/import/CSVImportModal';
import { EnrichmentPanel } from '@/components/enrichment/EnrichmentPanel';
import { FormulaPanel } from '@/components/formula/FormulaPanel';
import { AddDataModal } from '@/components/data/AddDataModal';
import { AddAiArcDataModal } from '@/components/data/AddAiArcDataModal';
import { AddWattdataModal } from '@/components/data/AddWattdataModal';
import { useTableStore } from '@/stores/tableStore';

const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

function WorkbookContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workbookId = params.id as string;
  const sheetParam = searchParams.get('sheet');

  const { currentTable, activeSheetId, sheets, columns, rows, getDisplayedRows, getVisibleColumns, fetchWorkbook } = useTableStore();

  const [workbookName, setWorkbookName] = useState('Loading...');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEnrichmentOpen, setIsEnrichmentOpen] = useState(false);
  const [editEnrichmentColumnId, setEditEnrichmentColumnId] = useState<string | null>(null);
  const [isFormulaOpen, setIsFormulaOpen] = useState(false);
  const [editFormulaColumnId, setEditFormulaColumnId] = useState<string | null>(null);
  const [isAddDataOpen, setIsAddDataOpen] = useState(false);
  const [isAiArcDataOpen, setIsAiArcDataOpen] = useState(false);
  const [isWattdataOpen, setIsWattdataOpen] = useState(false);

  // Load workbook on mount
  useEffect(() => {
    fetchWorkbook(workbookId, sheetParam || undefined);

    // Fetch workbook/project name
    fetch(`/api/projects/${workbookId}`)
      .then(r => r.json())
      .then(d => setWorkbookName(d.name || 'Workbook'))
      .catch(() => setWorkbookName('Workbook'));
  }, [workbookId, sheetParam, fetchWorkbook]);

  const handleExport = useCallback(() => {
    if (!currentTable) return;
    const displayedRows = getDisplayedRows();
    const visibleColumns = getVisibleColumns();
    if (displayedRows.length === 0) return;

    const headers = visibleColumns.map(col => col.name);
    const csvRows = displayedRows.map(row =>
      visibleColumns.map(col => row.data[col.id]?.value?.toString() ?? '')
    );

    const csvContent = Papa.unparse({ fields: headers, data: csvRows });
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${currentTable.name}-export.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [currentTable, getDisplayedRows, getVisibleColumns]);

  const handleOpenEnrichment = useCallback((columnId?: string) => {
    setEditEnrichmentColumnId(columnId || null);
    setIsEnrichmentOpen(true);
  }, []);

  const handleOpenFormula = useCallback((columnId?: string) => {
    setEditFormulaColumnId(columnId || null);
    setIsFormulaOpen(true);
  }, []);

  const handleImportComplete = useCallback(() => {
    setIsImportModalOpen(false);
    window.location.reload();
  }, []);

  const tableId = activeSheetId || '';

  return (
    <div className="h-screen overflow-hidden relative">
      <AnimatedBackground />

      <div className="relative z-10 p-4 lg:p-6 h-full">
        <div className="w-[95%] lg:w-[90%] mx-auto
                        h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)]
                        flex flex-col gap-3">

          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-midnight-100/60 backdrop-blur-xl border border-white/10 shadow-2xl">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Back</span>
              </button>
              <div className="w-px h-5 bg-white/20" />
              <h1 className="text-lg font-semibold text-white">{workbookName}</h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Import CSV"
              >
                <Upload className="w-4 h-4" />
                <span>Import</span>
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Export CSV"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
              <button
                onClick={() => setIsAddDataOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Add Clay Data"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Clay Data</span>
              </button>
              <button
                onClick={() => setIsAiArcDataOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-violet-300/70 hover:text-violet-200 hover:bg-violet-500/10 transition-colors"
                title="Add AI Ark Data"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add AI Ark Data</span>
              </button>
              <button
                onClick={() => setIsWattdataOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-300/70 hover:text-emerald-200 hover:bg-emerald-500/10 transition-colors"
                title="Add Wattdata"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Wattdata</span>
              </button>
            </div>
          </div>

          {/* Spreadsheet */}
          {tableId && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <SpreadsheetView
                tableId={tableId}
                onEnrich={handleOpenEnrichment}
                onFormula={handleOpenFormula}
              />
            </div>
          )}

          {/* Sheet Tabs */}
          <SheetTabs />
        </div>
      </div>

      {/* Modals */}
      {tableId && (
        <>
          <CSVImportModal
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            tableId={tableId}
            onImportComplete={handleImportComplete}
          />

          <EnrichmentPanel
            isOpen={isEnrichmentOpen}
            onClose={() => { setIsEnrichmentOpen(false); setEditEnrichmentColumnId(null); }}
            editColumnId={editEnrichmentColumnId}
          />

          <FormulaPanel
            isOpen={isFormulaOpen}
            onClose={() => { setIsFormulaOpen(false); setEditFormulaColumnId(null); }}
            tableId={tableId}
            columnId={editFormulaColumnId || undefined}
          />

          <AddDataModal
            isOpen={isAddDataOpen}
            onClose={() => setIsAddDataOpen(false)}
            tableId={tableId}
            workbookId={workbookId}
            onComplete={() => setIsAddDataOpen(false)}
          />

          <AddAiArcDataModal
            isOpen={isAiArcDataOpen}
            onClose={() => setIsAiArcDataOpen(false)}
            tableId={tableId}
            workbookId={workbookId}
            onComplete={() => setIsAiArcDataOpen(false)}
          />

          <AddWattdataModal
            isOpen={isWattdataOpen}
            onClose={() => setIsWattdataOpen(false)}
            tableId={tableId}
            workbookId={workbookId}
            onComplete={() => setIsWattdataOpen(false)}
          />
        </>
      )}
    </div>
  );
}

export default function WorkbookPage() {
  return (
    <ToastProvider>
      <WorkbookContent />
    </ToastProvider>
  );
}
