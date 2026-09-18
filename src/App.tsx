import { lazy, ReactNode, Suspense, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { authService } from './services/authService';

const RealMeetingList = lazy(() => import('./components/RealMeetingList'));
const AppShell = lazy(() => import('./components/AppShell'));
const RealJoinPage = lazy(() => import('./pages/RealJoinPage'));
const GuestJoinPage = lazy(() => import('./pages/GuestJoinPage'));
const MeetingRoomV2 = lazy(() => import('./pages/MeetingRoomV2'));
const GuestWaitingRoomPage = lazy(() => import('./pages/GuestWaitingRoomPage'));
const RealMeetingEndedPage = lazy(() => import('./pages/RealMeetingEndedPage'));
const RealFeaturePage = lazy(() => import('./pages/RealFeaturePage'));
const RealDashboardPage = lazy(() => import('./pages/dashboard/RealDashboardPage'));
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const Login = lazy(() => import('./pages/Login'));

function ProtectedRoute({ children }: { children: ReactNode; showAccountBar?: boolean }) {
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
  return children;
}

function AccountBar() {
  const user = authService.getCurrentUser();
  return <div className="account-bar"><span>{user?.name || user?.email}</span><button type="button" onClick={() => void authService.logout()}><X size={16} />Déconnexion</button></div>;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated());
  const [isAdmin, setIsAdmin] = useState(authService.isAdmin());
  useEffect(() => {
    const sync = () => { setIsAuthenticated(authService.isAuthenticated()); setIsAdmin(authService.isAdmin()); };
    window.addEventListener('storage', sync);
    window.addEventListener('mbote-room-auth-changed', sync);
    return () => { window.removeEventListener('storage', sync); window.removeEventListener('mbote-room-auth-changed', sync); };
  }, []);
  if (!isAuthenticated) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }
  if (!isAdmin) return <Navigate to="/app" replace />;
  return children;
}

function SimpleInfoPage({ title, description }: { title: string; description: string }) {
  const navigate = useNavigate();
  const closeModal = () => window.history.length > 1 ? navigate(-1) : navigate('/app', { replace: true });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return <main className="simple-info-page" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}><section className="simple-info-modal" role="dialog" aria-modal="true" aria-labelledby="simple-info-title"><button className="simple-info-close" type="button" aria-label="Fermer" onClick={closeModal}><X size={20} aria-hidden="true" /></button><h1 id="simple-info-title">{title}</h1><p>{description}</p></section></main>;
}

export default function App() {
  return <Suspense fallback={<main className="route-loading" role="status" aria-live="polite">Chargement de MBotéRoom…</main>}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/connexion" element={<Login />} />
    <Route path="/inscription" element={<Login initialView="register" />} />
    <Route path="/mot-de-passe-oublie" element={<Login initialView="forgot" />} />
    <Route path="/rejoindre-une-reunion" element={<GuestJoinPage />} />
    <Route path="/dashboard" element={<Navigate to="/app" replace />} />
    <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
    <Route path="/reunions/recentes" element={<Navigate to="/app?tab=reunions" replace />} />
    <Route path="/aide" element={<SimpleInfoPage title="Centre d'aide" description="Le centre d'aide MBotéRoom sera connecté au support dès que le backend expose cette section." />} />
    <Route path="/securite" element={<SimpleInfoPage title="Sécurité MBotéRoom" description="Les réunions utilisent les protections disponibles dans l'application." />} />
    <Route path="/fonctionnalites" element={<SimpleInfoPage title="Fonctionnalités MBotéRoom" description="Créez un compte pour retrouver l'historique, organiser vos réunions et gérer les invitations." />} />
    <Route path="/app/meetings" element={<ProtectedRoute><AppShell title="Réunions"><RealMeetingList /></AppShell></ProtectedRoute>} />
    <Route path="/app/calendar" element={<ProtectedRoute><RealFeaturePage kind="calendar" /></ProtectedRoute>} />
    <Route path="/app/recordings" element={<ProtectedRoute><RealFeaturePage kind="recordings" /></ProtectedRoute>} />
    <Route path="/app/messages" element={<ProtectedRoute><RealFeaturePage kind="messages" /></ProtectedRoute>} />
    <Route path="/app/contacts" element={<ProtectedRoute><RealFeaturePage kind="contacts" /></ProtectedRoute>} />
    <Route path="/app/whiteboard" element={<ProtectedRoute><RealFeaturePage kind="whiteboard" /></ProtectedRoute>} />
    <Route path="/app/polls" element={<ProtectedRoute><RealFeaturePage kind="polls" /></ProtectedRoute>} />
    <Route path="/app/settings" element={<ProtectedRoute><RealFeaturePage kind="settings" /></ProtectedRoute>} />
    <Route path="/app/profile" element={<ProtectedRoute><RealFeaturePage kind="profile" /></ProtectedRoute>} />
    <Route path="/reunions/terminee" element={<ProtectedRoute><RealMeetingEndedPage /></ProtectedRoute>} />
    <Route path="/reunions" element={<ProtectedRoute><AppShell title="Réunions"><RealMeetingList /></AppShell></ProtectedRoute>} />
    <Route path="/reunions/:meetingId/salle-attente" element={<GuestWaitingRoomPage />} />
    <Route path="/reunions/:meetingId/terminee" element={<ProtectedRoute><RealMeetingEndedPage /></ProtectedRoute>} />
    <Route path="/reunions/:meetingId/luna" element={<ProtectedRoute><MeetingRoomV2 /></ProtectedRoute>} />
    <Route path="/reunions/:meetingId" element={<ProtectedRoute><MeetingRoomV2 /></ProtectedRoute>} />
    <Route path="/" element={<Navigate to="/app" replace />} />
    <Route path="/app" element={<ProtectedRoute showAccountBar={false}><RealDashboardPage /></ProtectedRoute>} />
    <Route path="/join" element={<ProtectedRoute><AppShell title="Rejoindre"><RealJoinPage /></AppShell></ProtectedRoute>} />
    <Route path="/join/:meetingLink" element={<ProtectedRoute><AppShell title="Rejoindre"><RealJoinPage /></AppShell></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes></Suspense>;
}
