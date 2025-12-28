'use client';

import { useState, useEffect } from 'react';
import { X, Key, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface APISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function APISettingsModal({ isOpen, onClose }: APISettingsModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle');

  useEffect(() => {
    if (isOpen) {
      const savedKey = localStorage.getItem('vertex_api_key');
      if (savedKey) {
        setApiKey(savedKey);
        setStatus('valid');
      }
    }
  }, [isOpen]);

  const testConnection = async () => {
    if (!apiKey.trim()) return;

    setStatus('testing');
    try {
      const response = await fetch('/api/settings/test-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      if (response.ok) {
        setStatus('valid');
        localStorage.setItem('vertex_api_key', apiKey);
      } else {
        setStatus('invalid');
      }
    } catch (error) {
      setStatus('invalid');
    }
  };

  const saveKey = () => {
    if (apiKey.trim()) {
      localStorage.setItem('vertex_api_key', apiKey);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-midnight-100/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-lavender/20">
              <Key className="w-5 h-5 text-lavender" />
            </div>
            <h2 className="text-lg font-semibold text-white">API Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>

        {/* API Key Input */}
        <div className="mb-4">
          <label className="block text-sm text-white/70 mb-2">
            Google Cloud / Vertex AI API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setStatus('idle');
            }}
            placeholder="Enter your API key..."
            className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10
                       text-white placeholder:text-white/30
                       focus:border-lavender focus:outline-none focus:ring-2 focus:ring-lavender/20"
          />
        </div>

        {/* Status Indicator */}
        {status !== 'idle' && (
          <div
            className={cn(
              'flex items-center gap-2 mb-4 p-3 rounded-lg',
              status === 'valid' && 'bg-green-500/10 text-green-400',
              status === 'invalid' && 'bg-red-500/10 text-red-400',
              status === 'testing' && 'bg-white/5 text-white/70'
            )}
          >
            {status === 'testing' && <Loader2 className="w-4 h-4 animate-spin" />}
            {status === 'valid' && <CheckCircle className="w-4 h-4" />}
            {status === 'invalid' && <XCircle className="w-4 h-4" />}
            <span className="text-sm">
              {status === 'testing' && 'Testing connection...'}
              {status === 'valid' && 'API key is valid'}
              {status === 'invalid' && 'Invalid API key. Please check and try again.'}
            </span>
          </div>
        )}

        {/* Instructions */}
        <div className="mb-6 p-4 rounded-lg bg-white/5 border border-white/10">
          <p className="text-sm text-white/60 mb-2">To get your API key:</p>
          <ol className="text-sm text-white/60 list-decimal list-inside space-y-1">
            <li>Go to Google Cloud Console</li>
            <li>Enable the Vertex AI API</li>
            <li>Create an API key or service account</li>
            <li>Copy and paste the key above</li>
          </ol>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={testConnection}
            disabled={!apiKey.trim() || status === 'testing'}
            className="flex-1 px-4 py-3 rounded-lg bg-white/10 text-white
                       hover:bg-white/15 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Test Connection
          </button>
          <button
            onClick={saveKey}
            disabled={!apiKey.trim()}
            className="flex-1 px-4 py-3 rounded-lg bg-lavender text-midnight font-medium
                       hover:bg-lavender/90 transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save Key
          </button>
        </div>
      </div>
    </div>
  );
}
