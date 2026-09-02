import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import Button from '../components/ui/Button';
import { Field, TextInput } from '../components/ui/Field';
import { meApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import './Profile.css';

// Admins keep their normal tab bar here so the page feels like part of the
// console rather than a dead end; clients have no tabs anywhere, so they
// get a plain back link to the portal instead.
const ADMIN_TABS = [{ to: '/admin', label: 'Clients' }, { to: '/questions', label: 'Question Builder' }];

const EMPTY_PASSWORD = { currentPassword: '', newPassword: '', confirmPassword: '' };

export default function Profile() {
  const { isAdmin } = useAuth();
  const toast = useToast();

  const [account, setAccount] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const [details, setDetails] = useState({ firstName: '', lastName: '', companyName: '', phone: '' });
  const [savingDetails, setSavingDetails] = useState(false);

  const [pw, setPw] = useState(EMPTY_PASSWORD);
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState('');

  useEffect(() => {
    let cancelled = false;
    meApi.get()
      .then((data) => {
        if (cancelled) return;
        setAccount(data.account);
        setDetails({
          firstName: data.account.firstName || '',
          lastName: data.account.lastName || '',
          companyName: data.account.companyName || '',
          phone: data.account.phone || ''
        });
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load your account.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function saveDetails(e) {
    e.preventDefault();
    if (!details.firstName.trim()) { toast('First name is required.', 'error'); return; }
    setSavingDetails(true);
    try {
      const data = await meApi.update(details);
      setAccount(data.account);
      toast(data.message || 'Profile updated.');
    } catch (err) {
      toast(err.message || 'Could not save your profile.', 'error');
    } finally {
      setSavingDetails(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwError('');
    if (pw.newPassword !== pw.confirmPassword) { setPwError('New passwords do not match.'); return; }
    if (pw.newPassword.length < 8) { setPwError('New password must be at least 8 characters.'); return; }
    setSavingPw(true);
    try {
      const data = await meApi.changePassword(pw.currentPassword, pw.newPassword);
      setPw(EMPTY_PASSWORD);
      toast(data.message || 'Password changed.');
    } catch (err) {
      setPwError(err.message || 'Could not change your password.');
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="theme-dark profile-page">
      <Topbar tabs={isAdmin ? ADMIN_TABS : null} />

      <div className="profile-wrap">
        {!isAdmin && (
          <Link className="profile-back" to="/audit">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to portal
          </Link>
        )}

        <header className="profile-head">
          <h1>My profile</h1>
          <p>Your account details and password. Your email address is your login — an administrator has to change that for you.</p>
        </header>

        {loading && <div className="profile-note">Loading your account…</div>}
        {!loading && loadError && <div className="profile-note profile-note--error">{loadError}</div>}

        {!loading && !loadError && account && (
          <div className="profile-grid">
            <section className="card profile-card">
              <h2>Details</h2>
              <form onSubmit={saveDetails}>
                <div className="profile-row">
                  <Field label="First name">
                    <TextInput required value={details.firstName}
                      onChange={(e) => setDetails({ ...details, firstName: e.target.value })} />
                  </Field>
                  <Field label="Last name">
                    <TextInput value={details.lastName}
                      onChange={(e) => setDetails({ ...details, lastName: e.target.value })} />
                  </Field>
                </div>
                <Field label="Company">
                  <TextInput value={details.companyName} placeholder="Legal entity name"
                    onChange={(e) => setDetails({ ...details, companyName: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <TextInput type="tel" value={details.phone} placeholder="+61 …"
                    onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
                </Field>
                <Field label="Email" hint="Your login identifier — contact an administrator to change it.">
                  <TextInput value={account.email} readOnly disabled />
                </Field>
                <div className="profile-actions">
                  <Button variant="primary" type="submit" disabled={savingDetails}>
                    {savingDetails ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </form>
            </section>

            <section className="card profile-card">
              <h2>Password</h2>
              <form onSubmit={changePassword}>
                {/* Password managers need a username to file the new password
                    under, and Chrome warns when a password form has none.
                    Hidden, read-only, and never submitted anywhere. */}
                <input type="text" name="username" autoComplete="username" value={account.email} readOnly hidden />
                <Field label="Current password">
                  <TextInput type="password" required autoComplete="current-password" value={pw.currentPassword}
                    onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
                </Field>
                <Field label="New password" hint="At least 8 characters.">
                  <TextInput type="password" required minLength={8} autoComplete="new-password" value={pw.newPassword}
                    onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
                </Field>
                <Field label="Confirm new password">
                  <TextInput type="password" required minLength={8} autoComplete="new-password" value={pw.confirmPassword}
                    onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} />
                </Field>
                {pwError && <div className="profile-note profile-note--error">{pwError}</div>}
                <div className="profile-actions">
                  <Button variant="primary" type="submit" disabled={savingPw}>
                    {savingPw ? 'Changing…' : 'Change password'}
                  </Button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
