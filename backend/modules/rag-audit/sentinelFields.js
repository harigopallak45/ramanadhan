// =====================================================================
// The "Sentinel rrs" GHL custom-field folder (id tX2XsCqeHWln8tlVlkSN,
// contact.rrs_*/contact.q0*_* fields) — a pre-built, purpose-typed field
// set for all 23 review areas, created 2026-04-23 by an integration
// BEFORE this app's own field-provisioning logic existed. Each question
// maps to 1-4 real GHL fields here (a notes field, structured metadata
// like counts/dates/options, and one or more file-upload fields) rather
// than the single blob-per-question this app used to assume.
//
// IDs are hardcoded (not fuzzy-matched) because these are known, stable,
// pre-existing fields — no lazy provisioning needed for them. Custom
// questions an admin adds later still go through the old auto-provision
// path in routes.js (resolveTargetField), which is unaffected by this file.
// =====================================================================

const SENTINEL_FOLDER_ID = 'tX2XsCqeHWln8tlVlkSN';
const SENTINEL_FOLDER_NAME = 'Sentinel rrs';

// inputType values: text | textarea | number | date | radio | select | file
const SENTINEL_FIELDS_BY_QUESTION = {
  Q01: [
    { key: 'program_notes', label: 'Program notes / summary', inputType: 'textarea', ghlFieldId: '6mi9PrNokfMF6Qe3MpWn', ghlFieldKey: 'contact.q01_program_notes' },
    { key: 'program_files', label: 'Supporting documents', inputType: 'file', ghlFieldId: 'SoBGjzElk42PukQvtS7b', ghlFieldKey: 'contact.q01_program_files' }
  ],
  Q02: [
    { key: 'fte_count', label: 'Compliance FTE / headcount', inputType: 'number', ghlFieldId: 'x7uN9S5p4YO8e6kG2dZ4', ghlFieldKey: 'contact.q02_fte_count' }
  ],
  Q03: [
    { key: 'training_frequency', label: 'Training frequency', inputType: 'select', ghlFieldId: 'tUzOyaKjCOmAei0hTYRb', ghlFieldKey: 'contact.q03_training_frequency', options: ['Monthly', 'Quarterly', 'Bi-annual', 'Annual', 'Ad-hoc / as needed'] },
    { key: 'training_files', label: 'Training records & materials', inputType: 'file', ghlFieldId: '8xLYr55nCjBbM2cVhvx0', ghlFieldKey: 'contact.q03_training_files' }
  ],
  Q04: [
    { key: 'officer_names', label: 'Personnel screened (names / roles)', inputType: 'textarea', ghlFieldId: '2nDJrYbmqFa2wgaA5r7g', ghlFieldKey: 'contact.q04_officer_names' },
    { key: 'police_checks', label: 'Police clearance / background-check files', inputType: 'file', ghlFieldId: '9feCaVNLNr3u7ves2bZZ', ghlFieldKey: 'contact.q04_police_checks' }
  ],
  Q05: [
    { key: 'jurisdictions', label: 'Delivery channels & jurisdictions', inputType: 'textarea', ghlFieldId: 'KUjDRkGxD0ek6JtCvH0d', ghlFieldKey: 'contact.q05_jurisdictions' },
    { key: 'fatf_yn', label: 'Any FATF-listed / high-risk jurisdictions involved?', inputType: 'radio', ghlFieldId: 'QJDNN9qTh5HOMB1H0rjl', ghlFieldKey: 'contact.q05_fatf_yn', options: ['Yes', 'No'] }
  ],
  Q06: [
    { key: 'sample_month', label: 'Sample month', inputType: 'date', ghlFieldId: 'J9Jn62nPKTiZHxVkGD8A', ghlFieldKey: 'contact.q06_sample_month' },
    { key: 'transaction_count', label: 'Transaction count for sample month', inputType: 'number', ghlFieldId: 'drZDaTLYDzfCzB4aq2Fv', ghlFieldKey: 'contact.q06_transaction_count' },
    { key: 'transaction_file', label: 'Transaction list', inputType: 'file', ghlFieldId: 'i6HE8YVKCp7yGPZa5f8o', ghlFieldKey: 'contact.q06_transaction_file' }
  ],
  Q07: [
    { key: 'austrac_profile', label: 'AUSTRAC business profile & risk assessment', inputType: 'file', ghlFieldId: 'HDT82kzO5sX08hHtMN0H', ghlFieldKey: 'contact.q07_austrac_profile' }
  ],
  Q08: [
    { key: 'amlco_name', label: 'AMLCO name', inputType: 'text', ghlFieldId: 'IJ0GQP1q47UWM3hTPc87', ghlFieldKey: 'contact.q08_amlco_name' },
    { key: 'amlco_cams', label: 'AMLCO certification', inputType: 'select', ghlFieldId: '8Xxyvr4CGDP8uOK0lr3G', ghlFieldKey: 'contact.q08_amlco_cams', options: ['CAMS', 'CAMS-Audit', 'CAMS-Audit Advanced', 'ICA Certificate / Diploma', 'Other', 'None'] },
    { key: 'amlco_cv', label: 'AMLCO CV / resume', inputType: 'file', ghlFieldId: 'fQmROjlhl1Gr0hDGsi8E', ghlFieldKey: 'contact.q08_amlco_cv' }
  ],
  Q09: [
    { key: 'acr_year', label: 'Compliance report period', inputType: 'text', ghlFieldId: 'JcUwjsljWqkdtKpcA9mA', ghlFieldKey: 'contact.q09_acr_year' },
    { key: 'acr_file', label: 'AUSTRAC compliance report', inputType: 'file', ghlFieldId: 'bWBAUr9WEtrkIMWM3xe1', ghlFieldKey: 'contact.q09_acr_file' }
  ],
  Q10: [
    { key: 'expiry_notes', label: 'Enrolment / registration expiry notes', inputType: 'text', ghlFieldId: 'bxHtvAW7xz3qOMcqBtbv', ghlFieldKey: 'contact.q10_expiry_notes' },
    { key: 'registration_files', label: 'Registration evidence', inputType: 'file', ghlFieldId: 'bkVobZbh8dsJcYh3lNSP', ghlFieldKey: 'contact.q10_registration_files' }
  ],
  Q11: [
    { key: 'org_chart', label: 'Org chart', inputType: 'file', ghlFieldId: 'DGPw9i04q0vPfgNwzxgD', ghlFieldKey: 'contact.q11_org_chart' }
  ],
  Q12: [
    { key: 'outsource_yn', label: 'Any outsourced AML/CTF functions?', inputType: 'radio', ghlFieldId: '51bXjQQcZ0i9z01rnbHK', ghlFieldKey: 'contact.q12_outsource_yn', options: ['Yes', 'No'] },
    { key: 'reliance_policy', label: 'Outsourcing agreement / reliance policy', inputType: 'file', ghlFieldId: 'YbwMKB7F6v5xSFNkO6GC', ghlFieldKey: 'contact.q12_reliance_policy' }
  ],
  Q13: [
    { key: 'provider_name', label: 'Screening tool / provider name', inputType: 'text', ghlFieldId: 'as0W9YSH5Db6Itfw9JyJ', ghlFieldKey: 'contact.q13_provider_name' },
    { key: 'invoice_file', label: 'Provider invoice / configuration evidence', inputType: 'file', ghlFieldId: 'IyeEpNSDjLplVQ5LNFqf', ghlFieldKey: 'contact.q13_invoice_file' }
  ],
  Q14: [
    { key: 'cyber_narrative', label: 'Information security & data protection controls', inputType: 'textarea', ghlFieldId: 'jaY53a8nG67EFQQxWdll', ghlFieldKey: 'contact.q14_cyber_narrative' },
    { key: 'security_files', label: 'Supporting documents', inputType: 'file', ghlFieldId: '30P8k5l2PiqpdBzS7gjz', ghlFieldKey: 'contact.q14_security_files' }
  ],
  Q15: [
    { key: 'edd_count', label: 'Enhanced CDD case count (sample month)', inputType: 'number', ghlFieldId: 'EqF080LBNnoM8G5yTxnM', ghlFieldKey: 'contact.q15_edd_count' },
    { key: 'edd_notes', label: 'Enhanced CDD notes', inputType: 'textarea', ghlFieldId: 'lOwMSYUDZkX0qf4jNj2k', ghlFieldKey: 'contact.q15_edd_notes' },
    { key: 'edd_template', label: 'Enhanced CDD template', inputType: 'file', ghlFieldId: 'dyiI3epuqXz2ZI8cim29', ghlFieldKey: 'contact.q15_edd_template' },
    { key: 'edd_example', label: 'Enhanced CDD example case file', inputType: 'file', ghlFieldId: 'VsI8bOEvUvk5s0Z2KQ8s', ghlFieldKey: 'contact.q15_edd_example' }
  ],
  Q16: [
    { key: 'smr_count', label: 'SMRs filed (sample month)', inputType: 'number', ghlFieldId: '5eoQ5TjYHZosRaK9iPdI', ghlFieldKey: 'contact.q16_smr_count' },
    { key: 'smr_notes', label: 'SMR notes (or justified nil return)', inputType: 'textarea', ghlFieldId: '5Z7AM4pfLSyBz0yWA9KL', ghlFieldKey: 'contact.q16_smr_notes' }
  ],
  Q17: [
    { key: 'employee_count', label: 'Employees in AML/CTF-relevant roles', inputType: 'number', ghlFieldId: 'IlX71ij6Z41rTB811Xk5', ghlFieldKey: 'contact.q17_employee_count' },
    { key: 'due_diligence_notes', label: 'Ongoing due-diligence / re-screening notes', inputType: 'textarea', ghlFieldId: 'v3ByuAfwm1XwJ4RTIYvc', ghlFieldKey: 'contact.q17_due_diligence_notes' },
    { key: 'employee_files', label: 'Employee due-diligence files', inputType: 'file', ghlFieldId: 'GTdcVU6MxdM5ls8SXMV0', ghlFieldKey: 'contact.q17_employee_files' }
  ],
  Q18: [
    { key: 'cash_model', label: 'Cash exposure model', inputType: 'select', ghlFieldId: 'X3VfoRv5x4YaEKPVZcDY', ghlFieldKey: 'contact.q18_cash_model', options: ['Non-cash — no cash transactions accepted', 'Cash accepted — below threshold limits', 'Cash intensive — significant cash volumes', 'Mixed — some branches cash some digital only'] },
    { key: 'cash_controls', label: 'Cash / threshold-transaction controls', inputType: 'textarea', ghlFieldId: 'EkRJ3LwrQZRUcwMRmLvQ', ghlFieldKey: 'contact.q18_cash_controls' }
  ],
  Q19: [
    { key: 'onboard_count', label: 'Onboardings in sample month', inputType: 'number', ghlFieldId: 'G8SA9cnk6V60ayQR6pTp', ghlFieldKey: 'contact.q19_onboard_count' },
    { key: 'onboard_sample', label: 'Initial CDD / onboarding records', inputType: 'file', ghlFieldId: 'OKKNzlVDnj72ZwREpxa4', ghlFieldKey: 'contact.q19_onboard_sample' }
  ],
  Q20: [
    { key: 'review_frequency', label: 'Agent / distributor review frequency', inputType: 'select', ghlFieldId: 'GtYqiv353xNEVUs9F3B4', ghlFieldKey: 'contact.q20_review_frequency', options: ['Annual', 'Bi-annual', 'Quarterly', 'Risk-based (varies by partner risk)'] },
    { key: 'review_process', label: 'Review process', inputType: 'textarea', ghlFieldId: 'vnplRbABuzkQhTqUbLO3', ghlFieldKey: 'contact.q20_review_process' },
    { key: 'review_sample', label: 'Review evidence', inputType: 'file', ghlFieldId: 'gGEd2wFHSWsMeiDA4sbm', ghlFieldKey: 'contact.q20_review_sample' }
  ],
  Q21: [
    { key: 'privacy_url', label: 'Privacy policy URL', inputType: 'text', ghlFieldId: 'Tpncz6n0oJMANIoV3Bt6', ghlFieldKey: 'contact.q21_privacy_url' },
    { key: 'privacy_files', label: 'Privacy / APP documentation', inputType: 'file', ghlFieldId: 'ruDFaGr5nPFuGRvNzDZe', ghlFieldKey: 'contact.q21_privacy_files' }
  ],
  Q22: [
    { key: 'onsite_contact', label: 'On-site contact name', inputType: 'text', ghlFieldId: 'RGJdr1Fj8ZwLDlxS7Lwq', ghlFieldKey: 'contact.q22_onsite_contact' },
    { key: 'onsite_mobile', label: 'On-site contact mobile', inputType: 'text', ghlFieldId: 'Fz0ZZlt9EjCPVpHEqPHc', ghlFieldKey: 'contact.q22_onsite_mobile' },
    { key: 'preferred_dates', label: 'Preferred evaluation dates', inputType: 'textarea', ghlFieldId: 'Rs4ZOWXluJW2qNsyWGGL', ghlFieldKey: 'contact.q22_preferred_dates' }
  ],
  Q23: [
    { key: 'review_summary', label: 'Independent evaluation summary', inputType: 'textarea', ghlFieldId: '2vKLqLdd0EWhcN5yIPRW', ghlFieldKey: 'contact.q23_review_summary' },
    { key: 'internal_review_files', label: 'Independent evaluation evidence', inputType: 'file', ghlFieldId: 'ZqU5WuU05vA9i5yneOj9', ghlFieldKey: 'contact.q23_internal_review_files' }
  ]
};

// Submission-tracking metadata fields (written server-side on submit, never
// rendered as client-facing form inputs).
const RRS_META_FIELDS = {
  submittedAt: { ghlFieldId: '8GEzVJBKADq8bA2tXqc4', ghlFieldKey: 'contact.rrs_submitted_at' },
  completionPct: { ghlFieldId: 'sv1rB1Kd71DRgnnIHxe0', ghlFieldKey: 'contact.rrs_completion_pct' },
  status: { ghlFieldId: 'DDqeeAFbaC2dF6cGxB6f', ghlFieldKey: 'contact.rrs_status', options: ['Not Started', 'In Progress', 'Submitted', 'Under Review', 'Accepted'] }
};

function getSentinelFields(qId) {
  return SENTINEL_FIELDS_BY_QUESTION[qId] || null;
}

module.exports = { SENTINEL_FOLDER_ID, SENTINEL_FOLDER_NAME, SENTINEL_FIELDS_BY_QUESTION, RRS_META_FIELDS, getSentinelFields };
