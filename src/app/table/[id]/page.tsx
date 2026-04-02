'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function TableRedirect() {
  const params = useParams();
  const router = useRouter();
  const tableId = params.id as string;

  useEffect(() => {
    // Look up the table's projectId and redirect to workbook URL
    fetch(`/api/tables/${tableId}`)
      .then(r => r.json())
      .then(data => {
        const projectId = data.projectId;
        if (projectId) {
          router.replace(`/workbook/${projectId}?sheet=${tableId}`);
        } else {
          router.replace('/');
        }
      })
      .catch(() => router.replace('/'));
  }, [tableId, router]);

  return (
    <div className="h-screen flex items-center justify-center bg-[#0d0d39]">
      <div className="animate-spin w-8 h-8 border-2 border-lavender border-t-transparent rounded-full" />
    </div>
  );
}
