import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { meApi } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import Badge from '../ui/Badge';

function initialsOf(name, email) {
  const source = (name || '').trim() || (email || '').trim();
  if (!source) return '?';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2)).toUpperCase();
}

// Identity affordance shared by the admin topbar and the client portal
// header: who am I, a way into the full account page, and log out. Fetches
// /api/me itself so a page only has to drop <UserMenu /> in — no prop
// threading and no page-level state.
export default function UserMenu({ align = 'right' }) {
  const { logout, isAdmin } = useAuth();
  const [account, setAccount] = useState(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    meApi.get()
      .then((data) => { if (!cancelled) setAccount(data.account); })
      // A failed lookup shouldn't blank out the header — fall back to the
      // role badge alone, which needs no network call.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const label = account?.name || account?.email || (isAdmin ? 'Administrator' : 'Client');

  return (
    <div className={`usermenu usermenu--${align}`} ref={wrapRef}>
      <button
        type="button"
        className="usermenu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
      >
        <span className="usermenu-avatar" aria-hidden="true">{initialsOf(account?.name, account?.email)}</span>
        <span className="usermenu-name">{label}</span>
        <svg className="usermenu-caret" width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="usermenu-panel" role="menu">
          <div className="usermenu-head">
            <span className="usermenu-avatar usermenu-avatar--lg" aria-hidden="true">
              {initialsOf(account?.name, account?.email)}
            </span>
            <div className="usermenu-ident">
              <span className="usermenu-ident-name">{account?.name || '—'}</span>
              <span className="usermenu-ident-email">{account?.email || '—'}</span>
              {account?.companyName && <span className="usermenu-ident-company">{account.companyName}</span>}
            </div>
          </div>

          <div className="usermenu-role">
            <Badge tone="neutral">{isAdmin ? 'Administrator' : 'Client'}</Badge>
          </div>

          <div className="usermenu-actions">
            <Link className="usermenu-item" to="/profile" role="menuitem" onClick={close}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              My profile
            </Link>
            <button className="usermenu-item usermenu-item--danger" type="button" role="menuitem" onClick={logout}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
