import { useState, useEffect, useRef } from 'react';
import type { Document as KBDocument, User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { getDocuments, uploadDocument, ingestUrl, deleteDocument, getDocumentPreview, updateDocumentMetadata } from '../services/api';

interface Props {
  onClose: () => void;
  user: User;
  documents: KBDocument[];
  onRefresh: () => Promise<void>;
  initialDocId?: string;
  preferences?: any;
}

export function KnowledgeBase({ onClose, user, documents, onRefresh, initialDocId, preferences }: Props) {
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [chunks, setChunks] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [visibleChunks, setVisibleChunks] = useState<Set<number>>(new Set());
  const [isVaultUnlocked, setIsVaultUnlocked] = useState(false);
  const [isViewingVault, setIsViewingVault] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pendingDoc, setPendingDoc] = useState<KBDocument | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const chunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Keep selectedDoc in sync with fresh data from props (e.g. chunk count updates)
  const currentDoc = selectedDoc ? documents.find(d => d.id === selectedDoc.id) : null;

  // Sync vault unlock status with preferences
  useEffect(() => {
    if (preferences) {
      if (!preferences.resonance_key_hash) {
        // No PIN set = Open-by-Default
        setIsVaultUnlocked(true);
      } else {
        // PIN set = Forcibly lock to ensure new credentials are required
        setIsVaultUnlocked(false);
      }
    }
  }, [preferences?.resonance_key_hash]);

  // Handle deep-linking (one-time on mount or when initialDocId changes)
  const lastProcessedId = useRef<string | null>(null);

  useEffect(() => {
    if (initialDocId && documents.length > 0 && initialDocId !== lastProcessedId.current) {
      const doc = documents.find(d => d.id === initialDocId || d.filename === initialDocId);
      if (doc) {
        lastProcessedId.current = initialDocId;
        handleDocClick(doc);
      }
    }

    // Check for global UI trigger from LLM
    if ((window as any).triggerVaultChallenge) {
      delete (window as any).triggerVaultChallenge;
      if (!isVaultUnlocked) {
        setShowPinModal(true);
        setPinInput('');
      }
    }
  }, [initialDocId, documents]);

  // Intersection Observer for scroll animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const idx = Number(entry.target.getAttribute('data-chunk-idx'));
          if (entry.isIntersecting) {
            setVisibleChunks(prev => new Set([...prev, idx]));
          }
        });
      },
      { threshold: 0.15, root: scrollRef.current }
    );

    chunkRefs.current.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [chunks]);

  const handleUpload = async (files: FileList | File[]) => {
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      setUploadProgress(`Processing ${files[i].name}... (${i + 1}/${files.length})`);
      try {
        await uploadDocument(files[i], false);
      } catch (err: any) {
        setUploadProgress(`Failed: ${files[i].name} — ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    setUploadProgress('');
    setUploading(false);
    await onRefresh();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleUpload(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlValue.trim()) return;
    let url = urlValue.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    setUrlLoading(true);
    setUploadProgress(`Fetching ${url}...`);
    try {
      await ingestUrl(url, false);
      setUrlValue('');
      setShowUrlInput(false);
      setUploadProgress('');
      await onRefresh();
    } catch (err: any) {
      setUploadProgress(`Failed: ${err.message}`);
    }
    setUrlLoading(false);
  };

  const isDocSecret = (doc: KBDocument | null) => {
    if (!doc) return false;
    return doc.is_vault === 1;
  };

  const handleDocClick = async (doc: KBDocument) => {
    if (selectedDoc?.id === doc.id) {
      setSelectedDoc(null);
      setChunks([]);
      setVisibleChunks(new Set());
      return;
    }

    // Check for vault status
    const hasPin = !!preferences?.resonance_key_hash;
    if (doc.is_vault && !isVaultUnlocked && hasPin) {
      setPendingDoc(doc);
      setShowPinModal(true);
      setPinInput('');
      setPinError(false);
      return;
    }

    // Clear search on mobile so preview is prominent
    if (window.innerWidth <= 768) {
      setSearchQuery('');
    }

    try {
      const data = await getDocumentPreview(doc.id);
      setSelectedDoc(data.document);
      setChunks(data.chunks);
      setVisibleChunks(new Set());
      
      // Auto-scroll to preview
      setTimeout(() => {
        if (previewRef.current) {
          previewRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);

      // Auto-unlock vault state if it was open anyway
      if (doc.is_vault && !hasPin) {
        setIsVaultUnlocked(true);
      }
    } catch (err) {
      console.error('Preview error:', err);
    }
  };

  const handlePinSubmit = async () => {
    const targetPin = preferences?.resonance_key_hash;
    
    // If no pin is set, it's always "unlocked"
    if (!targetPin) {
      setIsVaultUnlocked(true);
      setShowPinModal(false);
      if (pendingDoc) handleDocClick(pendingDoc);
      return;
    }

    if (pinInput === targetPin) {
      setIsVaultUnlocked(true);
      setShowPinModal(false);
      localStorage.setItem('helm_resonance_key', pinInput);
      if (pendingDoc) {
        handleDocClick(pendingDoc);
        setPendingDoc(null);
      }
      if (!isViewingVault) setIsViewingVault(true);
    } else {
      setPinError(true);
      setPinInput('');
      setTimeout(() => setPinError(false), 1000);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteDocument(id);
    if (selectedDoc?.id === id) {
      setSelectedDoc(null);
      setChunks([]);
    }
    await onRefresh();
  };

  const handleToggleVault = async (doc: KBDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateDocumentMetadata(doc.id, { isVault: !doc.is_vault });
      await onRefresh();
    } catch (err) {
      console.error('Failed to toggle vault:', err);
    }
  };

  const getFileIcon = (doc: KBDocument) => {
    if (isDocSecret(doc) && !isVaultUnlocked) return '🔒';
    const ext = doc.filename.split('.').pop()?.toLowerCase();
    if (doc.mime_type === 'text/html') return '🔗';
    if (ext === 'epub') return '📖';
    if (ext === 'pdf') return '📕';
    if (ext === 'docx') return '📝';
    if (ext === 'md') return '📋';
    if (ext === 'json') return '📊';
    return '📄';
  };

  const formatSize = (chunks: number) => {
    if (chunks > 100) return `${chunks} chunks · Book`;
    if (chunks > 20) return `${chunks} chunks · Article`;
    return `${chunks} chunks`;
  };

  return (
    <motion.div 
      className="kb-overlay"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Header */}
      <div className="kb-header">
        <div className="kb-header-left">
          <button className="btn btn-ghost btn-sm" onClick={isViewingVault ? () => setIsViewingVault(false) : onClose}>
            {isViewingVault ? '← Exit Vault' : '← Back'}
          </button>
          <h1 className="kb-title">{isViewingVault ? '🔐 Restricted Vault' : '📚 Knowledge Base'}</h1>
          <span className="badge badge-cyan">{isViewingVault ? documents.filter(d => d.is_vault).length : documents.length} documents</span>
        </div>
        <div className="kb-header-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowUrlInput(!showUrlInput)}
          >
            🔗 Add Link
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            📄 Upload Files
          </button>
        </div>
      </div>

      {/* URL Input Bar */}
      {showUrlInput && (
        <div className="kb-url-bar animate-fade-in">
          <input
            type="url"
            value={urlValue}
            onChange={e => setUrlValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUrlSubmit()}
            placeholder="Paste a URL to add to your knowledge base..."
            autoFocus
            disabled={urlLoading}
          />
          <button className="btn btn-primary btn-sm" onClick={handleUrlSubmit} disabled={urlLoading || !urlValue.trim()}>
            {urlLoading ? 'Processing...' : 'Ingest →'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowUrlInput(false)}>✕</button>
        </div>
      )}

      {/* Upload status */}
      {uploadProgress && (
        <div className="kb-status animate-fade-in">{uploadProgress}</div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.pdf,.csv,.json,.epub,.docx"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        multiple
      />

      {/* Main Content */}
      <div className={`kb-content ${showPinModal ? 'vault-active' : ''}`} ref={scrollRef}>
        {/* Search Bar */}
        <div className="kb-search-container">
          <div className="kb-search-wrapper">
            <span className="kb-search-icon">🔍</span>
            <input 
              type="text" 
              className="kb-search-input" 
              placeholder={isViewingVault ? "Search secure records..." : "Search your library..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="kb-search-clear" onClick={() => setSearchQuery('')}>✕</button>
            )}
          </div>
          
          {/* Search Suggestions */}
          <AnimatePresence>
            {searchQuery.length > 0 && (
              <motion.div 
                className="kb-search-suggestions"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {documents
                  .filter(d => isViewingVault ? isDocSecret(d) : !isDocSecret(d))
                  .filter(d => d.filename.toLowerCase().includes(searchQuery.toLowerCase()))
                  .slice(0, 5)
                  .map(doc => (
                    <div 
                      key={doc.id} 
                      className="kb-suggestion-item"
                      onClick={() => {
                        handleDocClick(doc);
                        setSearchQuery('');
                      }}
                    >
                      <span className="kb-suggestion-icon">
                        {isDocSecret(doc) ? '🛡️' : (doc.mime_type === 'text/html' ? '🔗' : '📄')}
                      </span>
                      <span className="kb-suggestion-name">{doc.filename}</span>
                    </div>
                  ))
                }
                {documents.filter(d => 
                  (isViewingVault ? isDocSecret(d) : !isDocSecret(d)) && 
                  d.filename.toLowerCase().includes(searchQuery.toLowerCase())
                ).length === 0 && (
                  <div className="kb-suggestion-empty">No matching records found</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Drop Zone */}
        {!isViewingVault && (
          <div
            className={`kb-dropzone ${dragOver ? 'active' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div className="kb-dropzone-icon">{dragOver ? '⬇' : '📚'}</div>
            <div className="kb-dropzone-title">
              {dragOver ? 'Drop files here' : 'Drag & drop files to add to your knowledge base'}
            </div>
            <div className="kb-dropzone-sub">
              Supports: PDF, EPUB, DOCX, Markdown, TXT, CSV, JSON — up to 100MB
            </div>
          </div>
        )}

        {/* Knowledge Sections */}
        {documents.length > 0 && (() => {
          const filtered = documents.filter(d => 
            d.filename.toLowerCase().includes(searchQuery.toLowerCase())
          );
          const vaultDocs = filtered.filter(isDocSecret);
          const generalDocs = filtered.filter(d => !isDocSecret(d));

          if (isViewingVault) {
            // Show Lock Screen if not unlocked and PIN exists
            if (!isVaultUnlocked && preferences?.resonance_key_hash) {
              return (
                <div className="kb-section animate-fade-in" style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: '4rem', marginBottom: '24px', filter: 'drop-shadow(0 0 20px rgba(0,255,249,0.3))' }}>🔐</div>
                  <h2 className="kb-section-title" style={{ color: 'var(--accent-cyan)', fontSize: '1.5rem', marginBottom: '12px' }}>
                    Vault Locked
                  </h2>
                  <p className="text-muted" style={{ marginBottom: '24px', maxWidth: '400px', margin: '0 auto 24px' }}>
                    Cryptographic isolation is active. Enter your Resonance Key to access secure intelligence records.
                  </p>
                  <button 
                    className="btn btn-primary" 
                    onClick={() => setShowPinModal(true)}
                    style={{ padding: '12px 32px' }}
                  >
                    Enter Resonance Key
                  </button>
                </div>
              );
            }

            return (
              <div className="kb-section animate-fade-in">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h2 className="kb-section-title" style={{ color: 'var(--accent-cyan)', margin: 0 }}>🔐 Secure Records</h2>
                  {preferences?.resonance_key_hash && (
                    <button 
                      className="btn btn-ghost btn-sm" 
                      onClick={() => setIsVaultUnlocked(false)}
                      style={{ fontSize: '0.72rem' }}
                    >
                      🛡️ Lock Vault
                    </button>
                  )}
                </div>
                <div className="kb-doc-grid">
                  {vaultDocs.map((doc, i) => (
                    <div
                      key={doc.id}
                      className={`kb-doc-card vault ${currentDoc?.id === doc.id ? 'active' : ''}`}
                      onClick={() => handleDocClick(doc)}
                      style={{ animationDelay: `${i * 50}ms`, borderLeft: '3px solid var(--accent-cyan)' }}
                    >
                      <div className="kb-doc-card-header">
                        <span className="kb-doc-icon">{getFileIcon(doc)}</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="kb-doc-delete active"
                            onClick={(e) => handleToggleVault(doc, e)}
                            title="Remove from Vault"
                            style={{ color: 'var(--accent-cyan)' }}
                          >
                            🛡️
                          </button>
                          <button
                            className="kb-doc-delete"
                            onClick={(e) => handleDelete(doc.id, e)}
                            title="Delete"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <div className="kb-doc-name">{doc.filename}</div>
                      <div className="kb-doc-meta">
                        <span className="badge badge-cyan">{formatSize(doc.chunk_count)}</span>
                        <span className="kb-doc-date">
                          {new Date(doc.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                  {vaultDocs.length === 0 && (
                    <div className="text-muted" style={{ padding: '40px', textAlign: 'center', gridColumn: '1 / -1' }}>
                      No secure records found in the vault.
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <>
              {/* Vault Entrance */}
              <div 
                className="kb-vault-entrance" 
                onClick={() => {
                  if (isVaultUnlocked || !preferences?.resonance_key_hash) {
                    setIsVaultUnlocked(true);
                    setIsViewingVault(true);
                  } else {
                    setShowPinModal(true);
                  }
                }}
              >
                <div className="kb-vault-entrance-content">
                  <span style={{ fontSize: '1.5rem' }}>🔐</span>
                  <div>
                    <div className="kb-vault-entrance-title">Secure Intelligence Vault</div>
                    <div className="kb-vault-entrance-sub">Access {vaultDocs.length} encrypted records with your Resonance Key</div>
                  </div>
                </div>
                <button 
                  className="btn btn-ghost btn-sm" 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (isVaultUnlocked || !preferences?.resonance_key_hash) {
                      setIsVaultUnlocked(true);
                      setIsViewingVault(true);
                    } else {
                      setShowPinModal(true);
                    }
                  }}
                >
                  Enter →
                </button>
              </div>

              {/* General Section */}
              {generalDocs.length > 0 && (
                <div className="kb-section">
                  <h2 className="kb-section-title">📂 General Knowledge</h2>
                  <div className="kb-doc-grid">
                    {generalDocs.map((doc, i) => (
                      <div
                        key={doc.id}
                        className={`kb-doc-card ${currentDoc?.id === doc.id ? 'active' : ''}`}
                        onClick={() => handleDocClick(doc)}
                        style={{ animationDelay: `${i * 50}ms` }}
                      >
                        <div className="kb-doc-card-header">
                          <span className="kb-doc-icon">{getFileIcon(doc)}</span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              className="kb-doc-delete"
                              onClick={(e) => handleToggleVault(doc, e)}
                              title="Move to Vault"
                            >
                              🛡️
                            </button>
                            <button
                              className="kb-doc-delete"
                              onClick={(e) => handleDelete(doc.id, e)}
                              title="Delete"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <div className="kb-doc-name">{doc.filename}</div>
                        <div className="kb-doc-meta">
                          <span className="badge badge-cyan">{formatSize(doc.chunk_count)}</span>
                          <span className="kb-doc-date">
                            {new Date(doc.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* Scrollytelling Document Preview */}
        {currentDoc && (isDocSecret(currentDoc) === isViewingVault) && (!isDocSecret(currentDoc) || isVaultUnlocked) && (
          <div className="kb-preview" ref={previewRef}>
            <div className="kb-preview-header">
              <h2 className="kb-preview-title">
                {getFileIcon(currentDoc)} {currentDoc.filename}
              </h2>
              <div className="kb-preview-meta">
                <span className="badge badge-cyan">{Math.max(currentDoc.chunk_count, chunks.length)} chunks</span>
                <span className="badge badge-purple">
                  {chunks.reduce((sum: number, c: any) => sum + (c.token_count || 0), 0).toLocaleString()} tokens
                </span>
                <button 
                  className={`btn btn-sm ${isDocSecret(currentDoc) ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={(e) => handleToggleVault(currentDoc, e)}
                  style={{ marginLeft: '12px', gap: '6px' }}
                >
                  {isDocSecret(currentDoc) ? '🛡️ Secured' : '🛡️ Move to Vault'}
                </button>
                <span className="text-muted" style={{ fontSize: '0.75rem', marginLeft: 'auto' }}>
                  Added {new Date(currentDoc.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                </span>
              </div>
              {/* Render clickable link if document has a URL in its tags or filename */}
              {(currentDoc.tags?.includes('http') || currentDoc.filename?.includes('http')) && (
                <div style={{ marginTop: 'var(--space-sm)' }}>
                  <a 
                    href={currentDoc.tags?.includes('http') ? JSON.parse(currentDoc.tags)[0] : currentDoc.filename} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="badge badge-cyan"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    🔗 Visit Original Source →
                  </a>
                </div>
              )}
            </div>

            <div className="kb-chunks-scroll">
              {/* Progress indicator */}
              <div className="kb-scroll-progress">
                <div
                  className="kb-scroll-progress-bar"
                  style={{ height: `${(visibleChunks.size / Math.max(chunks.length, 1)) * 100}%` }}
                />
              </div>

              {/* Chunk cards with scroll reveal */}
              {chunks.map((chunk: any, i: number) => (
                <div
                  key={chunk.id}
                  data-chunk-idx={i}
                  ref={el => { if (el) chunkRefs.current.set(i, el); }}
                  className={`kb-chunk-card ${visibleChunks.has(i) ? 'visible' : ''}`}
                  style={{ transitionDelay: `${(i % 5) * 60}ms` }}
                >
                  <div className="kb-chunk-header">
                    <span className="kb-chunk-index">Chunk {i + 1}</span>
                    <span className="kb-chunk-tokens mono">{chunk.token_count || '—'} tokens</span>
                  </div>
                  <div className="kb-chunk-content">
                    {chunk.content}
                  </div>
                </div>
              ))}

              {chunks.length > 0 && (
                <div className="kb-end-marker">
                  <div className="kb-end-icon">⚓</div>
                  <div className="kb-end-text">End of document — {chunks.length} chunks indexed</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {documents.length === 0 && (
          <div className="kb-empty">
            <div className="kb-empty-icon">📚</div>
            <div className="kb-empty-title">Your knowledge base is empty</div>
            <div className="kb-empty-sub">
              Upload documents, books, or paste links to build your personal intelligence vault.
              The AI will search your knowledge base during conversations.
            </div>
          </div>
        )}
      </div>

      {/* Resonance Key (PIN) Modal */}
      <AnimatePresence>
        {showPinModal && (
          <div className="modal-overlay vault-blur" style={{ zIndex: 2000 }}>
            <motion.div 
              className={`modal vault-modal ${pinError ? 'shake' : ''}`}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              style={{ maxWidth: '360px', padding: '32px' }}
            >
              <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔐</div>
                <h2 className="auth-title">The Resonance Key</h2>
                <p className="auth-subtitle">Accessing restricted knowledge vault</p>
              </div>

              <div className="form-group">
                <label>Enter Secret PIN</label>
                <input 
                  type="password" 
                  className={`chat-input ${pinError ? 'error' : ''}`}
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
                  autoFocus
                  placeholder="••••"
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '8px', color: 'var(--accent-cyan)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button className="btn btn-ghost flex-1" onClick={() => setShowPinModal(false)}>Cancel</button>
                <button className="btn btn-primary flex-1" onClick={handlePinSubmit} style={{ background: 'var(--accent-cyan)', borderColor: 'var(--accent-cyan)', color: '#000' }}>Unlock</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
