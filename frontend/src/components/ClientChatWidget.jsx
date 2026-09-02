import { useEffect, useRef, useState } from 'react';
import { ragApi } from '../lib/api';
import './ClientChatWidget.css';

const QUICK_ACTIONS = [
  { label: "What's my status?", text: "What's my status?" },
  { label: 'What do I still need to do?', text: 'What do I still need to do?' }
];

const GREETING = {
  role: 'assistant',
  text: "Hi — I can tell you where your submission stands, or answer general questions about how the audit process works. For anything else, use \"Message the admin\" below."
};

// A small, scoped assistant for CLIENTS only — never the AI compliance
// scorer (that stays admin-only). Answers their own status + general
// process questions, and can hand off a free-text message to a real admin.
export default function ClientChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [composingToAdmin, setComposingToAdmin] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open]);

  async function send(text) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setMessages((m) => [...m, { role: 'user', text: trimmed }]);
    setInput('');
    setSending(true);
    try {
      const data = await ragApi.clientChat(trimmed);
      setMessages((m) => [...m, { role: 'assistant', text: data.reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `Sorry, I couldn't answer that: ${err.message}. Try "Message the admin" instead.` }]);
    } finally {
      setSending(false);
    }
  }

  async function sendToAdmin(text) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await ragApi.messageAdmin(trimmed);
      setMessages((m) => [...m, { role: 'user', text: trimmed }, { role: 'assistant', text: "Sent to your compliance admin — they'll follow up directly." }]);
      setComposingToAdmin(false);
      setInput('');
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: `Couldn't send that: ${err.message}` }]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (composingToAdmin) sendToAdmin(input);
    else send(input);
  }

  return (
    <div className="ccw-root">
      {open && (
        <div className="ccw-panel card">
          <div className="ccw-head">
            <span className="ccw-head-title">Ask about your audit</span>
            <button type="button" className="ccw-close" onClick={() => setOpen(false)} aria-label="Close chat">✕</button>
          </div>

          <div className="ccw-list" ref={listRef}>
            {messages.map((m, i) => (
              <div key={i} className={`ccw-msg ccw-msg--${m.role}`}>{m.text}</div>
            ))}
            {sending && <div className="ccw-msg ccw-msg--assistant ccw-msg--pending">…</div>}
          </div>

          {!composingToAdmin && (
            <div className="ccw-quick-row">
              {QUICK_ACTIONS.map((qa) => (
                <button key={qa.label} type="button" className="ccw-quick-btn" onClick={() => send(qa.text)} disabled={sending}>
                  {qa.label}
                </button>
              ))}
              <button type="button" className="ccw-quick-btn ccw-quick-btn--admin" onClick={() => setComposingToAdmin(true)} disabled={sending}>
                Message the admin
              </button>
            </div>
          )}

          {composingToAdmin && (
            <div className="ccw-admin-note">
              Writing to your compliance admin — they'll see this on your record and follow up directly.
              <button type="button" className="ccw-admin-cancel" onClick={() => setComposingToAdmin(false)}>Cancel</button>
            </div>
          )}

          <form className="ccw-input-row" onSubmit={handleSubmit}>
            <input
              type="text"
              className="input"
              placeholder={composingToAdmin ? 'Type a message for your admin…' : 'Ask a question…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="btn btn-primary ccw-send-btn" disabled={sending || !input.trim()}>Send</button>
          </form>
        </div>
      )}

      <button type="button" className="ccw-fab" onClick={() => setOpen((v) => !v)} aria-label="Open assistant">
        {open ? '✕' : '💬'}
      </button>
    </div>
  );
}
