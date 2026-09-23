import { useEffect, useState } from 'react';
import { Field, TextInput } from './ui/Field';
import { ragApi } from '../lib/api';

// The details printed on the External Review Report's cover, scope and
// sign-off — reviewer, firm, Statement of Engagement date, "as at" date,
// concluded date. Prefilled from the server's configured defaults; the
// auditor adjusts them before clicking AI Score. Stays collapsed until
// needed so the console isn't cluttered.

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function EngagementDetails({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const v = value || {};

  // Seed once from the server defaults (auditor / firm) + today's dates.
  useEffect(() => {
    if (value) return undefined;
    let cancelled = false;
    const base = { auditorName: '', auditorCredentials: '', firmName: '', engagementDate: '', asAtDate: todayYmd(), concludedDate: todayYmd() };
    ragApi.reportDefaults().then((d) => {
      if (cancelled) return;
      onChange({ ...base, auditorName: d.defaults?.auditorName || '', auditorCredentials: d.defaults?.auditorCredentials || '', firmName: d.defaults?.firmName || '' });
    }).catch(() => { if (!cancelled) onChange(base); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value });
  const summary = [v.auditorName, v.firmName, v.asAtDate ? `as at ${v.asAtDate}` : ''].filter(Boolean).join(' · ');

  return (
    <div className="card ac-engagement">
      <button type="button" className="ac-engagement-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="eyebrow">Report engagement details</span>
        <span className="muted ac-engagement-summary">{summary || 'Reviewer, firm and review dates printed on the report'}</span>
        <span className="faint">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="ac-engagement-grid">
          <Field label="Reviewer" htmlFor="eng-auditorName"><TextInput id="eng-auditorName" value={v.auditorName || ''} onChange={set('auditorName')} disabled={disabled} placeholder="Name printed on the sign-off" /></Field>
          <Field label="Credentials" htmlFor="eng-auditorCredentials"><TextInput id="eng-auditorCredentials" value={v.auditorCredentials || ''} onChange={set('auditorCredentials')} disabled={disabled} placeholder="e.g. MBA, CAMS-Audit" /></Field>
          <Field label="Reviewing firm" htmlFor="eng-firmName"><TextInput id="eng-firmName" value={v.firmName || ''} onChange={set('firmName')} disabled={disabled} placeholder="Named in the executive summary" /></Field>
          <Field label="Statement of Engagement dated" htmlFor="eng-engagementDate"><TextInput id="eng-engagementDate" type="date" value={v.engagementDate || ''} onChange={set('engagementDate')} disabled={disabled} /></Field>
          <Field label="Review as at" htmlFor="eng-asAtDate"><TextInput id="eng-asAtDate" type="date" value={v.asAtDate || ''} onChange={set('asAtDate')} disabled={disabled} /></Field>
          <Field label="Concluded on" htmlFor="eng-concludedDate"><TextInput id="eng-concludedDate" type="date" value={v.concludedDate || ''} onChange={set('concludedDate')} disabled={disabled} /></Field>
        </div>
      )}
    </div>
  );
}
