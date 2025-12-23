'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Upload, Sparkles } from 'lucide-react';
import { AnimatedBackground, GlassButton, ToastProvider } from '@/components/ui';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { SpreadsheetView } from '@/components/spreadsheet';
import { CSVImportModal } from '@/components/import/CSVImportModal';
import { EnrichmentPanel } from '@/components/enrichment/EnrichmentPanel';
import { useTableStore } from '@/stores/tableStore';

function TableContent() {
  const params = useParams();
  const router = useRouter();
  const tableId = params.id as string;

  const { currentTable, columns } = useTableStore();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isEnrichmentOpen, setIsEnrichmentOpen] = useState(false);
  const [enrichmentColumnId, setEnrichmentColumnId] = useState<string | undefined>();

  const handleOpenEnrichment = (columnId?: string) => {
    setEnrichmentColumnId(columnId);
    setIsEnrichmentOpen(true);
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-white/10 bg-midnight/50 backdrop-blur-sm">
        <GlassButton
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
        >
          <ChevronLeft className="w-4 h-4" />
        </GlassButton>

        <div className="flex-1">
          <h1 className="text-lg font-semibold text-white">
            {currentTable?.name || 'Loading...'}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={() => setIsImportModalOpen(true)}
          >
            <Upload className="w-4 h-4 mr-1" />
            Import
          </GlassButton>

          <GlassButton
            variant="primary"
            size="sm"
            onClick={() => handleOpenEnrichment()}
          >
            <Sparkles className="w-4 h-4 mr-1" />
            Enrich
          </GlassButton>
        </div>
      </div>

      {/* Spreadsheet */}
      <div className="flex-1 overflow-hidden">
        <SpreadsheetView tableId={tableId} />
      </div>

      {/* Modals */}
      <CSVImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        tableId={tableId}
        onImportComplete={() => {
          setIsImportModalOpen(false);
          // Refresh table data
          window.location.reload();
        }}
      />

      <EnrichmentPanel
        isOpen={isEnrichmentOpen}
        onClose={() => setIsEnrichmentOpen(false)}
        targetColumnId={enrichmentColumnId || columns[columns.length - 1]?.id}
      />
    </main>
  );
}

export default function TablePage() {
  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <AnimatedBackground />
        <Sidebar />
        <TableContent />
      </div>
    </ToastProvider>
  );
}
