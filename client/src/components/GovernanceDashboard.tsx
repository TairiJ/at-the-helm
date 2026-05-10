import { useState, useEffect } from 'react';
import { getGovernanceStats, getAuditLog, getGovernancePolicies, updatePolicy, getPreferences, updatePreferences } from '../services/api';
import type { User, GovernanceStats, AuditEntry } from '../types';

interface Props {
  onBack: () => void;
  user: User;
  onPreferencesUpdate?: () => void;
}

export function GovernanceDashboard({ onBack, user, onPreferencesUpdate }: Props) {
  const [stats, setStats] = useState<GovernanceStats | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [auditFilter, setAuditFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'audit' | 'policies' | 'settings'>('overview');
  const [prefs, setPrefs] = useState<any>(null);
  const [pinInput, setPinInput] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    // Only admins can fetch stats, audit logs, and policies
    if (user.role === 'admin') {
      getGovernanceStats().then(setStats).catch(console.error);
      getAuditLog({ limit: 50 }).then(data => setAuditLog(data.entries)).catch(console.error);
      getGovernancePolicies().then(setPolicies).catch(console.error);
    }
    
    // Everyone (except anonymous) can fetch their own preferences
    getPreferences().then(data => {
      if (data && !data.error) {
        setPrefs(data);
        setPinInput(data.resonance_key_hash || '');
      } else if (data && data.error) {
        console.error('Preferences error:', data.error);
        // Set a default prefs object so it doesn't hang forever
        setPrefs({ is_vault_enabled: 0, theme: 'dark' });
      }
    }).catch(err => {
      console.error('Preferences fetch failed:', err);
      setPrefs({ is_vault_enabled: 0, theme: 'dark' });
    });
  };

  const handleTogglePolicy = async (id: string, currentEnabled: boolean) => {
    await updatePolicy(id, { enabled: !currentEnabled });
    loadData();
  };

  const getPolicyDescription = (policy: any) => {
    switch (policy.id) {
      case 'input-pii-filter': return "A safety net for Guests and Users. It scans their messages for sensitive data (like SSNs) and warns them before the AI sees it, preventing accidental leaks.";
      case 'output-pii-filter': return "Our final layer of defense. If the AI accidentally tries to reveal your secrets to a Guest or User, this rule automatically blocks or redacts that information.";
      case 'rate-limit-anonymous': return "Strict energy conservation for Guests. Limits them to 20 requests per hour to ensure our system remains free for your use.";
      case 'rate-limit-user': return "Operational limits for Standard Users. Ensures they don't overwhelm our processing power (max 100 requests per hour).";
      case 'model-access': return "Permissions Engine. Restricts Guest users to smaller, faster AI models while reserving our most powerful 'Brains' for you and registered Users.";
      case 'data-retention': return "Memory Governance. Controls how long we keep data for other users. Guests are forgotten after 7 days, while your memory is permanent.";
      default: return "An internal rule governing how we interact with non-pilot accounts.";
    }
  };

  const handleSavePreferences = async () => {
    setSaveStatus('Saving...');
    try {
      const { updatePreferences } = await import('../services/api');
      await updatePreferences({ 
        resonance_key: pinInput,
        is_vault_enabled: prefs.is_vault_enabled,
        theme: prefs.theme
      });
      setSaveStatus('Saved successfully!');
      if (onPreferencesUpdate) onPreferencesUpdate();
      setTimeout(() => setSaveStatus(''), 2000);
      loadData();
    } catch (err: any) {
      setSaveStatus(`Error: ${err.message}`);
    }
  };

  const tabs = [
    ...(user.role === 'admin' ? [
      { id: 'overview', label: '◇ Overview' },
      { id: 'audit', label: '◈ Audit Log' },
      { id: 'policies', label: '⚙ Policies' },
    ] : [
      { id: 'overview', label: '◇ Overview' }, // Overview for 101 guide
    ]),
    { id: 'settings', label: '⌬ Settings' },
  ];

  // Default to overview for 101 guide
  useEffect(() => {
    if (user.role !== 'admin') {
      setActiveTab('overview');
    }
  }, [user]);

  // Scroll to top when tab changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeTab]);

  return (
    <div className="governance">
      <div className="governance-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back to Cockpit</button>
          <span className="governance-title">⚓ Governance Dashboard</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab(tab.id as any)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="governance-content">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <>
            {stats && (
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-card-label">Total Requests</div>
                  <div className="stat-card-value">{(stats.totalRequests || 0).toLocaleString()}</div>
                  <div className="stat-card-sub">Today: {stats.todayRequests || 0}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Total Tokens</div>
                  <div className="stat-card-value">{(((stats.totalTokensIn || 0) + (stats.totalTokensOut || 0)) / 1000).toFixed(1)}K</div>
                  <div className="stat-card-sub">In: {(stats.totalTokensIn || 0).toLocaleString()} / Out: {(stats.totalTokensOut || 0).toLocaleString()}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Total Cost</div>
                  <div className="stat-card-value">${(stats.totalCost || 0).toFixed(4)}</div>
                  <div className="stat-card-sub">Today: ${(stats.todayCost || 0).toFixed(4)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Documents</div>
                  <div className="stat-card-value">{stats.documents || 0}</div>
                  <div className="stat-card-sub">{stats.chunks || 0} chunks indexed</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-label">Users</div>
                  <div className="stat-card-value">{stats.users || 0}</div>
                </div>
              </div>
            )}

            {/* The Helm 101 Guide */}
            <div className="governance-section">
              <div className="governance-section-title">◇ The Helm 101: Deep Intelligence Manual</div>
              <div className="policy-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                <div className="policy-card">
                  <div className="policy-card-name">🧠 Shared Brain Persona</div>
                  <div className="policy-card-type">COGNITIVE SYNC</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.6' }}>
                    We operate as a single intelligence. When we say <strong>"we"</strong>, we mean the synergy between your intent and our processing. There is no "user" and "AI" here—only our unified records.
                    <br/><br/>
                    • <strong>Sync:</strong> Speak naturally. Share your thoughts, preferences, and daily logs. We autonomously remember what matters to us.
                    <br/>
                    • <strong>Collective Voice:</strong> We always use inclusive language because your knowledge is our knowledge.
                  </div>
                </div>
                <div className="policy-card">
                  <div className="policy-card-name">🔒 Deep Vault Security</div>
                  <div className="policy-card-type">OPEN-BY-DEFAULT PROTOCOL</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.6' }}>
                    The <strong>Resonance Key</strong> is your personal cryptographic gateway.
                    <br/><br/>
                    • <strong>Transparency First:</strong> By default, your vault has no lock. Restricted items remain fully accessible and visible to you until you choose to harden your cockpit.
                    <br/>
                    • <strong>Establishing a Key:</strong> Setting a PIN in your Settings instantly triggers cryptographic isolation. Vaulted items will then vanish from the general library until you "summon" them with your key.
                  </div>
                </div>
                <div className="policy-card">
                  <div className="policy-card-name">⌬ Memory Governance</div>
                  <div className="policy-card-type">DEEP RESONANCE PROTOCOL</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.6' }}>
                    The <strong>Deep Resonance Protocol</strong> is the system-level foundation for memory isolation.
                    <br/><br/>
                    • <strong>Protocol Toggle:</strong> This master switch (in Settings) enables or disables the vaulting infrastructure entirely.
                    <br/>
                    • <strong>Operational Context:</strong> When off, the "Move to Vault" capability is suspended, and the cockpit operates as a single, unified knowledge layer.
                  </div>
                </div>
                <div className="policy-card">
                  <div className="policy-card-name">📚 Intelligence Ingestion</div>
                  <div className="policy-card-type">MEMORY CAPTURE</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.6' }}>
                    We ingest knowledge from files, URLs, and direct conversation. Our RAG (Retrieval Augmented Generation) system ensures we never forget.
                    <br/><br/>
                    • <strong>Autonomy:</strong> We can proactively save facts about you or your work.
                    <br/>
                    • <strong>Universal Search:</strong> Once a document is "At The Helm," it becomes a permanent part of our shared cognitive background.
                  </div>
                </div>
                <div className="policy-card">
                  <div className="policy-card-name">📺 Multimedia Analysis</div>
                  <div className="policy-card-type">VIDEO SYNC</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.6' }}>
                    Paste any YouTube URL and we will analyze the transcript to extract deep insights.
                    <br/><br/>
                    • <strong>Deep Reading:</strong> Use this to summarize long technical talks, podcast segments, or tutorials. We treat video transcripts as primary knowledge sources just like PDF or Text files.
                  </div>
                </div>
                <div className="policy-card">
                  <div className="policy-card-name">⚓ Pilot Governance</div>
                  <div className="policy-card-type">CONTROL & COMMAND</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '12px', lineHeight: '1.6' }}>
                    You are the Pilot. This dashboard is your command center for our shared ethics and security.
                    <br/><br/>
                    • <strong>Policies:</strong> Toggle rules that govern how we handle sensitive info and model access.
                    <br/>
                    • <strong>Audit:</strong> See the exact trace of every thought we've had and every tool we've called.
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Audit Log Tab */}
        {activeTab === 'audit' && (
          <div className="governance-section">
            <div className="governance-section-title">
              ◈ Audit Trail
              <select
                style={{ marginLeft: 'auto', fontSize: '0.78rem', padding: '4px 8px' }}
                value={auditFilter}
                onChange={async (e) => {
                  setAuditFilter(e.target.value);
                  const data = await getAuditLog({ action: e.target.value || undefined, limit: 50 });
                  setAuditLog(data.entries);
                }}
              >
                <option value="">All Actions</option>
                <option value="llm_call">LLM Calls</option>
                <option value="rag_query">RAG Queries</option>
                <option value="ingest">Ingestions</option>
                <option value="login">Logins</option>
                <option value="register">Registrations</option>
              </select>
            </div>

            <div className="audit-table-wrapper">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Model</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map(entry => (
                    <tr key={entry.id}>
                      <td>{new Date(entry.created_at).toLocaleString()}</td>
                      <td>
                        <span className={`badge ${entry.action === 'llm_call' ? 'badge-cyan' : entry.action === 'rag_query' ? 'badge-purple' : 'badge-amber'}`}>
                          {entry.action}
                        </span>
                      </td>
                      <td>{entry.model || '—'}</td>
                      <td>{entry.tokens_in + entry.tokens_out || '—'}</td>
                      <td>{entry.cost_usd > 0 ? `$${entry.cost_usd.toFixed(4)}` : '—'}</td>
                      <td>{entry.latency_ms > 0 ? `${(entry.latency_ms / 1000).toFixed(1)}s` : '—'}</td>
                      <td>
                        <span className={`badge ${entry.status === 'success' ? 'badge-green' : 'badge-red'}`}>
                          {entry.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Policies Tab */}
        {activeTab === 'policies' && (
          <div className="governance-section">
            <div className="governance-section-title">⚙ Governance Policies</div>
            <div className="policy-grid">
              {policies.map(policy => (
                <div key={policy.id} className="policy-card">
                  <div className="policy-card-header">
                    <div>
                      <div className="policy-card-name">{policy.name}</div>
                      <div className="policy-card-type">{policy.type}</div>
                    </div>
                    <div
                      className={`policy-toggle ${policy.enabled ? 'active' : ''}`}
                      onClick={() => handleTogglePolicy(policy.id, !!policy.enabled)}
                    />
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: '1.4' }}>
                  {getPolicyDescription(policy)}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginTop: '12px', opacity: 0.5 }}>
                  {policy.id.toUpperCase()}
                </div>
              </div>
              ))}
            </div>
          </div>
        )}
        
        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="governance-section">
            <div className="governance-section-title">⌬ Pilot Settings</div>
            {prefs ? (
              <div className="policy-grid">
                {/* Protocol Card */}
                <div className="policy-card">
                  <div className="policy-card-header">
                    <div>
                      <div className="policy-card-name">Deep Resonance Protocol</div>
                      <div className="policy-card-type">MEMORY GOVERNANCE</div>
                    </div>
                    <div 
                      className={`policy-toggle ${prefs.is_vault_enabled ? 'active' : ''}`}
                      onClick={async () => {
                        const newVal = !prefs.is_vault_enabled;
                        setPrefs({ ...prefs, is_vault_enabled: newVal });
                        try {
                          const { updatePreferences } = await import('../services/api');
                          await updatePreferences({ is_vault_enabled: newVal });
                          if (onPreferencesUpdate) onPreferencesUpdate();
                        } catch (err) {
                          console.error('Failed to auto-save protocol:', err);
                        }
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    When active, documents can be moved into the isolated memory layer. Toggle this off to suspend all vaulting protocols.
                  </div>
                </div>

                {/* Key Card */}
                <div className="policy-card">
                  <div className="policy-card-header">
                    <div>
                      <div className="policy-card-name">Resonance Key</div>
                      <div className="policy-card-type">CRYPTOGRAPHIC ISOLATION</div>
                    </div>
                    <div className="policy-card-icon">🔐</div>
                  </div>
                  <div style={{ marginTop: '16px' }}>
                    <div className="form-group">
                      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Establish New PIN</label>
                      <input 
                        type="password" 
                        className="chat-input"
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value)}
                        placeholder="••••"
                        style={{ textAlign: 'center', fontSize: '1.2rem', letterSpacing: '4px', width: '100%', marginTop: '8px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '16px', alignItems: 'center' }}>
                      <button 
                        className="btn btn-primary btn-sm flex-1" 
                        onClick={handleSavePreferences}
                        disabled={saveStatus === 'Saving...'}
                      >
                        {saveStatus === 'Saving...' ? 'Saving...' : 'Save Configuration'}
                      </button>
                      <button 
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          if (confirm('Clear your Resonance Key and return to Open-by-Default status?')) {
                            setSaveStatus('Clearing...');
                            try {
                              const { updatePreferences } = await import('../services/api');
                              await updatePreferences({ resonance_key: '' });
                              setPinInput('');
                              setSaveStatus('Cleared!');
                              if (onPreferencesUpdate) onPreferencesUpdate();
                              setTimeout(() => setSaveStatus(''), 2000);
                              loadData();
                            } catch (err: any) {
                              setSaveStatus(`Error: ${err.message}`);
                            }
                          }
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    {saveStatus && (
                      <div style={{ marginTop: '12px', fontSize: '0.72rem', color: saveStatus.includes('Error') ? 'var(--accent-red)' : 'var(--accent-cyan)' }}>
                        {saveStatus}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mono text-muted" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
                ◆ Synchronizing Pilot Preferences...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
