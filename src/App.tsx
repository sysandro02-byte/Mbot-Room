import { ReactNode, useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import MeetingList from './components/MeetingList';
import MeetingJoinPage from './pages/MeetingJoinPage';
import GuestJoinPage from './pages/GuestJoinPage';
import GuestMeetingPage from './pages/GuestMeetingPage';
import GuestWaitingRoomPage from './pages/GuestWaitingRoomPage';
import MeetingEndedPage from './pages/MeetingEndedPage';
import UserDashboardPage from './pages/dashboard/UserDashboardPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import Login from './pages/Login';
import { authService } from './services/authService';

function ProtectedRoute({ children, showAccountBar = true }: { children: ReactNode; showAccountBar?: boolean }) {
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
      {showAccountBar && <AccountBar />}
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

function AdminRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated());
  const [isAdmin, setIsAdmin] = useState(authService.isAdmin());

  useEffect(() => {
    const sync = () => {
      setIsAuthenticated(authService.isAuthenticated());
      setIsAdmin(authService.isAdmin());
    };
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

  if (!isAdmin) {
    return <Navigate to="/app" replace />;
  }

  return children;
}

function SimpleInfoPage({ title, description }: { title: string; description: string }) {
  return (
    <main className="simple-info-page">
      <section>
        <h1>{title}</h1>
        <p>{description}</p>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/connexion" element={<Login />} />
      <Route path="/inscription" element={<Login initialView="register" />} />
      <Route path="/mot-de-passe-oublie" element={<Login initialView="forgot" />} />
      <Route path="/rejoindre-une-reunion" element={<GuestJoinPage />} />
      <Route path="/dashboard" element={<Navigate to="/app" replace />} />
      <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
      <Route path="/reunions/recentes" element={<Navigate to="/app?tab=reunions" replace />} />
      <Route path="/aide" element={<SimpleInfoPage title="Centre d'aide" description="Le centre d'aide MBotéRoom sera connecté au support dès que le backend expose cette section." />} />
      <Route path="/securite" element={<SimpleInfoPage title="Sécurité MBotéRoom" description="Les réunions utilisent les protections disponibles dans l'application. Le niveau exact de chiffrement doit rester aligné avec la configuration backend et WebRTC active." />} />
      <Route path="/fonctionnalites" element={<SimpleInfoPage title="Fonctionnalités MBotéRoom" description="Créez un compte pour retrouver l'historique, organiser vos réunions et gérer les invitations." />} />
      <Route path="/reunions/terminee" element={<MeetingEndedPage />} />
      <Route path="/reunions" element={<ProtectedRoute><MeetingList /></ProtectedRoute>} />
      <Route path="/reunions/:meetingId/salle-attente" element={<GuestWaitingRoomPage />} />
      <Route path="/reunions/:meetingId/terminee" element={<MeetingEndedPage />} />
      <Route path="/reunions/:meetingId/luna" element={<GuestMeetingPage />} />
      <Route path="/reunions/:meetingId" element={<GuestMeetingPage />} />
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/app" element={<ProtectedRoute showAccountBar={false}><UserDashboardPage /></ProtectedRoute>} />
      <Route path="/join" element={<ProtectedRoute><MeetingJoinPage /></ProtectedRoute>} />
      <Route path="/join/:meetingLink" element={<ProtectedRoute><MeetingJoinPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
