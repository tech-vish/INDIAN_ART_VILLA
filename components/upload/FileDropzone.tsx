'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useRawDataStore } from '@/store/rawDataStore';
import * as XLSX from 'xlsx';
import { formatFileSize } from '@/lib/utils/formatter';
import { UPLOAD_CONFIG } from '@/lib/constants';

interface FileDropzoneProps {
  className?: string;
}

export default function FileDropzone({ className }: FileDropzoneProps) {
  const { setWorkbook, setError } = useRawDataStore();
  const [uploadStatus, setUploadStatus] = useState<Record<string, 'uploading' | 'success' | 'error'>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Only accept one workbook at a time
    const file = acceptedFiles[0];
    if (!file) return;

    const fileId = `${file.name}-${Date.now()}`;
    try {
      setUploadStatus(prev => ({ ...prev, [fileId]: 'uploading' }));
      setUploadErrors(prev => ({ ...prev, [fileId]: '' }));
      setError(null);

      if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE) {
        throw new Error(`File size exceeds ${formatFileSize(UPLOAD_CONFIG.MAX_FILE_SIZE)} limit.`);
      }

      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      setWorkbook(wb, file.name);
      setUploadStatus(prev => ({ ...prev, [fileId]: 'success' }));
    } catch (error) {
      console.error('File upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setUploadErrors(prev => ({ ...prev, [fileId]: errorMessage }));
      setUploadStatus(prev => ({ ...prev, [fileId]: 'error' }));
      setError(errorMessage);
    }
  }, [setWorkbook, setError]);

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxFiles: 1,
    maxSize: UPLOAD_CONFIG.MAX_FILE_SIZE
  });

  return (
    <div className={className}>
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
          ${isDragActive 
            ? 'border-blue-400 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
          }
        `}
      >
        <input {...getInputProps()} />
        
        <div className="space-y-4">
          <div className="text-4xl">📁</div>
          {isDragActive ? (
            <p className="text-blue-600 font-medium">Drop the files here...</p>
          ) : (
            <div className="space-y-2">
              <p className="text-gray-600 font-medium">
                Drag & drop files here, or click to select
              </p>
              <p className="text-gray-500 text-sm">
                Upload the master workbook: Excel (.xlsx, .xls)
              </p>
              <p className="text-gray-400 text-xs">
                Max file size: {formatFileSize(UPLOAD_CONFIG.MAX_FILE_SIZE)} | 
                Max files: {UPLOAD_CONFIG.MAX_FILES}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Uploaded Files List */}
      {acceptedFiles.length > 0 && (
        <div className="mt-6 space-y-3">
          <h3 className="text-lg font-semibold">Uploaded Files</h3>
          {acceptedFiles.map((file) => {
            const fileId = `${file.name}-${Date.now()}`;
            const status = uploadStatus[fileId];
            const error = uploadErrors[fileId];
            
            return (
              <div
                key={fileId}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <div className="text-2xl">
                    {getFileIcon(file.name)}
                  </div>
                  <div>
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-gray-500">
                      {formatFileSize(file.size)}
                    </p>
                    {error && (
                      <p className="text-sm text-red-600">{error}</p>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  {status === 'uploading' && (
                    <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                  )}
                  {status === 'success' && (
                    <div className="text-green-500 text-xl">✓</div>
                  )}
                  {status === 'error' && (
                    <div className="text-red-500 text-xl">✗</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function getFileIcon(filename: string): string {
  const extension = filename.toLowerCase().split('.').pop();
  switch (extension) {
    case 'xlsx':
    case 'xls':
      return '📊';
    default:
      return '📁';
  }
}