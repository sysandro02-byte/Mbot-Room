import { ReactNode, Suspense, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { authService } from './services/authService';
import PwaExperience from './components/PwaExperience';
import MobileSplash from './components/MobileSplash';
import SessionSecurity from './components/SessionSecurity';
import AppMessageModal from './components/AppMessageModal';
import UserPreferencesRuntime from './components/UserPreferencesRuntime';
import { sanitizeInternalPath } from './lib/navigationSecurity';
import { AppLanguageBridge } from './lib/appLanguage';
import { lazyWithRetry } from './lib/lazyWithRetry';
import AppErrorBoundary from './components/AppErrorBoundary';
import AppLoader from './components/AppLoader';
import GlobalHeader from './components/GlobalHeader';
import UserAdModal from './components/UserAdModal';
import RealMeetingList from './components/RealMeetingList';
import AppShell from './components/AppShell';
import RealJoinPage from './pages/RealJoinPage';
import CalendarPage from './pages/CalendarPage';
import RealFeaturePage from './pages/RealFeaturePage';
import RealDashboardPage from './pages/dashboard/RealDashboardPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import GlobalSearchPage from './pages/GlobalSearchPage';
import HelpPage from './pages/HelpPage';
import DynamicInfoPage from './pages/DynamicInfoPage';
import NotificationsPage from './pages/NotificationsPage';
import MessagesPage from './pages/MessagesPage';
import ContactsPage from './pages/ContactsPage';
import RecordingsPage from './pages/RecordingsPage';
import ProfilePage from './pages/ProfilePage';
import FilesPage from './pages/FilesPage';
import WorkGroupsPage from './pages/WorkGroupsPage';
import { LiveCreatePage, LiveFeedPage, LiveRoomPage } from './pages/LivePage';
const GuestJoinPage = lazyWithRetry(() => import('./pages/GuestJoinPage'));
const MeetingRoomV2 = lazyWithRetry(() => import('./pages/MeetingRoomV2'));
const GuestWaitingRoomPage = lazyWithRetry(() => import('./pages/GuestWaitingRoomPage'));
const RealMeetingEndedPage = lazyWithRetry(() => import('./pages/RealMeetingEndedPage'));
const AdminAuthPage = lazyWithRetry(() => import('./pages/admin/AdminAuthPage'));
const Login = lazyWithRetry(() => import('./pages/Login'));
const TermsPage = lazyWithRetry(() => import('./pages/TermsPage'));

function ProtectedRoute({ children }: { children: ReactNode; showAccountBar?: boolean }) {
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticated());
  const [checking, setChecking] = useState(() => !authService.isAuthenticated());

  useEffect(() => {
    let active = true;
    const verify = async () => {
      try {
        const user = await authService.refreshCurrentUser();
        if (active) setIsAuthenticated(Boolean(user));
      } catch {
        // Keep a still-valid local session during temporary API or network outages.
        if (active) setIsAuthenticated(authService.isAuthenticated());
      } finally {
        if (active) setChecking(false);
      }
    };
    const sync = () => setIsAuthenticated(authService.isAuthenticated());
    void verify();
    window.addEventListener('storage', sync);
    window.addEventListener('mbote-room-auth-changed', sync);
    return () => {
      active = false;
      window.removeEventListener('storage', sync);
      window.removeEventListener('mbote-room-auth-changed', sync);
    };
  }, []);

  if (checking) return <AppLoader label="Vérification de la session…" fullScreen />;
  if (!isAuthenticated) {
    const redirect = sanitizeInternalPath(`${location.pathname}${location.search}`);
    sessionStorage.setItem('mboteroom-login-redirect', redirect);
    return <Navigate to="/login" replace />;
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
  const [checking, setChecking] = useState(() => !(authService.isAuthenticated() && authService.isAdmin()));

  useEffect(() => {
    let active = true;
    const verify = async () => {
      try {
        const user = await authService.refreshCurrentUser();
        if (!active) return;
        setIsAuthenticated(Boolean(user));
        setIsAdmin(Boolean(user && authService.isAdmin()));
      } catch {
        if (!active) return;
        setIsAuthenticated(authService.isAuthenticated());
        setIsAdmin(authService.isAdmin());
      } finally {
        if (active) setChecking(false);
      }
    };
    const sync = () => {
      setIsAuthenticated(authService.isAuthenticated());
      setIsAdmin(authService.isAdmin());
    };
    void verify();
    window.addEventListener('storage', sync);
    window.addEventListener('mbote-room-auth-changed', sync);
    return () => {
      active = false;
      window.removeEventListener('storage', sync);
      window.removeEventListener('mbote-room-auth-changed', sync);
    };
  }, []);

  if (checking) return <AppLoader label="Vérification de la session…" fullScreen />;
  if (!isAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }
  if (!isAdmin) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  const location = useLocation();
  const hideGlobalHeader = location.pathname.startsWith('/admin')
    || ['/login', '/connexion', '/inscription', '/mot-de-passe-oublie', '/rejoindre-une-reunion', '/aide'].includes(location.pathname)
    || /^\/reunions\/(?!recentes(?:\/|$)|terminee(?:\/|$))[^/]+(?:\/(?:luna|salle-attente))?$/.test(location.pathname)
    || /^\/app\/live\/(?!new(?:\/|$))[^/]+$/.test(location.pathname);

  useEffect(() => {
    const timer = window.setTimeout(() => sessionStorage.removeItem('mboteroom-runtime-recovery'), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  return <AppErrorBoundary><><AppLanguageBridge/><UserPreferencesRuntime/><AppMessageModal/><MobileSplash/><PwaExperience/><SessionSecurity/><UserAdModal/>{!hideGlobalHeader ? <GlobalHeader/> : null}<Suspense fallback={<AppLoader label="Chargement de MBotéRoom…" fullScreen />}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/connexion" element={<Login />} />
    <Route path="/inscription" element={<Login initialView="register" />} />
    <Route path="/mot-de-passe-oublie" element={<Login initialView="forgot" />} />
    <Route path="/rejoindre-une-reunion" element={<Login initialView="guest" />} />
    <Route path="/dashboard" element={<Navigate to="/app" replace />} />
    <Route path="/admin/login" element={<AdminAuthPage mode="login" />} />
    <Route path="/admin/inscription" element={<AdminAuthPage mode="register" />} />
    <Route path="/admin/mot-de-passe-oublie" element={<AdminAuthPage mode="forgot" />} />
    <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
    <Route path="/admin/calendar" element={<AdminRoute><CalendarPage /></AdminRoute>} />
    <Route path="/reunions/recentes" element={<Navigate to="/app?tab=reunions" replace />} />
    <Route path="/aide" element={<HelpPage />} />
    <Route path="/securite" element={<DynamicInfoPage pageKey="security" />} />
    <Route path="/fonctionnalites" element={<DynamicInfoPage pageKey="features" />} />
    <Route path="/confidentialite" element={<DynamicInfoPage pageKey="privacy" />} />
    <Route path="/conditions" element={<TermsPage />} />
    <Route path="/app/meetings" element={<ProtectedRoute><AppShell title="Réunions"><RealMeetingList /></AppShell></ProtectedRoute>} />
    <Route path="/app/search" element={<ProtectedRoute><AppShell title="Recherche"><GlobalSearchPage /></AppShell></ProtectedRoute>} />
    <Route path="/app/calendar" element={<ProtectedRoute><CalendarPage /></ProtectedRoute>} />
    <Route path="/app/live" element={<ProtectedRoute><LiveFeedPage /></ProtectedRoute>} />
    <Route path="/app/live/new" element={<ProtectedRoute><LiveCreatePage /></ProtectedRoute>} />
    <Route path="/app/live/:liveId" element={<ProtectedRoute><LiveRoomPage /></ProtectedRoute>} />
    <Route path="/app/recordings" element={<ProtectedRoute><AppShell title="Enregistrements"><RecordingsPage /></AppShell></ProtectedRoute>} />
    <Route path="/app/messages" element={<ProtectedRoute><AppShell title="Messages"><MessagesPage /></AppShell></ProtectedRoute>} />
    <Route path="/app/contacts" element={<ProtectedRoute><AppShell title="Contacts"><ContactsPage /></AppShell></ProtectedRoute>} />
    <Route path="/app/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
    <Route path="/app/files" element={<ProtectedRoute><AppShell title="Fichiers"><FilesPage /></AppShell></ProtectedRoute>} />
    <Route path="/app/groups" element={<ProtectedRoute><AppShell title="Groupes de travail"><WorkGroupsPage /></AppShell></ProtectedRoute>} />
    <Route path="/app/whiteboard" element={<ProtectedRoute><RealFeaturePage kind="whiteboard" /></ProtectedRoute>} />
    <Route path="/app/polls" element={<ProtectedRoute><RealFeaturePage kind="polls" /></ProtectedRoute>} />
    <Route path="/app/settings" element={<ProtectedRoute><RealFeaturePage kind="settings" /></ProtectedRoute>} />
    <Route path="/app/profile" element={<ProtectedRoute><AppShell title="Mon profil"><ProfilePage /></AppShell></ProtectedRoute>} />
    <Route path="/reunions/terminee" element={<ProtectedRoute><RealMeetingEndedPage /></ProtectedRoute>} />
    <Route path="/reunions" element={<ProtectedRoute><AppShell title="Réunions"><RealMeetingList /></AppShell></ProtectedRoute>} />
    <Route path="/reunions/:meetingId/salle-attente" element={<GuestWaitingRoomPage />} />
    <Route path="/reunions/:meetingId/terminee" element={<ProtectedRoute><RealMeetingEndedPage /></ProtectedRoute>} />
    <Route path="/reunions/:meetingId/luna" element={<ProtectedRoute><MeetingRoomV2 /></ProtectedRoute>} />
    <Route path="/reunions/:meetingId" element={<ProtectedRoute><MeetingRoomV2 /></ProtectedRoute>} />
    <Route path="/" element={<Navigate to="/app" replace />} />
    <Route path="/app" element={<ProtectedRoute showAccountBar={false}><AppShell title="Accueil"><RealDashboardPage /></AppShell></ProtectedRoute>} />
    <Route path="/join" element={<ProtectedRoute><AppShell title="Rejoindre"><RealJoinPage /></AppShell></ProtectedRoute>} />
    <Route path="/join/:meetingLink" element={<ProtectedRoute><AppShell title="Rejoindre"><RealJoinPage /></AppShell></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes></Suspense></></AppErrorBoundary>;
}
