import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ragApi } from '../lib/api';
import { useToast } from '../lib/toast';
import UserMenu from '../components/layout/UserMenu';
import ResultBreakdown from '../components/ResultBreakdown';
import ClientChatWidget from '../components/ClientChatWidget';
import QuestionAnswerFields from '../components/QuestionAnswerFields';
import './ClientPortal.css';

const LOGO = 'https://assets.cdn.filesafe.space/wDk2dm52D9L325zEgO6S/media/69d63d6bebf1a608432cce2d.png';

// A question's answer is now keyed by sub-field: { subKey: { value, files } }.
// "Answered" means at least one sub-field has something in it.
function questionHasAnswer(answerByField) {
  if (!answerByField) return false;
  return Object.values(answerByField).some((sf) => sf && (String(sf.value || '').trim() || (sf.files && sf.files.length)));
}

// The reporting-entity-facing portal: a dark marketing landing hero, then
// (once entered) either a live evidence-intake form or a read-only summary
// of what's already been filed, depending on the client's profile state.
export default function ClientPortal() {
  const [entered, setEntered] = useState(false);

  return (
    <div className="cp-root theme-light">
      {!entered ? <Landing onEnter={() => setEntered(true)} /> : <Portal />}
    </div>
  );
}

function Landing({ onEnter }) {
  return (
    <div className="cp-landing">
      <header className="cp-landing-header">
        <div className="cp-brand">
          <img src={LOGO} alt="Centinl Logo" />
          <span className="cp-landing-tag">EXTERNAL REVIEW PORTAL</span>
        </div>
        <span className="cp-landing-tag">aml compliance · amlctf specialists · QLD</span>
      </header>

      <main className="cp-landing-main">
        <section className="cp-landing-left">
          <div className="cp-landing-eyebrow">01 · Engagement open</div>
          <h1 className="cp-hero-title display">
            The response you file now <em>is</em> the audit we conduct.
          </h1>
          <p className="cp-hero-lead">
            This portal collects your Response Requirement Statement for the independent evaluation of your
            entire AML/CTF program (AML/CTF reform, from 31 March 2026). What you upload here becomes evidence.
            What you leave blank becomes a finding.
          </p>
          <div>
            <button className="btn btn-primary cp-enter-btn" onClick={onEnter}>
              Enter as reporting entity
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          <div className="cp-landing-footnote-row">
            <span>conf. channel · TLS 1.3 · AU-east</span>
            <span>eval ref. GEN-2026-EVAL-01</span>
          </div>
        </section>

        <section className="cp-landing-right">
          <div className="cp-landing-eyebrow">02 · From the principal auditor</div>
          <blockquote className="cp-quote display">
            "We have moved from a compliance system that rewarded checkbox behaviour to one that asks: did your
            actions mitigate the harm?"
          </blockquote>
          <div className="cp-quote-attr">— AUSTRAC CEO Brendan Thomas, 2025</div>
          <div className="cp-quote-cite">Cited in ACAMS Today by Ramanathan Karuppiah, CAMS-Audit</div>

          <div className="cp-fact-row">
            <div className="cp-fact-label">Standard under review</div>
            <div className="cp-fact-value">
              AML/CTF Act 2006 (as amended 2024); AML/CTF Rules 2025; AUSTRAC transitional guidance 2026
            </div>
          </div>
          <div className="cp-fact-row">
            <div className="cp-fact-label">Assessment framework</div>
            <div className="cp-fact-value">
              Risk-based, outcomes-oriented program evaluation — adequacy and efficacy, 100-mark weighted scorecard
            </div>
          </div>
          <div className="cp-fact-row">
            <div className="cp-fact-label">Your auditor</div>
            <div className="cp-fact-value">Ramanathan Karuppiah MBA · CAMS-Audit Advanced · Fellow, ICA</div>
          </div>
        </section>
      </main>

      <footer className="cp-landing-footer">
        <div className="cp-footer-top">
          <div className="cp-footer-about">
            <span className="cp-footer-brand display">AML Compliance</span>
            <span>Focused on AML/CTF audit readiness, regulatory alignment, and practical compliance execution.</span>
            <span className="cp-footer-note">Limited availability due to ongoing audit commitments</span>
          </div>
          <div className="cp-footer-contact">
            <span className="cp-footer-contact-title">Contact Information</span>
            <span>
              Phone: <a href="tel:+61404335811">+61 404 335 811</a>
            </span>
            <span>
              Email: <a href="mailto:rknathan@amlcompliance.com.au">rknathan@amlcompliance.com.au</a>
            </span>
            <span>Location: Eight Mile Plains QLD 4113</span>
          </div>
        </div>
        <div className="cp-footer-bottom">
          <span>Copyrights 2026 | Terms &amp; Conditions</span>
          <span>centinl.external-review / 1.0.0-preview · Sync Engine: v1.0.2</span>
        </div>
      </footer>
    </div>
  );
}

