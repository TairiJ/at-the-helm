import { useRef, useState, useEffect } from 'react';
import type { Model, Conversation, User, Document } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { uploadDocument, getDocuments, deleteDocument, ingestUrl } from '../services/api';

const PROVIDER_MAP: Record<string, string> = {
  'Anthropic': 'anthropic',
  'Google': 'google',
  'OpenAI': 'openai',
};

const PROVIDER_ABBREV: Record<string, string> = {
  'anthropic': 'CL',
  'google': 'GM',
  'openai': 'OA',
};

interface Props {
  models: Model[];
  selectedModel: string;
  onModelSelect: (id: string) => void;
  conversations: Conversation[];
  activeConversation: string | null;
  onConversationSelect: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  user: User | null;
  onOpenKnowledgeBase: (docId?: string) => void;
  isModelLocked: boolean;
  onToggleLock: () => void;
  documents: Document[];
  onRefreshDocuments: () => Promise<void>;
  isMobileOpen?: boolean;
}

export function AgentRoster({
  models, selectedModel, onModelSelect,
  conversations, activeConversation,
  onConversationSelect, onNewConversation, onDeleteConversation,
  user, onOpenKnowledgeBase,
  isModelLocked, onToggleLock,
  documents, onRefreshDocuments,
  isMobileOpen = false
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);

    for (let i = 0; i < files.length; i++) {
      setUploadStatus(`Processing ${files[i].name}... (${i + 1}/${files.length})`);
      try {
        await uploadDocument(files[i], false);
      } catch (err: any) {
        console.error(`Upload failed for ${files[i].name}:`, err);
        setUploadStatus(`Failed: ${files[i].name} — ${err.message}`);
      }
    }

    setUploadStatus('');
    setUploading(false);
    await onRefreshDocuments();
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleUrlSubmit = async () => {
    if (!urlValue.trim()) return;

    // Basic URL validation
    let url = urlValue.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    setUrlLoading(true);
    setUploadStatus(`Fetching ${url}...`);
    try {
      await ingestUrl(url, false);
      setUrlValue('');
      setShowUrlInput(false);
      setUploadStatus('');
      await onRefreshDocuments();
    } catch (err: any) {
      setUploadStatus(`Failed: ${err.message}`);
    }
    setUrlLoading(false);
  };

  const handleDeleteDoc = async (id: string) => {
    try {
      await deleteDocument(id);
      await onRefreshDocuments();
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const formatDate = (dateStr: string) => {
    // SQLite returns "YYYY-MM-DD HH:MM:SS" (UTC). Append 'Z' to force UTC parsing.
    const safeStr = dateStr.includes('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(safeStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHrs = diffMs / 3600000;
    
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    
    // Calculate difference in calendar days
    const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((nowDate.getTime() - dDate.getTime()) / 86400000);
    
    if (diffDays === 0) {
      return timeStr;
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else {
      return `${diffDays}d ago`;
    }
  };

  return (
    <motion.div 
      className={`agent-roster ${isMobileOpen ? 'mobile-open' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Model Selection */}
      <div className="roster-section">
        <div className="roster-section-title">⬡ Models</div>
        <div className="model-select-wrapper" style={{ padding: '0 4px', position: 'relative' }}>
          <div 
            className="chat-input"
            onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
            style={{ width: '100%', padding: '8px 12px', cursor: 'pointer', background: 'var(--surface-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span>{models.find(m => m.id === selectedModel)?.name || 'Select Model'}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLock();
                }}
                className={`btn-ghost ${isModelLocked ? 'text-primary' : 'text-dim'}`}
                style={{ border: 'none', background: 'transparent', padding: 0, fontSize: '1.1rem', color: isModelLocked ? 'var(--accent-cyan)' : 'var(--text-dim)', transition: 'color 0.2s' }}
                title={isModelLocked ? 'Selection Locked' : 'Auto-Route Active'}
              >
                {isModelLocked ? '🔒' : '🔓'}
              </button>
              <span style={{ fontSize: '0.8rem', transform: isModelDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
            </div>
          </div>

          <AnimatePresence>
            {isModelDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ 
                  position: 'relative', 
                  marginTop: '4px',
                  background: 'var(--surface-light)', 
                  border: '1px solid var(--surface-hover)', 
                  borderRadius: 'var(--radius-md)', 
                  overflow: 'hidden', 
                  zIndex: 10,
                  boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                  transformOrigin: 'top center'
                }}
              >
                {models.filter(m => 
                  m.id === 'auto' || 
                  m.id === 'gemma-3-27b' || 
                  m.id === 'gemma-4-26b' || 
                  m.id === 'gemma-4-31b'
                ).map(model => {
                  const providerKey = PROVIDER_MAP[model.provider] || 'unknown';
                  return (
                    <div 
                      key={model.id}
                      onClick={() => {
                        onModelSelect(model.id);
                        setIsModelDropdownOpen(false);
                      }}
                      style={{ 
                        padding: '8px 12px', 
                        cursor: 'pointer',
                        background: model.id === selectedModel ? 'var(--surface-hover)' : 'transparent',
                        color: model.id === selectedModel ? 'var(--text-primary)' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'background 0.2s, color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--surface-hover)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                      }}
                      onMouseLeave={(e) => {
                        if (model.id !== selectedModel) {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--text-secondary)';
                        }
                      }}
                    >
                      <span className={`model-card-icon ${providerKey}`} style={{ width: '24px', height: '24px', fontSize: '0.7rem', flexShrink: 0 }}>
                        {PROVIDER_ABBREV[providerKey] || '??'}
                      </span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{model.name}</span>
                        <span style={{ fontSize: '0.7rem', opacity: 0.65, lineHeight: 1.2 }}>{model.description}</span>
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Knowledge Base — Upload, Links, Documents */}
      {user && user.role !== 'anonymous' && (
        <motion.div 
          className="roster-section"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <div className="roster-section-title">📚 Knowledge Base</div>

          {/* Upload buttons row */}
          <div style={{ display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
            <button
              className="new-chat-btn"
              style={{ flex: 1, marginBottom: 0, fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              📄 Upload File
            </button>
            <button
              className="new-chat-btn"
              style={{ flex: 1, marginBottom: 0, fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-sm)' }}
              onClick={() => setShowUrlInput(!showUrlInput)}
              disabled={urlLoading}
            >
              🔗 Add Link
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.pdf,.csv,.json,.epub,.docx"
            onChange={handleUpload}
            style={{ display: 'none' }}
            multiple
          />

          {/* URL Input */}
          {showUrlInput && (
            <div style={{ display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-sm)' }}>
              <input
                type="url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                placeholder="https://example.com/article"
                style={{ flex: 1, fontSize: '0.78rem', padding: '6px 8px' }}
                autoFocus
                disabled={urlLoading}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleUrlSubmit}
                disabled={urlLoading || !urlValue.trim()}
                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
              >
                {urlLoading ? '...' : '→'}
              </button>
            </div>
          )}

          {/* Status message */}
          {uploadStatus && (
            <div style={{
              fontSize: '0.72rem',
              color: uploadStatus.startsWith('Failed') ? 'var(--accent-red)' : 'var(--accent-cyan)',
              padding: '4px 8px',
              marginBottom: 'var(--space-xs)',
              fontFamily: 'var(--font-mono)',
            }}>
              {uploadStatus}
            </div>
          )}

          {/* Document list */}
          <div style={{ maxHeight: 150, overflowY: 'auto' }}>
            {documents.filter(doc => (doc as any).is_vault !== 1).map(doc => (
              <div 
                key={doc.id} 
                className="doc-item" 
                style={{ justifyContent: 'space-between' }}
                onClick={() => onOpenKnowledgeBase(doc.id)}
              >
                <span className="doc-item-icon">
                  {(doc as any).is_vault === 1 ? '🔒' : (doc.mime_type === 'text/html' ? '🔗' : '📄')}
                </span>
                <span style={{
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontSize: '0.73rem',
                }}>
                  {doc.filename}
                </span>
                <span className="badge badge-cyan" style={{ fontSize: '0.65rem', marginRight: '4px' }}>
                  {doc.chunk_count}
                </span>
                <button
                  className="conversation-item-delete"
                  style={{ opacity: 0.4, fontSize: '0.7rem' }}
                  onClick={() => handleDeleteDoc(doc.id)}
                  title="Delete document"
                >
                  ✕
                </button>
              </div>
            ))}
            {documents.length === 0 && (
              <div style={{ padding: 'var(--space-sm)', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.72rem' }}>
                Upload files or paste links to build your knowledge base
              </div>
            )}
          </div>
          {onOpenKnowledgeBase && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', marginTop: 'var(--space-xs)', fontSize: '0.72rem', opacity: 0.7 }}
              onClick={() => onOpenKnowledgeBase()}
            >
              📚 Open Full Library →
            </button>
          )}
        </motion.div>
      )}

      {/* Conversations */}
      <div className="roster-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="roster-section-title">💬 Conversations</div>
        <button className="new-chat-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
        <div className="conversations-list">
          {conversations.map(conv => (
            <div
              key={conv.id}
              className={`conversation-item ${activeConversation === conv.id ? 'active' : ''}`}
              onClick={() => onConversationSelect(conv.id)}
            >
              <span className="conversation-item-title">{conv.title || 'Untitled'}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', whiteSpace: 'nowrap', marginRight: '4px' }}>
                {formatDate(conv.updated_at)}
              </span>
              <button
                className="conversation-item-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(conv.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <div style={{ padding: 'var(--space-md)', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
              No conversations yet
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
