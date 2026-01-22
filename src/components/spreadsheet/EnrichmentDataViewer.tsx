'use client';

import { useState } from 'react';
import { X, Database, Plus, Check, Loader2, Clock, Coins, Zap } from 'lucide-react';
import { GlassButton, Modal } from '@/components/ui';

interface CellMetadata {
  inputTokens: number;
  outputTokens: number;
  timeTakenMs: number;
  totalCost: number;
  forcedToFinishEarly?: boolean;
}

interface EnrichmentDataViewerProps {
  isOpen: boolean;
  onClose: () => void;
  data: Record<string, string | number | null>;
  metadata?: CellMetadata;
  rowId: string;
  columnId: string;
  tableId: string;
  onExtractToColumn: (dataKey: string) => Promise<void>;
}

// Helper to format key names for display (e.g., "reason" -> "reasoning", "steps_taken" -> "steps taken")
function formatKeyForDisplay(key: string): string {
  // Special case: "reason" -> "reasoning"
  if (key.toLowerCase() === 'reason') {
    return 'reasoning';
  }
  // Replace underscores with spaces
  return key.replace(/_/g, ' ');
}

export function EnrichmentDataViewer({
  isOpen,
  onClose,
  data,
  metadata,
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
        {/* Response Data Section - Lavender */}
        <div>
          <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
            <Database className="w-4 h-4 text-lavender" />
            <span className="text-lavender font-medium">Response Data</span>
            <span className="text-white/40">({dataEntries.length} datapoint{dataEntries.length !== 1 ? 's' : ''})</span>
          </div>

          <div className="space-y-2">
            {dataEntries.map(([key, value]) => (
              <div
                key={key}
                className="group relative flex items-start gap-3 p-3 rounded-lg bg-lavender/10 border border-lavender/30
                         hover:bg-lavender/20 hover:border-lavender/50 transition-colors cursor-pointer"
                onClick={() => handleDatapointClick(key)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-lavender">{formatKeyForDisplay(key)}</span>
                    <Plus className="w-3 h-3 text-white/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="mt-1 text-sm text-white/80 break-words">
                    {value !== null && value !== undefined ? String(value) : <span className="text-white/30">null</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Metadata Section - Blue */}
        {metadata && (
          <div>
            <div className="flex items-center gap-2 text-white/60 text-sm mb-2">
              <Zap className="w-4 h-4 text-blue-400" />
              <span className="text-blue-400 font-medium">Usage Metadata</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Input Tokens */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="text-xs text-blue-400 mb-1">Input Tokens</div>
                <div className="text-sm text-white font-medium">{metadata.inputTokens.toLocaleString()}</div>
              </div>

              {/* Output Tokens */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="text-xs text-blue-400 mb-1">Output Tokens</div>
                <div className="text-sm text-white font-medium">{metadata.outputTokens.toLocaleString()}</div>
              </div>

              {/* Time Taken */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="flex items-center gap-1 text-xs text-blue-400 mb-1">
                  <Clock className="w-3 h-3" />
                  Time Taken
                </div>
                <div className="text-sm text-white font-medium">{(metadata.timeTakenMs / 1000).toFixed(2)}s</div>
              </div>

              {/* Total Cost */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="flex items-center gap-1 text-xs text-blue-400 mb-1">
                  <Coins className="w-3 h-3" />
                  Total Cost
                </div>
                <div className="text-sm text-white font-medium">${metadata.totalCost.toFixed(6)}</div>
              </div>

              {/* Forced To Finish Early - only show if true */}
              {metadata.forcedToFinishEarly && (
                <div className="col-span-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <div className="text-xs text-amber-400 mb-1">Warning</div>
                  <div className="text-sm text-amber-200">Response was forced to finish early (cost limit)</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Confirmation dialog */}
        {confirmKey && (
          <div className="mt-4 p-4 rounded-lg bg-lavender/10 border border-lavender/30">
            <p className="text-sm text-white mb-3">
              Create a new column <span className="font-semibold text-lavender">"{formatKeyForDisplay(confirmKey)}"</span> with this data for all rows in the table?
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
