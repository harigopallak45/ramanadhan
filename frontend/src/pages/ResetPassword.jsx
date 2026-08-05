import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../lib/api';
import './Login.css';

const LOGO = 'https://assets.cdn.filesafe.space/wDk2dm52D9L325zEgO6S/media/69d63d6bebf1a608432cce2d.png';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [state, setState] = useState('loading'); // loading | ready | error
  const [user, setUser] = useState(null);
  const [type, setType] = useState('reset');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState({ text: '', kind: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setState('error'); setStatus({ text: 'Invalid or missing link token.', kind: 'error' }); return; }
    authApi.verifyToken(token)
      .then((data) => {
        setUser({ name: data.name || 'Client', email: data.email || '' });
        setType(data.type === 'invite' ? 'invite' : 'reset');
        setState('ready');
      })
      .catch((err) => {
        setState('error');
        setStatus({ text: err.message || 'The secure link has expired or is invalid.', kind: 'error' });
      });
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) { setStatus({ text: 'Passwords do not match.', kind: 'error' }); return; }
    setBusy(true);
    setStatus({ text: 'Updating password…', kind: '' });
    try {
      await authApi.resetPassword(token, password);
      setStatus({ text: 'Password updated successfully. Redirecting to login…', kind: 'success' });
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setStatus({ text: err.message || 'Update failed.', kind: 'error' });
    } finally { setBusy(false); }
  }

  const initials = user ? (user.name.split(' ').map((n) => n[0]).join('').slice(0, 2) || 'C') : 'C';

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={LOGO} alt="Centinl Logo" />
          <h1>{type === 'invite' ? 'Activate Account' : 'Reset Password'}</h1>
        </div>

        {state === 'loading' && <div className="auth-status">Verifying token…</div>}

        {state === 'ready' && user && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, padding: 16,
              background: 'var(--bg-raised)', border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 8, marginBottom: 32, textAlign: 'left'
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', background: 'var(--gold)', color: '#ffffff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                fontWeight: 600, textTransform: 'uppercase', flexShrink: 0
              }}>{initials}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="auth-field">
                <label>New Password</label>
                <input type="password" required minLength={8} placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="auth-field">
                <label>Confirm Password</label>
                <input type="password" required minLength={8} placeholder="••••••••" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <button className="auth-submit" type="submit" disabled={busy}>
                {type === 'invite' ? 'Set Password & Activate' : 'Update Password'}
              </button>
            </form>
          </>
        )}

        <div className={`auth-status ${status.kind}`}>{status.text}</div>
      </div>
    </div>
  );
}
