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
const EMPTY_FIELD = () => ({ key: null, label: 'Answer', inputType: 'file', options: '', ghlFieldId: null, ghlFieldKey: null });
const EMPTY_FORM = { section: '', title: '', adequacy: '', efficacy: '', critical: false, keywords: '', fields: [EMPTY_FIELD()] };

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
      section: q.section, title: q.title, adequacy: q.adequacy, efficacy: q.efficacy, critical: q.critical,
      keywords: (q.keywords || []).join(', '),
      fields: (q.fields?.length ? q.fields : [{}]).map((f) => ({
        key: f.key || null, label: f.label || 'Answer', inputType: f.inputType || 'file',
        options: (f.options || []).join(', '), ghlFieldId: f.ghlFieldId || null, ghlFieldKey: f.ghlFieldKey || null
      }))
    } : EMPTY_FORM);
    setModalOpen(true);
  }

  const editingQuestion = editingId ? questions.find((q) => q.id === editingId) : null;
  // Sentinel built-ins map onto fixed, real fields in the GHL "Sentinel rrs"
  // folder shared across every client already using them — their field
  // structure (add/remove/retype a sub-field) is never editable here, only
  // title/adequacy/efficacy/critical/keywords are. A brand-new question or
  // an existing admin-added custom one can freely edit its fields[].
  const canEditFieldStructure = !editingQuestion || !editingQuestion.builtin;
  // Only a genuinely new question eagerly provisions GHL fields at save time
  // (same as before) — adding a field to an EXISTING custom question stays
  // lazy, provisioned on first real answer, so editing never surprises the
  // admin with an immediate CRM write.
  const newFieldCount = canEditFieldStructure && editingId
    ? form.fields.filter((f) => !f.ghlFieldId).length
    : 0;

  function addField() {
    setForm({ ...form, fields: [...form.fields, { ...EMPTY_FIELD(), key: `field_${Date.now()}` }] });
  }
  function updateField(idx, patch) {
    setForm({ ...form, fields: form.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) });
  }
  function removeField(idx) {
    const field = form.fields[idx];
    if (field.ghlFieldId && !window.confirm(`"${field.label}" already has answers saved against it in GHL. Removing it here won't delete that GHL field or its data, but this app will stop showing/using it. Continue?`)) return;
    setForm({ ...form, fields: form.fields.filter((_, i) => i !== idx) });
  }

  async function saveQuestion() {
    if (!form.title.trim() || !form.section.trim()) return toast('Title and section are required', 'error');
    if (canEditFieldStructure) {
      if (!form.fields.length) return toast('Add at least one field', 'error');
      for (const f of form.fields) {
        if (!f.label.trim()) return toast('Every field needs a label', 'error');
        if (NEEDS_OPTIONS.has(f.inputType) && !f.options.trim()) {
          return toast(`Add at least one option (comma-separated) for "${f.label}"`, 'error');
        }
      }
    }
    if (!editingId) {
      const ok = window.confirm(
        form.fields.length > 1
          ? `This will create ${form.fields.length} new custom fields in your GHL account (one per field below) to store answers for this question. This is a real, persistent change to your CRM. Continue?`
          : `This will create a new custom field "${form.title}" in your GHL account to store answers for this question. This is a real, persistent change to your CRM. Continue?`
      );
      if (!ok) return;
    } else if (newFieldCount > 0) {
      const ok = window.confirm(`${newFieldCount} new field(s) below have no GHL wiring yet — they'll get their own custom field created automatically the first time a client answers them. Continue?`);
      if (!ok) return;
    }
    const payload = {
      section: form.section.trim(), title: form.title.trim(),
      adequacy: form.adequacy.trim(), efficacy: form.efficacy.trim(),
      critical: form.critical, keywords: form.keywords.split(',').map((s) => s.trim()).filter(Boolean)
    };
    if (canEditFieldStructure) {
      payload.fields = form.fields.map((f, i) => ({
        key: f.key || (form.fields.length > 1 ? `field_${i + 1}` : 'value'),
        label: f.label.trim(), inputType: f.inputType,
        options: NEEDS_OPTIONS.has(f.inputType) ? f.options : undefined,
        ghlFieldId: f.ghlFieldId || null, ghlFieldKey: f.ghlFieldKey || null
      }));
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
          {!canEditFieldStructure && (
            <div className="qb-provision-note">
              <span>ⓘ</span>
              <span>
                This question already maps to {editingQuestion.fields.length} real field{editingQuestion.fields.length > 1 ? 's' : ''} in your GHL "Sentinel rrs" folder
                ({editingQuestion.fields.map((f) => f.label).join(', ')}) — that wiring is fixed and isn't edited here.
              </span>
            </div>
          )}
          {canEditFieldStructure && !editingId && (
            <div className="qb-provision-note">
              <span>ⓘ</span>
              <span>Saving this will <strong>create {form.fields.length > 1 ? `${form.fields.length} new custom fields` : 'a new custom field'}</strong> in your GHL account to store answers — a real, persistent change to your CRM.</span>
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
          <Field label="Critical area">
            <Toggle checked={form.critical} onChange={(e) => setForm({ ...form, critical: e.target.checked })} label="Gaps here trigger a score penalty" />
          </Field>

          {canEditFieldStructure ? (
            <Field label={form.fields.length > 1 ? 'Fields — a client fills in each one separately' : 'Field'} hint="add more than one when this question really needs several pieces of evidence at once, e.g. a count AND a supporting document">
              <div className="qb-fields-list">
                {form.fields.map((f, idx) => (
                  <div className="qb-field-row" key={f.key || idx}>
                    <div className="qb-field-row-main">
                      <TextInput placeholder="Field label, e.g. Transaction count" value={f.label} onChange={(e) => updateField(idx, { label: e.target.value })} />
                      <Select value={f.inputType} onChange={(e) => updateField(idx, { inputType: e.target.value })}>
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
                      {form.fields.length > 1 && (
                        <Button variant="ghost" className="btn-icon" title="Remove field" onClick={() => removeField(idx)}>✕</Button>
                      )}
                    </div>
                    {NEEDS_OPTIONS.has(f.inputType) && (
                      <TextInput placeholder="Options, comma-separated — e.g. Yes, No" value={f.options} onChange={(e) => updateField(idx, { options: e.target.value })} />
                    )}
                  </div>
                ))}
              </div>
              <Button variant="secondary" size="sm" onClick={addField} style={{ marginTop: 8 }}>+ Add field</Button>
            </Field>
          ) : null}

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
