import { useState, useRef, useEffect } from 'react';
import type { Message, User } from '../types';
import { motion } from 'motion/react';

interface Props {
  messages: Message[];
  streamingContent: string;
  isStreaming: boolean;
  onSend: (content: string) => void;
  selectedModel: string;
  ragSources: any[];
  user: User | null;
  onOpenSource: (docId: string) => void;
}

export function CommandConsole({ messages, streamingContent, isStreaming, onSend, selectedModel, ragSources, user, onOpenSource }: Props) {
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  // Smart auto-scroll: only scroll if user is at bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  }, [messages, streamingContent, isAtBottom]);

  // Detect user scroll position
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setIsAtBottom(distFromBottom < 80);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '24px';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  const handleSubmit = () => {
    if (!input.trim() || isStreaming) return;
    onSend(input.trim());
    setInput('');
    setIsAtBottom(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const copyToClipboard = async (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for non-secure contexts (mobile testing over local IP, etc)
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error('Fallback copy failed:', err);
      }
      document.body.removeChild(textArea);
    }
  };

  const copyMessage = async (id: string, content: string) => {
    // Filter out mental trace if it exists for the main message copy
    const cleanContent = content.replace(/<mental_trace>[\s\S]*?<\/mental_trace>/g, '').trim();
    await copyToClipboard(cleanContent);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const copyTrace = async (e: React.MouseEvent, id: string, traceContent: string) => {
    e.preventDefault();
    e.stopPropagation();
    await copyToClipboard(traceContent);
    setCopied(`trace-${id}`);
    setTimeout(() => setCopied(null), 2000);
  };

  const getSafeDate = (dateStr: string) => {
    if (!dateStr) return new Date();
    const safeStr = dateStr.includes('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    return new Date(safeStr);
  };

  // Full Markdown renderer
  const renderMarkdown = (text: string): React.ReactNode[] => {
    const lines = text.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;

    const renderInline = (line: string, key: string): React.ReactNode => {
      // Split on code blocks, bold, italic, links
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g;
      const parts: React.ReactNode[] = [];
      let last = 0;
      let match: RegExpExecArray | null;
      let partIdx = 0;
      while ((match = pattern.exec(line)) !== null) {
        if (match.index > last) parts.push(<span key={`${key}-t${partIdx++}`}>{line.slice(last, match.index)}</span>);
        const m = match[0];
        if (m.startsWith('`')) {
          parts.push(<code key={`${key}-c${partIdx++}`}>{m.slice(1, -1)}</code>);
        } else if (m.startsWith('**')) {
          parts.push(<strong key={`${key}-b${partIdx++}`}>{m.slice(2, -2)}</strong>);
        } else if (m.startsWith('*')) {
          parts.push(<em key={`${key}-i${partIdx++}`}>{m.slice(1, -1)}</em>);
        } else {
          // Link: [text](url)
          parts.push(<a key={`${key}-l${partIdx++}`} href={match[3]} target="_blank" rel="noopener noreferrer">{match[2]}</a>);
        }
        last = match.index + m.length;
      }
      if (last < line.length) parts.push(<span key={`${key}-t${partIdx}`}>{line.slice(last)}</span>);
      return parts.length === 1 ? parts[0] : parts;
    };

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code block
      if (line.startsWith('```')) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        nodes.push(
          <div key={`cb-${i}`} className="md-code-block">
            {lang && <div className="md-code-lang">{lang}</div>}
            <pre><code>{codeLines.join('\n')}</code></pre>
          </div>
        );
        i++;
        continue;
      }

      // Headings
      const h3 = line.match(/^### (.+)/);
      const h2 = line.match(/^## (.+)/);
      const h1 = line.match(/^# (.+)/);
      if (h1) { nodes.push(<h1 key={`h1-${i}`} className="md-h1">{renderInline(h1[1], `h1-${i}`)}</h1>); i++; continue; }
      if (h2) { nodes.push(<h2 key={`h2-${i}`} className="md-h2">{renderInline(h2[1], `h2-${i}`)}</h2>); i++; continue; }
      if (h3) { nodes.push(<h3 key={`h3-${i}`} className="md-h3">{renderInline(h3[1], `h3-${i}`)}</h3>); i++; continue; }

      // Horizontal rule
      if (line.match(/^---+$/)) { nodes.push(<hr key={`hr-${i}`} className="md-hr" />); i++; continue; }

      // Blockquote
      if (line.startsWith('> ')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].startsWith('> ')) {
          quoteLines.push(lines[i].slice(2));
          i++;
        }
        nodes.push(<blockquote key={`bq-${i}`} className="md-blockquote">{quoteLines.map((l, qi) => <p key={qi}>{renderInline(l, `bq-${i}-${qi}`)}</p>)}</blockquote>);
        continue;
      }

      // Unordered list
      if (line.match(/^[-*+] /)) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^[-*+] /)) {
          items.push(lines[i].slice(2));
          i++;
        }
        nodes.push(<ul key={`ul-${i}`} className="md-ul">{items.map((item, li) => <li key={li}>{renderInline(item, `ul-${i}-${li}`)}</li>)}</ul>);
        continue;
      }

      // Ordered list
      if (line.match(/^\d+\. /)) {
        const items: string[] = [];
        while (i < lines.length && lines[i].match(/^\d+\. /)) {
          items.push(lines[i].replace(/^\d+\. /, ''));
          i++;
        }
        nodes.push(<ol key={`ol-${i}`} className="md-ol">{items.map((item, li) => <li key={li}>{renderInline(item, `ol-${i}-${li}`)}</li>)}</ol>);
        continue;
      }

      // Empty line = paragraph break
      if (line.trim() === '') { nodes.push(<div key={`br-${i}`} className="md-br" />); i++; continue; }

      // Regular paragraph
      nodes.push(<p key={`p-${i}`} className="md-p">{renderInline(line, `p-${i}`)}</p>);
      i++;
    }
    return nodes;
  };

  const renderContent = (text: string) => {
    const trimmedText = text.trim();
    
    // --- ROBUST PARSING ENGINE ---
    let trace: string | null = null;
    let cleanText = text;

    // Extract ALL <mental_trace> blocks safely
    const traceRegex = /<mental_trace>([\s\S]*?)<\/mental_trace>/g;
    const traces: string[] = [];
    let match;

    if (text.includes('</mental_trace>')) {
      while ((match = traceRegex.exec(text)) !== null) {
        traces.push(match[1].trim());
      }
      if (traces.length > 0) {
        trace = traces.join('\n\n---\n\n');
        cleanText = text.replace(/<mental_trace>[\s\S]*?<\/mental_trace>/g, '').trim();
      }
    } else if (text.includes('<mental_trace>')) {
      // Unclosed tag (streaming)
      const parts = text.split('<mental_trace>');
      trace = parts[1].trim();
      cleanText = parts[0].trim();
    } else if (text.includes('<m') && !text.includes('>')) {
      // Hide partial tags
      const tagStart = text.indexOf('<m');
      cleanText = text.slice(0, tagStart).trim();
      trace = 'Thinking...';
    } else {
      // Fallback: Heuristic split (for models that don't use tags)
      const heuristicRegex = /^\s*(?:[\*\#\-\s])*?(?:Plan|Thinking|Reasoning|Analysis|Goal|Step \d|Directive|Wait|Actually|Based on|To address|Let's|The user|I need|I will|I should|I am going to|I'll|Let me|First|Since)/i;
      if (heuristicRegex.test(trimmedText)) {
        const responseSigs = ['Done.', "I've ", 'Here is', 'Sure,', 'Okay,', 'I have ', 'As requested', 'Noted.', "I'm ", 'Absolutely', 'Certainly', 'Logged.', 'I added', 'I updated', 'The knowledge base', 'Your knowledge base'];
        let splitIndex = -1;
        for (const sig of responseSigs) {
          const idx = text.indexOf(sig);
          if (idx !== -1 && (splitIndex === -1 || idx < splitIndex)) splitIndex = idx;
        }
        if (splitIndex !== -1) {
          trace = text.slice(0, splitIndex).trim();
          cleanText = text.slice(splitIndex).trim();
        } else {
          trace = text.trim();
          cleanText = '';
        }
      }
    }

    const hasContent = cleanText.length > 0;

    return (
      <div className="rendered-message-container">
        {trace && (
          <details className="mental-trace-details" open={false}>
            <summary className="mental-trace-summary">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', flex: 1 }}>
                <span className="mental-trace-icon">🧠</span> Mental Trace
              </div>
              <button 
                className="copy-trace-btn"
                onClick={(e) => copyTrace(e, Math.random().toString(), trace)}
              >
                {copied?.startsWith('trace-') ? '✓ Copied' : '❐ Copy Trace'}
              </button>
            </summary>
            <div className="mental-trace-content">{trace}</div>
          </details>
        )}
        <div className="primary-response">
          {hasContent ? renderMarkdown(cleanText) : (
            <div className="streaming-placeholder">⚓ Operator is thinking...</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="command-console">
      {/* Messages */}
      <div className="chat-messages" ref={chatRef} style={{ overflowY: 'auto' }}>
        {messages.length === 0 && !streamingContent ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">⚓</div>
            <div className="chat-empty-title">Welcome to the Helm</div>
            <div className="chat-empty-subtitle">
              ... or your second brain! Upload documents and data through chat or your knowledge base and/or ask a question about whatever you're thinking.
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', justifyContent: 'center' }}>
              <span className="badge badge-cyan">RAG-Powered</span>
              <span className="badge badge-amber">Multi-Model</span>
              <span className="badge badge-green">MCP Tools</span>
              <span className="badge badge-purple">Governed</span>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, index) => (
              <motion.div
                key={msg.id}
                className={`message ${msg.role}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut', delay: index === messages.length - 1 ? 0.1 : 0 }}
              >
                <div className="message-avatar">
                  {msg.role === 'user' ? (user?.displayName?.[0]?.toUpperCase() || 'U') : '⚓'}
                </div>
                <div className="message-content">
                  <div className="message-bubble">
                    {renderContent(msg.content)}
                  </div>
                  
                  {msg.role === 'user' && msg.created_at && (
                    <div className="message-meta" style={{ justifyContent: 'flex-end', marginTop: '4px' }}>
                      <span className="msg-time" title={getSafeDate(msg.created_at).toLocaleString()}>
                        {getSafeDate(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  
                  {/* RAG sources on assistant message */}
                  {msg.role === 'assistant' && msg.rag_sources && (
                    <div className="rag-sources">
                      {(() => {
                        try {
                          const sources = JSON.parse(msg.rag_sources);
                          // Unique by ID/filename to avoid duplicate chips
                          const uniqueSources: any[] = [];
                          const seen = new Set();
                          for (const s of sources) {
                            const key = typeof s === 'object' ? (s.id || s.document_id || s.documentId || s.filename) : s;
                            if (key && !seen.has(key)) {
                              seen.add(key);
                              uniqueSources.push(s);
                            }
                          }

                          return uniqueSources.map((source: any, i: number) => {
                            const isObject = typeof source === 'object' && source !== null;
                            // ID detection for KB, URL detection for Web
                            const id = isObject ? (source.documentId || source.document_id || source.id || source.doc_id) : null;
                            const url = isObject ? (source.url || source.source || source.uri) : null;
                            const name = isObject ? (source.filename || source.title) : source;
                            const score = isObject && source.score !== undefined ? ` (${(source.score * 100).toFixed(0)}%)` : '';

                            // Always make it clickable if we have a name or id
                            const isClickable = !!(id || url || name);

                            return (
                              <span 
                                key={i} 
                                className={`rag-source-chip ${isClickable ? 'clickable' : ''}`}
                                style={{ cursor: isClickable ? 'pointer' : 'default', pointerEvents: 'auto' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  console.log('--- CHIP CLICK ---');
                                  console.log('Source Data:', source);
                                  if (id) {
                                    onOpenSource(id);
                                  } else if (url) {
                                    window.open(url, '_blank', 'noopener,noreferrer');
                                  } else if (name) {
                                    // Fallback: try to open by name
                                    onOpenSource(name);
                                  }
                                }}
                                title={id ? 'Open in Knowledge Base' : (url ? 'Open in Browser' : 'Search in Vault')}
                              >
                                📎 {name}{score}
                              </span>
                            );
                          });
                        } catch (e) {
                          return null;
                        }
                      })()}
                    </div>
                  )}

                  {msg.role === 'assistant' && (
                    <div className="message-meta">
                      {msg.created_at && (
                        <span className="msg-time" title={getSafeDate(msg.created_at).toLocaleString()}>
                          {(() => {
                            const timeStr = getSafeDate(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                            const [time, ampm] = timeStr.split(' ');
                            return (
                              <span className="stacked-time">
                                <span>{time}</span>
                                <span>{ampm}</span>
                              </span>
                            );
                          })()}
                        </span>
                      )}
                      <div className="meta-stats">
                        {msg.model && <span className="meta-model">{msg.model}</span>}
                        {msg.tokens_in !== undefined && msg.tokens_in > 0 && (
                          <>
                            <span className="meta-sep">—</span>
                            <span>{(msg.tokens_in + (msg.tokens_out || 0)).toLocaleString()} tokens</span>
                          </>
                        )}
                        {msg.latency_ms !== undefined && msg.latency_ms > 0 && (
                          <>
                            <span className="meta-sep">—</span>
                            <span>{(msg.latency_ms / 1000).toFixed(1)}s</span>
                          </>
                        )}
                      </div>
                      <button
                        className="copy-msg-btn always-visible"
                        onClick={() => copyMessage(msg.id, msg.content)}
                        title="Copy message"
                      >
                        {copied === msg.id ? '✓ Copied' : '❐ Copy'}
                      </button>
                    </div>
                  )}
                  {/* Tool executions */}
                  {msg.role === 'assistant' && msg.tool_calls && (
                    <div className="rag-sources">
                      {JSON.parse(msg.tool_calls).map((tool: string, i: number) => (
                        <span key={i} className="rag-source-chip" style={{ background: 'rgba(147, 51, 234, 0.15)', color: '#d8b4fe', borderColor: 'rgba(147, 51, 234, 0.3)' }}>
                          ⚙ Used {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            {/* Streaming message */}
            {streamingContent && (
              <motion.div
                className="message assistant"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="message-avatar">⚓</div>
                <div className="message-content">
                  <div className="message-bubble">
                    {renderContent(streamingContent)}
                    <span className="streaming-cursor" />
                  </div>
                    
                    {ragSources.length > 0 && (
                      <div className="rag-sources">
                        {(() => {
                          const uniqueSources: any[] = [];
                          const seen = new Set();
                          for (const s of ragSources) {
                            const key = s.id || s.document_id || s.documentId || s.filename;
                            if (key && !seen.has(key)) {
                              seen.add(key);
                              uniqueSources.push(s);
                            }
                          }

                          return uniqueSources.map((source: any, i: number) => {
                            const id = source.documentId || source.document_id || source.id || source.doc_id;
                            const url = source.url || source.source || source.uri;
                            return (
                              <span 
                                key={i} 
                                className="rag-source-chip clickable"
                                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  console.log('--- STREAMING CHIP CLICK ---');
                                  console.log('Source Data:', source);
                                  console.log('Detected ID:', id);
                                  console.log('Detected URL:', url);
                                  if (id) {
                                    onOpenSource(id);
                                  } else if (url) {
                                    window.open(url, '_blank', 'noopener,noreferrer');
                                  }
                                }}
                                title={id ? 'Open in Knowledge Base' : (url ? 'Open in Browser' : 'Click to open')}
                              >
                                📎 {source.filename || source.title} ({(source.score * 100).toFixed(0)}%)
                              </span>
                            );
                          });
                        })()}
                      </div>
                    )}
                </div>
              </motion.div>
            )}

            {/* Streaming indicator without content */}
            {isStreaming && !streamingContent && (
              <div className="message assistant">
                <div className="message-avatar">⚓</div>
                <div className="message-content">
                  <div className="message-bubble">
                    <span className="streaming-cursor" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-to-bottom button */}
      {!isAtBottom && (
        <button
          className="scroll-to-bottom-btn"
          onClick={() => { setIsAtBottom(true); scrollToBottom(); }}
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}

      {/* Input */}
      <div className="chat-input-container">
        <div 
          className="chat-input-wrapper"
          onClick={() => textareaRef.current?.focus()}
        >
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="... (Enter to send, Shift+Enter for newline)"
            rows={1}
            disabled={isStreaming}
          />
          <button
            className="chat-send-btn"
            onClick={handleSubmit}
            disabled={!input.trim() || isStreaming}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
