export default function Modal({ open, onClose, maxWidth = 560, children }) {
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" style={{ maxWidth }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
