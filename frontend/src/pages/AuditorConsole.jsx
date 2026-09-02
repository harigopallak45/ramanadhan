import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import ResultBreakdown from '../components/ResultBreakdown';
import AssignedQuestionsPanel from '../components/AssignedQuestionsPanel';
import EditPermissionPicker from '../components/EditPermissionPicker';
import QuestionAnswerFields from '../components/QuestionAnswerFields';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { TextArea } from '../components/ui/Field';
import { apiFetch, ragApi } from '../lib/api';
import { useToast } from '../lib/toast';
import './AuditorConsole.css';

const NAV_TABS = [{ to: '/admin', label: 'Clients' }, { to: '/questions', label: 'Question Builder' }];

function formatActivityDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const when = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  if (days <= 0) return `${when} (today)`;
  if (days === 1) return `${when} (yesterday)`;
  return `${when} (${days} days ago)`;
}

const STATUS_META = {
  adequate: { label: 'Good', tone: 'success' },
  partial: { label: 'Partial', tone: 'pending' },
  inadequate: { label: 'Weak', tone: 'danger' },
  missing: { label: 'Not provided', tone: 'danger' },
  error: { label: 'Not scored', tone: 'neutral' }
};
const SCORE_TONE = { pass: 'success', watch: 'pending', fail: 'danger', critical: 'danger' };

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fileExt(name) {
  const clean = String(name || '').split('?')[0];
  const parts = clean.split('.');
  return parts.length > 1 ? parts.pop().toUpperCase() : 'FILE';
}

function guessKind(url) {
  const lower = String(url || '').toLowerCase();
  if (/\.(jpe?g|png|gif|webp|svg)(\?|$)/.test(lower)) return 'image';
  if (/\.pdf(\?|$)/.test(lower) || lower.includes('/documents/download/')) return 'pdf';
  return 'other';
}

// An answer is keyed by sub-field: { subKey: { value, files } } — a question
// counts as answered if ANY of its sub-fields has something in it.
function answerHasContent(a) {
  if (!a) return false;
  return Object.values(a).some((sf) => sf && (String(sf.value || '').trim() || (sf.files && sf.files.length)));
}

