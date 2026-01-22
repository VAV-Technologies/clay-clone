'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Settings, Upload, Download } from 'lucide-react';
import Papa from 'papaparse';
import { ToastProvider, useToast } from '@/components/ui';
import { SpreadsheetView } from '@/components/spreadsheet';
import { CSVImportModal } from '@/components/import/CSVImportModal';
import { EnrichmentPanel } from '@/components/enrichment/EnrichmentPanel';
import { FormulaPanel } from '@/components/formula/FormulaPanel';
import { APISettingsModal } from '@/components/settings/APISettingsModal';
import { useTableStore } from '@/stores/tableStore';

// Dynamically import AnimatedBackground to avoid hydration issues
const AnimatedBackground = dynamic(
  () => import('@/components/ui/AnimatedBackground').then((mod) => mod.AnimatedBackground),
  { ssr: false }
);

function TableContent() {
  const params = useParams();
  const router = useRouter();
  const tableId = params.id as string;

  const { currentTable, columns, rows, getDisplayedRows, getVisibleColumns } = useTableStore();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEnrichmentOpen, setIsEnrichmentOpen] = useState(false);
  const [editEnrichmentColumnId, setEditEnrichmentColumnId] = useState<string | null>(null);
  const [isFormulaOpen, setIsFormulaOpen] = useState(false);
  const [editFormulaColumnId, setEditFormulaColumnId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleImport = useCallback(() => {
    setIsImportModalOpen(true);
  }, []);

  const handleExport = useCallback(() => {
    if (!currentTable) return;

    // Use displayed rows (filtered + sorted) and visible columns
    const displayedRows = getDisplayedRows();
    const visibleColumns = getVisibleColumns();

    if (displayedRows.length === 0) return;

    // Build CSV data with column names as headers
    const headers = visibleColumns.map(col => col.name);
    const csvRows = displayedRows.map(row => {
      return visibleColumns.map(col => {
        const cellValue = row.data[col.id];
        return cellValue?.value?.toString() ?? '';
      });
    });

    const csvContent = Papa.unparse({
      fields: headers,
      data: csvRows,
    });

    // Add BOM for Excel compatibility
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

  return (
    <div className="h-screen overflow-hidden relative">
      <AnimatedBackground />

      {/* Content wrapper with padding - fixed height */}
      <div className="relative z-10 p-4 lg:p-6 h-full">
        {/* Main card container - 90% screen width, responsive */}
        <div className="bg-midnight-100/60 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden shadow-2xl
                        w-[95%] lg:w-[90%] mx-auto
                        h-[calc(100vh-2rem)] lg:h-[calc(100vh-3rem)]
                        flex flex-col">

          {/* Header - Table name ONLY here */}
          <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-white/10">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/')}
                className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-sm">Back</span>
              </button>
              <div className="w-px h-5 bg-white/20" />
              <h1 className="text-lg font-semibold text-white">
                {currentTable?.name || 'Loading...'}
              </h1>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleImport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Import CSV"
              >
                <Upload className="w-4 h-4" />
                <span>Import</span>
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Export CSV"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
              <div className="w-px h-5 bg-white/20 mx-1" />
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="Settings"
              >
                <Settings className="w-5 h-5 text-white/70" />
              </button>
            </div>
          </div>

          {/* Spreadsheet with toolbar - fills remaining space with overflow hidden */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <SpreadsheetView
              tableId={tableId}
              onEnrich={handleOpenEnrichment}
              onFormula={handleOpenFormula}
            />
          </div>
        </div>
      </div>

      {/* Modals */}
      <CSVImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        tableId={tableId}
        onImportComplete={handleImportComplete}
      />

      <EnrichmentPanel
        isOpen={isEnrichmentOpen}
        onClose={() => {
          setIsEnrichmentOpen(false);
          setEditEnrichmentColumnId(null);
        }}
        editColumnId={editEnrichmentColumnId}
      />

      <FormulaPanel
        isOpen={isFormulaOpen}
        onClose={() => {
          setIsFormulaOpen(false);
          setEditFormulaColumnId(null);
        }}
        tableId={tableId}
        columnId={editFormulaColumnId || undefined}
      />

      <APISettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}

export default function TablePage() {
  return (
    <ToastProvider>
      <TableContent />
    </ToastProvider>
  );
}
