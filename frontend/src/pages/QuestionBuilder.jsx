import { useEffect, useState } from 'react';
import Topbar from '../components/layout/Topbar';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Field, TextInput, TextArea, Select, Toggle } from '../components/ui/Field';
import { ragApi } from '../lib/api';
import { useToast } from '../lib/toast';
import './QuestionBuilder.css';

const NAV_TABS = [{ to: '/admin', label: 'Clients' }, { to: '/questions', label: 'Question Builder' }];
const INPUT_TYPE_LABELS = {
  file: 'Document', textarea: 'Long text', text: 'Short text', number: 'Number', date: 'Date',
  radio: 'Radio select', select: 'Dropdown', phone: 'Phone', monetary: 'Monetary', checkbox: 'Checkbox (Yes/No)'
};
const NEEDS_OPTIONS = new Set(['radio', 'select']);
const EMPTY_FORM = { section: '', title: '', adequacy: '', efficacy: '', inputType: 'file', critical: false, keywords: '', options: '' };

export default function QuestionBuilder() {
  const toast = useToast();
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [dragId, setDragId] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await ragApi.listQuestions();
      setQuestions(data.questions.sort((a, b) => a.order - b.order));
      setLoadError('');
    } catch (err) {
      setLoadError(err.message);
    } finally { setLoading(false); }
  }

  const active = questions.filter((q) => !q.archived);
  const archived = questions.filter((q) => q.archived);
  const bySection = active.reduce((acc, q) => {
    (acc[q.section] = acc[q.section] || []).push(q);
    return acc;
  }, {});

  // Pick-and-move drag reorder — drop a question on top of another to swap
  // it into that spot. Works across the whole active list (not just within
  // one section), matching how `order` itself is a single global sequence.
  async function handleDrop(targetId) {
    const draggedId = dragId;
    setDragId(null);
    if (!draggedId || draggedId === targetId) return;
    const list = [...active];
    const fromIdx = list.findIndex((q) => q.id === draggedId);
    const toIdx = list.findIndex((q) => q.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    try {
      await ragApi.reorderQuestions(list.map((q) => q.id));
      await load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function openModal(q) {
    setEditingId(q?.id || null);
    setForm(q ? {
      section: q.section, title: q.title, adequacy: q.adequacy,
      efficacy: q.efficacy, inputType: q.fields?.[0]?.inputType || 'file', critical: q.critical,
      keywords: (q.keywords || []).join(', '), options: (q.fields?.[0]?.options || []).join(', ')
    } : EMPTY_FORM);
    setModalOpen(true);
  }

  const editingQuestion = editingId ? questions.find((q) => q.id === editingId) : null;
  // Multi-field Sentinel questions have their real GHL wiring fixed — the
  // single "evidence type" picker only makes sense for a genuinely new
  // question or an existing single-field custom one not yet provisioned.
  const isMultiField = (editingQuestion?.fields?.length || 0) > 1;
  const needsProvisioning = !editingId || !editingQuestion?.fields?.every((f) => f.ghlFieldId);
  const canPickEvidenceType = !isMultiField && needsProvisioning;

  async function saveQuestion() {
    if (!form.title.trim() || !form.section.trim()) return toast('Title and section are required', 'error');
    if (canPickEvidenceType && NEEDS_OPTIONS.has(form.inputType) && !form.options.trim()) {
      return toast('Add at least one option (comma-separated) for a radio/dropdown question', 'error');
    }
    if (needsProvisioning) {
      const ok = window.confirm(
        `This will create a new custom field "${form.title}" in your GHL account to store answers for this question. ` +
        `This is a real, persistent change to your CRM. Continue?`
      );
      if (!ok) return;
    }
    const payload = {
      section: form.section.trim(), title: form.title.trim(),
      adequacy: form.adequacy.trim(), efficacy: form.efficacy.trim(),
      critical: form.critical, keywords: form.keywords.split(',').map((s) => s.trim()).filter(Boolean)
    };
    if (canPickEvidenceType) {
      payload.inputType = form.inputType;
      if (NEEDS_OPTIONS.has(form.inputType)) payload.options = form.options;
    }
    setSaving(true);
    try {
      if (editingId) await ragApi.updateQuestion(editingId, payload);
      else await ragApi.addQuestion(payload);
      setModalOpen(false);
      toast(editingId ? 'Question updated' : 'Question added');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally { setSaving(false); }
  }

  async function archiveQuestion(id) {
    if (!window.confirm('Archive this question? It will disappear from the client form and future scoring, but stays readable in past scorecards.')) return;
    try { await ragApi.archiveQuestion(id); toast('Archived'); await load(); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function restoreQuestion(id) {
    try { await ragApi.restoreQuestion(id); toast('Restored'); await load(); }
    catch (err) { toast(err.message, 'error'); }
  }

  return (
    <div className="theme-dark" style={{ minHeight: '100vh' }}>
      <Topbar tabs={NAV_TABS} />
      <main className="qb-main">
        <div className="qb-head">
          <div>
            <div className="eyebrow">Evaluation framework</div>
            <h1 className="qb-title display">Question Builder</h1>
            <p className="qb-sub">This is the live list of evidence areas the AI scorer grades and the client intake form asks for. Add a question here and it appears on the client's form immediately — no changes needed anywhere else.</p>
          </div>
          <Button variant="primary" onClick={() => openModal(null)}>+ Add question</Button>
        </div>

        {loading && (
          <>
            <div className="skeleton" style={{ height: 60, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 60, marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 60 }} />
          </>
        )}

        {!loading && loadError && <div className="qb-empty">Couldn't load questions: {loadError}</div>}

        {!loading && !loadError && !questions.length && <div className="qb-empty">No questions yet.</div>}

        {!loading && !loadError && Object.entries(bySection).map(([section, list]) => (
          <div className="qb-section" key={section}>
            <div className="qb-section-heading">{section}</div>
            {list.map((q) => (
              <QuestionRow
                key={q.id} q={q} onEdit={openModal} onArchive={archiveQuestion}
                dragging={dragId === q.id}
                onDragStart={() => setDragId(q.id)}
                onDragEnd={() => setDragId(null)}
                onDrop={() => handleDrop(q.id)}
              />
            ))}
          </div>
        ))}

        {!loading && !loadError && archived.length > 0 && (
          <div className="qb-section">
            <div className="qb-section-heading">Archived ({archived.length})</div>
            {archived.map((q) => (
              <QuestionRow key={q.id} q={q} onEdit={openModal} onRestore={restoreQuestion} />
            ))}
          </div>
        )}
      </main>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} maxWidth={640}>
        <div className="qb-modal-head">
          <h2 className="display" style={{ fontSize: 20 }}>{editingId ? `Edit ${editingId}` : 'Add question'}</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Every field below is what the AI scorer uses to judge evidence — write it as if briefing a junior auditor.</p>
        </div>
        <div className="qb-modal-body">
          {needsProvisioning && !isMultiField && (
            <div className="qb-provision-note">
              <span>ⓘ</span>
              <span>This question has no matching field in GHL yet. Saving it will <strong>create a new custom field</strong> in your GHL account to store answers — a real, persistent change to your CRM.</span>
            </div>
          )}
          {isMultiField && (
            <div className="qb-provision-note">
              <span>ⓘ</span>
              <span>
                This question already maps to {editingQuestion.fields.length} real fields in your GHL "Sentinel rrs" folder
                ({editingQuestion.fields.map((f) => f.label).join(', ')}) — that wiring is fixed and isn't edited here.
              </span>
            </div>
          )}
          <Field label="Section">
            <TextInput placeholder="e.g. Step 2: Risk Assessment" value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} />
          </Field>
          <Field label="Title">
            <TextInput placeholder="Short, specific — this is what the client sees" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="What counts as adequate? (documented)">
            <TextArea placeholder="Describe the evidence that shows this control exists / is documented." value={form.adequacy} onChange={(e) => setForm({ ...form, adequacy: e.target.value })} />
          </Field>
          <Field label="What counts as effective? (actually works)">
            <TextArea placeholder="Describe the evidence that proves the control actually operates." value={form.efficacy} onChange={(e) => setForm({ ...form, efficacy: e.target.value })} />
          </Field>
          <div className="qb-two-col">
            {canPickEvidenceType && (
              <Field label="Evidence type">
                <Select value={form.inputType} onChange={(e) => setForm({ ...form, inputType: e.target.value })}>
                  <option value="file">Document upload</option>
                  <option value="textarea">Long text answer</option>
                  <option value="text">Short text answer</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="phone">Phone</option>
                  <option value="monetary">Monetary</option>
                  <option value="checkbox">Checkbox (Yes/No)</option>
                  <option value="radio">Radio select</option>
                  <option value="select">Dropdown</option>
                </Select>
              </Field>
            )}
            <Field label="Critical area">
              <Toggle checked={form.critical} onChange={(e) => setForm({ ...form, critical: e.target.checked })} label="Gaps here trigger a score penalty" />
            </Field>
          </div>
          {canPickEvidenceType && NEEDS_OPTIONS.has(form.inputType) && (
            <Field label={form.inputType === 'radio' ? 'Radio options' : 'Dropdown options'} hint="comma-separated — e.g. Yes, No">
              <TextInput placeholder="Option one, Option two, Option three" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} />
            </Field>
          )}
          <Field label="Keywords" hint="optional — helps auto-sort uploaded files here">
            <TextInput placeholder="comma, separated, phrases" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          </Field>
        </div>
        <div className="qb-modal-foot">
          <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={saveQuestion} disabled={saving}>{saving ? 'Saving…' : 'Save question'}</Button>
        </div>
      </Modal>
    </div>
  );
}

function QuestionRow({ q, onEdit, onArchive, onRestore, dragging, onDragStart, onDragEnd, onDrop }) {
  const draggable = !q.archived && !!onDragStart;
  return (
    <div
      className={`card qb-row ${q.archived ? 'archived' : ''} ${dragging ? 'qb-row--dragging' : ''}`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={draggable ? (e) => { e.preventDefault(); onDrop(); } : undefined}
    >
      {draggable && <div className="qb-drag-handle" title="Drag to reorder">⠿</div>}
      <div className="qb-id">{q.id}</div>
      <div className="qb-main-col">
        <div className="qb-item-title">{q.title}</div>
        <div className="qb-meta">
          {q.critical && <Badge tone="danger">Critical</Badge>}
          {q.fields?.length > 1
            ? <Badge tone="neutral">{q.fields.length} fields</Badge>
            : <Badge tone="neutral">{INPUT_TYPE_LABELS[q.fields?.[0]?.inputType] || q.fields?.[0]?.inputType}</Badge>}
          {!q.fields?.every((f) => f.ghlFieldId) && <Badge tone="pending">No GHL field yet</Badge>}
        </div>
      </div>
      <div className="qb-actions">
        <Button variant="ghost" className="btn-icon" title="Edit" onClick={() => onEdit(q)}>✎</Button>
        {q.archived
          ? <Button variant="secondary" size="sm" onClick={() => onRestore(q.id)}>Restore</Button>
          : <Button variant="danger" className="btn-icon" title="Archive" onClick={() => onArchive(q.id)}>🗄</Button>}
      </div>
    </div>
  );
}
