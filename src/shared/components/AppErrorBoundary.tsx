import React from 'react';

type Props = {
  children: React.ReactNode;
  label?: string;
  compact?: boolean;
};

type State = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error || 'Unknown error'),
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error(`[${this.props.label || 'App'}] rendering error`, error, info);
  }

  private recover = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch (error) {
      console.warn('Recovery cleanup failed', error);
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.compact) {
      return (
        <div style={{
          background: '#351218', border: '1px solid #ff5a6b', borderRadius: 10,
          padding: 12, color: '#ffd8dd', marginBottom: 10, fontFamily: 'Barlow, sans-serif'
        }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠ {this.props.label || 'Section'} unavailable</div>
          <div style={{ fontSize: 11, opacity: 0.8 }}>{this.state.message}</div>
        </div>
      );
    }

    return (
      <div style={{
        minHeight: '100vh', background: '#04091c', color: '#e8f0ff',
        display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Barlow, sans-serif'
      }}>
        <div style={{
          width: '100%', maxWidth: 520, background: '#0b1830', border: '1px solid #ff5a6b',
          borderRadius: 18, padding: 24, boxShadow: '0 20px 70px rgba(0,0,0,.45)'
        }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: '#ff7a89', letterSpacing: 1.2 }}>
            TECHNICIAN PORTAL RECOVERY
          </div>
          <h1 style={{ fontSize: 26, margin: '8px 0', fontFamily: 'Barlow Condensed, sans-serif' }}>
            The page could not finish loading
          </h1>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: '#9db0cf' }}>
            A cached file or one optional module may be out of date. Your route data was not deleted.
          </p>
          <div style={{
            background: '#071327', borderRadius: 10, padding: 10, fontSize: 11,
            color: '#ffbdc6', wordBreak: 'break-word', margin: '12px 0 16px'
          }}>
            {this.state.message || 'Unknown rendering error'}
          </div>
          <button onClick={this.recover} style={{
            width: '100%', border: 0, borderRadius: 10, padding: 13,
            background: 'linear-gradient(135deg,#0040c0,#00b8f5)', color: '#fff',
            fontWeight: 900, cursor: 'pointer'
          }}>
            Clear local cache and reload
          </button>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
