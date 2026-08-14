import React from 'react';

// No ErrorBoundary existed anywhere in frontend-react/src before this — a
// render-time throw (e.g. an unexpected API response shape, a corrupted
// localStorage value a shape-check missed) unmounted the whole React root
// with no fallback UI and no way back to the classic view. class component
// is required here — getDerivedStateFromError/componentDidCatch have no
// hook equivalent.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-8 text-center text-sm text-slate-500">
          Something went wrong loading this page. Try refreshing.
        </div>
      );
    }
    return this.props.children;
  }
}
