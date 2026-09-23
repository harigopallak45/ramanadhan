import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import Badge from './ui/Badge';
import FormalReportView from './FormalReportView';
import { ragApi } from '../lib/api';
import { useToast } from '../lib/toast';
import './FormalReportPanel.css';

// The Independent External Review Report as produced by an AI run: the
// current version shown as a document, every saved version listed (with the
// copy GHL holds on the contact's "AI Score Reports" field), Word download,
// print and copy. Generation itself is driven by the console's AI Score
// button — this panel only displays what a run produced.

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const scoreTone = (n) => (n >= 70 ? 'success' : n >= 50 ? 'pending' : 'danger');

export default function FormalReportPanel({ contactId, report, versions = [], running, onSelectVersion, onNewVersion, canNewVersion }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(null); // reportId being fetched
  const [ghlFiles, setGhlFiles] = useState(null);
  const [showVersions, setShowVersions] = useState(false);
  const printRootRef = useRef(null);

  // What GHL actually holds on the contact — refreshed whenever a new
  // version lands, so the list here and the GHL field never disagree.
  const versionKey = versions.map((v) => v.version).join(',');
  useEffect(() => {
    let cancelled = false;
    if (!versions.length) { setGhlFiles(null); return undefined; }
    ragApi.ghlReportFiles(contactId).then((d) => { if (!cancelled) setGhlFiles(d.files || []); }).catch(() => { if (!cancelled) setGhlFiles(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId, versionKey]);

  async function downloadDocx(reportId, fileName) {
    if (downloading) return;
    setDownloading(reportId);
    try {
      const name = await ragApi.downloadFullReportDocx(contactId, reportId, fileName);
      toast(`Downloaded ${name}`);
    } catch (err) {
      toast(`Couldn't download the Word file: ${err.message}`, 'error');
    } finally {
      setDownloading(null);
    }
  }

  function printReport() {
    if (!report) return;
    document.body.classList.add('fr-printing');
    const cleanup = () => { document.body.classList.remove('fr-printing'); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 2000); // browsers that never fire afterprint
  }

  function copyText() {
    if (!report) return;
    navigator.clipboard.writeText(report.fullText || '');
    toast('Report text copied to clipboard');
  }

  const ghlByName = new Map((ghlFiles || []).map((f) => [f.name, f]));

  return (
    <div className="card frp">
      <div className="frp-head">
        <div>
          <div className="eyebrow">Independent External Review Report</div>
          <p className="muted frp-blurb">
            Every AI Score run writes the full report — executive summary, business profile, scope and methodology, the
            detailed compliance review (areas A–Q), opportunities, strengths, red flags and conclusion — renders it as Word
            in the issued format, and files it on the client's GHL contact as the next version.
          </p>
        </div>
        <div className="frp-actions">
          {versions.length > 0 && (
            <Button variant="secondary" size="sm" className="ac-gold-outline" onClick={() => setShowVersions((v) => !v)}>
              {showVersions ? 'Hide versions' : `Versions (${versions.length})`}
            </Button>
          )}
          {onNewVersion && (
            <Button variant="ghost" size="sm" disabled={!canNewVersion || !!running} onClick={onNewVersion} title="Write a new report version around the current score without re-scoring">
              New version (same score)
            </Button>
          )}
        </div>
      </div>

      {showVersions && versions.length > 0 && (
        <div className="frp-versions">
          <table className="frp-versions-table">
            <thead>
              <tr><th>Version</th><th>Generated</th><th>Score</th><th>Assessment</th><th>GHL contact</th><th></th></tr>
            </thead>
            <tbody>
              {versions.map((v) => {
                const current = report && report.id === v.reportId;
                const inGhl = ghlByName.get(v.fileName);
                return (
                  <tr key={v.version} className={current ? 'is-current' : ''}>
                    <td><strong>v{v.version}</strong>{v.kind === 'report' ? <span className="faint"> · report only</span> : ''}</td>
                    <td>{fmtWhen(v.generatedAt)}</td>
                    <td><Badge tone={scoreTone(v.score)}>{v.score}/100</Badge></td>
                    <td className="frp-versions-assessment">{v.assessment}</td>
                    <td>
                      {inGhl
                        ? <a href={inGhl.url} target="_blank" rel="noreferrer" title={inGhl.name}>Filed ✓</a>
                        : v.ghl?.error
                          ? <span className="ac-activity-warn" title={v.ghl.error}>Not filed</span>
                          : v.ghl?.fileUrl ? <span>Filed ✓</span> : <span className="faint">—</span>}
                    </td>
                    <td className="frp-versions-actions">
                      {!current && <button className="btn btn-ghost btn-sm" onClick={() => onSelectVersion?.(v)}>View</button>}
                      <button className="btn btn-ghost btn-sm" disabled={downloading === v.reportId} onClick={() => downloadDocx(v.reportId, v.fileName)}>
                        {downloading === v.reportId ? 'Preparing…' : 'Word'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ghlFiles && (
            <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>
              GHL holds {ghlFiles.length} file{ghlFiles.length === 1 ? '' : 's'} on this contact's "AI Score Reports" field.
            </div>
          )}
        </div>
      )}

      {!report && !running && (
        <div className="frp-empty">
          {versions.length ? 'Pick a version above to view it.' : 'No report yet — click AI Score. The report is written as part of the run and appears here when it finishes.'}
        </div>
      )}

      {report && (
        <>
          <div className="frp-report-bar">
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              <Badge tone="gold">v{report.version || '—'}</Badge>
              <Badge tone={scoreTone(report.score.value)}>{report.score.value}/100</Badge>
              <span className="muted" style={{ fontSize: 12.5 }}>{report.score.assessment}</span>
              <span className="faint" style={{ fontSize: 12 }}>· generated {fmtWhen(report.generatedAt)}{report.model ? ` · ${report.model}` : ''}</span>
            </div>
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              <Button variant="primary" size="sm" disabled={downloading === report.id} onClick={() => downloadDocx(report.id, report.fileName)}>
                {downloading === report.id ? 'Preparing…' : 'Download Word (.docx)'}
              </Button>
              <Button variant="ghost" size="sm" onClick={printReport}>Print / PDF</Button>
              <Button variant="ghost" size="sm" onClick={copyText}>Copy text</Button>
            </div>
          </div>

          {report.ghl?.error && (
            <div className="ac-ai-warn ac-ai-warn--pending">
              ⚠ The report was saved here but could not be filed on the GHL contact: {report.ghl.error}
            </div>
          )}
          {report.ghl?.fileUrl && !report.ghl.error && (
            <div className="faint frp-filed">
              Filed on the client's GHL contact as <strong>{report.fileName}</strong>{report.ghl.noteAdded ? ' · note added to the activity feed' : ''}.
            </div>
          )}
          {report.warnings?.length > 0 && (
            <div className="ac-ai-warn">
              <strong>Draft notes — review before issue:</strong>
              <ul className="frp-warnings">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {report.notes?.length > 0 && (
            <div className="faint" style={{ fontSize: 12, marginBottom: 12 }}>
              {report.notes.map((n, i) => <div key={i}>ⓘ {n}</div>)}
            </div>
          )}

          <div className="fr-print-root" ref={printRootRef}>
            <FormalReportView report={report} />
          </div>
          <div className="ac-ai-footer">
            Drafted by the Centinl AI reviewer from the entity's submitted evidence and the AI score verdicts. A qualified auditor must review, edit and sign off every section before the report is issued.
          </div>
        </>
      )}
    </div>
  );
}
