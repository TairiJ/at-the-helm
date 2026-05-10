import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { TelemetryBar } from './components/TelemetryBar';
import { AgentRoster } from './components/AgentRoster';
import { CommandConsole } from './components/CommandConsole';
import { ToolActivityFeed } from './components/ToolActivityFeed';
import { GovernanceDashboard } from './components/GovernanceDashboard';
import { KnowledgeBase } from './components/KnowledgeBase';
import { AuthModal } from './components/AuthModal';
import { getMe, getModels, getConversations, getConversation, sendMessage, deleteConversation, logout as logoutApi, getDocuments, getPreferences } from './services/api';
import type { User, Model, Conversation, Message, StreamChunk, Document as KBDocument } from './types';
import { motion, AnimatePresence } from 'motion/react';

function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  // Chat state
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Telemetry state
  const [sessionTokens, setSessionTokens] = useState({ in: 0, out: 0 });
  const [sessionCost, setSessionCost] = useState(0);
  const [lastLatency, setLastLatency] = useState(0);

  // Activity feed state
  const [activities, setActivities] = useState<any[]>([]);
  const [ragSources, setRagSources] = useState<any[]>([]);

  // Knowledge Base state
  const [kbDocuments, setKbDocuments] = useState<KBDocument[]>([]);

  // View state
  const [showGovernance, setShowGovernance] = useState(false);
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [showKnowledgeBase, setShowKnowledgeBase] = useState(false);
  const [kbInitialDocId, setKbInitialDocId] = useState<string | null>(null);
  const [isModelLocked, setIsModelLocked] = useState(true);
  const [preferences, setPreferences] = useState<any>(null);
  
  // Mobile layout state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Init: check auth
  useEffect(() => {
    const token = localStorage.getItem('helm_token');
    if (token) {
      getMe().then(data => {
        setUser(data.user);
      }).catch(() => {
        setUser({ id: 'anonymous-user', username: 'anonymous', role: 'anonymous', displayName: 'Anonymous' });
      });
    } else {
      setUser({ id: 'anonymous-user', username: 'anonymous', role: 'anonymous', displayName: 'Anonymous' });
    }
  }, []);

  // KB Fetch & Poll
  const refreshKB = useCallback(async () => {
    try {
      const docs = await getDocuments();
      setKbDocuments(docs);
    } catch (err) {
      console.error('KB fetch error:', err);
    }
  }, []);

  const refreshPreferences = useCallback(async () => {
    if (user && user.role !== 'anonymous') {
      try {
        const prefs = await getPreferences();
        setPreferences(prefs);
      } catch (err) {
        console.error('Preferences fetch error:', err);
      }
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      refreshKB();
      if (showKnowledgeBase) {
        const interval = setInterval(refreshKB, 10000); // Poll every 10s only when KB panel is open
        return () => clearInterval(interval);
      }
    }
  }, [user, showKnowledgeBase, refreshKB]);

  // Load models and conversations when user changes
  useEffect(() => {
    if (user) {
      getModels().then(m => {
        setModels(m);
        if (m.length > 0 && !selectedModel) {
          setSelectedModel('auto');
          setIsModelLocked(true);
        }
      }).catch(console.error);

      if (user.role !== 'anonymous') {
        getConversations().then(setConversations).catch(console.error);
        refreshPreferences();
      }
    }
  }, [user, refreshPreferences]);

  // Load conversation messages
  const loadConversation = useCallback(async (id: string) => {
    setIsMobileSidebarOpen(false);
    try {
      const data = await getConversation(id);
      setMessages(data.messages);
      setActiveConversation(id);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
  }, []);

  // Send a message
  const handleSend = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    // Add user message to UI immediately
    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: activeConversation || '',
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setStreamingContent('');
    setIsStreaming(true);
    setRagSources([]);

    const requestModel = isModelLocked ? selectedModel : 'auto';
    const modelName = models.find(m => m.id === requestModel)?.name || requestModel;
    const activity: any = {
      id: Date.now(),
      type: 'llm_call',
      model: modelName,
      status: 'running',
      startTime: Date.now(),
      input: content.slice(0, 100),
    };
    setActivities(prev => [activity, ...prev].slice(0, 20));

    try {
      let newConvId = activeConversation;
      const resonanceKey = localStorage.getItem('helm_resonance_key');
      let fullContent = '';
      let localRagSources: any[] = [];

      await sendMessage(content, requestModel, activeConversation || undefined, resonanceKey || undefined, (chunk: StreamChunk) => {
        if (chunk.type === 'text' && chunk.content?.includes('RESONANCE_CHALLENGE_REQUIRED')) {
          // Trigger the Vault prompt in the UI
          setShowKnowledgeBase(true);
          (window as any).triggerVaultChallenge = true;
        }
        switch (chunk.type) {
          case 'meta':
            if (chunk.conversationId) {
              newConvId = chunk.conversationId;
              setActiveConversation(chunk.conversationId);
            }
            if (chunk.model) {
              // Capture the actual model chosen by the auto-router
              setActivities(prev => prev.map(a => 
                a.id === activity.id ? { ...a, model: models.find(m => m.id === chunk.model)?.name || chunk.model } : a
              ));
            }
            if (chunk.ragSources && chunk.ragSources.length > 0) {
              localRagSources = [...localRagSources, ...chunk.ragSources];
              setRagSources(localRagSources);
              setActivities(prev => [{
                id: Date.now(),
                type: 'rag_search',
                status: 'done',
                startTime: Date.now(),
                results: chunk.ragSources?.length || 0,
                sources: chunk.ragSources,
              }, ...prev].slice(0, 20));
            }
            break;
          case 'text':
            fullContent += chunk.content || '';
            setStreamingContent(prev => prev + (chunk.content || ''));
            break;
          case 'governance_warning':
            setActivities(prev => [{
              id: Date.now(),
              type: 'governance',
              status: 'warning',
              warnings: chunk.warnings,
              startTime: Date.now(),
            }, ...prev].slice(0, 20));
            break;
          case 'grounding':
            if (chunk.grounding?.groundingChunks) {
              const googleSources = chunk.grounding.groundingChunks
                .filter((c: any) => c.web)
                .map((c: any) => ({
                  filename: c.web.title || 'Google Search',
                  source: c.web.uri,
                  score: 1.0
                }));
              if (googleSources.length > 0) {
                localRagSources = [...localRagSources, ...googleSources];
                setRagSources(localRagSources);
                setActivities(prev => [{
                  id: Date.now(),
                  type: 'search_grounding',
                  status: 'done',
                  startTime: Date.now(),
                  results: googleSources.length,
                }, ...prev].slice(0, 20));
              }
            }
            break;
          case 'tool_exec':
            if (chunk.tool === 'trigger_resonance_key') {
              // Open KB and trigger vault UI
              setShowKnowledgeBase(true);
              // We'll use a signal or a specific prop if needed, but for now just opening KB is a start
              // Actually, we should signal KnowledgeBase to show the PIN modal
              (window as any).triggerVaultChallenge = true;
            }
            setActivities(prev => [{
              id: chunk.callId || Date.now().toString(),
              type: 'tool_exec',
              status: 'running',
              toolName: chunk.tool,
              startTime: Date.now(),
            }, ...prev].slice(0, 20));
            break;
          case 'tool_exec_done':
            // Mark the specific tool_exec as done using callId
            setActivities(prev => {
              const activeToolIndex = prev.findIndex(a => 
                a.type === 'tool_exec' && 
                (chunk.callId ? a.id === chunk.callId : a.status === 'running')
              );
              if (activeToolIndex !== -1) {
                const updated = [...prev];
                updated[activeToolIndex] = {
                  ...updated[activeToolIndex],
                  status: 'done',
                  duration: Date.now() - updated[activeToolIndex].startTime
                };
                return updated;
              }
              return prev;
            });

            // Real-time refresh of Knowledge Base preview if a modification tool just finished
            if (chunk.tool === 'save_to_knowledge_base' || chunk.tool === 'append_to_knowledge_base' || chunk.tool === 'remove_from_knowledge_base') {
              getDocuments().then(setKbDocuments).catch(console.error);
            }

            // Bare tool_exec_done (no callId) = sentinel from server that all tools
            // are done and the final LLM response is about to stream. We wrap
            // the accumulated pre-tool text in a mental_trace so it gracefully
            // collapses into the UI, leaving a clean slate for the final response.
            if (!chunk.callId && !chunk.tool) {
              const currentText = fullContent.trim();
              if (currentText) {
                // Strip all mental_trace tags and wrap everything in a single clean tag
                const cleaned = currentText.replace(/<\/?mental_trace>/g, '').trim();
                const wrapped = `<mental_trace>\n${cleaned}\n</mental_trace>\n\n`;
                fullContent = wrapped;
                setStreamingContent(wrapped);
              }
            }
            break;
          case 'done':
            if (chunk.usage) {
              setSessionTokens(prev => ({
                in: prev.in + chunk.usage!.tokensIn,
                out: prev.out + chunk.usage!.tokensOut,
              }));
              setSessionCost(prev => prev + chunk.usage!.costUsd);
              setLastLatency(chunk.usage!.latencyMs);

              // Update activity
              setActivities(prev => prev.map(a =>
                a.id === activity.id
                  ? { ...a, status: 'done', ...chunk.usage, duration: Date.now() - a.startTime }
                  : a
              ));
            }
            break;
          case 'error':
            setActivities(prev => prev.map(a =>
              a.id === activity.id
                ? { ...a, status: 'error', error: chunk.content }
                : a
            ));
            break;
        }
      });

      // Add assistant message
      if (fullContent) {
        const assistantMsg: Message = {
          id: `msg-${Date.now()}`,
          conversation_id: newConvId || '',
          role: 'assistant',
          content: fullContent,
          model: selectedModel,
          created_at: new Date().toISOString(),
          rag_sources: localRagSources.length > 0 ? JSON.stringify(localRagSources) : undefined,
        };
        setMessages(prev => [...prev, assistantMsg]);
      }

      setStreamingContent('');
      setIsStreaming(false);

      // Refresh conversation list
      if (user?.role !== 'anonymous') {
        getConversations().then(setConversations).catch(console.error);
      }
    } catch (error: any) {
      console.error('Send error:', error);
      setIsStreaming(false);
      setStreamingContent('');
      setActivities(prev => prev.map(a =>
        a.id === activity.id ? { ...a, status: 'error', error: error.message } : a
      ));
    }
  }, [activeConversation, selectedModel, isStreaming, user, ragSources]);

  // New conversation
  const handleNewConversation = useCallback(() => {
    setIsMobileSidebarOpen(false);
    setActiveConversation(null);
    setMessages([]);
    setStreamingContent('');
    setRagSources([]);
  }, []);

  // Delete conversation
  const handleDeleteConversation = useCallback(async (id: string) => {
    await deleteConversation(id);
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversation === id) {
      handleNewConversation();
    }
  }, [activeConversation, handleNewConversation]);

  // Auth handlers
  const handleLogin = useCallback((userData: User) => {
    setUser(userData);
    setShowAuth(false);
  }, []);

  const handleLogout = useCallback(() => {
    logoutApi();
    setUser({ id: 'anonymous-user', username: 'anonymous', role: 'anonymous', displayName: 'Anonymous' });
    setConversations([]);
    handleNewConversation();
  }, [handleNewConversation]);

  const handleOpenKB = useCallback((docId?: string) => {
    console.log('handleOpenKB called with docId:', docId);
    if (docId) setKbInitialDocId(docId);
    setShowKnowledgeBase(true);
  }, []);

  const handleCloseKB = useCallback(() => {
    setShowKnowledgeBase(false);
    setKbInitialDocId(null);
  }, []);

  // Governance/Settings view
  if (showGovernance && user && user.role !== 'anonymous') {
    return (
      <GovernanceDashboard
        onBack={() => setShowGovernance(false)}
        user={user}
        onPreferencesUpdate={refreshPreferences}
      />
    );
  }

  // Knowledge Base full view
  if (showKnowledgeBase && user && user.role !== 'anonymous') {
    return (
      <KnowledgeBase
        onClose={handleCloseKB}
        user={user}
        documents={kbDocuments}
        onRefresh={refreshKB}
        initialDocId={kbInitialDocId || undefined}
        preferences={preferences}
      />
    );
  }

  const hasNewActivity = activities.length > 0 && activities[0].status === 'running';

  return (
    <div className={`cockpit ${showActivityFeed ? 'feed-open' : ''}`}>
      {/* Telemetry Bar */}
      <TelemetryBar
        model={selectedModel}
        tokensIn={sessionTokens.in}
        tokensOut={sessionTokens.out}
        cost={sessionCost}
        latency={lastLatency}
        user={user}
        onLogin={() => setShowAuth(true)}
        onLogout={handleLogout}
        onGovernance={() => setShowGovernance(true)}
        onToggleSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        isSidebarOpen={isMobileSidebarOpen}
      />

      {/* Mobile Sidebar Backdrop */}
      {isMobileSidebarOpen && (
        <div 
          className="sidebar-backdrop" 
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      <div className="cockpit-layout">
        {/* Sidebar (Agent Roster) */}
        <AgentRoster
          models={models}
          selectedModel={selectedModel}
          onModelSelect={(id) => {
            setSelectedModel(id);
            if (id === 'auto') {
              setIsModelLocked(false);
            } else {
              setIsModelLocked(true);
            }
          }}
          conversations={conversations}
          activeConversation={activeConversation}
          onConversationSelect={loadConversation}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          user={user}
          onOpenKnowledgeBase={handleOpenKB}
          isModelLocked={isModelLocked}
          onToggleLock={() => setIsModelLocked(!isModelLocked)}
          documents={kbDocuments}
          onRefreshDocuments={refreshKB}
          isMobileOpen={isMobileSidebarOpen}
        />

        {/* Main Cockpit Grid */}
        <div className="cockpit-main">
          {/* Center: Command Console */}
          <CommandConsole
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            onSend={handleSend}
            selectedModel={selectedModel}
            ragSources={ragSources}
            user={user}
            onOpenSource={handleOpenKB}
          />
        </div>
      </div>

      {/* Activity Feed Toggle Button */}
      <button
        className={`activity-toggle ${hasNewActivity ? 'pulse' : ''} ${showActivityFeed ? 'active' : ''}`}
        onClick={() => setShowActivityFeed(!showActivityFeed)}
        title="Toggle Activity Feed"
      >
        <span className="activity-toggle-icon">◆</span>
        {activities.length > 0 && (
          <span className="activity-toggle-badge">{activities.length}</span>
        )}
      </button>

      {/* Slide-out Activity Feed */}
      <AnimatePresence>
        {showActivityFeed && (
          <>
            <motion.div
              className="activity-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowActivityFeed(false)}
            />
            <motion.div
              className="activity-drawer open"
              style={{ transition: 'none' }}
              initial={{ x: 340 }}
              animate={{ x: 0 }}
              exit={{ x: 340 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <div className="activity-drawer-header">
                <span className="roster-section-title" style={{ margin: 0 }}>◆ Activity Feed</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowActivityFeed(false)}>✕</button>
              </div>
              <ToolActivityFeed
                activities={activities}
                ragSources={ragSources}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-bar-left">
          <span className="status-dot active" />
          <span className="mono text-muted">CONNECTED</span>
        </div>
        <div className="status-bar-center mono text-muted">
          AT THE HELM v1.0.0
        </div>
        <div className="status-bar-right mono text-muted">
          {user?.displayName || 'Anonymous'} • {user?.role?.toUpperCase()}
        </div>
      </div>

      {/* Auth Modal */}
      {showAuth && (
        <AuthModal
          onLogin={handleLogin}
          onClose={() => setShowAuth(false)}
        />
      )}
    </div>
  );
}

export default App;
