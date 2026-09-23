import { Dispatch, SetStateAction, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Accessibility,
  Archive,
  Bell,
  Bot,
  Camera,
  ChevronRight,
  CircleHelp,
  CircleInfo,
  Database,
  Download,
  FileText,
  Gauge,
  Globe2,
  HardDrive,
  Languages,
  Laptop,
  LockKeyhole,
  LogOut,
  MapPin,
  MessageCircle,
  Mic,
  MonitorCog,
  Moon,
  Palette,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Type,
  UserRound,
  UsersRound,
  Video,
  Volume2,
  Vibrate,
  WandSparkles,
  Wifi,
} from 'lucide-react';
import OfflineModeSettings from '../../components/OfflineModeSettings';
import PushNotificationSettings from '../../components/PushNotificationSettings';
import { authService } from '../../services/authService';
import type { Preferences } from '../../services/appDataService';
import './SettingsWorkspace.css';

type SettingsWorkspaceProps = {
  preferences: Preferences;
  setPreferences: Dispatch<SetStateAction<Preferences>>;
  persistPreferences: (preferences: Preferences) => Promise<Preferences>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

type SettingsCardProps = {
  title: string;
  subtitle: string;
  icon: JSX.Element;
  children: React.ReactNode;
  className?: string;
  badge?: string;
};

type SettingRowProps = {
  icon: JSX.Element;
  label: string;
  description?: string;
  value?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  disabled?: boolean;
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 Mo';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount >= 10 || index < 2 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
};

function SettingsCard({ title, subtitle, icon, children, className = '', badge }: SettingsCardProps) {
  return <section className={`settings-panel ${className}`.trim()}>
    <header className="settings-panel-head">
      <span>{icon}</span>
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {badge ? <b className="settings-panel-badge">{badge}</b> : null}
    </header>
    <div className="settings-panel-body">{children}</div>
  </section>;
}

function SettingRow({ icon, label, description, value, onClick, children, disabled }: SettingRowProps) {
  const content = <>
    <span className="settings-row-icon">{icon}</span>
    <span className="settings-row-copy"><strong>{label}</strong>{description ? <small>{description}</small> : null}</span>
    {value ? <span className="settings-row-value">{value}</span> : null}
    {children}
    {onClick ? <ChevronRight className="settings-row-arrow" size={18} aria-hidden="true"/> : null}
  </>;
  return onClick
    ? <button className="settings-row" type="button" onClick={onClick} disabled={disabled}>{content}</button>
    : <div className="settings-row">{content}</div>;
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button
    className={checked ? 'settings-switch is-on' : 'settings-switch'}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  ><span/></button>;
}

export default function SettingsWorkspace({
  preferences,
  setPreferences,
  persistPreferences,
  onNotice,
  onError,
}: SettingsWorkspaceProps) {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const [savingKey, setSavingKey] = useState('');
  const [storageUsage, setStorageUsage] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [connectionCopied, setConnectionCopied] = useState(false);

  const initials = useMemo(() => {
    const source = user?.name || user?.email || 'MB';
    return source.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'MB';
  }, [user?.email, user?.name]);

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    void navigator.storage.estimate().then((estimate) => {
      setStorageUsage(typeof estimate.usage === 'number' ? estimate.usage : null);
      setStorageQuota(typeof estimate.quota === 'number' ? estimate.quota : null);
    }).catch(() => undefined);
  }, []);

  const update = async (key: string, patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    setSavingKey(key);
    try {
      const saved = await persistPreferences(next);
      setPreferences(saved);
      onNotice('Paramètre enregistré.');
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Enregistrement impossible.');
    } finally {
      setSavingKey('');
    }
  };

  const clearMboteCache = async () => {
    setStorageBusy(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => /mbote/i.test(key)).map((key) => caches.delete(key)));
      }
      if (navigator.storage?.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageUsage(typeof estimate.usage === 'number' ? estimate.usage : null);
        setStorageQuota(typeof estimate.quota === 'number' ? estimate.quota : null);
      }
      onNotice('Cache MBotéRoom nettoyé.');
    } catch {
      onError('Le cache n’a pas pu être nettoyé.');
    } finally {
      setStorageBusy(false);
    }
  };

  const backupPreferences = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      application: 'MBotéRoom',
      user: { id: user?.id, email: user?.email },
      preferences,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mboteroom-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onNotice('Sauvegarde locale créée.');
  };

  const copyPcConnection = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/login`);
      setConnectionCopied(true);
      window.setTimeout(() => setConnectionCopied(false), 2200);
      onNotice('Adresse de connexion copiée.');
    } catch {
      onError('Impossible de copier l’adresse de connexion.');
    }
  };

  const storageLabel = storageUsage === null
    ? 'Calcul…'
    : storageQuota
      ? `${formatBytes(storageUsage)} / ${formatBytes(storageQuota)}`
      : formatBytes(storageUsage);

  return <section className="settings-workspace">
    <header className="settings-account-hero">
      <div className="settings-account-identity">
        <span className="settings-account-avatar">{user?.avatar ? <img src={user.avatar} alt=""/> : initials}<i/></span>
        <div>
          <span className="settings-account-kicker">Paramètres MBotéRoom</span>
          <h1>{user?.name || 'Votre compte'}</h1>
          <p>{user?.email || ''}</p>
          <b><span/> Compte actif</b>
        </div>
      </div>
      <div className="settings-account-welcome">
        <strong>Bonjour !</strong>
        <span>Personnalisez votre espace, vos réunions et votre confidentialité.</span>
      </div>
    </header>

    <div className="settings-desktop-grid">
      <div className="settings-column">
        <SettingsCard title="Compte" subtitle="Gérez votre compte et votre sécurité" icon={<UserRound/>}>
          <SettingRow icon={<UserRound/>} label="Mon profil" description="Identité, avatar et organisation" onClick={() => navigate('/app/profile')}/>
          <SettingRow icon={<ShieldCheck/>} label="Sécurité" description="Mot de passe et protection" onClick={() => navigate('/securite')}/>
          <SettingRow icon={<Laptop/>} label="Appareils connectés" description="Votre session et vos appareils" onClick={() => navigate('/securite')}/>
          <SettingRow icon={<LockKeyhole/>} label="Vérification en deux étapes" description="Code de sécurité demandé à la connexion" value="Activée" onClick={() => navigate('/securite')}/>
        </SettingsCard>

        <SettingsCard title="Notifications" subtitle="Choisissez comment vous êtes notifié" icon={<Bell/>}>
          <SettingRow icon={<Bell/>} label="Notifications dans l’application" description="Messages, réunions et alertes">
            <Switch checked={preferences.notifications !== false} label="Notifications dans l’application" disabled={savingKey==='notifications'} onChange={(value) => void update('notifications', { notifications: value })}/>
          </SettingRow>
          <PushNotificationSettings compact/>
          <SettingRow icon={<Volume2/>} label="Sons" description="Sons pour les nouvelles alertes">
            <Switch checked={preferences.notificationSounds !== false} label="Sons de notification" disabled={savingKey==='notificationSounds'} onChange={(value) => void update('notificationSounds', { notificationSounds: value })}/>
          </SettingRow>
          <SettingRow icon={<Vibrate/>} label="Vibreur" description="Retour haptique sur appareil compatible">
            <Switch checked={preferences.vibration === true} label="Vibreur" disabled={savingKey==='vibration'} onChange={(value) => void update('vibration', { vibration: value })}/>
          </SettingRow>
          <SettingRow icon={<Smartphone/>} label="Aperçu sur écran verrouillé" description="Afficher un aperçu des alertes">
            <Switch checked={preferences.lockScreenPreview !== false} label="Aperçu sur écran verrouillé" disabled={savingKey==='lockScreenPreview'} onChange={(value) => void update('lockScreenPreview', { lockScreenPreview: value })}/>
          </SettingRow>
        </SettingsCard>

        <SettingsCard title="Connexion PC" subtitle="Utilisez MBotéRoom sur votre ordinateur" icon={<MonitorCog/>}>
          <div className="settings-pc-connect">
            <span><Laptop size={28}/></span>
            <div><strong>Connecter un appareil</strong><p>Ouvrez MBotéRoom sur l’ordinateur, puis connectez-vous avec votre compte.</p></div>
            <button type="button" onClick={() => void copyPcConnection()}>{connectionCopied ? 'Copié' : 'Copier l’adresse'}</button>
          </div>
        </SettingsCard>

        <SettingsCard title="Stockage & données" subtitle="Gérez l’espace et la consommation" icon={<Database/>}>
          <SettingRow icon={<HardDrive/>} label="Utilisation du stockage" value={storageLabel}/>
          <SettingRow icon={<Trash2/>} label="Nettoyer le cache" description="Supprimer les fichiers temporaires MBotéRoom" onClick={() => void clearMboteCache()} disabled={storageBusy}/>
          <SettingRow icon={<Save/>} label="Sauvegarde locale" description="Exporter vos préférences sur cet appareil" onClick={backupPreferences}/>
          <SettingRow icon={<Gauge/>} label="Économie de données" description="Réduire l’usage réseau quand c’est possible">
            <Switch checked={preferences.dataSaver === true} label="Économie de données" disabled={savingKey==='dataSaver'} onChange={(value) => void update('dataSaver', { dataSaver: value })}/>
          </SettingRow>
        </SettingsCard>

        <SettingsCard title="Localiser mon appareil" subtitle="Retrouvez et sécurisez vos appareils" icon={<MapPin/>} badge="Premium">
          <SettingRow icon={<MapPin/>} label="Localiser un appareil perdu" description="Disponible avec MBotéRoom Premium" value="Premium" disabled/>
        </SettingsCard>
      </div>

      <div className="settings-column">
        <SettingsCard title="Préférences" subtitle="Personnalisez votre expérience" icon={<Palette/>}>
          <SettingRow icon={<Languages/>} label="Langue">
            <select aria-label="Langue" value={preferences.language || 'fr'} disabled={savingKey==='language'} onChange={(event) => void update('language', { language: event.target.value })}>
              <option value="fr">Français</option><option value="en">English</option>
            </select>
          </SettingRow>
          <SettingRow icon={<Moon/>} label="Thème">
            <select aria-label="Thème" value={preferences.theme || 'system'} disabled={savingKey==='theme'} onChange={(event) => void update('theme', { theme: event.target.value })}>
              <option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option>
            </select>
          </SettingRow>
          <SettingRow icon={<Type/>} label="Taille du texte">
            <select aria-label="Taille du texte" value={preferences.textSize || 'normal'} disabled={savingKey==='textSize'} onChange={(event) => void update('textSize', { textSize: event.target.value as Preferences['textSize'] })}>
              <option value="small">Petite</option><option value="normal">Normale</option><option value="large">Grande</option>
            </select>
          </SettingRow>
          <SettingRow icon={<Accessibility/>} label="Accessibilité" description="Contraste renforcé et réduction des animations">
            <Switch checked={Boolean((preferences.accessibility as { enabled?: boolean } | undefined)?.enabled)} label="Accessibilité renforcée" disabled={savingKey==='accessibility'} onChange={(value) => void update('accessibility', { accessibility: { ...(preferences.accessibility || {}), enabled: value } })}/>
          </SettingRow>
        </SettingsCard>

        <SettingsCard title="Discussions" subtitle="Personnalisez vos conversations" icon={<MessageCircle/>}>
          <SettingRow icon={<Archive/>} label="Archivage automatique">
            <select aria-label="Archivage automatique" value={preferences.autoArchiveDays ?? 30} disabled={savingKey==='autoArchiveDays'} onChange={(event) => void update('autoArchiveDays', { autoArchiveDays: Number(event.target.value) })}>
              <option value="0">Jamais</option><option value="7">Après 7 jours</option><option value="30">Après 30 jours</option><option value="90">Après 90 jours</option>
            </select>
          </SettingRow>
          <SettingRow icon={<Download/>} label="Téléchargement média auto">
            <select aria-label="Téléchargement automatique des médias" value={preferences.mediaDownload || 'wifi'} disabled={savingKey==='mediaDownload'} onChange={(event) => void update('mediaDownload', { mediaDownload: event.target.value as Preferences['mediaDownload'] })}>
              <option value="wifi">Wi-Fi uniquement</option><option value="always">Toujours</option><option value="never">Jamais</option>
            </select>
          </SettingRow>
          <SettingRow icon={<Palette/>} label="Fond des discussions">
            <select aria-label="Fond des discussions" value={preferences.chatBackground || 'default'} disabled={savingKey==='chatBackground'} onChange={(event) => void update('chatBackground', { chatBackground: event.target.value as Preferences['chatBackground'] })}>
              <option value="default">Par défaut</option><option value="soft">Doux</option><option value="dark">Sombre</option>
            </select>
          </SettingRow>
        </SettingsCard>

        <SettingsCard title="Audio & Vidéo" subtitle="Configurez vos préférences de réunion" icon={<Video/>}>
          <SettingRow icon={<Mic/>} label="Micro actif par défaut">
            <Switch checked={preferences.defaultMic !== false} label="Micro actif par défaut" disabled={savingKey==='defaultMic'} onChange={(value) => void update('defaultMic', { defaultMic: value })}/>
          </SettingRow>
          <SettingRow icon={<Camera/>} label="Caméra active par défaut">
            <Switch checked={preferences.defaultCamera !== false} label="Caméra active par défaut" disabled={savingKey==='defaultCamera'} onChange={(value) => void update('defaultCamera', { defaultCamera: value })}/>
          </SettingRow>
          <SettingRow icon={<Volume2/>} label="Réduction du bruit">
            <Switch checked={preferences.noiseReduction !== false} label="Réduction du bruit" disabled={savingKey==='noiseReduction'} onChange={(value) => void update('noiseReduction', { noiseReduction: value })}/>
          </SettingRow>
          <SettingRow icon={<Video/>} label="Qualité vidéo HD">
            <Switch checked={preferences.hdVideo !== false} label="Qualité vidéo HD" disabled={savingKey==='hdVideo'} onChange={(value) => void update('hdVideo', { hdVideo: value })}/>
          </SettingRow>
        </SettingsCard>

        <SettingsCard title="Outils IA Luna" subtitle="Boostez votre productivité avec l’IA" icon={<Sparkles/>}>
          <SettingRow icon={<FileText/>} label="Résumés automatiques">
            <Switch checked={preferences.lunaAutoSummary !== false} label="Résumés automatiques Luna" disabled={savingKey==='lunaAutoSummary'} onChange={(value) => void update('lunaAutoSummary', { lunaAutoSummary: value })}/>
          </SettingRow>
          <SettingRow icon={<Globe2/>} label="Traduction en temps réel">
            <Switch checked={preferences.lunaRealtimeTranslation !== false} label="Traduction en temps réel Luna" disabled={savingKey==='lunaRealtimeTranslation'} onChange={(value) => void update('lunaRealtimeTranslation', { lunaRealtimeTranslation: value })}/>
          </SettingRow>
          <SettingRow icon={<WandSparkles/>} label="Suggestions d’actions">
            <Switch checked={preferences.lunaActionSuggestions !== false} label="Suggestions d’actions Luna" disabled={savingKey==='lunaActionSuggestions'} onChange={(value) => void update('lunaActionSuggestions', { lunaActionSuggestions: value })}/>
          </SettingRow>
        </SettingsCard>

        <div className="settings-offline-slot"><OfflineModeSettings/></div>
      </div>

      <div className="settings-column">
        <SettingsCard title="Confidentialité" subtitle="Contrôlez vos données et votre vie privée" icon={<LockKeyhole/>}>
          <SettingRow icon={<UsersRound/>} label="Salle d’attente" description="Activer par défaut pour les nouvelles réunions">
            <Switch checked={preferences.waitingRoomDefault !== false} label="Salle d’attente par défaut" disabled={savingKey==='waitingRoomDefault'} onChange={(value) => void update('waitingRoomDefault', { waitingRoomDefault: value })}/>
          </SettingRow>
          <SettingRow icon={<LockKeyhole/>} label="Verrouillage des réunions" description="Verrouiller automatiquement après le démarrage">
            <Switch checked={preferences.meetingLockDefault === true} label="Verrouillage des réunions" disabled={savingKey==='meetingLockDefault'} onChange={(value) => void update('meetingLockDefault', { meetingLockDefault: value })}/>
          </SettingRow>
          <SettingRow icon={<Mic/>} label="Micro des participants">
            <Switch checked={preferences.participantAudioAllowed !== false} label="Autoriser le micro des participants" disabled={savingKey==='participantAudioAllowed'} onChange={(value) => void update('participantAudioAllowed', { participantAudioAllowed: value })}/>
          </SettingRow>
          <SettingRow icon={<Camera/>} label="Caméra des participants">
            <Switch checked={preferences.participantVideoAllowed !== false} label="Autoriser la caméra des participants" disabled={savingKey==='participantVideoAllowed'} onChange={(value) => void update('participantVideoAllowed', { participantVideoAllowed: value })}/>
          </SettingRow>
          <SettingRow icon={<MonitorCog/>} label="Partage d’écran">
            <Switch checked={preferences.screenShareAllowed !== false} label="Autoriser le partage d’écran" disabled={savingKey==='screenShareAllowed'} onChange={(value) => void update('screenShareAllowed', { screenShareAllowed: value })}/>
          </SettingRow>
          <SettingRow icon={<ShieldCheck/>} label="Blocage et signalement" description="Gérez les utilisateurs indésirables" onClick={() => navigate('/aide')}/>
        </SettingsCard>

        <SettingsCard title="Aide" subtitle="Obtenez de l’aide et contactez-nous" icon={<CircleHelp/>}>
          <SettingRow icon={<CircleHelp/>} label="Centre d’aide" description="Guides, tutoriels et questions fréquentes" onClick={() => navigate('/aide')}/>
          <SettingRow icon={<MessageCircle/>} label="Contacter le support" description="Notre équipe est là pour vous aider" onClick={() => navigate('/aide')}/>
          <SettingRow icon={<ShieldCheck/>} label="Conditions et confidentialité" description="Nos règles et votre vie privée" onClick={() => navigate('/confidentialite')}/>
          <SettingRow icon={<CircleInfo/>} label="À propos" value="Version 0.2.0" onClick={() => navigate('/fonctionnalites')}/>
        </SettingsCard>

        <SettingsCard title="Synchronisation" subtitle="Continuité de service et données locales" icon={<Wifi/>}>
          <div className="settings-sync-note"><RefreshCw size={18}/><div><strong>Synchronisation automatique</strong><p>Vos changements sont enregistrés dans votre compte et repris dès que la connexion revient.</p></div></div>
        </SettingsCard>
      </div>
    </div>

    <button className="settings-logout" type="button" onClick={() => void authService.logout()}><LogOut size={19}/> Se déconnecter</button>
  </section>;
}
