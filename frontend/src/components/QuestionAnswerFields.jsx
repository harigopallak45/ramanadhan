import { useEffect, useState } from 'react';
import './QuestionAnswerFields.css';

// Renders every real sub-field of one question (e.g. Q08 = AMLCO name +
// certification + CV upload) as editable inputs, or a plain read-only view.
// Shared between the client intake form and the admin's per-client console —
// so an auditor can add/reset/remove an individual answer on a client's
// behalf using the exact same save/upload/remove-file API the client uses.
export default function QuestionAnswerFields({ q, answer, readOnly, onSave, onUpload, onRemoveFile }) {
  const fields = q.fields && q.fields.length ? q.fields : [{ key: 'value', label: null, inputType: 'text' }];
  const showLabel = fields.length > 1;

  return (
    <div className="qf-fields">
      {fields.map((field) => (
        <SubFieldInput
          key={field.key}
          qId={q.id}
          field={field}
          showLabel={showLabel}
          answer={answer?.[field.key] || { value: '', files: [] }}
          readOnly={readOnly}
          onSave={onSave}
          onUpload={onUpload}
          onRemoveFile={onRemoveFile}
        />
      ))}
    </div>
  );
}

function SubFieldInput({ qId, field, showLabel, answer, readOnly, onSave, onUpload, onRemoveFile }) {
  const a = answer || { value: '', files: [] };
  const [value, setValue] = useState(a.value || '');
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removingUrl, setRemovingUrl] = useState('');

  useEffect(() => {
    setValue(a.value || '');
  }, [a.value]);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await onUpload(qId, field.key, file);
    setUploading(false);
    e.target.value = '';
  }

  async function handleBlur() {
    const ok = await onSave(qId, field.key, value);
    if (ok && value !== (a.value || '')) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function handleRemoveFile(f) {
    if (!window.confirm(`Remove "${f.name || 'this document'}"? You can upload a replacement after.`)) return;
    setRemovingUrl(f.url);
    await onRemoveFile(qId, field.key, f.url);
    setRemovingUrl('');
  }

  return (
    <div className="qf-subfield">
      {showLabel && field.label && (
        <div className="qf-subfield-label">
          {field.label}
          {saved && <span className="qf-saved">Saved ✓</span>}
        </div>
      )}

      {readOnly ? (
        <div className="qf-readonly">
          {a.value ? (
            <div className="qf-readonly-value">{a.value}</div>
          ) : !a.files?.length ? (
            <div className="qf-readonly-empty">No answer provided.</div>
          ) : null}
        </div>
      ) : field.inputType === 'file' ? (
        <label className="qf-file-picker">
          {uploading ? 'Uploading…' : 'Upload document'}
          <input type="file" onChange={handleFileChange} disabled={uploading} />
        </label>
      ) : field.inputType === 'number' ? (
        <input
          type="number"
          className="input"
          value={value}
          placeholder="Enter a number"
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
        />
      ) : field.inputType === 'date' ? (
        <input
          type="date"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
        />
      ) : field.inputType === 'textarea' ? (
        <textarea
          className="textarea"
          rows={3}
          placeholder="Type your answer…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
        />
      ) : field.inputType === 'radio' ? (
        <div className="qf-radio-row">
          {(field.options || []).map((opt) => (
            <label className="qf-radio-option" key={opt}>
              <input
                type="radio"
                name={`${qId}-${field.key}`}
                checked={value === opt}
                onChange={() => { setValue(opt); onSave(qId, field.key, opt); }}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      ) : field.inputType === 'select' ? (
        <select
          className="select"
          value={value}
          onChange={(e) => { setValue(e.target.value); onSave(qId, field.key, e.target.value); }}
        >
          <option value="">Choose…</option>
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : field.inputType === 'phone' ? (
        <input
          type="tel"
          className="input"
          placeholder="+61 4xx xxx xxx"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
        />
      ) : field.inputType === 'monetary' ? (
        <input
          type="number"
          step="0.01"
          className="input"
          placeholder="$0.00"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
        />
      ) : field.inputType === 'checkbox' ? (
        <label className="qf-radio-option">
          <input
            type="checkbox"
            checked={value === 'Yes'}
            onChange={(e) => { const v = e.target.checked ? 'Yes' : 'No'; setValue(v); onSave(qId, field.key, v); }}
          />
          <span>Yes</span>
        </label>
      ) : (
        <input
          type="text"
          className="input"
          placeholder="Type your answer…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
        />
      )}

      {!showLabel && saved && <span className="qf-saved">Saved ✓</span>}

      {a.files && a.files.length > 0 && (
        <div className="qf-files">
          {a.files.map((f, i) => (
            <span className="qf-file-chip" key={i}>
              <button type="button" className="qf-file-chip-name" onClick={() => window.open(f.url, '_blank')}>
                {f.name || 'document'}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  className="qf-file-chip-remove"
                  onClick={() => handleRemoveFile(f)}
                  disabled={removingUrl === f.url}
                  aria-label={`Remove ${f.name || 'document'}`}
                  title="Remove this file"
                >
                  {removingUrl === f.url ? '…' : '✕'}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
