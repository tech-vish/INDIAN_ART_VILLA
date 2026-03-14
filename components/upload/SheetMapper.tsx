'use client';

import { useState } from 'react';
import { useRawDataStore } from '@/store/rawDataStore';
import { useOutputStore } from '@/store/outputStore';
import Link from 'next/link';

export default function SheetMapper() {
  const { workbook, fileName, setProcessing, setError } = useRawDataStore();
  const { clearOutput } = useOutputStore();

  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleProcessData = async () => {
    if (!workbook) return;

    setIsProcessing(true);
    clearOutput();
    setProcessing(true);
    setError(null);
    setStatus('Processing data...');

    try {
      // TODO: POST workbook bytes to /api/process, call buildPL server-side,
      //       then store result via setUploadResult(uploadId, month, pl, errors)
      setStatus('Data processing complete (stub — wired to buildPL in next step).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setStatus('Error: ' + msg);
    } finally {
      setProcessing(false);
      setIsProcessing(false);
    }
  };

  if (!workbook) {
    return (
      <div className="text-center py-8 text-gray-500">
        No workbook uploaded yet. Please upload the master Excel file first.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Workbook info */}
      <div className="border rounded-lg p-4">
        <h3 className="font-semibold mb-2">Workbook: {fileName}</h3>
        <p className="text-sm text-gray-500 mb-3">{workbook.SheetNames.length} sheets detected</p>
        <div className="flex flex-wrap gap-2">
          {workbook.SheetNames.map(name => (
            <span key={name} className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
              {name}
            </span>
          ))}
        </div>
      </div>

      {/* Process button */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleProcessData}
          disabled={isProcessing}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Processing...' : 'Process All Data'}
        </button>
        {status && <p className="text-sm text-gray-600">{status}</p>}
      </div>

      {/* Link to dashboard */}
      <Link href="/dashboard" className="inline-block text-blue-600 hover:underline text-sm">
        View Dashboard &rarr;
      </Link>
    </div>
  );
}
