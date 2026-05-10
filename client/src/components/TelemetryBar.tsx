import type { User } from '../types';

interface Props {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  latency: number;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  onGovernance: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
}

const MODEL_PROVIDERS: Record<string, string> = {
  'gemini-2.5-pro': 'google',
  'gemma-3-1b': 'google',
  'gemma-3-2b': 'google',
  'gemma-3-4b': 'google',
  'gemma-3-12b': 'google',
  'gemma-3-27b': 'google',
  'gemma-4-26b': 'google',
  'gemma-4-31b': 'google',
  'auto': 'google',
};

const MODEL_LABELS: Record<string, string> = {
  'gemma-3-1b': 'Gemma 3 1B',
  'gemma-3-2b': 'Gemma 3 2B',
  'gemma-3-4b': 'Gemma 3 4B',
  'gemma-3-12b': 'Gemma 3 12B',
  'gemma-4-26b': 'Gemma 4 26B (MoE)',
  'gemma-3-27b': 'Gemma 3 27B',
  'gemma-4-31b': 'Gemma 4 31B (Dense)',
};

export function TelemetryBar({ model, tokensIn, tokensOut, cost, latency, user, onLogin, onLogout, onGovernance, onToggleSidebar, isSidebarOpen }: Props) {
  const provider = MODEL_PROVIDERS[model] || 'unknown';
  
  // Dynamic Context Window
  let contextWindow = 128000;
  if (model.includes('gemini')) contextWindow = 1000000;
  else if (model.includes('gemma-4-26b') || model.includes('gemma-4-31b')) contextWindow = 256000;
  
  const contextUsed = Math.min(((tokensIn + tokensOut) / contextWindow) * 100, 100);

  return (
    <div className="telemetry-bar">
      <div className="telemetry-bar-left">
        <button className={`mobile-menu-btn ${isSidebarOpen ? 'active' : ''}`} onClick={onToggleSidebar} title="Toggle Menu">
          ☰
        </button>
        {/* Brand */}
        <div className="telemetry-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
            <path d="M2 12h20"/>
          </svg>
          AT THE HELM
        </div>

        {/* Metrics */}
        <div className="telemetry-metrics">
          {user?.role === 'admin' && (
            <>
              <div className="telemetry-metric">
                <span className="telemetry-metric-label">TOKENS</span>
                <span className="telemetry-metric-value">{(tokensIn + tokensOut).toLocaleString()}</span>
              </div>
              <div className="telemetry-metric">
                <span className="telemetry-metric-label">COST</span>
                <span className="telemetry-metric-value">${cost.toFixed(4)}</span>
              </div>
            </>
          )}
          
          <div className="telemetry-metric">
            <span className="telemetry-metric-label">LATENCY</span>
            <span className="telemetry-metric-value">{latency > 0 ? `${(latency / 1000).toFixed(1)}s` : '—'}</span>
          </div>

          <div className="telemetry-metric">
            <span className="telemetry-metric-label">CTX</span>
            <div style={{ width: 60, height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${contextUsed}%`,
                height: '100%',
                background: contextUsed > 80 ? 'var(--accent-red)' : contextUsed > 50 ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                borderRadius: 3,
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        </div>
      </div>

      <div className="telemetry-bar-right">
        {/* Active Model */}
        {model && (
          <div className={`model-indicator ${provider}`}>
            <span className="status-dot active" />
            {MODEL_LABELS[model] || model}
          </div>
        )}

        {/* User controls */}
        {user && user.role !== 'anonymous' && (
          <button className="btn btn-ghost btn-sm" onClick={onGovernance}>
            {user.role === 'admin' ? '⚙ Governance' : '⌬ Settings'}
          </button>
        )}

        {user?.role === 'anonymous' ? (
          <button className="btn btn-primary btn-sm" onClick={onLogin}>
            Sign In
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={onLogout}>
            ↪ {user?.displayName}
          </button>
        )}
      </div>
    </div>
  );
}
