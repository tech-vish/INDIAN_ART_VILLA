/**
 * Format number in Indian numbering system (lakhs, crores)
 */
export function formatIndianCurrency(amount: number, currency = '₹'): string {
  if (amount === 0) return `${currency}0`;
  
  const absAmount = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  
  if (absAmount >= 10000000) { // 1 crore
    const crores = absAmount / 10000000;
    return `${sign}${currency}${crores.toFixed(2)} Cr`;
  } else if (absAmount >= 100000) { // 1 lakh
    const lakhs = absAmount / 100000;
    return `${sign}${currency}${lakhs.toFixed(2)} L`;
  } else if (absAmount >= 1000) { // 1 thousand
    const thousands = absAmount / 1000;
    return `${sign}${currency}${thousands.toFixed(2)} K`;
  } else {
    return `${sign}${currency}${absAmount.toFixed(2)}`;
  }
}

/**
 * Format number with Indian comma separation (e.g., 1,23,45,678)
 */
export function formatIndianNumber(num: number): string {
  const numStr = Math.abs(num).toString();
  const sign = num < 0 ? '-' : '';
  
  if (numStr.length <= 3) {
    return sign + numStr;
  }
  
  // Separate last 3 digits
  const lastThree = numStr.slice(-3);
  const remaining = numStr.slice(0, -3);
  
  // Add commas every 2 digits for the remaining part
  const formatted = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  
  return sign + formatted + ',' + lastThree;
}

/**
 * Format percentage with specified decimal places
 */
export function formatPercentage(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format percentage change with + or - sign
 */
export function formatPercentageChange(value: number, decimals = 2): string {
  const formatted = formatPercentage(Math.abs(value), decimals);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatted}`;
}

/**
 * Format large numbers with appropriate suffixes (K, L, Cr)
 */
export function formatLargeNumber(num: number): string {
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 10000000) { // 1 crore
    return `${sign}${(absNum / 10000000).toFixed(1)}Cr`;
  } else if (absNum >= 100000) { // 1 lakh
    return `${sign}${(absNum / 100000).toFixed(1)}L`;
  } else if (absNum >= 1000) { // 1 thousand
    return `${sign}${(absNum / 1000).toFixed(1)}K`;
  } else {
    return `${sign}${absNum}`;
  }
}

/**
 * Parse Indian formatted number string back to number
 */
export function parseIndianNumber(str: string): number {
  if (!str) return 0;
  
  // Remove currency symbols and spaces
  let cleaned = str.replace(/[₹$,\s]/g, '');
  
  // Handle suffixes
  const suffix = cleaned.slice(-1).toUpperCase();
  const numPart = cleaned.slice(0, -1);
  
  let multiplier = 1;
  if (suffix === 'K') {
    multiplier = 1000;
    cleaned = numPart;
  } else if (suffix === 'L') {
    multiplier = 100000;
    cleaned = numPart;
  } else if (cleaned.slice(-2).toUpperCase() === 'CR') {
    multiplier = 10000000;
    cleaned = cleaned.slice(0, -2);
  }
  
  const number = parseFloat(cleaned) || 0;
  return number * multiplier;
}

/**
 * Format date in Indian format (DD/MM/YYYY)
 */
export function formatIndianDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Format time in 12-hour format
 */
export function formatTime12Hour(date: Date): string {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Format compact numbers for charts and dashboards
 */
export function formatCompactNumber(num: number): string {
  const formatter = Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 1
  });
  
  return formatter.format(num);
}

/**
 * Format margin or ratio as percentage
 */
export function formatMargin(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%';
  const margin = (numerator / denominator);
  return formatPercentage(margin);
}

/**
 * Format growth rate between two values
 */
export function formatGrowthRate(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+∞%' : '0%';
  const growth = (current - previous) / previous;
  return formatPercentageChange(growth);
}

/**
 * Round to specified decimal places
 */
export function roundTo(num: number, decimals = 2): number {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ── Dashboard-specific formatters ─────────────────────────────────────────

// Indian number format: 1234567 → "12,34,567"; negatives as (12,34,567); zero as —
export function formatINR(value: number): string {
  if (value === 0) return '—';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return value < 0 ? `(${formatted})` : formatted;
}

// Percentage format: 0.1423 → "14.2%"; non-finite → —
export function formatPct(value: number): string {
  if (!isFinite(value) || isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

// Short label for month from Date: Apr-24, Jan-26
export function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

// Tailwind CSS class for a numeric value
export function valueClass(value: number): string {
  return value < 0 ? 'text-red-600' : value > 0 ? 'text-gray-900' : 'text-gray-400';
}