function Portal() {
  const toast = useToast();
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [loading, setLoading] = useState(true);

  const [schema, setSchema] = useState(null);
  const [answers, setAnswers] = useState({});
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/client/profile');
      setProfile(data);
      setProfileError('');
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const contactId = profile?.contact?.id;

  const loadForm = useCallback(async (id) => {
    setFormLoading(true);
    try {
      const [schemaRes, answersRes] = await Promise.all([ragApi.formSchema(), ragApi.getResponses(id)]);
      setSchema(schemaRes.questions);
      setAnswers(answersRes.answers || {});
      setFormError('');
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormLoading(false);
    }
  }, []);

  useEffect(() => {
    if (contactId) loadForm(contactId);
  }, [contactId, loadForm]);

  // Editing is open by default at ANY submission stage, partial or complete
  // — a client can always come back and change/resubmit. The ONLY thing
  // that locks the portal is an explicit admin action (never automatic).
  //
  // Locking is per-question, not all-or-nothing: a locked question's
  // already-answered sub-fields turn read-only, but any still-blank
  // sub-field stays open — and an admin can grant a specific question back
  // to fully editable via the per-question picker (profile.grantedQuestionIds).
  const grantedIds = new Set(profile?.grantedQuestionIds || []);
  const isQuestionLocked = useCallback(
    (qId) => !!profile?.editingLocked && !grantedIds.has(qId),
    [profile?.editingLocked, profile?.grantedQuestionIds]
  );
  const hasAnyEditableField = !!schema && schema.some((q) => {
    if (!isQuestionLocked(q.id)) return true;
    const fields = q.fields?.length ? q.fields : [{ key: 'value' }];
    const answerByField = answers[q.id];
    return fields.some((f) => {
      const sf = answerByField?.[f.key];
      const hasAnswer = !!(sf?.value && String(sf.value).trim()) || (sf?.files?.length > 0);
      return !hasAnswer;
    });
  });
  const showLiveForm = !!profile && (!profile.editingLocked || hasAnyEditableField);

  async function saveAnswer(qId, subKey, value) {
    const prev = answers[qId]?.[subKey]?.value || '';
    if (value === prev) return true; // nothing changed, skip the round-trip
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

  async function uploadFile(qId, subKey, file) {
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

  async function removeFile(qId, subKey, url) {
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

  async function submitFinal() {
    const total = schema?.length || 0;
    const answeredCount = (schema || []).filter((q) => questionHasAnswer(answers[q.id])).length;
    const isPartial = total > 0 && answeredCount < total;

    // A client is always allowed to submit early, and submitting never
    // locks the portal — they can keep editing and resubmit any time.
    const confirmMsg = isPartial
      ? `You've answered ${answeredCount} of ${total} questions. You can still submit now — the rest will show as ` +
        `outstanding to your auditor, and you can keep going and resubmit whenever you like. Submit now?`
      : "Submit your response for review? You'll still be able to make changes and resubmit afterward.";
    if (!window.confirm(confirmMsg)) return;

    setSubmitting(true);
    try {
      const data = await apiFetch('/api/client/submit', { method: 'POST' });
      toast(data.message || 'Submitted for review');
      await loadProfile();
    } catch (err) {
      toast(`Submission failed: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cp-portal">
      <header className="cp-portal-header">
        <div className="cp-portal-brand">
          <img src={LOGO} alt="Centinl Logo" className="cp-portal-logo" />
          <div className="cp-portal-divider" />
          <div className="cp-portal-client-meta">
            AUSTRAC Registered · independent evaluation of the AML/CTF program
          </div>
        </div>
        <UserMenu />
      </header>

      <div className="cp-portal-body">
        {loading && <div className="cp-loading">Loading your portal…</div>}
        {!loading && profileError && <div className="cp-error">Couldn't load your profile: {profileError}</div>}

        {!loading && !profileError && profile && (
          <>
            {profile.editingLocked && (
              <div className="cp-locked-banner">
                <div className="cp-locked-title display">
                  {hasAnyEditableField ? 'Submission Locked — Partial Editing' : 'Submission Locked (Read-Only)'}
                </div>
                <p>
                  {hasAnyEditableField
                    ? "Your auditor has locked editing while they review your Response Requirement Statement (RRS). You can still fill in anything you haven't answered yet, but already-submitted answers are locked unless your auditor grants edit permission for that specific question."
                    : "Your auditor has locked editing while they review your Response Requirement Statement (RRS). If you need to make changes, please request edit permission from the principal auditor."}
                </p>
              </div>
            )}

            {!profile.editingLocked && profile.done && (
              <div className="cp-unlock-banner">
                <div>
                  <div className="cp-unlock-title display">
                    {profile.isPartial ? 'Partial Response Filed' : 'Response Submitted'}
                  </div>
                  <p>
                    {profile.isPartial
                      ? "You submitted what you had so far. You can keep answering and upload or change documents any time — resubmit whenever you're ready."
                      : 'Your response has been submitted for review. You can still make changes and resubmit any time.'}
                  </p>
                </div>
              </div>
            )}

            {formLoading && <div className="cp-loading">Loading your evidence checklist…</div>}
            {!formLoading && formError && (
              <div className="cp-error">Couldn't load your checklist: {formError}. Please refresh the page.</div>
            )}
            {!formLoading && !formError && schema && (
              <IntakeForm
                schema={schema}
                answers={answers}
                readOnly={!showLiveForm}
                isQuestionLocked={isQuestionLocked}
                onSave={saveAnswer}
                onUpload={uploadFile}
                onRemoveFile={removeFile}
                onSubmit={submitFinal}
                submitting={submitting}
              />
            )}
          </>
        )}
      </div>

      {!loading && !profileError && profile && <ClientChatWidget />}
    </div>
  );
}

function IntakeForm({ schema, answers, readOnly, isQuestionLocked, onSave, onUpload, onRemoveFile, onSubmit, submitting }) {
  const bySection = {};
  schema.forEach((q) => {
    (bySection[q.section] = bySection[q.section] || []).push(q);
  });

  const total = schema.length;
  const answeredCount = schema.filter((q) => questionHasAnswer(answers[q.id])).length;
  const pct = total ? Math.round((answeredCount / total) * 100) : 0;

  return (
    <div className="cp-intake">
      <div className="cp-intake-head">
        <h2 className="display">{readOnly ? 'Your submitted evidence' : 'Your evidence checklist'}</h2>
        <p>
          {readOnly
            ? "This is what you submitted. Ask the auditor to unlock editing if something needs to change."
            : 'Answer what you can and upload documents as evidence. Everything saves automatically — come back any time.'}
        </p>
        {!readOnly && (
          <div className="cp-progress-row">
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <span className="cp-progress-label">
              {answeredCount}/{total} answered
            </span>
          </div>
        )}
      </div>

      {readOnly ? (
        <ResultBreakdown schema={schema} answers={answers} storageKey="client-summary" allowCustomize={false} />
      ) : (
        Object.entries(bySection).map(([section, qs]) => (
          <div className="cp-section" key={section}>
            <div className="cp-section-label">{section}</div>
            {qs.map((q) => (
              <QuestionCard key={q.id} q={q} answer={answers[q.id]} readOnly={readOnly} isQuestionLocked={isQuestionLocked} onSave={onSave} onUpload={onUpload} onRemoveFile={onRemoveFile} />
            ))}
          </div>
        ))
      )}

      {!readOnly && (
        <div className="cp-submit-row">
          {answeredCount < total && (
            <p className="cp-submit-hint">
              You don't have to finish everything before submitting — anything left blank will simply show your
              auditor as outstanding.
            </p>
          )}
          <button className="btn btn-primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? 'Submitting…' : answeredCount < total ? `Submit what I have (${answeredCount}/${total})` : 'Submit for review'}
          </button>
        </div>
      )}
    </div>
  );
}

// A question now maps to 1-4 real sub-fields (e.g. Q08 = AMLCO name +
// certification + CV upload) — QuestionAnswerFields (shared with the admin
// console) renders every one of them.
function QuestionCard({ q, answer, readOnly, isQuestionLocked, onSave, onUpload, onRemoveFile }) {
  const answered = questionHasAnswer(answer);
  const dotClass = answered ? 'answered' : q.critical ? 'critical' : 'empty';
  const locked = !readOnly && !!isQuestionLocked?.(q.id);

  return (
    <div className="cp-qcard card">
      <div className="cp-qcard-top">
        <div className="cp-qcard-id-row">
          <span className={`cp-qdot cp-qdot--${dotClass}`} />
          <span className="cp-qcard-id">{q.id}</span>
        </div>
        <div className="cp-qcard-badges">
          {locked && <span className="badge badge--neutral" title="Already-answered fields are locked; ask your auditor for edit permission">🔒 Locked</span>}
          {q.critical && <span className="badge badge--danger">Important</span>}
        </div>
      </div>
      <div className="cp-qcard-title">{q.title}</div>
      {q.lookingFor && <div className="cp-qcard-hint">{q.lookingFor}</div>}

      <QuestionAnswerFields q={q} answer={answer} readOnly={readOnly} isQuestionLocked={isQuestionLocked} onSave={onSave} onUpload={onUpload} onRemoveFile={onRemoveFile} />
    </div>
  );
}
