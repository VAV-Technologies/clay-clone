'use client';

import { useState } from 'react';
import { X, Database, Plus, Check, Loader2 } from 'lucide-react';
import { GlassButton, Modal } from '@/components/ui';

interface EnrichmentDataViewerProps {
  isOpen: boolean;
  onClose: () => void;
  data: Record<string, string | number | null>;
  rowId: string;
  columnId: string;
  tableId: string;
  onExtractToColumn: (dataKey: string) => Promise<void>;
}

export function EnrichmentDataViewer({
  isOpen,
  onClose,
  data,
  tableId,
  onExtractToColumn,
}: EnrichmentDataViewerProps) {
  const [extractingKey, setExtractingKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const dataEntries = Object.entries(data);

  const handleDatapointClick = (key: string) => {
    if (extractingKey) return;
    setConfirmKey(key);
  };

  const handleConfirmExtract = async () => {
    if (!confirmKey) return;

    setExtractingKey(confirmKey);
    try {
      await onExtractToColumn(confirmKey);
      setConfirmKey(null);
      onClose();
    } catch (error) {
      console.error('Failed to extract to column:', error);
    } finally {
      setExtractingKey(null);
    }
  };

  const handleCancelExtract = () => {
    setConfirmKey(null);
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Enrichment Data" size="md">
      <div className="space-y-4">
        {/* Header info */}
        <div className="flex items-center gap-2 text-white/60 text-sm">
          <Database className="w-4 h-4" />
          <span>{dataEntries.length} datapoint{dataEntries.length !== 1 ? 's' : ''} extracted</span>
        </div>

        {/* Data entries */}
        <div className="space-y-2">
          {dataEntries.map(([key, value]) => (
            <div
              key={key}
              className="group relative flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10
                       hover:bg-white/10 hover:border-lavender/30 transition-colors cursor-pointer"
              onClick={() => handleDatapointClick(key)}
            >
              {/* Key name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-lavender">{key}</span>
                  <Plus className="w-3 h-3 text-white/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="mt-1 text-sm text-white/80 break-words">
                  {value !== null && value !== undefined ? String(value) : <span className="text-white/30">null</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Confirmation dialog */}
        {confirmKey && (
          <div className="mt-4 p-4 rounded-lg bg-lavender/10 border border-lavender/30">
            <p className="text-sm text-white mb-3">
              Create a new column <span className="font-semibold text-lavender">"{confirmKey}"</span> with this data for all rows in the table?
            </p>
            <div className="flex items-center gap-2">
              <GlassButton
                variant="primary"
                size="sm"
                onClick={handleConfirmExtract}
                disabled={extractingKey !== null}
              >
                {extractingKey === confirmKey ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Yes, create column
                  </>
                )}
              </GlassButton>
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={handleCancelExtract}
                disabled={extractingKey !== null}
              >
                Cancel
              </GlassButton>
            </div>
          </div>
        )}

        {/* Help text */}
        {!confirmKey && (
          <p className="text-xs text-white/40 mt-4">
            Click on a datapoint name to extract it as a new column across all rows.
          </p>
        )}
      </div>
    </Modal>
  );
}
