import { useEffect, useState } from 'react';

export type AppLanguage = 'fr' | 'en' | 'ln' | 'ar';

const LANGUAGE_STORAGE_KEY = 'mboteroom-language';
const LANGUAGE_EVENT = 'mboteroom-language-changed';

const supportedLanguages: AppLanguage[] = ['fr', 'en', 'ln', 'ar'];

export const getStoredLanguage = (): AppLanguage => {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY) as AppLanguage | null;
    return value && supportedLanguages.includes(value) ? value : 'fr';
  } catch {
    return 'fr';
  }
};

export const getAppLocale = (language = getStoredLanguage()) => ({
  fr: 'fr-FR',
  en: 'en-US',
  ln: 'fr-CD',
  ar: 'ar',
}[language]);

export const persistAppLanguage = (language: AppLanguage) => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable in private/restricted contexts.
  }
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: language }));
};

type TranslationRow = Partial<Record<Exclude<AppLanguage, 'fr'>, string>>;

const dictionary: Record<string, TranslationRow> = {
  'Accueil': { en: 'Home', ln: 'Ebandeli', ar: 'الرئيسية' },
  'Réunions': { en: 'Meetings', ln: 'Likita', ar: 'الاجتماعات' },
  'Rejoindre': { en: 'Join', ln: 'Kokota', ar: 'انضمام' },
  'Calendrier': { en: 'Calendar', ln: 'Manaka', ar: 'التقويم' },
  'Enregistrements': { en: 'Recordings', ln: 'Ba enregistrement', ar: 'التسجيلات' },
  'Messages': { en: 'Messages', ln: 'Ba messages', ar: 'الرسائل' },
  'Contacts': { en: 'Contacts', ln: 'Ba contacts', ar: 'جهات الاتصال' },
  'Notifications': { en: 'Notifications', ln: 'Mayebisi', ar: 'الإشعارات' },
  'Alertes': { en: 'Alerts', ln: 'Makebisi', ar: 'التنبيهات' },
  'Tableau blanc': { en: 'Whiteboard', ln: 'Tableau pembe', ar: 'السبورة البيضاء' },
  'Sondages': { en: 'Polls', ln: 'Ba sondage', ar: 'الاستطلاعات' },
  'Paramètres': { en: 'Settings', ln: 'Paramètres', ar: 'الإعدادات' },
  'Mon profil': { en: 'My profile', ln: 'Profil na ngai', ar: 'ملفي الشخصي' },
  'Sécurité': { en: 'Security', ln: 'Bobateli', ar: 'الأمان' },
  'Se déconnecter': { en: 'Sign out', ln: 'Kobima', ar: 'تسجيل الخروج' },
  'Déconnexion': { en: 'Sign out', ln: 'Kobima', ar: 'تسجيل الخروج' },
  'En ligne': { en: 'Online', ln: 'Na ligne', ar: 'متصل' },
  'Mode hors ligne': { en: 'Offline mode', ln: 'Mode sans réseau', ar: 'وضع عدم الاتصال' },
  'Réunions sécurisées': { en: 'Secure meetings', ln: 'Likita ya kobatelama', ar: 'اجتماعات آمنة' },
  'Navigation principale': { en: 'Main navigation', ln: 'Navigation ya liboso', ar: 'التنقل الرئيسي' },
  'Navigation mobile': { en: 'Mobile navigation', ln: 'Navigation ya telefone', ar: 'تنقل الهاتف' },
  'Fermer le menu': { en: 'Close menu', ln: 'Kanga menu', ar: 'إغلاق القائمة' },
  'Ouvrir le menu': { en: 'Open menu', ln: 'Fungola menu', ar: 'فتح القائمة' },
  'Ouvrir le menu du profil': { en: 'Open profile menu', ln: 'Fungola menu ya profil', ar: 'فتح قائمة الملف الشخصي' },
  'Rechercher': { en: 'Search', ln: 'Koluka', ar: 'بحث' },
  'Rechercher une réunion ou un contact...': { en: 'Search for a meeting or contact...', ln: 'Luka likita to contact...', ar: 'ابحث عن اجتماع أو جهة اتصال...' },
  'Identité, avatar et organisation': { en: 'Identity, avatar and organization', ln: 'Identité, avatar mpe organisation', ar: 'الهوية والصورة والمؤسسة' },
  'Alertes et activité': { en: 'Alerts and activity', ln: 'Makebisi mpe activité', ar: 'التنبيهات والنشاط' },
  'Appareil, application et préférences': { en: 'Device, app and preferences', ln: 'Appareil, application mpe préférences', ar: 'الجهاز والتطبيق والتفضيلات' },
  'Code de sécurité et protection du compte': { en: 'Security code and account protection', ln: 'Code ya sécurité mpe bobateli compte', ar: 'رمز الأمان وحماية الحساب' },
  'Nouvelle réunion': { en: 'New meeting', ln: 'Likita ya sika', ar: 'اجتماع جديد' },
  'Programmer ou démarrer': { en: 'Schedule or start', ln: 'Bongisa to banda', ar: 'جدولة أو بدء' },
  'ID ou lien de réunion': { en: 'Meeting ID or link', ln: 'ID to lien ya likita', ar: 'معرّف الاجتماع أو الرابط' },
  'Code ou lien de réunion': { en: 'Meeting code or link', ln: 'Code to lien ya likita', ar: 'رمز الاجتماع أو الرابط' },
  'Conversations de réunion': { en: 'Meeting conversations', ln: 'Masolo ya likita', ar: 'محادثات الاجتماع' },
  'Participants rencontrés': { en: 'Participants met', ln: 'Bato ya likita', ar: 'المشاركون الذين قابلتهم' },
  'Recherche': { en: 'Search', ln: 'Boluki', ar: 'البحث' },
  'Invité': { en: 'Guest', ln: 'Mobengami', ar: 'ضيف' },
  'Membre MBotéRoom': { en: 'MBotéRoom member', ln: 'Membre MBotéRoom', ar: 'عضو MBotéRoom' },
  'Administrateur MBotéRoom': { en: 'MBotéRoom administrator', ln: 'Administrateur MBotéRoom', ar: 'مسؤول MBotéRoom' },
  'Utilisateur MBotéRoom': { en: 'MBotéRoom user', ln: 'Mosaleli MBotéRoom', ar: 'مستخدم MBotéRoom' },
  'Ouvrir mon profil': { en: 'Open my profile', ln: 'Fungola profil na ngai', ar: 'فتح ملفي الشخصي' },
  'Ouvrir': { en: 'Open', ln: 'Fungola', ar: 'فتح' },
  'Fermer': { en: 'Close', ln: 'Kanga', ar: 'إغلاق' },
  'Annuler': { en: 'Cancel', ln: 'Longola', ar: 'إلغاء' },
  'Supprimer': { en: 'Delete', ln: 'Longola', ar: 'حذف' },
  'Modifier': { en: 'Edit', ln: 'Bongola', ar: 'تعديل' },
  'Envoyer': { en: 'Send', ln: 'Tinda', ar: 'إرسال' },
  'Chargement…': { en: 'Loading…', ln: 'Ezali kofungwama…', ar: 'جارٍ التحميل…' },
  'Chargement impossible.': { en: 'Unable to load.', ln: 'Kofungola ekoki te.', ar: 'تعذر التحميل.' },
  'Données indisponibles.': { en: 'Data unavailable.', ln: 'Ba données ezali te.', ar: 'البيانات غير متاحة.' },
  'Démarrage impossible.': { en: 'Unable to start.', ln: 'Kobanda ekoki te.', ar: 'تعذر البدء.' },
  'Accès impossible.': { en: 'Unable to access.', ln: 'Kokota ekoki te.', ar: 'تعذر الوصول.' },
  'Création impossible.': { en: 'Unable to create.', ln: 'Kosala ekoki te.', ar: 'تعذر الإنشاء.' },
  'Mise à jour impossible.': { en: 'Unable to update.', ln: 'Kobongisa ekoki te.', ar: 'تعذر التحديث.' },
  'Notifications indisponibles.': { en: 'Notifications unavailable.', ln: 'Mayebisi ezali te.', ar: 'الإشعارات غير متاحة.' },
  'Tout est à jour.': { en: 'Everything is up to date.', ln: 'Nyonso ezali malamu.', ar: 'كل شيء محدّث.' },
  'Réunion introuvable.': { en: 'Meeting not found.', ln: 'Likita emonani te.', ar: 'لم يتم العثور على الاجتماع.' },
  'Réunion introuvable ou inaccessible.': { en: 'Meeting not found or inaccessible.', ln: 'Likita emonani te to ekoki kokotama te.', ar: 'الاجتماع غير موجود أو غير متاح.' },
  'Cette réunion est terminée ou annulée.': { en: 'This meeting has ended or was cancelled.', ln: 'Likita oyo esili to elongolami.', ar: 'انتهى هذا الاجتماع أو تم إلغاؤه.' },
  'Impossible de rejoindre la réunion.': { en: 'Unable to join the meeting.', ln: 'Kokota na likita ekoki te.', ar: 'تعذر الانضمام إلى الاجتماع.' },
  'Vérification…': { en: 'Checking…', ln: 'Vérification…', ar: 'جارٍ التحقق…' },
  'Réunion MBotéRoom': { en: 'MBotéRoom meeting', ln: 'Likita MBotéRoom', ar: 'اجتماع MBotéRoom' },
  'Rejoindre maintenant': { en: 'Join now', ln: 'Kota sikoyo', ar: 'انضم الآن' },
  'Rejoindre la réunion': { en: 'Join meeting', ln: 'Kota na likita', ar: 'الانضمام إلى الاجتماع' },
  'Connexion à la réunion...': { en: 'Connecting to the meeting...', ln: 'Kokota na likita...', ar: 'جارٍ الاتصال بالاجتماع...' },
  'Votre nom': { en: 'Your name', ln: 'Kombo na yo', ar: 'اسمك' },
  'Mot de passe (si requis)': { en: 'Password (if required)', ln: 'Mot de passe (soki esengeli)', ar: 'كلمة المرور (إن لزم)' },
  'Entrez le mot de passe de la réunion': { en: 'Enter the meeting password', ln: 'Koma mot de passe ya likita', ar: 'أدخل كلمة مرور الاجتماع' },
  'Accès sécurisé': { en: 'Secure access', ln: 'Kokota ya kobatelama', ar: 'وصول آمن' },
  'Tous appareils': { en: 'All devices', ln: 'Ba appareils nyonso', ar: 'كل الأجهزة' },
  'Prévisualisation avant entrée': { en: 'Preview before joining', ln: 'Tala liboso ya kokota', ar: 'معاينة قبل الدخول' },
  'Micro': { en: 'Mic', ln: 'Micro', ar: 'الميكروفون' },
  'Microphone': { en: 'Microphone', ln: 'Microphone', ar: 'الميكروفون' },
  'Micro coupé': { en: 'Mic off', ln: 'Micro ekangami', ar: 'الميكروفون مغلق' },
  'Micro actif': { en: 'Mic on', ln: 'Micro ezali kosala', ar: 'الميكروفون يعمل' },
  'Caméra': { en: 'Camera', ln: 'Caméra', ar: 'الكاميرا' },
  'Caméra coupée': { en: 'Camera off', ln: 'Caméra ekangami', ar: 'الكاميرا مغلقة' },
  'Caméra activée': { en: 'Camera on', ln: 'Caméra ezali kosala', ar: 'الكاميرا مفعلة' },
  'Caméra désactivée': { en: 'Camera off', ln: 'Caméra ekangami', ar: 'الكاميرا معطلة' },
  'Partager': { en: 'Share', ln: 'Kabola', ar: 'مشاركة' },
  'Partage d’écran': { en: 'Screen sharing', ln: 'Kokabola écran', ar: 'مشاركة الشاشة' },
  'Participants': { en: 'Participants', ln: 'Bato ya likita', ar: 'المشاركون' },
  'Hôte': { en: 'Host', ln: 'Mokambi', ar: 'المضيف' },
  'Co-hôte': { en: 'Co-host', ln: 'Mokambi mosungi', ar: 'مضيف مشارك' },
  'Résumé': { en: 'Summary', ln: 'Bokuse', ar: 'الملخص' },
  'Décisions': { en: 'Decisions', ln: 'Mikano', ar: 'القرارات' },
  'Génération…': { en: 'Generating…', ln: 'Ezali kosalama…', ar: 'جارٍ الإنشاء…' },
  'Générer maintenant': { en: 'Generate now', ln: 'Sala sikoyo', ar: 'إنشاء الآن' },
  'Résumé indisponible.': { en: 'Summary unavailable.', ln: 'Bokuse ezali te.', ar: 'الملخص غير متاح.' },
  'Réactions': { en: 'Reactions', ln: 'Ba réactions', ar: 'التفاعلات' },
  'Périphériques': { en: 'Devices', ln: 'Ba appareils', ar: 'الأجهزة' },
  'Écrire un message…': { en: 'Write a message…', ln: 'Koma message…', ar: 'اكتب رسالة…' },
  'Demander à Luna': { en: 'Ask Luna', ln: 'Tuna Luna', ar: 'اسأل Luna' },
  'Sous-titres': { en: 'Captions', ln: 'Ba sous-titres', ar: 'الترجمة النصية' },
  'Sous-titres IA': { en: 'AI captions', ln: 'Ba sous-titres IA', ar: 'ترجمة نصية بالذكاء الاصطناعي' },
  'Arrière-plan': { en: 'Background', ln: 'Arrière-plan', ar: 'الخلفية' },
  'Aucun': { en: 'None', ln: 'Moko te', ar: 'لا شيء' },
  'Informations de la réunion': { en: 'Meeting information', ln: 'Makambo ya likita', ar: 'معلومات الاجتماع' },
  'ID de réunion': { en: 'Meeting ID', ln: 'ID ya likita', ar: 'معرّف الاجتماع' },
  'Salle d’attente': { en: 'Waiting room', ln: 'Salle ya kozela', ar: 'غرفة الانتظار' },
  'Vous êtes dans la salle d’attente.': { en: 'You are in the waiting room.', ln: 'Ozali na salle ya kozela.', ar: 'أنت في غرفة الانتظار.' },
  'Paramètres enregistrés.': { en: 'Settings saved.', ln: 'Paramètres ebombami.', ar: 'تم حفظ الإعدادات.' },
  'Profil mis à jour.': { en: 'Profile updated.', ln: 'Profil ebongisami.', ar: 'تم تحديث الملف الشخصي.' },
  'Profil non enregistré.': { en: 'Profile not saved.', ln: 'Profil ebombami te.', ar: 'لم يتم حفظ الملف الشخصي.' },
  'Votre nom complet': { en: 'Your full name', ln: 'Kombo na yo mobimba', ar: 'اسمك الكامل' },
  'Entreprise, école ou équipe': { en: 'Company, school or team', ln: 'Entreprise, école to équipe', ar: 'شركة أو مدرسة أو فريق' },
  'Non renseignée': { en: 'Not provided', ln: 'Eyebisami te', ar: 'غير محدد' },
  'Créer ou rejoindre une réunion': { en: 'Create or join a meeting', ln: 'Sala to kota na likita', ar: 'إنشاء اجتماع أو الانضمام إليه' },
  'Messages et sondages': { en: 'Messages and polls', ln: 'Ba messages mpe ba sondage', ar: 'الرسائل والاستطلاعات' },
  'Aide': { en: 'Help', ln: 'Lisungi', ar: 'المساعدة' },
};

