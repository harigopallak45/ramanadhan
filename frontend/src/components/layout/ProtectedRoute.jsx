import { Navigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

// requireAdmin: if true, non-admin sessions are redirected to /audit (the
// client portal) instead of the login page, mirroring the old pages'
// behaviour of routing users to the surface their role is meant for.
export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { isAuthenticated, isAdmin } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/audit" replace />;
  return children;
}
