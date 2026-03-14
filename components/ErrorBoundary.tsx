'use client';

import React from 'react';
import Link from 'next/link';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white flex items-center justify-center">
          <div className="text-center space-y-4 max-w-sm px-4">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <span className="text-red-600 text-xl font-bold">!</span>
            </div>
            <p className="text-red-600 font-medium">Something went wrong</p>
            {this.state.error?.message && (
              <p className="text-sm text-gray-500 font-mono bg-gray-50 rounded px-3 py-2">
                {this.state.error.message}
              </p>
            )}
            <div className="flex items-center justify-center gap-4 text-sm">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="text-blue-600 hover:underline"
              >
                Try again
              </button>
              <span className="text-gray-300">|</span>
              <Link href="/upload" className="text-blue-600 hover:underline">
                ← Go to Upload
              </Link>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
