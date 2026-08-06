import { useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { ragApi } from '../lib/api';
import { useToast } from '../lib/toast';
import './AssignedQuestionsPanel.css';

// While a client's submission is locked, lets the admin grant full edit
// access back for specific questions only — instead of unlocking
// everything at once. A still-blank sub-field always stays editable for
// the client regardless of this list (see QuestionAnswerFields' per-field
// lock logic); this only affects ALREADY-answered sub-fields.
export default function EditPermissionPicker({ contactId, questions, grantedQuestionIds, onSaved }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  function openPicker() {
    setSelected(grantedQuestionIds || []);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      await ragApi.saveEditPermissions(contactId, selected);
      setOpen(false);
      toast(selected.length ? `Granted edit permission for ${selected.length} question(s)` : 'Cleared all granted questions');
      onSaved?.(selected);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const bySection = {};
  (questions || []).forEach((q) => { (bySection[q.section] = bySection[q.section] || []).push(q); });

  function toggle(id) {
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  return (
    <>
      <Button variant="secondary" className="ac-gold-outline" onClick={openPicker}>
        🔓 Grant edit permission{grantedQuestionIds?.length ? ` (${grantedQuestionIds.length})` : ''}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidth={520}>
        <div className="aqp-modal-head">
          <h2 className="display" style={{ fontSize: 20 }}>Grant edit permission</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            This client's submission is locked. Tick specific questions to let them fully edit those (including
            fields they already answered) — everything else stays locked to already-answered fields, though a
            blank field is always editable regardless of this list.
          </p>
        </div>
        <div className="aqp-modal-actions">
          <button type="button" onClick={() => setSelected((questions || []).map((q) => q.id))}>Select all</button>
          <button type="button" onClick={() => setSelected([])}>Clear</button>
        </div>
        <div className="aqp-modal-list">
          {Object.entries(bySection).map(([section, qs]) => (
            <div key={section}>
              <div className="aqp-modal-section">{section}</div>
              {qs.map((q) => (
                <label className="aqp-modal-item" key={q.id}>
                  <input type="checkbox" checked={selected.includes(q.id)} onChange={() => toggle(q.id)} />
                  <span>{q.id} · {q.title}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="aqp-modal-foot">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </Modal>
    </>
  );
}
