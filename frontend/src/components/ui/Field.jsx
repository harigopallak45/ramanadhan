export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="field">
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function TextInput(props) {
  return <input className="input" {...props} />;
}

export function TextArea(props) {
  return <textarea className="textarea" {...props} />;
}

export function Select({ children, ...props }) {
  return <select className="select" {...props}>{children}</select>;
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="row gap-2" style={{ height: 22 }}>
      <span className="toggle">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="track" />
      </span>
      {label && <span className="hint">{label}</span>}
    </label>
  );
}