const translateValue = (value: string, language: AppLanguage) => {
  if (language === 'fr') return value;
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const source = value.trim();
  if (!source) return value;

  const direct = dictionary[source]?.[language];
  if (direct) return leading + direct + trailing;

  const duration = source.match(/^Durée\s*:\s*(\d+)\s*min$/i);
  if (duration) {
    const label = language === 'en' ? 'Duration' : language === 'ln' ? 'Ntango' : 'المدة';
    return leading + `${label}: ${duration[1]} min` + trailing;
  }
  const participants = source.match(/^Participants\s*:\s*(\d+)$/i);
  if (participants) {
    const label = language === 'en' ? 'Participants' : language === 'ln' ? 'Bato ya likita' : 'المشاركون';
    return leading + `${label}: ${participants[1]}` + trailing;
  }
  const micIndex = source.match(/^Microphone\s+(\d+)$/);
  if (micIndex) return leading + (language === 'ar' ? `الميكروفون ${micIndex[1]}` : `Microphone ${micIndex[1]}`) + trailing;
  const cameraIndex = source.match(/^Caméra\s+(\d+)$/);
  if (cameraIndex) return leading + (language === 'en' ? `Camera ${cameraIndex[1]}` : language === 'ln' ? `Caméra ${cameraIndex[1]}` : `الكاميرا ${cameraIndex[1]}`) + trailing;

  return value;
};

