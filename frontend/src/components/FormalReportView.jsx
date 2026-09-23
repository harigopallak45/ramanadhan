import './FormalReportView.css';

// Renders the structured External Review Report (the JSON fullReport.js
// produces) as a document on screen, section for section in the order the
// issued Word file prints them. Pure presentation — the status badges beside
// each lettered area are an on-screen aid for the auditor and are not part
// of the issued document.

const STATUS_META = {
  adequate: { label: 'Adequate', tone: 'success' },
  partial: { label: 'Partial', tone: 'pending' },
  inadequate: { label: 'Inadequate', tone: 'danger' },
  missing: { label: 'Not evidenced', tone: 'danger' },
  error: { label: 'Not scored', tone: 'neutral' }
};

function Paras({ items }) {
  return (items || []).map((p, i) => <p key={i}>{p}</p>);
}

function AssessmentLines({ score }) {
  return (
    <div className="fr-assessment">
      <p><strong>Overall Assessment: {score.assessment}</strong></p>
      <p><strong>Indicative Overall Compliance Rating: {score.value}/100</strong></p>
    </div>
  );
}

export default function FormalReportView({ report: r, showStatus = true }) {
  if (!r) return null;
  return (
    <article className="fr-doc">
      <header className="fr-cover">
        <div className="fr-cover-band">
          <div className="fr-cover-year">{r.meta.year}</div>
          <div className="fr-cover-author">{r.meta.auditorName}</div>
          <div className="fr-cover-brand">{r.meta.brandName}</div>
          <div className="fr-cover-date">{r.meta.concludedLabel}</div>
        </div>
        <div className="fr-cover-main">
          <div className="fr-cover-title">AML/CTF<br />External Review Report</div>
          <div className="fr-cover-entity">{r.entity.legalName}</div>
          {r.entity.entityTypeLine && <div className="fr-cover-types">{r.entity.entityTypeLine}</div>}
          <div className="fr-cover-asat">Independent External Review of the AML/CTF Compliance Program<br />As at {r.meta.asAtLabel}</div>
        </div>
      </header>

      <h1>INDEPENDENT EXTERNAL REVIEW REPORT</h1>
      <h2 className="fr-subtitle">Anti-Money Laundering and Counter-Terrorism Financing Compliance Program</h2>
      <p className="fr-entity">{r.entity.legalName}</p>
      {r.entity.entityTypeLine && <p className="fr-entity-types">{r.entity.entityTypeLine}</p>}

      <h2>1. Executive Summary</h2>
      <Paras items={r.executiveSummary} />
      <AssessmentLines score={r.score} />

      <h2>2. Business Profile</h2>
      <table className="fr-profile">
        <thead><tr><th>Business Information</th><th>Details</th></tr></thead>
        <tbody>
          {r.businessProfile.map((row) => (
            <tr key={row.key} className={row.evidenced ? '' : 'fr-not-evidenced'}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>Business Overview</h4>
      <Paras items={r.businessOverview} />

      <h2>3. Scope and Methodology</h2>
      <h3>3.1 Scope of the Review</h3>
      <Paras items={r.scope.scopeParagraphs} />
      <h3>3.2 Review Methodology</h3>
      <Paras items={r.scope.methodologyParagraphs} />
      <h3>3.3 Areas Reviewed</h3>
      <p>The review assessed the effectiveness of the following key components of the AML/CTF framework:</p>
      <ul>{r.scope.areasReviewed.map((a, i) => <li key={i}>{a}</li>)}</ul>
      <h3>3.4 Review Limitations</h3>
      <Paras items={r.scope.limitationsParagraphs} />

      <h2>4. DETAILED COMPLIANCE REVIEW</h2>
      {r.detailedReview.map((s) => {
        const meta = STATUS_META[s.status] || STATUS_META.error;
        return (
          <section key={s.key} className="fr-area">
            <h3>
              {s.letter}. {s.title}
              {showStatus && (
                <span className={`badge badge--${meta.tone} fr-area-status`} title="On-screen aid only — not printed in the issued report">
                  {meta.label}{s.criticalFailure ? ' · critical' : ''}
                </span>
              )}
            </h3>
            <h4>Requirement</h4>
            <p>{s.requirement}</p>
            <h4>Auditor Observation</h4>
            <p className={/^\[/.test(s.observation) ? 'fr-placeholder' : ''}>{s.observation}</p>
          </section>
        );
      })}

      <h2>5. Opportunities for Improvement</h2>
      {r.opportunities.intro && <p>{r.opportunities.intro}</p>}
      <ul>{r.opportunities.items.map((x, i) => <li key={i}>{x}</li>)}</ul>

      <h2>6. Key Strengths</h2>
      <Paras items={r.keyStrengths} />

      <h2>7. Key Red Flags</h2>
      <Paras items={r.keyRedFlags} />

      <h2>8. Overall Conclusion</h2>
      <Paras items={r.overallConclusion} />
      <AssessmentLines score={r.score} />

      <footer className="fr-signoff">
        <p>Conducted by {r.meta.auditorName}{r.meta.auditorCredentials ? ` ${r.meta.auditorCredentials}` : ''}</p>
        <p>Electronically concluded on {r.meta.concludedLabel}.</p>
      </footer>
    </article>
  );
}
