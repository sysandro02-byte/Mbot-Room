import { ReactNode, useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import MeetingList from './components/MeetingList';
import MeetingJoinPage from './pages/MeetingJoinPage';
import Login from './pages/Login';
import { authService } from './services/authService';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated());

  useEffect(() => {
    const sync = () => setIsAuthenticated(authService.isAuthenticated());
    window.addEventListener('storage', sync);
    window.addEventListener('mbote-room-auth-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('mbote-room-auth-changed', sync);
    };
  }, []);

  if (!isAuthenticated) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return (
    <>
      <AccountBar />
      {children}
    </>
  );
}

function AccountBar() {
  const user = authService.getCurrentUser();

  return (
    <div className="account-bar">
      <span>{user?.name || user?.email}</span>
      <button type="button" onClick={() => void authService.logout()}>
        <LogOut size={16} />
        Déconnexion
      </button>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/app" element={<ProtectedRoute><MeetingList /></ProtectedRoute>} />
      <Route path="/join" element={<ProtectedRoute><MeetingJoinPage /></ProtectedRoute>} />
      <Route path="/join/:meetingLink" element={<ProtectedRoute><MeetingJoinPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
