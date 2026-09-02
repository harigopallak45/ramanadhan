import { useEffect, useMemo, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { ragApi } from '../lib/api';
import { useToast } from '../lib/toast';
import './AssignedQuestionsPanel.css';

// Shows which questions a specific client was actually sent, with a way to
// change it right from their page — the same picker used at invite time,
// just reachable afterward too. null assignment = "everyone gets everything"
// (the default), which we surface honestly rather than implying a real list.
export default function AssignedQuestionsPanel({ contactId, onSaved }) {
  const toast = useToast();
  const [allQuestions, setAllQuestions] = useState([]);
  const [assignedIds, setAssignedIds] = useState(null); // null = everything
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);

  async function load() {
    setLoading(true);
    try {
      const [qRes, aRes] = await Promise.all([ragApi.listQuestions(), ragApi.getAssignments(contactId)]);
      const active = (qRes.questions || []).filter((q) => !q.archived).sort((a, b) => a.order - b.order);
      setAllQuestions(active);
      setAssignedIds(aRes.assignedIds);
    } catch (err) {
      toast(`Couldn't load assigned questions: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  function openEdit() {
    setSelected(assignedIds || allQuestions.map((q) => q.id));
    setEditOpen(true);
  }

  async function save(nextIds) {
    setSaving(true);
    try {
      await ragApi.saveAssignments(contactId, nextIds);
      setAssignedIds(nextIds && nextIds.length ? nextIds : null);
      setEditOpen(false);
      toast('Updated what this client is asked.');
      onSaved?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const bySection = useMemo(() => {
    const map = {};
    allQuestions.forEach((q) => { (map[q.section] = map[q.section] || []).push(q); });
    return map;
  }, [allQuestions]);

  function toggle(id) {
    setSelected((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  if (loading) return null;

  const isCustom = Array.isArray(assignedIds);
  const summary = isCustom
    ? `${assignedIds.length} of ${allQuestions.length} questions assigned to them`
    : `All ${allQuestions.length} questions assigned to them`;

  return (
    <div className="aqp-row">
      <span className="aqp-summary">{summary}</span>
      <Button variant="ghost" size="sm" onClick={openEdit}>Edit what they're asked</Button>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} maxWidth={520}>
        <div className="aqp-modal-head">
          <h2 className="display" style={{ fontSize: 20 }}>What should we ask this client?</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Untick anything they don't need to answer. This changes their form immediately.
          </p>
        </div>
        <div className="aqp-modal-actions">
          <button type="button" onClick={() => setSelected(allQuestions.map((q) => q.id))}>Select all</button>
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
          <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => save(selected)} disabled={saving || !selected.length}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
