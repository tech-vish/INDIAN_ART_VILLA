'use client';

import type { PLOutput } from '@/lib/types';
import { CHANNELS } from '@/lib/constants';

// ── Consistency check builder ─────────────────────────────────────────────

interface CheckResult {
  label:   string;
  pass:    boolean;
  detail?: string;
}

function fmtINR(n: number) {
  return Math.round(Math.abs(n)).toLocaleString('en-IN');
}

function buildChecks(pl: PLOutput): CheckResult[] {
  const checks: CheckResult[] = [];
  const TOL = 1; // ₹1 rounding tolerance

  // 1. Gross Sales: sum of channels == row total
  const grossChannelSum = CHANNELS.reduce((s, ch) => s + (pl.grossSales.byChannel[ch] ?? 0), 0);
  const gsDiff          = Math.abs(grossChannelSum - pl.grossSales.total);
  checks.push({
    label:  'Gross Sales: Σ channels = Total',
    pass:   gsDiff <= TOL,
    detail: gsDiff > TOL ? `off by ₹${fmtINR(gsDiff)}` : undefined,
  });

  // 2. Net Sales derivation: Gross − Cancellations − Courier − Customer + Shipping = Net
  const derivedNet = pl.grossSales.total
    - pl.cancellations.total
    - pl.courierReturns.total
    - pl.customerReturns.total
    + pl.shippingReceived.total;
  const nsDiff = Math.abs(derivedNet - pl.netSales.total);
  checks.push({
    label:  'Net Sales = Gross − Returns + Shipping',
    pass:   nsDiff <= TOL,
    detail: nsDiff > TOL
      ? `computed ₹${fmtINR(derivedNet)}, stored ₹${fmtINR(pl.netSales.total)}`
      : undefined,
  });

  // 3. Gross Profit = Net Sales − COGS
  const derivedGP = pl.netSales.total - pl.cogs.total;
  const gpDiff    = Math.abs(derivedGP - pl.grossProfit.total);
  checks.push({
    label:  'Gross Profit = Net Sales − COGS',
    pass:   gpDiff <= TOL,
    detail: gpDiff > TOL
      ? `computed ₹${fmtINR(derivedGP)}, stored ₹${fmtINR(pl.grossProfit.total)}`
      : undefined,
  });

  // 4. Net Profit = Gross Profit − Direct Expenses − Allocated Expenses
  const derivedNP = pl.grossProfit.total - pl.totalDirectExp.total - pl.totalAllocatedExp.total;
  const npDiff    = Math.abs(derivedNP - pl.netProfit.total);
  checks.push({
    label:  'Net Profit = Gross Profit − All Expenses',
    pass:   npDiff <= TOL,
    detail: npDiff > TOL
      ? `computed ₹${fmtINR(derivedNP)}, stored ₹${fmtINR(pl.netProfit.total)}`
      : undefined,
  });

  // 5. No channel has negative Gross Sales
  const negChannels = CHANNELS.filter(ch => (pl.grossSales.byChannel[ch] ?? 0) < 0);
  checks.push({
    label:  'No channel has negative Gross Sales',
    pass:   negChannels.length === 0,
    detail: negChannels.length > 0 ? `Negative: ${negChannels.join(', ')}` : undefined,
  });

  // 6. Net Profit margin within sane range
  const margin = pl.netSales.total > 0
    ? (pl.netProfit.total / pl.netSales.total) * 100
    : 0;
  const marginOk = margin >= -100 && margin <= 100;
  checks.push({
    label:  'Net profit margin within range (−100% to +100%)',
    pass:   marginOk,
    detail: `${margin.toFixed(1)}%`,
  });

  // 7. Gross Sales > 0 (data was loaded)
  checks.push({
    label:  'Gross Sales total is non-zero',
    pass:   pl.grossSales.total > 0,
    detail: pl.grossSales.total <= 0 ? 'No sales data found — check uploaded file' : undefined,
  });

  return checks;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function ValidationPanel({ pl }: { pl: PLOutput }) {
  const checks  = buildChecks(pl);
  const nFail   = checks.filter(c => !c.pass).length;
  const allPass = nFail === 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Data Consistency
        </h2>
        <span className={[
          'text-xs font-medium px-2.5 py-0.5 rounded-full',
          allPass ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
        ].join(' ')}>
          {allPass ? 'All checks passed' : `${nFail} issue${nFail > 1 ? 's' : ''} detected`}
        </span>
      </div>

      <ul className="space-y-2">
        {checks.map((check, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <span className={`mt-px flex-shrink-0 font-semibold ${check.pass ? 'text-green-500' : 'text-amber-500'}`}>
              {check.pass ? '✓' : '⚠'}
            </span>
            <div className="min-w-0">
              <span className={check.pass ? 'text-gray-700' : 'text-amber-800 font-medium'}>
                {check.label}
              </span>
              {check.detail && (
                <span className="ml-2 text-xs text-gray-400">({check.detail})</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
