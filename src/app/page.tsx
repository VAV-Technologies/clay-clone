'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Folder,
  FileSpreadsheet,
  Clock,
  ArrowRight,
  Sparkles,
  Table,
} from 'lucide-react';
import { AnimatedBackground, GlassButton, GlassCard, ToastProvider } from '@/components/ui';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useProjectStore } from '@/stores/projectStore';

export default function HomePage() {
  const router = useRouter();
  const { projects, fetchProjects, isLoading } = useProjectStore();
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreateWorkbook = async () => {
    setIsCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Workbook',
          type: 'workbook',
        }),
      });

      if (response.ok) {
        const project = await response.json();
        router.push(`/projects/${project.id}`);
      }
    } catch (error) {
      console.error('Failed to create workbook:', error);
    } finally {
      setIsCreating(false);
    }
  };

  // Get recent workbooks
  const recentWorkbooks = projects
    .filter((p) => p.type === 'workbook')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 6);

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden">
        <AnimatedBackground />
        <Sidebar />

        <main className="flex-1 overflow-y-auto p-8">
          {/* Welcome Section */}
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-white mb-2">
                Welcome to DataFlow
              </h1>
              <p className="text-white/60">
                AI-powered spreadsheet for data enrichment and automation
              </p>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <GlassCard
                variant="interactive"
                className="flex flex-col items-center justify-center p-6 text-center"
                onClick={handleCreateWorkbook}
              >
                <div className="w-12 h-12 rounded-xl bg-lavender/20 flex items-center justify-center mb-3">
                  <Plus className="w-6 h-6 text-lavender" />
                </div>
                <h3 className="font-medium text-white mb-1">New Workbook</h3>
                <p className="text-sm text-white/50">Start from scratch</p>
              </GlassCard>

              <GlassCard
                variant="interactive"
                className="flex flex-col items-center justify-center p-6 text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center mb-3">
                  <FileSpreadsheet className="w-6 h-6 text-green-400" />
                </div>
                <h3 className="font-medium text-white mb-1">Import CSV</h3>
                <p className="text-sm text-white/50">Upload your data</p>
              </GlassCard>

              <GlassCard
                variant="interactive"
                className="flex flex-col items-center justify-center p-6 text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center mb-3">
                  <Sparkles className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="font-medium text-white mb-1">AI Templates</h3>
                <p className="text-sm text-white/50">Pre-built enrichments</p>
              </GlassCard>
            </div>

            {/* Recent Workbooks */}
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Clock className="w-5 h-5 text-white/50" />
                  Recent Workbooks
                </h2>
                {recentWorkbooks.length > 0 && (
                  <GlassButton variant="ghost" size="sm">
                    View all
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </GlassButton>
                )}
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin w-6 h-6 border-2 border-lavender border-t-transparent rounded-full" />
                </div>
              ) : recentWorkbooks.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recentWorkbooks.map((workbook) => (
                    <GlassCard
                      key={workbook.id}
                      variant="interactive"
                      className="p-4"
                      onClick={() => router.push(`/projects/${workbook.id}`)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-lavender/20 flex items-center justify-center">
                          <Table className="w-5 h-5 text-lavender" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-white truncate">
                            {workbook.name}
                          </h3>
                          <p className="text-sm text-white/50">
                            {new Date(workbook.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              ) : (
                <GlassCard className="p-8 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                    <Folder className="w-8 h-8 text-white/20" />
                  </div>
                  <h3 className="text-lg font-medium text-white mb-1">
                    No workbooks yet
                  </h3>
                  <p className="text-white/50 mb-4">
                    Create your first workbook to get started
                  </p>
                  <GlassButton
                    variant="primary"
                    onClick={handleCreateWorkbook}
                    loading={isCreating}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Create Workbook
                  </GlassButton>
                </GlassCard>
              )}
            </div>

            {/* Features Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <GlassCard className="p-6">
                <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-lavender" />
                  AI Enrichment
                </h3>
                <p className="text-sm text-white/60 mb-4">
                  Automatically enrich your data with AI-powered insights.
                  Research companies, validate emails, and more.
                </p>
                <ul className="space-y-2 text-sm text-white/50">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-lavender" />
                    Google Gemini integration
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-lavender" />
                    Custom prompts with variables
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-lavender" />
                    Batch processing
                  </li>
                </ul>
              </GlassCard>

              <GlassCard className="p-6">
                <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-green-400" />
                  Powerful Spreadsheet
                </h3>
                <p className="text-sm text-white/60 mb-4">
                  A familiar spreadsheet interface with advanced features
                  for managing your data at scale.
                </p>
                <ul className="space-y-2 text-sm text-white/50">
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    Virtual scrolling for large datasets
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    Advanced filtering & sorting
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    CSV import/export
                  </li>
                </ul>
              </GlassCard>
            </div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
