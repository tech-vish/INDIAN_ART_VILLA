import { Suspense } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';
import DashboardNav from '@/components/dashboard/DashboardNav';

// Shared loading spinner shown while a dashboard sub-page suspends
function DashboardFallback() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="inline-block w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <DashboardNav />
      <Suspense fallback={<DashboardFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}
