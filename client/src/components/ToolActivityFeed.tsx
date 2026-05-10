interface Props {
  activities: any[];
  ragSources: any[];
}
import { motion, AnimatePresence } from 'motion/react';

export function ToolActivityFeed({ activities, ragSources }: Props) {
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="activity-feed">
      <div className="panel-header">
        ◈ Activity Feed
        <span className="badge badge-cyan" style={{ marginLeft: 'auto' }}>{activities.length}</span>
      </div>

      <div className="activity-list">
        {activities.length === 0 ? (
          <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 'var(--space-sm)', opacity: 0.3 }}>◇</div>
            Activity will appear here as you interact with the cockpit
          </div>
        ) : (
          <AnimatePresence>
            {activities.map(activity => (
              <motion.div 
                key={activity.id} 
                className="activity-card"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                <div className="activity-card-header">
                  <span className={`activity-type ${activity.type}`}>
                    {activity.type === 'llm_call' && '⬡ LLM Call'}
                    {activity.type === 'rag_search' && '◈ RAG Search'}
                    {activity.type === 'tool_exec' && '⚙ Tool'}
                    {activity.type === 'governance' && '⛨ Governance'}
                    {activity.type === 'search_grounding' && '🔍 Google Search'}
                  </span>
                  <span className={`activity-status ${activity.status}`}>
                    {activity.status === 'running' && '● RUNNING'}
                    {activity.status === 'done' && '✓ DONE'}
                    {activity.status === 'error' && '✕ ERROR'}
                    {activity.status === 'warning' && '⚠ WARN'}
                  </span>
                </div>

                <div className="activity-details">
                  {activity.type === 'llm_call' && (
                    <>
                      <div className="activity-detail-row">
                        <span className="activity-detail-label">Model</span>
                        <span>{activity.model}</span>
                      </div>
                      {activity.status === 'done' && (
                        <>
                          <div className="activity-detail-row">
                            <span className="activity-detail-label">Tokens</span>
                            <span>{((activity.tokensIn || 0) + (activity.tokensOut || 0)).toLocaleString()}</span>
                          </div>
                          <div className="activity-detail-row">
                            <span className="activity-detail-label">Cost</span>
                            <span>${(activity.costUsd || 0).toFixed(4)}</span>
                          </div>
                          <div className="activity-detail-row">
                            <span className="activity-detail-label">Latency</span>
                            <span>{formatDuration(activity.latencyMs || activity.duration || 0)}</span>
                          </div>
                        </>
                      )}
                      {activity.status === 'error' && (
                        <div style={{ color: 'var(--accent-red)', marginTop: 'var(--space-xs)', fontSize: '0.72rem' }}>
                          {activity.error}
                        </div>
                      )}
                      {activity.input && (
                        <div style={{ marginTop: 'var(--space-xs)', color: 'var(--text-muted)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          → {activity.input}
                        </div>
                      )}
                    </>
                  )}

                  {activity.type === 'rag_search' && (
                    <>
                      <div className="activity-detail-row">
                        <span className="activity-detail-label">Results</span>
                        <span>{activity.results} chunks</span>
                      </div>
                      {activity.sources?.map((s: any, i: number) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            📎 {s.filename}
                          </span>
                          <span className="badge badge-purple" style={{ fontSize: '0.65rem', marginLeft: 'var(--space-xs)' }}>
                            {(s.score * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </>
                  )}

                  {activity.type === 'governance' && (
                    <div style={{ marginTop: 'var(--space-xs)' }}>
                      {activity.warnings?.map((w: string, i: number) => (
                        <div key={i} style={{ color: 'var(--accent-amber)', fontSize: '0.72rem', padding: '2px 0' }}>
                          ⚠ {w}
                        </div>
                      ))}
                    </div>
                  )}
                  {activity.type === 'search_grounding' && (
                    <>
                      <div className="activity-detail-row">
                        <span className="activity-detail-label">Status</span>
                        <span>Verified via Google</span>
                      </div>
                      <div className="activity-detail-row">
                        <span className="activity-detail-label">Results</span>
                        <span>{activity.results} live sources</span>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