export default function AuditorConsole() {
  const { contactId } = useParams();
  const toast = useToast();
  const fileInputRef = useRef(null);

  const [contact, setContact] = useState(null);
  const [activity, setActivity] = useState(null);
  const [activityTracked, setActivityTracked] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');

  const [scoring, setScoring] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState('');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [showFullDraft, setShowFullDraft] = useState(false);
  const [requestedIds, setRequestedIds] = useState(new Set());
  const [fullReport, setFullReport] = useState(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [fullReportError, setFullReportError] = useState('');

  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestMsg, setRequestMsg] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetMsg, setResetMsg] = useState('');
  const [sendingReset, setSendingReset] = useState(false);

  const [viewer, setViewer] = useState(null);
  const [editingQId, setEditingQId] = useState(null);
  const [grantedQuestionIds, setGrantedQuestionIds] = useState([]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [contactId]);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const [userRes, schemaRes, respRes, grantRes] = await Promise.all([
        apiFetch(`/api/admin/users/${contactId}`),
        ragApi.formSchema(contactId), // mirrors exactly what THIS client was asked, not the whole bank
        ragApi.getResponses(contactId),
        ragApi.getEditPermissions(contactId)
      ]);
      setContact(userRes.contact);
      setActivity(userRes.activity || null);
      setActivityTracked(!!userRes.activityTracked);
      setQuestions(schemaRes.questions || []);
      setAnswers(respRes.answers || {});
      setGrantedQuestionIds(grantRes.grantedQuestionIds || []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Admin edits go through the exact same API a client's own portal uses —
  // an admin token is allowed to write to any contact's record (see
  // clientAuth in routes.js), so this is a real, persistent change to the
  // client's answers, not a separate "override" mechanism.
  async function saveAnswerAdmin(qId, subKey, value) {
    try {
      await ragApi.saveAnswers(contactId, { [qId]: { [subKey]: value } });
      setAnswers((a) => ({
        ...a,
        [qId]: { ...(a[qId] || {}), [subKey]: { ...(a[qId]?.[subKey] || { files: [] }), value } }
      }));
      return true;
    } catch (err) {
      toast(`Couldn't save that answer: ${err.message}`, 'error');
      return false;
    }
  }

  async function uploadFileAdmin(qId, subKey, file) {
    const fd = new FormData();
    fd.append('qId', qId);
    fd.append('fieldKey', subKey);
    fd.append('file', file);
    try {
      const data = await ragApi.uploadEvidence(contactId, fd);
      setAnswers((a) => {
        const cur = a[qId]?.[subKey] || { value: '', files: [] };
        return {
          ...a,
          [qId]: { ...(a[qId] || {}), [subKey]: { ...cur, files: [...(cur.files || []), { name: data.fileName, url: data.url }] } }
        };
      });
    } catch (err) {
      toast(`Upload failed: ${err.message}`, 'error');
    }
  }

  async function removeFileAdmin(qId, subKey, url) {
    try {
      await ragApi.removeFile(contactId, qId, subKey, url);
      setAnswers((a) => {
        const cur = a[qId]?.[subKey] || { value: '', files: [] };
        return {
          ...a,
          [qId]: { ...(a[qId] || {}), [subKey]: { ...cur, files: (cur.files || []).filter((f) => f.url !== url) } }
        };
      });
    } catch (err) {
      toast(`Couldn't remove that file: ${err.message}`, 'error');
    }
  }

  const tags = (contact?.tags || []).map((t) => String(t).toLowerCase().trim());
  const isEntityAdmin = tags.includes('audit admin') || tags.includes('audit-admin');
  // Editing is open by default at any submission stage — locking a client
  // out is now only ever this explicit admin action, never automatic.
  const editingLocked = tags.includes('editing locked');
  const isSubmittedPartial = tags.includes('audit submitted partial');
  const entityName = contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : '';
  const answeredQCount = questions.filter((q) => answerHasContent(answers[q.id])).length;

  const bySection = useMemo(() => {
    const map = {};
    questions.forEach((q) => { (map[q.section] = map[q.section] || []).push(q); });
    return map;
  }, [questions]);

  const searchLower = search.trim().toLowerCase();
  function matchesSearch(q) {
    if (!searchLower) return true;
    const a = answers[q.id] || {};
    const subFieldText = Object.values(a).flatMap((sf) => [sf?.value, ...(sf?.files || []).map((f) => f.name)]);
    const hay = [q.id, q.title, ...subFieldText].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(searchLower);
  }

  // ---- AI scoring ----------------------------------------------------
  async function runAiScore() {
    if (scoring || uploading) return;
    setScoring(true);
    setAiError('');
    setAiPanelOpen(true);
    setFullReport(null); // a new score invalidates any previously-generated formal report
    setFullReportError('');
    try {
      const data = await ragApi.score(contactId);
      setAiResult(data.result);
      setRequestedIds(new Set());
    } catch (err) {
      setAiError(err.message);
    } finally {
      setScoring(false);
    }
  }

  // A formal, long-form report — separate from the live scorecard above.
  // Never re-grades; writes the auditor narrative + regulatory citations
  // around the verdicts runAiScore already decided.
  async function generateFullReport() {
    if (!aiResult || generatingReport) return;
    setGeneratingReport(true);
    setFullReportError('');
    try {
      const data = await ragApi.fullReport(contactId, aiResult);
      setFullReport(data.report);
    } catch (err) {
      setFullReportError(err.message);
    } finally {
      setGeneratingReport(false);
    }
  }

  function copyFullReport() {
    if (!fullReport) return;
    navigator.clipboard.writeText(fullReport.fullText);
    toast('Full report copied to clipboard');
  }

  function exportFullReportPdf() {
    if (!fullReport) return;
    const w = window.open('', '_blank');
    if (!w) { toast('Pop-up blocked — allow pop-ups to export.', 'error'); return; }
    w.document.write(`<html><head><title>${escapeHtml(entityName)} — Independent Evaluation Report</title>
      <style>body{font-family:Georgia,serif;padding:40px;color:#111;white-space:pre-wrap;line-height:1.65;font-size:14px;} h1{font-size:18px;}</style>
      </head><body>${escapeHtml(fullReport.fullText)}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  async function uploadAndAnalyze(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    setAiError('');
    setAiPanelOpen(true);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('entityLabel', entityName || 'Uploaded evidence');
    fd.append('contactId', contactId);
    try {
      const data = await ragApi.analyzeUpload(fd);
      setAiResult(data.result);
      setRequestedIds(new Set());
    } catch (err) {
      setAiError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function copyDraft() {
    if (!aiResult) return;
    navigator.clipboard.writeText(aiResult.draftReport);
    toast('Draft copied to clipboard');
  }

  async function saveToRecord() {
    if (!aiResult) return;
    const summary = `Centinl AI Compliance Score: ${aiResult.score}/100 (${aiResult.rating}). `
      + `${aiResult.criticalFailures} critical gap(s). Model: ${aiResult.model}.\n\n${aiResult.draftReport}`;
    try {
      await ragApi.note(contactId, summary);
      toast('Saved to client record');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function requestFromClient(area) {
    const body = `Please provide/upload evidence for: [${area.qId}] ${area.title}.${area.finding ? ` ${area.finding}` : ''}`;
    try {
      await ragApi.note(contactId, body);
      setRequestedIds((prev) => new Set(prev).add(area.qId));
      toast(`Requested ${area.qId} from client`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function exportPdf() {
    if (!aiResult) return;
    const w = window.open('', '_blank');
    if (!w) { toast('Pop-up blocked — allow pop-ups to export.', 'error'); return; }
    w.document.write(`<html><head><title>${escapeHtml(entityName)} — Compliance Report</title>
      <style>body{font-family:Georgia,serif;padding:40px;color:#111;white-space:pre-wrap;line-height:1.65;font-size:14px;} h1{font-size:18px;}</style>
      </head><body>${escapeHtml(aiResult.draftReport)}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  function exportCsv() {
    const rows = [['Question', 'Response']];
    questions.forEach((q) => {
      const a = answers[q.id];
      if (!a) return;
      const fields = q.fields && q.fields.length ? q.fields : [{ key: 'value', label: null }];
      fields.forEach((f) => {
        const sf = a[f.key];
        if (sf && String(sf.value || '').trim()) {
          rows.push([`${q.id} ${q.title}${f.label ? ` — ${f.label}` : ''}`, sf.value]);
        }
      });
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${contact?.firstName || 'client'}_survey_data.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // ---- Admin actions ---------------------------------------------------
  async function changeRole(action) {
    const msgs = {
      promote_admin: 'Promote this user to Admin?',
      demote_admin: 'Revoke Admin privileges?',
      revoke_access: 'Completely revoke audit access (removes all tags)?'
    };
    if (!window.confirm(msgs[action])) return;
    try {
      const data = await apiFetch(`/api/admin/users/${contactId}/role`, { method: 'POST', body: { action } });
      toast(data.message || 'Role updated');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // Locking is the only blanket action left — it makes every already-
  // answered field read-only (blank fields always stay open regardless).
  // There's no matching blanket "unlock everything" anymore: once locked,
  // the admin grants specific questions back via EditPermissionPicker
  // instead, so a client never gets more re-opened than actually intended.
  async function lockEditing() {
    if (!window.confirm('Lock editing for this client? Already-answered fields become read-only; anything still blank stays editable, and you can grant specific questions back afterward.')) return;
    try {
      const data = await apiFetch(`/api/admin/users/${contactId}/edit-permission`, { method: 'POST', body: { action: 'lock' } });
      toast(data.message || 'Updated');
      setGrantedQuestionIds([]); // a fresh lock always resets prior grants (server does the same)
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function submitResetPassword() {
    setSendingReset(true);
    try {
      const data = await apiFetch(`/api/admin/reset-password/${contactId}`, { method: 'POST', body: { message: resetMsg } });
      toast(data.message || 'Reset link sent');
      setResetModalOpen(false);
      setResetMsg('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSendingReset(false);
    }
  }

  async function submitClientRequest() {
    if (!requestMsg.trim()) return toast('Please enter a message', 'error');
    setSendingRequest(true);
    try {
      const data = await apiFetch(`/api/admin/request-client/${contactId}`, { method: 'POST', body: { message: requestMsg } });
      toast(data.message || 'Request sent');
      setRequestModalOpen(false);
      setRequestMsg('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSendingRequest(false);
    }
  }

  function openViewer(url, name) {
    setViewer({ url, name, kind: guessKind(url) });
  }

  if (loading) {
    return (
      <div className="theme-dark" style={{ minHeight: '100vh' }}>
        <Topbar tabs={NAV_TABS} />
        <main className="ac-main">
        <Link className="ac-back" to="/admin">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          All clients
        </Link>
          <div className="skeleton" style={{ height: 140, marginBottom: 24 }} />
          <div className="skeleton" style={{ height: 60, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 60, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 60 }} />
        </main>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="theme-dark" style={{ minHeight: '100vh' }}>
        <Topbar tabs={NAV_TABS} />
        <main className="ac-main">
        <Link className="ac-back" to="/admin">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          All clients
        </Link>
          <div className="ac-empty">Couldn't load this client. {loadError}</div>
        </main>
      </div>
    );
  }

  const evidenceGaps = (aiResult?.areas || []).filter((a) => a.status === 'missing' || a.status === 'inadequate');
  const answeredCount = (aiResult?.areas || []).filter((a) => a.hasAnswer || a.filesCount > 0).length;

  return (
    <div className="theme-dark" style={{ minHeight: '100vh' }}>
      <Topbar tabs={NAV_TABS} />
      <main className="ac-main">
        <Link className="ac-back" to="/admin">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          All clients
        </Link>
        <div className="card ac-header">
          <div>
            <h1 className="display ac-name">{contact?.firstName} {contact?.lastName || ''}</h1>
            <p className="muted" style={{ marginTop: 4 }}>{contact?.email} &bull; {contact?.companyName || 'No company linked'}</p>
            <dl className="ac-activity">
              <div>
                <dt>Last sign-in</dt>
                <dd>{formatActivityDate(activity?.lastLoginAt) || (activityTracked ? 'Never signed in' : 'Not recorded yet')}</dd>
              </div>
              <div>
                <dt>Sign-ins</dt>
                <dd>{activity?.loginCount ? activity.loginCount : (activityTracked ? '0' : '—')}</dd>
              </div>
              <div>
                <dt>Password</dt>
                <dd>
                  {activity?.passwordChangedAt
                    ? `Set by them · ${formatActivityDate(activity.passwordChangedAt)}`
                    : (activityTracked
                        ? <span className="ac-activity-warn">Never changed — still on the invite password</span>
                        : 'Not recorded yet')}
                </dd>
              </div>
            </dl>

            <div className="row gap-2" style={{ marginTop: 10 }}>
              <Badge tone={isEntityAdmin ? 'gold' : 'neutral'}>{isEntityAdmin ? 'Administrator' : 'Audit user'}</Badge>
              {isSubmittedPartial && (
                <Badge tone="pending" title="They submitted before answering everything">
                  Partial submission — {answeredQCount}/{questions.length} answered
                </Badge>
              )}
            </div>
          </div>
          <div className="ac-header-right">
            <p className="faint" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 12 }}>GHL ID: {contact?.id}</p>
            <div className="ac-actions">
              <Button variant="secondary" className="ac-gold-outline" disabled={scoring || uploading} onClick={runAiScore}>
                {scoring ? '✦ Scoring…' : '✦ AI Score'}
              </Button>
              <Button variant="secondary" className="ac-gold-outline" disabled={scoring || uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? '⬆ Analyzing…' : '⬆ Upload documents'}
              </Button>
              <input
                ref={fileInputRef} type="file" multiple hidden
                accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                onChange={(e) => { uploadAndAnalyze(e.target.files); e.target.value = ''; }}
              />
              <Button variant="primary" onClick={exportCsv}>Export to CSV</Button>
              {isEntityAdmin
                ? <Button variant="danger" onClick={() => changeRole('demote_admin')}>Revoke admin rights</Button>
                : <Button variant="secondary" onClick={() => changeRole('promote_admin')}>Promote to admin</Button>}
              {editingLocked
                ? <EditPermissionPicker contactId={contactId} questions={questions} grantedQuestionIds={grantedQuestionIds} onSaved={setGrantedQuestionIds} />
                : <Button variant="danger" onClick={lockEditing}>🔒 Lock editing</Button>}
              <Button variant="danger" onClick={() => changeRole('revoke_access')}>Revoke access</Button>
              <Button variant="ghost" onClick={() => setRequestModalOpen(true)}>Request client update</Button>
              <Button variant="ghost" onClick={() => setResetModalOpen(true)}>Reset password</Button>
            </div>
          </div>
        </div>

        {!!questions.length && (
          <div className="card" style={{ padding: 22, marginBottom: 20 }}>
            <AssignedQuestionsPanel contactId={contactId} onSaved={load} />
            <ResultBreakdown
              schema={questions}
              answers={answers}
              storageKey="auditor"
              onPreviewFile={(url, name) => openViewer(url, name)}
            />
          </div>
        )}

        {aiPanelOpen && (
          <div className="card ac-ai-panel">
            {scoring && (
              <div className="ac-ai-loading">
                <div className="eyebrow" style={{ color: 'var(--gold)' }}>Centinl AI Reviewer</div>
                <div style={{ marginTop: 14, fontSize: 15 }}>Checking all evidence areas against AUSTRAC rules…</div>
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>This usually takes 5–15 seconds.</div>
              </div>
            )}
            {uploading && (
              <div className="ac-ai-loading">
                <div className="eyebrow" style={{ color: 'var(--gold)' }}>Centinl AI Reviewer</div>
                <div style={{ marginTop: 14, fontSize: 15 }}>Reading documents and scoring…</div>
                <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Files are sorted into sections automatically by content.</div>
              </div>
            )}
            {!scoring && !uploading && aiError && (
              <div className="ac-ai-error">The AI couldn't finish: {aiError}</div>
            )}
            {!scoring && !uploading && aiResult && (
              <AiScorecard
                result={aiResult}
                answeredCount={answeredCount}
                evidenceGaps={evidenceGaps}
                requestedIds={requestedIds}
                onRequest={requestFromClient}
                onCopy={copyDraft}
                onSave={saveToRecord}
                onExportPdf={exportPdf}
                onRescore={runAiScore}
                showFullDraft={showFullDraft}
                setShowFullDraft={setShowFullDraft}
                fullReport={fullReport}
                generatingReport={generatingReport}
                fullReportError={fullReportError}
                onGenerateFullReport={generateFullReport}
                onCopyFullReport={copyFullReport}
                onExportFullReportPdf={exportFullReportPdf}
              />
            )}
          </div>
        )}

        <div className="ac-console-head">
          <div className="eyebrow">Connected compliance console</div>
          <input
            className="input ac-search"
            placeholder="Search questions, answers, or files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {!questions.length && <div className="ac-empty">No evidence areas configured yet — add some in the Question Builder.</div>}

        {Object.entries(bySection).map(([section, list]) => {
          const visible = list.filter(matchesSearch);
          if (!visible.length) return null;
          return (
            <div className="ac-section" key={section}>
              <h2 className="ac-section-title">📁 {section}</h2>
              {visible.map((q) => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  answer={answers[q.id]}
                  onPreview={openViewer}
                  editing={editingQId === q.id}
                  onToggleEdit={() => setEditingQId((cur) => (cur === q.id ? null : q.id))}
                  onSave={saveAnswerAdmin}
                  onUpload={uploadFileAdmin}
                  onRemoveFile={removeFileAdmin}
                />
              ))}
            </div>
          );
        })}
      </main>

      <Modal open={requestModalOpen} onClose={() => setRequestModalOpen(false)}>
        <div className="ac-modal-body">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Compose client message</div>
          <TextArea
            style={{ height: 120 }}
            placeholder="Type your request or update here…"
            value={requestMsg}
            onChange={(e) => setRequestMsg(e.target.value)}
          />
          <div className="ac-modal-foot">
            <Button variant="ghost" onClick={() => setRequestModalOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={sendingRequest} onClick={submitClientRequest}>
              {sendingRequest ? 'Sending…' : 'Send message'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={resetModalOpen} onClose={() => setResetModalOpen(false)}>
        <div className="ac-modal-body">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Compose password reset message (optional)</div>
          <TextArea
            style={{ height: 100 }}
            placeholder="Add an optional custom message to include in the reset email…"
            value={resetMsg}
            onChange={(e) => setResetMsg(e.target.value)}
          />
          <div className="ac-modal-foot">
            <Button variant="ghost" onClick={() => setResetModalOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={sendingReset} onClick={submitResetPassword}>
              {sendingReset ? 'Sending…' : 'Generate & send link'}
            </Button>
          </div>
        </div>
      </Modal>

      {viewer && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewer(null); }}>
          <div className="ac-viewer">
            <div className="ac-viewer-head">
              <span className="ac-viewer-title">📄 {viewer.name}</span>
              <div className="row gap-2">
                <a href={viewer.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">↗ Open in new tab</a>
                <button className="ac-viewer-close" onClick={() => setViewer(null)}>&times;</button>
              </div>
            </div>
            <div className="ac-viewer-body">
              {viewer.kind === 'image' && <img src={viewer.url} alt={viewer.name} />}
              {viewer.kind === 'pdf' && <iframe src={viewer.url} title={viewer.name} />}
              {viewer.kind === 'other' && (
                <div className="ac-viewer-generic">
                  <div style={{ fontSize: 44 }}>📁</div>
                  <p className="muted">This file type can't be previewed directly. Open it in a new tab instead.</p>
                  <a href={viewer.url} target="_blank" rel="noreferrer" className="btn btn-primary">↗ Open file in new tab</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionCard({ q, answer, onPreview, editing, onToggleEdit, onSave, onUpload, onRemoveFile }) {
  const fields = q.fields && q.fields.length ? q.fields : [{ key: 'value', label: null }];
  const hasAny = answerHasContent(answer);

  return (
    <div className="card ac-question">
      <div className="ac-question-head">
        <span className="badge badge--gold ac-qid">{q.id}</span>
        <h3 className="ac-question-title">{q.title}</h3>
        <button className="btn btn-ghost btn-sm ac-edit-toggle" onClick={onToggleEdit}>
          {editing ? 'Done' : '✎ Edit'}
        </button>
      </div>

      {editing ? (
        <QuestionAnswerFields q={q} answer={answer} readOnly={false} onSave={onSave} onUpload={onUpload} onRemoveFile={onRemoveFile} />
      ) : (
        <>
          {!hasAny && (
            <div className="ac-evidence-banner">⚠ Awaiting response and document evidence</div>
          )}

          {fields.map((field) => {
        const sf = answer?.[field.key] || { value: '', files: [] };
        const value = String(sf.value || '').trim();
        const files = sf.files || [];
        if (!value && !files.length) return null;
        const isYesNo = /^(yes|no)$/i.test(value);
        return (
          <div className="ac-answer-item" key={field.key}>
            <div className="ac-answer-label">{field.label || 'Written response'}</div>
            {value && (isYesNo
              ? <span className={`badge ${value.toLowerCase() === 'yes' ? 'badge--success' : 'badge--danger'}`}>{value}</span>
              : <div className="ac-answer-value">{value}</div>)}

            {files.length > 0 && (
              <div className="ac-files">
                {files.map((f, i) => (
                  <div className="ac-vault-card" key={i}>
                    <div className="ac-vault-head">
                      <span className="ac-ext-badge">{fileExt(f.name)}</span>
                    </div>
                    <div className="ac-vault-name" title={f.name}>{f.name}</div>
                    <div className="ac-vault-actions">
                      <button className="btn-card-action" onClick={() => onPreview(f.url, f.name)}>Preview</button>
                      <a href={f.url} target="_blank" rel="noreferrer" download className="btn-card-action">Download</a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
          })}
        </>
      )}
    </div>
  );
}

function AiScorecard({
  result: r, answeredCount, evidenceGaps, requestedIds, onRequest, onCopy, onSave, onExportPdf, onRescore, showFullDraft, setShowFullDraft,
  fullReport, generatingReport, fullReportError, onGenerateFullReport, onCopyFullReport, onExportFullReportPdf
}) {
  const scoredAt = r.scoredAt ? new Date(r.scoredAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const scoreTone = SCORE_TONE[r.tone] || 'danger';

  return (
    <div>
      {r.incompleteModelOutput?.length > 0 && (
        <div className="ac-ai-warn">⚠ The AI couldn't grade {r.incompleteModelOutput.length} area(s) that had evidence ({r.incompleteModelOutput.join(', ')}). Re-run before relying on this score.</div>
      )}
      {r.upload?.unmatched?.length > 0 && (
        <div className="ac-ai-warn ac-ai-warn--pending">⚠ {r.upload.unmatched.length} file(s) couldn't be matched to a section: {r.upload.unmatched.join(', ')}.</div>
      )}

      <div className="ac-ai-top">
        <div className="row gap-6">
          <div className="ac-score-big" style={{ color: `var(--${scoreTone})` }}>
            {r.score}<span className="ac-score-max">/100</span>
          </div>
          <div>
            <Badge tone={scoreTone}>{r.rating}</Badge>
            <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Scored {scoredAt}{r.grounded === false ? ' · ungrounded' : ''}</div>
          </div>
        </div>
        <div className="row gap-2">
          <Button variant="ghost" size="sm" onClick={onCopy}>Copy write-up</Button>
          <Button variant="secondary" size="sm" className="ac-gold-outline" onClick={onSave}>Save to client record</Button>
          <Button variant="ghost" size="sm" onClick={onExportPdf}>Export PDF</Button>
          <Button variant="ghost" size="sm" onClick={onRescore}>Re-score</Button>
        </div>
      </div>

      <div className="ac-stat-tiles">
        <div className="ac-stat-tile">
          <div className="ac-stat-value" style={{ color: r.criticalFailures ? 'var(--danger)' : 'var(--success)' }}>{r.criticalFailures}</div>
          <div className="ac-stat-label">Critical gaps</div>
        </div>
        <div className="ac-stat-tile">
          <div className="ac-stat-value">{answeredCount}/{r.areas.length}</div>
          <div className="ac-stat-label">Areas answered</div>
        </div>
        <div className="ac-stat-tile">
          <div className="ac-stat-value">{r.documents?.read ?? 0}</div>
          <div className="ac-stat-label">Documents read</div>
        </div>
        <div className="ac-stat-tile">
          <div className="ac-stat-value" style={{ color: r.documents?.unreadable ? 'var(--pending)' : undefined }}>{r.documents?.unreadable ?? 0}</div>
          <div className="ac-stat-label">Unreadable</div>
        </div>
      </div>

      <div className="ac-summary">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Executive summary</div>
        <div className="ac-summary-text">{r.executiveSummary || <span className="faint">(none generated)</span>}</div>
        {r.topRisks?.length > 0 && (
          <>
            <div className="eyebrow" style={{ margin: '16px 0 6px' }}>Top risks</div>
            <ul className="ac-risk-list">{r.topRisks.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>
        )}
      </div>

      {evidenceGaps.length > 0 && (
        <div className="ac-gap-tracker">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Evidence gaps — {evidenceGaps.length} area(s) need attention</div>
          <div className="ac-gap-chips">
            {evidenceGaps.map((a) => (
              <div className={`ac-gap-chip ${a.criticalFailure ? 'critical' : ''}`} key={a.qId}>
                <span className="ac-gap-chip-id">{a.qId}</span>
                <span className="ac-gap-chip-title">{a.title}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={requestedIds.has(a.qId)}
                  onClick={() => onRequest(a)}
                >
                  {requestedIds.has(a.qId) ? '✓ Requested' : 'Request from client'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ac-area-table">
        {r.areas.map((a) => {
          const meta = STATUS_META[a.status] || { label: a.status, tone: 'neutral' };
          return (
            <div className="ac-area-row" key={a.qId}>
              <div className="ac-area-id">{a.qId}</div>
              <div className="ac-area-main">
                <div className="ac-area-title">
                  {a.title}
                  {a.criticalFailure && <span className="ac-critical-tag">CRITICAL</span>}
                </div>
                <div className="ac-area-finding">{a.finding}</div>
                {a.recommendation && <div className="ac-area-reco">→ {a.recommendation}</div>}
                <div className="ac-area-bars">
                  <div className="ac-bar">
                    <span className="ac-bar-label">Adequacy</span>
                    <div className="progress"><div style={{ width: `${a.adequacy}%` }} /></div>
                    <span className="ac-bar-value">{a.adequacy}</span>
                  </div>
                  <div className="ac-bar">
                    <span className="ac-bar-label">Efficacy</span>
                    <div className="progress"><div style={{ width: `${a.efficacy}%` }} /></div>
                    <span className="ac-bar-value">{a.efficacy}</span>
                  </div>
                </div>
              </div>
              <div className="ac-area-mark">{a.weightedMark}<span className="faint">/{a.maxMark}</span></div>
              <div className="ac-area-status"><Badge tone={meta.tone}>{meta.label}</Badge></div>
            </div>
          );
        })}
      </div>

      <div className="ac-draft-toggle">
        <button className="btn btn-ghost btn-sm" onClick={() => setShowFullDraft(!showFullDraft)}>
          {showFullDraft ? 'Hide full draft report' : 'View full draft report'}
        </button>
        {showFullDraft && <pre className="ac-draft-pre">{r.draftReport}</pre>}
      </div>

      <div className="ac-full-report">
        <div className="ac-full-report-head">
          <div>
            <div className="eyebrow">Formal report</div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              A longer, formal Independent Evaluation Report — proper sections, paragraph-length findings, and
              regulatory citations where the knowledge base actually supports one. Separate from the quick scorecard
              above; doesn't re-grade anything.
            </p>
          </div>
          <Button variant="secondary" size="sm" className="ac-gold-outline" disabled={generatingReport} onClick={onGenerateFullReport}>
            {generatingReport ? 'Generating…' : fullReport ? 'Regenerate full report' : 'Generate full report'}
          </Button>
        </div>

        {generatingReport && (
          <div className="ac-ai-loading" style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 13 }}>Writing the formal report — this takes longer than the quick score.</div>
          </div>
        )}
        {!generatingReport && fullReportError && (
          <div className="ac-ai-error" style={{ marginTop: 12 }}>The report couldn't be generated: {fullReportError}</div>
        )}
        {!generatingReport && fullReport && (
          <>
            {fullReport.missingNarratives?.length > 0 && (
              <div className="ac-ai-warn" style={{ marginTop: 12 }}>
                ⚠ The model didn't return a written finding for {fullReport.missingNarratives.length} area(s)
                ({fullReport.missingNarratives.join(', ')}) — their one-line finding from the scorecard was used instead.
              </div>
            )}
            {fullReport.grounded === false && (
              <div className="ac-ai-warn ac-ai-warn--pending" style={{ marginTop: 12 }}>
                ⚠ No AUSTRAC knowledge base is loaded — this report has no regulatory citations.
              </div>
            )}
            <div className="row gap-2" style={{ marginTop: 12 }}>
              <Button variant="ghost" size="sm" onClick={onCopyFullReport}>Copy report</Button>
              <Button variant="ghost" size="sm" onClick={onExportFullReportPdf}>Export PDF</Button>
            </div>
            <pre className="ac-draft-pre" style={{ marginTop: 12 }}>{fullReport.fullText}</pre>
          </>
        )}
      </div>

      <div className="ac-ai-footer">
        Each area is checked two ways — is it documented, and is there proof it actually works. Generated by the Centinl AI reviewer against AUSTRAC rules; an auditor must review before any finding is issued.
      </div>
    </div>
  );
}
