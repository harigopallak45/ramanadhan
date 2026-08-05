import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import './Login.css';

const LOGO = 'https://assets.cdn.filesafe.space/wDk2dm52D9L325zEgO6S/media/69d63d6bebf1a608432cce2d.png';

const COPY = {
  login: { title: 'Portal Access', sub: 'AML/CTF Independent Evaluation', toggle: 'Apply for Access', toggleText: 'Unauthorized entity?' },
  signup: { title: 'Registration', sub: 'Onboarding New Entity', toggle: 'Return to Login', toggleText: 'Already authorized?' },
  forgot: { title: 'Recovery', sub: 'Password Reset Request', toggle: 'Return to Login', toggleText: 'Remembered?' }
};

export default function Login() {
  const { login, signup, forgotPassword, isAuthenticated, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [status, setStatus] = useState({ text: '', kind: '' });
  const [busy, setBusy] = useState(false);

  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [signupForm, setSignupForm] = useState({ company: '', name: '', email: '', password: '' });
  const [forgotEmail, setForgotEmail] = useState('');

  useEffect(() => {
    if (isAuthenticated) navigate(isAdmin ? '/admin' : '/audit', { replace: true });
  }, [isAuthenticated, isAdmin, navigate]);

  const switchMode = (m) => { setMode(m); setStatus({ text: '', kind: '' }); };

  async function handleLogin(e) {
    e.preventDefault();
    setBusy(true); setStatus({ text: 'Processing request…', kind: '' });
    try {
      const data = await login(loginForm.email, loginForm.password);
      setStatus({ text: 'Access granted. Redirecting…', kind: 'success' });
      setTimeout(() => navigate(data.isAdmin ? '/admin' : '/audit', { replace: true }), 600);
    } catch (err) {
      setStatus({ text: err.message, kind: 'error' });
      if (err.data?.needsRegistration) {
        setTimeout(() => {
          switchMode('signup');
          setSignupForm((f) => ({ ...f, email: loginForm.email }));
          setStatus({ text: err.message, kind: 'error' });
        }, 1500);
      }
    } finally { setBusy(false); }
  }

  async function handleSignup(e) {
    e.preventDefault();
    setBusy(true); setStatus({ text: 'Processing request…', kind: '' });
    try {
      const data = await signup(signupForm);
      // The backend just set this exact password on the account — log them
      // straight in instead of leaving them stuck on a static "activated"
      // message with only a small link to notice.
      setStatus({ text: (data.message || 'Account activated.') + ' Signing you in…', kind: 'success' });
      try {
        const loginData = await login(signupForm.email, signupForm.password);
        setStatus({ text: 'Access granted. Redirecting…', kind: 'success' });
        setTimeout(() => navigate(loginData.isAdmin ? '/admin' : '/audit', { replace: true }), 500);
      } catch (loginErr) {
        // Activation succeeded but auto-login didn't — hand them straight to
        // a pre-filled login form rather than leaving them to figure it out.
        switchMode('login');
        setLoginForm({ email: signupForm.email, password: signupForm.password });
        setStatus({ text: 'Account activated — press "Initialize Session" to continue.', kind: 'success' });
      }
    } catch (err) {
      setStatus({ text: err.message, kind: 'error' });
    } finally { setBusy(false); }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setBusy(true); setStatus({ text: 'Processing request…', kind: '' });
    try {
      const data = await forgotPassword(forgotEmail);
      setStatus({ text: data.message, kind: 'success' });
    } catch (err) {
      setStatus({ text: err.message, kind: 'error' });
    } finally { setBusy(false); }
  }

  const copy = COPY[mode];

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={LOGO} alt="Centinl Logo" />
          <h1>{copy.title}</h1>
          <p>{copy.sub}</p>
        </div>

        {mode === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="auth-field">
              <label>Corporate Email</label>
              <input type="email" required placeholder="compliance@entity.com.au"
                value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
            </div>
            <div className="auth-field">
              <label>Password</label>
              <input type="password" required placeholder="••••••••"
                value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
            </div>
            <div className="auth-forgot">
              <button type="button" onClick={() => switchMode('forgot')}>Forgot Password?</button>
            </div>
            <button className="auth-submit" type="submit" disabled={busy}>Initialize Session</button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignup}>
            <div className="auth-field">
              <label>Legal Entity Name</label>
              <input required placeholder="ABC Pty Ltd" value={signupForm.company} onChange={(e) => setSignupForm({ ...signupForm, company: e.target.value })} />
            </div>
            <div className="auth-field">
              <label>Full Name</label>
              <input required placeholder="Primary Compliance Officer" value={signupForm.name} onChange={(e) => setSignupForm({ ...signupForm, name: e.target.value })} />
            </div>
            <div className="auth-field">
              <label>Corporate Email</label>
              <input type="email" required placeholder="compliance@entity.com.au" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} />
            </div>
            <div className="auth-field">
              <label>Password</label>
              <input type="password" required placeholder="••••••••" value={signupForm.password} onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })} />
            </div>
            <button className="auth-submit" type="submit" disabled={busy}>Request Credentials</button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot}>
            <div className="auth-field">
              <label>Recovery Email</label>
              <input type="email" required placeholder="compliance@entity.com.au" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 24, lineHeight: 1.6 }}>
              Enter your email to verify your account and receive administrator contact details for password recovery.
            </p>
            <button className="auth-submit" type="submit" disabled={busy}>Verify Account</button>
          </form>
        )}

        <div className={`auth-status ${status.kind}`}>{status.text}</div>

        <div className="auth-toggle">
          <span>{copy.toggleText}</span>
          <button type="button" onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}>{copy.toggle}</button>
        </div>
      </div>
    </div>
  );
}
