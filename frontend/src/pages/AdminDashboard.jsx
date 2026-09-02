import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { Field, TextInput, TextArea, Select, Toggle } from '../components/ui/Field';
import { apiFetch, ragApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import './AdminDashboard.css';

const NAV_TABS = [{ to: '/admin', label: 'Clients' }, { to: '/questions', label: 'Question Builder' }];
const EMPTY_INVITE = { firstName: '', lastName: '', email: '', company: '', role: 'client' };
const EMPTY_NEW_QUESTION = { section: '', title: '', adequacy: '', efficacy: '', inputType: 'file', critical: false };
const EMPTY_SCORECARD = { open: false, contactId: null, name: '', result: null, loading: false, error: '', reportOpen: false };

function statusTone(status) {
  const s = (status || '').toLowerCase();
  if (s === 'completed') return 'success';
  if (s === 'admin') return 'gold';
  if (s === 'not started') return 'neutral';
  return 'pending';
}

// The backend derives status from GHL tags alone, so a client who has never
// opened the form and one who is halfway through both read "In Progress".
// Once the per-client counts land we can tell those apart — but only then,
// so an absent count leaves the tag-derived status untouched rather than
// mislabelling someone as idle while their numbers are still loading.
function effectiveStatus(user, perClient) {
  const status = user.status || '';
  if (status.toLowerCase() !== 'in progress') return status;
  const p = perClient?.[user.id];
  if (p && p.total > 0 && p.answered === 0) return 'Not started';
  return status;
}

function EngineChip({ engine, className = '' }) {
  if (!engine) return <span className={`ad-engine-chip ${className}`}>engine…</span>;
  if (engine.configured) {
    return (
      <span className={`ad-engine-chip ${className}`} title={`${engine.provider || ''} · ${engine.model || ''}`}>
        ✓ AI ready
      </span>
    );
  }
  return <span className={`ad-engine-chip off ${className}`}>AI not set up</span>;
}

export default function AdminDashboard() {
  const { logout } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [engine, setEngine] = useState(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  // Admins and clients are the same GHL contacts distinguished only by tag,
  // so they arrive in one list; this splits the view without a second fetch.
  const [roleView, setRoleView] = useState('client');
  const [progress, setProgress] = useState(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState(EMPTY_INVITE);
  const [inviting, setInviting] = useState(false);

  // Per-invite question picker — "send everyone everything" is the default
  // (customizeQuestions off) so a non-technical admin never has to think
  // about this unless they choose to.
  const [customizeQuestions, setCustomizeQuestions] = useState(false);
  const [inviteQuestions, setInviteQuestions] = useState([]); // active questions, loaded when the modal opens
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [selectedQIds, setSelectedQIds] = useState([]);
  const [showNewQForm, setShowNewQForm] = useState(false);
  const [newQForm, setNewQForm] = useState(EMPTY_NEW_QUESTION);
  const [savingNewQ, setSavingNewQ] = useState(false);

  const [scorecard, setScorecard] = useState(EMPTY_SCORECARD);

  useEffect(() => { fetchUsers(); loadEngineChip(); }, []);

  // Load the current question bank the moment the invite modal opens, so
  // the picker is ready the instant an admin chooses to customize it.
  useEffect(() => {
    if (!inviteOpen) return;
    setQuestionsLoading(true);
    ragApi.listQuestions()
      .then((d) => {
        const active = (d.questions || []).filter((q) => !q.archived).sort((a, b) => a.order - b.order);
        setInviteQuestions(active);
        setSelectedQIds(active.map((q) => q.id)); // everything checked by default — admin deselects what they don't need
      })
      .catch(() => setInviteQuestions([]))
      .finally(() => setQuestionsLoading(false));
  }, [inviteOpen]);

  const questionsBySection = useMemo(() => {
    const map = {};
    inviteQuestions.forEach((q) => { (map[q.section] = map[q.section] || []).push(q); });
    return map;
  }, [inviteQuestions]);

  function toggleQuestionId(id) {
    setSelectedQIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }

  async function saveNewQuestionInline() {
    if (!newQForm.title.trim() || !newQForm.section.trim()) return toast('Give the question a title and a section.', 'error');
    const ok = window.confirm(
      `This will create a new custom field "${newQForm.title}" in your GHL account to store answers for this question. ` +
      `This is a real, persistent change to your CRM. Continue?`
    );
    if (!ok) return;
    setSavingNewQ(true);
    try {
      const payload = { ...newQForm, keywords: [] };
      const d = await ragApi.addQuestion(payload);
      setInviteQuestions((qs) => [...qs, d.question]);
      setSelectedQIds((ids) => [...ids, d.question.id]); // auto-include it for this invite
      setShowNewQForm(false);
      setNewQForm(EMPTY_NEW_QUESTION);
      toast('Question added — included for this invite.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingNewQ(false);
    }
  }

  async function fetchUsers() {
    setLoading(true); setLoadError('');
    try {
      const data = await apiFetch('/api/admin/users');
      setUsers(data.users || []);
    } catch (err) {
      if (err.status === 401 || err.status === 403) { logout(); return; }
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadEngineChip() {
    try { setEngine(await ragApi.health()); }
    catch { setEngine({ configured: false }); }
  }

  const clients = useMemo(() => users.filter((u) => u.role !== 'admin'), [users]);
  const admins = useMemo(() => users.filter((u) => u.role === 'admin'), [users]);
  const viewUsers = roleView === 'admin' ? admins : clients;

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const status = statusFilter.toLowerCase();
    return viewUsers.filter((u) => {
      const matchesSearch = !q
        || (u.name || '').toLowerCase().includes(q)
        || (u.email || '').toLowerCase().includes(q)
        || (u.company && u.company.toLowerCase().includes(q));
      // Every admin carries the same 'Admin' status, so the filter only
      // means anything on the client list.
      const matchesStatus = roleView === 'admin' || status === 'all'
        || effectiveStatus(u, progress?.perClient).toLowerCase() === status;
      return matchesSearch && matchesStatus;
    });
  }, [viewUsers, roleView, search, statusFilter, progress]);

  // Answered/total costs one GHL fetch per client, so it runs after the table
  // has already painted rather than holding it up. Keyed on the id list so it
  // re-runs when clients are invited or removed — not on every keystroke in
  // the search box.
  const clientIdKey = useMemo(() => clients.map((u) => u.id).sort().join(','), [clients]);
  useEffect(() => {
    if (!clientIdKey) { setProgress(null); return undefined; }
    let cancelled = false;
    apiFetch('/api/admin/progress-summary', { method: 'POST', body: { contactIds: clientIdKey.split(',') } })
      .then((d) => { if (!cancelled) setProgress(d); })
      // A failed aggregate just means no question counts in the headline —
      // the rest of the dashboard is unaffected, so stay quiet.
      .catch(() => { if (!cancelled) setProgress(null); });
    return () => { cancelled = true; };
  }, [clientIdKey]);

  const stats = useMemo(() => {
    const completed = clients.filter((u) => (u.status || '').toLowerCase() === 'completed').length;
    // "In progress" only — the legacy page compared against a status value
    // ('pending') the backend never actually sends, so this stat was always
    // stuck at 0. Matching on the real status string fixes that.
    const active = clients.filter((u) => (u.status || '').toLowerCase() === 'in progress').length;
    // Subset of `active` — everyone awaiting submission who hasn't answered
    // a single question yet. Needs the per-client counts, so it's 0 until
    // those arrive.
    const notStarted = clients.filter((u) => effectiveStatus(u, progress?.perClient) === 'Not started').length;
    return { total: clients.length, completed, active, notStarted, rest: clients.length - completed };
  }, [clients, progress]);

  const allFilteredSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedIds.includes(u.id));

  function toggleSelect(id) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }
  function toggleSelectAll() {
    if (allFilteredSelected) {
      const filteredIds = new Set(filteredUsers.map((u) => u.id));
      setSelectedIds((ids) => ids.filter((id) => !filteredIds.has(id)));
    } else {
      setSelectedIds((ids) => Array.from(new Set([...ids, ...filteredUsers.map((u) => u.id)])));
    }
  }
  function clearSelection() { setSelectedIds([]); }

  async function handleBulkNudge() {
    if (!selectedIds.length) return;
    if (!window.confirm(`Trigger reminders for ${selectedIds.length} users?`)) return;
    try {
      const d = await apiFetch('/api/admin/bulk-nudge', { method: 'POST', body: { contactIds: selectedIds } });
      toast(d.message || 'Reminders sent.');
      clearSelection();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleBulkTag() {
    if (!selectedIds.length) return;
    const tag = window.prompt('Enter tag to apply:');
    if (!tag) return;
    try {
      const d = await apiFetch('/api/admin/bulk-tag', { method: 'POST', body: { contactIds: selectedIds, tag } });
      toast(d.message || 'Tag applied.');
      clearSelection();
    } catch (err) { toast(err.message, 'error'); }
  }

function closeInviteModal() {
    setInviteOpen(false);
    setInviteForm(EMPTY_INVITE);
    setCustomizeQuestions(false);
    setShowNewQForm(false);
    setNewQForm(EMPTY_NEW_QUESTION);
  }

  async function sendInvite() {
    if (!inviteForm.firstName.trim() || !inviteForm.email.trim()) {
      return toast('First Name and Email are required.', 'error');
    }
    if (customizeQuestions && !selectedQIds.length) {
      return toast('Pick at least one question, or switch back to "Ask them everything".', 'error');
    }
    setInviting(true);
    try {
      const d = await apiFetch('/api/admin/invite', { method: 'POST', body: inviteForm });
      // Only write a custom question list if the admin actually chose to
      // customize it — otherwise leave the field untouched (unset = everyone).
      if (customizeQuestions && d.contactId) {
        try {
          await ragApi.saveAssignments(d.contactId, selectedQIds);
        } catch (err) {
          toast(`Invite sent, but couldn't save the custom question list: ${err.message}`, 'error');
        }
      }
      toast(d.message || 'Invite sent.');
      closeInviteModal();
      fetchUsers();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setInviting(false);
    }
  }

  function openScorecard(user) {
    const name = (user.company && user.company !== 'N/A') ? user.company : (user.name || user.email);
    setScorecard({ ...EMPTY_SCORECARD, open: true, contactId: user.id, name, loading: true });
    runScore(user.id);
  }
  function closeScorecard() { setScorecard((s) => ({ ...s, open: false })); }

  async function runScore(contactId) {
    const id = contactId || scorecard.contactId;
    if (!id) return;
    setScorecard((s) => ({ ...s, loading: true, error: '', result: null }));
    try {
      const d = await ragApi.score(id, { save: true });
      setScorecard((s) => ({ ...s, loading: false, result: d.result }));
    } catch (err) {
      setScorecard((s) => ({ ...s, loading: false, error: err.message }));
    }
  }

  async function requestEvidence() {
    const areas = scorecard.result?.areas || [];
    const gaps = areas.filter((a) => a.status === 'missing' || a.status === 'inadequate');
    if (!gaps.length) return toast('No outstanding evidence gaps to request.', 'error');
    const lines = gaps.map((g) => `• ${g.qId} ${g.title}`).join('\n');
    if (!window.confirm(`Log an evidence request for ${gaps.length} item(s) to this contact's GHL activity feed?`)) return;
    try {
      await ragApi.note(scorecard.contactId, `Centinl — evidence requested from client (${gaps.length} items):\n${lines}`);
      toast('Evidence request logged to GHL.');
    } catch (err) { toast(err.message, 'error'); }
  }

  function exportScorecardPdf() {
    const r = scorecard.result;
    if (!r) return;
    const rows = (r.areas || []).map((a) =>
      `<tr><td>${a.qId}</td><td>${a.title}</td><td style="text-align:center;">${a.adequacy}/${a.efficacy}</td><td>${a.status}</td><td>${(a.finding || '').replace(/</g, '&lt;')}</td></tr>`
    ).join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Centinl Report — ${scorecard.name}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:32px;max-width:900px;margin:auto;}
      h1{font-size:20px;margin:0;} .sub{color:#666;font-size:13px;margin:4px 0 18px;}
      .band{display:inline-block;padding:4px 12px;border-radius:6px;background:#f0f0f0;font-size:13px;}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-top:14px;}
      td,th{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top;} th{background:#f5f5f5;}
      .muted{color:#777;font-size:11px;margin-top:18px;}</style></head><body>
      <h1>Centinl — Independent AML/CTF Program Evaluation</h1>
      <div class="sub"><b>${scorecard.name}</b> · ${new Date(r.scoredAt || Date.now()).toLocaleString()}</div>
      <div class="sub">${(r.framework || 'AUSTRAC AML/CTF Reform — independent evaluation').replace(/</g, '&lt;')}</div>
      <h2>Score: ${r.score}/100 &nbsp;<span class="band">${r.rating}</span></h2>
      <div class="muted">raw ${r.rawScore} · −${r.deduction} critical deductions · ${r.criticalFailures} critical gaps · engine ${r.model}</div>
      <p>${(r.executiveSummary || '').replace(/</g, '&lt;')}</p>
      <table><thead><tr><th>Area</th><th>Title</th><th>Adq/Eff</th><th>Status</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="muted">Generated by Centinl AI evaluator. Auditor review required before issue.</div>
      </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }

  return (
    <div className="theme-dark ad-page">
      <Topbar tabs={NAV_TABS} right={<EngineChip engine={engine} />} />

      <main className="ad-main">
        <div className="ad-summary-line">
          {loading ? 'Loading clients…' : (
            <>
              <strong>{stats.total}</strong> clients · <strong>{stats.completed}</strong> completed · <strong>{stats.active}</strong> awaiting submission
              {stats.notStarted > 0 && <> (<strong>{stats.notStarted}</strong> not started)</>}
              {progress && progress.total > 0 && (
                <> · <strong>{progress.answered}</strong> of <strong>{progress.total}</strong> questions answered
                  {' '}(<strong>{progress.total - progress.answered}</strong> remaining)</>
              )}
              {progress && progress.failed > 0 && (
                <span className="ad-summary-warn"> · {progress.failed} skipped</span>
              )}
              {' · '}<strong>{admins.length}</strong> {admins.length === 1 ? 'admin' : 'admins'}
            </>
          )}
        </div>

        <div className="card ad-table-card">
          <div className="ad-table-head">
            <div>
              <div className="ad-roleswitch" role="tablist" aria-label="Account type">
                {[
                  { key: 'client', label: 'Clients', count: clients.length },
                  { key: 'admin', label: 'Admins', count: admins.length }
                ].map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    role="tab"
                    aria-selected={roleView === v.key}
                    className={`ad-roleswitch-btn${roleView === v.key ? ' active' : ''}`}
                    // Selections don't carry across — a checked row in the
                    // other list would silently join the next bulk action.
                    onClick={() => { setRoleView(v.key); setSelectedIds([]); }}
                  >
                    {v.label}<span className="ad-roleswitch-count">{v.count}</span>
                  </button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                {roleView === 'admin'
                  ? 'Administrators can see every client file and run scores. They have no audit of their own.'
                  : 'Pick a client, then run their AI score or open their file.'}
              </div>
            </div>
            <div className="ad-table-controls">
              {roleView === 'client' && (
                <select className="select ad-status-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All Statuses</option>
                  <option value="completed">Completed</option>
                  <option value="in progress">In Progress</option>
                  <option value="not started">Not Started</option>
                  <option value="partial">Partial</option>
                </select>
              )}
              <div className="ad-search-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                <input className="input" type="text"
                  placeholder={roleView === 'admin' ? 'Search admins…' : 'Search entities…'}
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button variant="primary" onClick={() => { setInviteForm({ ...EMPTY_INVITE, role: roleView }); setInviteOpen(true); }}>
                {roleView === 'admin' ? '+ Invite Admin' : '+ Invite Client'}
              </Button>
            </div>
          </div>

          {loading && (
            <div className="ad-skel-list">
              <div className="skeleton" style={{ height: 56 }} />
              <div className="skeleton" style={{ height: 56 }} />
              <div className="skeleton" style={{ height: 56 }} />
            </div>
          )}

          {!loading && loadError && <div className="ad-empty">Couldn't connect to the server. {loadError}</div>}

          {!loading && !loadError && !filteredUsers.length && (
            <div className="ad-empty">No {roleView === 'admin' ? 'admins' : 'clients'} match your search.</div>
          )}

          {!loading && !loadError && filteredUsers.length > 0 && (
            <table className="ad-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" className="ad-checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} title="Select all" />
                  </th>
                  <th>{roleView === 'admin' ? 'Administrator' : 'Client'}</th>
                  <th>Company</th>
                  <th>Audit status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td><input type="checkbox" className="ad-checkbox" checked={selectedIds.includes(user.id)} onChange={() => toggleSelect(user.id)} /></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {user.name || '—'}
                        {user.role === 'admin' && <Badge tone="gold" style={{ marginLeft: 6 }}>Admin</Badge>}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>{user.email}</div>
                    </td>
                    <td>{user.company && user.company !== 'N/A' ? user.company : '—'}</td>
                    <td>
                      <div className="ad-status-cell">
                        <Badge tone={statusTone(effectiveStatus(user, progress?.perClient))}>
                          {effectiveStatus(user, progress?.perClient)}
                        </Badge>
                        {roleView === 'client' && (() => {
                          // Arrives after the table paints, so render nothing
                          // rather than a flash of "0/0" while it's in flight.
                          const p = progress?.perClient?.[user.id];
                          if (!p || !p.total) return null;
                          const pct = Math.round((p.answered / p.total) * 100);
                          return (
                            <span className="ad-progress" title={`${p.answered} of ${p.total} answered · ${p.total - p.answered} remaining`}>
                              <span className="ad-progress-bar"><span className="ad-progress-fill" style={{ width: `${pct}%` }} /></span>
                              <span className="ad-progress-text">{p.answered}/{p.total}</span>
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="ad-row-actions">
                      <button className="ad-btn-score" onClick={() => openScorecard(user)}>✦ AI Score</button>
                      <Link className="btn btn-secondary btn-sm" to={`/entity/${user.id}`}>View</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      <div className={`ad-bulk-bar ${selectedIds.length ? 'active' : ''}`}>
        <div className="ad-bulk-count"><span>{selectedIds.length}</span> selected</div>
        <div className="ad-bulk-divider" />
        <button className="ad-bulk-btn" onClick={handleBulkNudge}>Send reminder</button>
        <button className="ad-bulk-btn" onClick={handleBulkTag}>Add tag</button>
        <div className="ad-bulk-divider" />
        <button className="ad-bulk-clear" onClick={clearSelection}>Clear selection</button>
      </div>

      <Modal open={inviteOpen} onClose={closeInviteModal} maxWidth={600}>
        <div className="ad-invite-modal">
          <h2 className="display" style={{ fontSize: 24, marginBottom: 2 }}>Invite someone new</h2>
          <p className="ad-invite-sub">Fill in their details, choose what they can do, and — if you like — pick exactly what to ask them.</p>

          <Field label="First name">
            <TextInput placeholder="First Name" value={inviteForm.firstName} onChange={(e) => setInviteForm({ ...inviteForm, firstName: e.target.value })} />
          </Field>
          <Field label="Last name" hint="optional">
            <TextInput placeholder="Last Name" value={inviteForm.lastName} onChange={(e) => setInviteForm({ ...inviteForm, lastName: e.target.value })} />
          </Field>
          <Field label="Email address">
            <TextInput type="email" placeholder="Email Address" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
          </Field>
          <Field label="Company name" hint="optional">
            <TextInput placeholder="Company Name" value={inviteForm.company} onChange={(e) => setInviteForm({ ...inviteForm, company: e.target.value })} />
          </Field>

          <Field label="What can they do here?">
            <div className="ad-role-options">
              <div
                className={`ad-role-card ${inviteForm.role === 'client' ? 'active' : ''}`}
                onClick={() => setInviteForm({ ...inviteForm, role: 'client' })}
              >
                <div className="ad-role-card-title">Client</div>
                <div className="ad-role-card-desc">Fills out their own audit form. Can't see other clients.</div>
              </div>
              <div
                className={`ad-role-card ${inviteForm.role === 'admin' ? 'active' : ''}`}
                onClick={() => setInviteForm({ ...inviteForm, role: 'admin' })}
              >
                <div className="ad-role-card-title">Administrator</div>
                <div className="ad-role-card-desc">Full access — sees every client, can score and manage everything.</div>
              </div>
            </div>
          </Field>

          {inviteForm.role === 'client' && (
            <Field label="What should we ask them?">
              {/* A single source of truth for the click: only the Toggle's own
                  onChange flips state (Toggle already renders its own <label>,
                  so wrapping it in a SECOND label — or adding a sibling onClick
                  on this div — creates two handlers that fire on the same click
                  and cancel each other out, which is why the switch looked stuck). */}
              <div className="ad-questions-toggle">
                <div>
                  <div className="ad-questions-toggle-label">
                    {customizeQuestions ? 'Custom question list' : 'Everything (recommended)'}
                  </div>
                  <div className="ad-questions-toggle-hint">
                    {customizeQuestions
                      ? `${selectedQIds.length} of ${inviteQuestions.length} questions selected`
                      : `They'll see all ${inviteQuestions.length || '…'} current questions`}
                  </div>
                </div>
                <Toggle checked={customizeQuestions} onChange={() => setCustomizeQuestions((v) => !v)} />
              </div>

              {customizeQuestions && (
                <div className="ad-question-picker" style={{ marginTop: 10 }}>
                  <div className="ad-question-picker-head">
                    <span className="hint">Untick anything you don't need to ask them</span>
                    <div className="ad-question-picker-actions">
                      <button type="button" onClick={() => setSelectedQIds(inviteQuestions.map((q) => q.id))}>Select all</button>
                      <button type="button" onClick={() => setSelectedQIds([])}>Clear</button>
                    </div>
                  </div>
                  <div className="ad-question-picker-list">
                    {questionsLoading && <div className="hint" style={{ padding: 10 }}>Loading questions…</div>}
                    {!questionsLoading && Object.entries(questionsBySection).map(([section, qs]) => (
                      <div key={section}>
                        <div className="ad-question-picker-section">{section}</div>
                        {qs.map((q) => (
                          <label className="ad-question-picker-row" key={q.id}>
                            <input type="checkbox" checked={selectedQIds.includes(q.id)} onChange={() => toggleQuestionId(q.id)} />
                            <div>
                              <div className="ad-question-picker-row-title">{q.title}</div>
                              <div className="ad-question-picker-row-meta">{q.id}{q.critical ? ' · critical' : ''}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="ad-add-question-inline">
                    {!showNewQForm ? (
                      <button type="button" className="ad-add-question-toggle" onClick={() => setShowNewQForm(true)}>
                        + Ask something not on this list
                      </button>
                    ) : (
                      <div className="ad-add-question-form">
                        <TextInput placeholder="Section (e.g. Step 2: Risk Assessment)" value={newQForm.section} onChange={(e) => setNewQForm({ ...newQForm, section: e.target.value })} />
                        <TextInput placeholder="Question title — what the client sees" value={newQForm.title} onChange={(e) => setNewQForm({ ...newQForm, title: e.target.value })} />
                        <TextArea placeholder="What counts as a good answer?" value={newQForm.adequacy} onChange={(e) => setNewQForm({ ...newQForm, adequacy: e.target.value })} />
                        <div className="ad-add-question-row">
                          <Select value={newQForm.inputType} onChange={(e) => setNewQForm({ ...newQForm, inputType: e.target.value })}>
                            <option value="file">Document upload</option>
                            <option value="textarea">Long text answer</option>
                            <option value="text">Short text answer</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                            <option value="phone">Phone</option>
                            <option value="monetary">Monetary</option>
                            <option value="checkbox">Checkbox (Yes/No)</option>
                          </Select>
                          <div className="row gap-2" style={{ height: 44 }}>
                            <Toggle checked={newQForm.critical} onChange={(e) => setNewQForm({ ...newQForm, critical: e.target.checked })} label="Critical" />
                          </div>
                        </div>
                        <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                          <Button variant="ghost" size="sm" onClick={() => { setShowNewQForm(false); setNewQForm(EMPTY_NEW_QUESTION); }}>Cancel</Button>
                          <Button variant="primary" size="sm" onClick={saveNewQuestionInline} disabled={savingNewQ}>
                            {savingNewQ ? 'Adding…' : 'Add question'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Field>
          )}

          <div className="ad-invite-actions">
            <Button variant="ghost" onClick={closeInviteModal}>Cancel</Button>
            <Button variant="primary" onClick={sendInvite} disabled={inviting}>{inviting ? 'Sending…' : 'Send Invite'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={scorecard.open} onClose={closeScorecard} maxWidth={720}>
        <ScorecardBody
          scorecard={scorecard}
          engine={engine}
          onClose={closeScorecard}
          onRescore={() => runScore()}
          onRequestEvidence={requestEvidence}
          onExportPdf={exportScorecardPdf}
          onToggleReport={() => setScorecard((s) => ({ ...s, reportOpen: !s.reportOpen }))}
        />
      </Modal>
    </div>
  );
}

function toneColor(score) {
  return score >= 85 ? 'var(--success)' : score >= 70 ? 'var(--gold)' : score >= 50 ? 'var(--pending)' : 'var(--danger)';
}
function bandBg(score) {
  return score >= 85 ? 'var(--success-wash)' : score >= 70 ? 'var(--gold-wash)' : score >= 50 ? 'var(--pending-wash)' : 'var(--danger-wash)';
}
function markColor(v) { return v >= 60 ? 'var(--success)' : v >= 30 ? 'var(--pending)' : 'var(--danger)'; }
function statusTone2(s) { return s === 'adequate' ? 'success' : s === 'partial' ? 'pending' : (s === 'inadequate' || s === 'error') ? 'danger' : 'neutral'; }
function plainStatus(s) { return ({ adequate: 'Good', partial: 'Partial', inadequate: 'Weak', missing: 'Not provided', error: 'Not scored' })[s] || s; }
function bandText(score) {
  return score >= 85 ? 'Strong — this file looks compliant.'
    : score >= 70 ? 'Mostly there — a few gaps to fix.'
    : score >= 50 ? 'Not ready — several things need fixing.'
    : 'Not ready — major evidence is missing.';
}

function Pipeline({ state }) {
  return (
    <div className="ad-sc-pipe">
      <span className="ad-sc-step done">✓ received</span><span>→</span>
      <span className={`ad-sc-step ${state === 'processing' ? 'active' : 'done'}`}>{state === 'done' ? '✓ ' : ''}reading documents</span><span>→</span>
      <span className={`ad-sc-step ${state === 'done' ? 'active' : ''}`}>{state === 'done' ? '✓ ' : ''}done</span>
    </div>
  );
}

function ScorecardBody({ scorecard, engine, onClose, onRescore, onRequestEvidence, onExportPdf, onToggleReport }) {
  const { name, result, loading, error, reportOpen } = scorecard;

  return (
    <div className="ad-sc-panel">
      <div className="ad-sc-head">
        <div>
          <div className="display ad-sc-entity">{name || 'Entity'}</div>
          <div className="muted" style={{ fontSize: 12 }}>Independent AML/CTF review · grounded scoring</div>
        </div>
        <div className="row gap-2">
          <EngineChip engine={engine} />
          <button className="ad-sc-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {loading && (
        <>
          <Pipeline state="processing" />
          <div className="ad-sc-loading">
            Checking the client's documents against AUSTRAC rules…<br />
            <span style={{ fontSize: 12 }}>This usually takes a few seconds.</span>
          </div>
        </>
      )}

      {!loading && error && (
        <>
          <Pipeline state="processing" />
          <div className="ad-sc-error">{error}</div>
        </>
      )}

      {!loading && !error && result && (
        <>
          <Pipeline state="done" />

          <div className="ad-sc-score-row">
            <div className="ad-sc-score-big">
              <div className="muted" style={{ fontSize: 12 }}>Overall score</div>
              <div className="ad-sc-score-line">
                <span className="ad-sc-score-num" style={{ color: toneColor(result.score) }}>{result.score}</span>
                <span className="muted" style={{ fontSize: 13 }}>/ 100</span>
                <span className="ad-sc-rating" style={{ background: bandBg(result.score), color: toneColor(result.score) }}>{result.rating}</span>
              </div>
              <div className="ad-sc-bar"><span style={{ width: `${result.score}%`, background: toneColor(result.score) }} /></div>
              <div style={{ fontSize: 13, color: toneColor(result.score), marginTop: 10 }}>{bandText(result.score)}</div>
            </div>
            <div className="ad-sc-stats">
              <StatMini label="Serious gaps" value={result.criticalFailures} color="var(--danger)" />
              <StatMini label="Sections with evidence" value={`${(result.areas || []).filter((a) => a.status !== 'missing').length} / ${(result.areas || []).length}`} />
              <StatMini label="Documents read" value={result.documents?.read ?? 0} />
              <StatMini label="Couldn't read" value={result.documents?.unreadable ?? 0} color="var(--pending)" />
            </div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 500, margin: '0 0 4px' }}>Section-by-section results</div>
          <div className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>Each row has two bars — left: is it documented · right: does it actually work.</div>
          <div className="ad-sc-areas">
            {(result.areas || []).map((a) => (
              <div className="ad-sc-area-row" key={a.qId}>
                <span className="ad-sc-qid">{a.qId}</span>
                <span>{a.title}</span>
                <span className="ad-sc-dual">
                  <span><i style={{ width: `${a.adequacy || 0}%`, background: markColor(a.adequacy || 0) }} /></span>
                  <span><i style={{ width: `${a.efficacy || 0}%`, background: markColor(a.efficacy || 0) }} /></span>
                </span>
                <Badge tone={statusTone2(a.status)}>{plainStatus(a.status)}</Badge>
              </div>
            ))}
          </div>

          <div className="ad-sc-gaps">
            <div className="ad-sc-gaps-head">
              <div style={{ fontSize: 13, fontWeight: 500 }}>Missing items · {(result.areas || []).filter((a) => a.status === 'missing' || a.status === 'inadequate').length}</div>
              <button className="ad-sc-btn" onClick={onRequestEvidence}>Ask client for these</button>
            </div>
            <div className="ad-sc-gap-chips">
              {(result.areas || []).filter((a) => a.status === 'missing' || a.status === 'inadequate').length
                ? (result.areas || []).filter((a) => a.status === 'missing' || a.status === 'inadequate').map((g) => (
                  <Badge key={g.qId} tone={statusTone2(g.status)}>{g.qId} {g.title.split(' ').slice(0, 2).join(' ')}</Badge>
                ))
                : <span className="faint" style={{ fontSize: 12 }}>No outstanding gaps.</span>}
            </div>
          </div>

          {reportOpen && <div className="ad-sc-report">{result.draftReport || '(no report)'}</div>}

          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            <button className="ad-sc-btn" onClick={onToggleReport}>{reportOpen ? 'Hide full write-up' : 'See full write-up'}</button>
            <button className="ad-sc-btn" onClick={onExportPdf}>Download report</button>
            <button className="ad-sc-btn primary" onClick={onRescore}>Run again</button>
          </div>
        </>
      )}
    </div>
  );
}

function StatMini({ label, value, color }) {
  return (
    <div className="ad-sc-statmini">
      <div className="muted" style={{ fontSize: 11 }}>{label}</div>
      <div className="ad-sc-statmini-v" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
