import { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import './ResultBreakdown.css';

const PREFS_PREFIX = 'centinl:resultView:';

function loadPrefs(key) {
  try {
    const raw = localStorage.getItem(PREFS_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.order) ? parsed : null;
  } catch {
    return null;
  }
}

function savePrefs(key, prefs) {
  try { localStorage.setItem(PREFS_PREFIX + key, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function fileExt(name) {
  const parts = String(name || '').split('?')[0].split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : 'FILE';
}

// `a` is the per-question answer object keyed by sub-field: { subKey: {value, files} }
function hasAnswer(a) {
  if (!a) return false;
  return Object.values(a).some((sf) => sf && (String(sf.value || '').trim() || (sf.files && sf.files.length)));
}

// The one shared "what did this person actually tell us" view. Every answered
// question shows immediately as a card — even if it's the only one — and
// unanswered ones stay visible as small tags instead of disappearing, so a
// reviewer never has to guess whether something is missing or just not shown.
//
// storageKey scopes the "Customize view" preference (which questions show,
// and in what order) — pass a stable key like 'auditor' or 'client-summary'
// so different surfaces can keep independent layouts if desired, or share
// one key to keep them in sync.
export default function ResultBreakdown({ schema, answers, storageKey = 'default', allowCustomize = true, onPreviewFile }) {
  const [prefs, setPrefs] = useState(() => loadPrefs(storageKey));
  const [customizeOpen, setCustomizeOpen] = useState(false);

  useEffect(() => { setPrefs(loadPrefs(storageKey)); }, [storageKey]);

  const visible = useMemo(() => {
    if (!prefs) return schema;
    const hiddenSet = new Set(prefs.hidden || []);
    const byId = new Map(schema.map((q) => [q.id, q]));
    const ordered = prefs.order.map((id) => byId.get(id)).filter(Boolean).filter((q) => !hiddenSet.has(q.id));
    // Anything in schema but not yet in the saved order (e.g. a question
    // added after the admin last customized) still shows, appended at the end.
    const knownIds = new Set(prefs.order);
    const extras = schema.filter((q) => !knownIds.has(q.id) && !hiddenSet.has(q.id));
    return [...ordered, ...extras];
  }, [schema, prefs]);

  const answeredList = visible.filter((q) => hasAnswer(answers[q.id]));
  const unansweredList = visible.filter((q) => !hasAnswer(answers[q.id]));

  function handleSave(nextPrefs) {
    savePrefs(storageKey, nextPrefs);
    setPrefs(nextPrefs);
    setCustomizeOpen(false);
  }

  return (
    <div className="rb-root">
      <div className="rb-head">
        <div className="rb-progress-row">
          <div className="progress" style={{ flex: 1 }}>
            <div style={{ width: `${schema.length ? Math.round((answeredList.length / schema.length) * 100) : 0}%` }} />
          </div>
          <span className="rb-progress-label">{answeredList.length} of {schema.length} answered</span>
        </div>
        {allowCustomize && (
          <Button variant="ghost" size="sm" onClick={() => setCustomizeOpen(true)}>Customize view</Button>
        )}
      </div>

      <div className="rb-eyebrow">Answered so far</div>
      {answeredList.length === 0 && <div className="rb-empty">Nothing answered yet.</div>}
      <div className="rb-answered-list">
        {answeredList.map((q) => (
          <AnsweredCard key={q.id} q={q} answer={answers[q.id]} onPreviewFile={onPreviewFile} />
        ))}
      </div>

      {unansweredList.length > 0 && (
        <>
          <div className="rb-eyebrow" style={{ marginTop: 18 }}>Not answered yet ({unansweredList.length})</div>
          <div className="rb-tag-row">
            {unansweredList.map((q) => (
              <span key={q.id} className={`rb-tag ${q.critical ? 'rb-tag--critical' : ''}`} title={q.title}>{q.id}</span>
            ))}
          </div>
        </>
      )}

      {allowCustomize && (
        <CustomizeViewModal
          open={customizeOpen}
          onClose={() => setCustomizeOpen(false)}
          schema={schema}
          prefs={prefs}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function AnsweredCard({ q, answer, onPreviewFile }) {
  // Only render sub-fields that actually have something — a question with
  // 3 sub-fields but 1 filled in shows just that 1 line, not 2 empty ones.
  const subFields = (q.fields && q.fields.length ? q.fields : [{ key: 'value', label: null }])
    .map((f) => ({ field: f, sf: answer?.[f.key] || { value: '', files: [] } }))
    .filter(({ sf }) => String(sf.value || '').trim() || (sf.files && sf.files.length));

  return (
    <div className="rb-card">
      <div className="rb-card-label">{q.id} · {q.title}</div>
      {subFields.map(({ field, sf }) => (
        <div className="rb-card-subfield" key={field.key}>
          {field.label && subFields.length > 1 && <div className="rb-card-sublabel">{field.label}</div>}
          {String(sf.value || '').trim() && <div className="rb-card-value">{sf.value}</div>}
          {sf.files && sf.files.length > 0 && (
            <div className="rb-card-files">
              {sf.files.map((f, i) => (
                onPreviewFile ? (
                  <button key={i} className="rb-file-chip" onClick={() => onPreviewFile(f.url, f.name)}>
                    {fileExt(f.name)} · {f.name}
                  </button>
                ) : (
                  <a key={i} className="rb-file-chip" href={f.url} target="_blank" rel="noreferrer">
                    {fileExt(f.name)} · {f.name}
                  </a>
                )
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CustomizeViewModal({ open, onClose, schema, prefs, onSave }) {
  const [order, setOrder] = useState([]);
  const [hidden, setHidden] = useState(new Set());

  useEffect(() => {
    if (!open) return;
    if (prefs) {
      const knownIds = new Set(prefs.order);
      const extras = schema.filter((q) => !knownIds.has(q.id)).map((q) => q.id);
      setOrder([...prefs.order.filter((id) => schema.some((q) => q.id === id)), ...extras]);
      setHidden(new Set(prefs.hidden || []));
    } else {
      setOrder(schema.map((q) => q.id));
      setHidden(new Set());
    }
  }, [open, prefs, schema]);

  const byId = useMemo(() => new Map(schema.map((q) => [q.id, q])), [schema]);

  function move(id, dir) {
    setOrder((list) => {
      const idx = list.indexOf(id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= list.length) return list;
      const copy = [...list];
      [copy[idx], copy[swapIdx]] = [copy[swapIdx], copy[idx]];
      return copy;
    });
  }
  function toggleHidden(id) {
    setHidden((h) => {
      const next = new Set(h);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={520}>
      <div className="rb-customize-head">
        <h2 className="display" style={{ fontSize: 20 }}>Customize this view</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Choose which questions show here and in what order. This only changes what you see — it doesn't change what the client was asked.
        </p>
      </div>
      <div className="rb-customize-list">
        {order.map((id, i) => {
          const q = byId.get(id);
          if (!q) return null;
          return (
            <div className="rb-customize-row" key={id}>
              <div className="rb-customize-order">
                <button type="button" disabled={i === 0} onClick={() => move(id, -1)}>▲</button>
                <button type="button" disabled={i === order.length - 1} onClick={() => move(id, 1)}>▼</button>
              </div>
              <label className="rb-customize-label">
                <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggleHidden(id)} />
                <span>{q.id} · {q.title}</span>
              </label>
            </div>
          );
        })}
      </div>
      <div className="rb-customize-foot">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" onClick={() => onSave(null)}>Reset to default</Button>
        <Button variant="primary" onClick={() => onSave({ order, hidden: Array.from(hidden) })}>Save</Button>
      </div>
    </Modal>
  );
}
