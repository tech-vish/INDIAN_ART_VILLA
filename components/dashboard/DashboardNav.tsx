'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useShallow } from 'zustand/shallow';
import { useOutputStore } from '@/store/outputStore';
import DownloadReportButton from './DownloadReportButton';

const NAV_LINKS = [
  { key: 'pl',            href: '/dashboard/pl' },
  { key: 'kpi',           href: '/dashboard/kpi' },
  { key: 'comparativePct',href: '/dashboard/comparative-pct' },
  { key: 'groupComp',     href: '/dashboard/group-comparative' },
  { key: 'amazonMonthly', href: '/dashboard/monthwise' },
  { key: 'amazonQuarter', href: '/dashboard/quarterly' },
  { key: 'orders',        href: '/dashboard/orders' },
  { key: 'statewise',     href: '/dashboard/statewise' },
  { key: 'statewiseSale', href: '/dashboard/statewise-sale' },
  { key: 'stockValue',    href: '/dashboard/stock-value' },
  { key: 'amazonExp',     href: '/dashboard/amazon-exp' },
  { key: 'flipkartExp',   href: '/dashboard/flipkart-exp' },
] as const;

export default function DashboardNav() {
  const path = usePathname();
  const { uploadId, month } = useOutputStore(
    useShallow(s => ({ uploadId: s.uploadId, month: s.month })),
  );

  const tabLabel = (key: (typeof NAV_LINKS)[number]['key']): string => {
    switch (key) {
      case 'pl':
        return month ? `P&L ${month}` : 'P&L';
      case 'kpi':
        return '% Analysis';
      case 'comparativePct':
        return 'Comparative %';
      case 'groupComp':
        return 'Group Comparative';
      case 'amazonMonthly':
        return 'Amazon Monthly';
      case 'amazonQuarter':
        return 'Amazon Quarterly';
      case 'orders':
        return 'Orders';
      case 'statewise':
        return 'Amazon Statewise';
      case 'statewiseSale':
        return 'Statewise Sale';
      case 'stockValue':
        return 'Stock Value';
      case 'amazonExp':
        return 'Amazon Expenses';
      case 'flipkartExp':
        return 'Flipkart Expenses';
      default:
        return '';
    }
  };

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4">
        <div className="flex items-center gap-1 h-11 overflow-x-auto">
          {NAV_LINKS.map((link) => {
            const isActive = path.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  'px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors shrink-0',
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
                  link.key === 'pl' ? 'font-medium' : '',
                ].join(' ')}
              >
                {tabLabel(link.key)}
              </Link>
            );
          })}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Download Report button — shown only when a processed period is loaded */}
          {uploadId && (
            <DownloadReportButton periodId={uploadId} month={month ?? undefined} />
          )}
        </div>
      </div>
    </nav>
  );
}
