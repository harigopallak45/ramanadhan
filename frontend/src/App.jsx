import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './lib/toast';
import ProtectedRoute from './components/layout/ProtectedRoute';

import Login from './pages/Login';
import ResetPassword from './pages/ResetPassword';
import ClientPortal from './pages/ClientPortal';
import AuditorConsole from './pages/AuditorConsole';
import AdminDashboard from './pages/AdminDashboard';
import QuestionBuilder from './pages/QuestionBuilder';

// Matches whatever `base` vite.config.js was built with (via VITE_BASE_PATH)
// so client-side route changes stay under the same sub-path the app is
// actually deployed at, e.g. '/hlgp' — BrowserRouter wants no trailing slash.
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter basename={ROUTER_BASENAME}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* The backend generates password-reset and invite links pointing
                at /audit/reset?token=... (a leftover convention from the old
                static-HTML app) — every alias below must render the same
                page or those emailed links silently 404 into the login
                redirect and drop the token. */}
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/audit/reset" element={<ResetPassword />} />
            <Route path="/reset" element={<ResetPassword />} />
            <Route path="/audit" element={<ProtectedRoute><ClientPortal /></ProtectedRoute>} />
            <Route path="/entity/:contactId" element={<ProtectedRoute requireAdmin><AuditorConsole /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
            <Route path="/questions" element={<ProtectedRoute requireAdmin><QuestionBuilder /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