const originalText = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const appliedAttributes = new WeakMap<Element, Map<string, string>>();
const translatedAttributes = ['placeholder', 'title', 'aria-label'];

const applyTextNode = (node: Text, language: AppLanguage) => {
  const current = node.data;
  const lastApplied = appliedText.get(node);
  let source = originalText.get(node);
  if (source === undefined || (lastApplied !== undefined && current !== lastApplied)) {
    source = current;
    originalText.set(node, source);
  }
  const next = translateValue(source, language);
  appliedText.set(node, next);
  if (current !== next) node.data = next;
};

const applyElementAttributes = (element: Element, language: AppLanguage) => {
  let originals = originalAttributes.get(element);
  let applied = appliedAttributes.get(element);
  if (!originals) {
    originals = new Map();
    originalAttributes.set(element, originals);
  }
  if (!applied) {
    applied = new Map();
    appliedAttributes.set(element, applied);
  }

  translatedAttributes.forEach((name) => {
    if (!element.hasAttribute(name)) return;
    const current = element.getAttribute(name) || '';
    const lastApplied = applied!.get(name);
    if (!originals!.has(name) || (lastApplied !== undefined && current !== lastApplied)) originals!.set(name, current);
    const source = originals!.get(name) || '';
    const next = translateValue(source, language);
    applied!.set(name, next);
    if (current !== next) element.setAttribute(name, next);
  });
};

const translateTree = (root: Node, language: AppLanguage) => {
  if (root.nodeType === Node.TEXT_NODE) {
    applyTextNode(root as Text, language);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) applyElementAttributes(root as Element, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) applyTextNode(node as Text, language);
    else applyElementAttributes(node as Element, language);
    node = walker.nextNode();
  }
};

export function AppLanguageBridge() {
  const [language, setLanguage] = useState<AppLanguage>(() => getStoredLanguage());

  useEffect(() => {
    const update = (event: Event) => {
      const next = (event as CustomEvent<AppLanguage>).detail || getStoredLanguage();
      setLanguage(next);
    };
    const syncStorage = () => setLanguage(getStoredLanguage());
    window.addEventListener(LANGUAGE_EVENT, update);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, update);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    if (document.body) translateTree(document.body, language);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') applyTextNode(mutation.target as Text, language);
        if (mutation.type === 'attributes') applyElementAttributes(mutation.target as Element, language);
        mutation.addedNodes.forEach((node) => translateTree(node, language));
      });
    });
    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: translatedAttributes,
      });
    }
    return () => observer.disconnect();
  }, [language]);

  return null;
}
