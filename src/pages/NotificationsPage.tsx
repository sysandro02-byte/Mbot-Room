
import {
  Bell, BellRing, CalendarDays, CheckCheck, ChevronRight, CircleCheck, Clock3,
  FileText, MessageCircle, Phone, Search, Send, Settings2, SlidersHorizontal,
  Sparkles, Video,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { appDataService, type Preferences } from '../services/appDataService';
import { notificationService, type PushState, type RoomNotification } from '../services/notificationService';
import { getAppLocale } from '../lib/appLanguage';
import { socket } from '../lib/socket';
import { showAppMessage } from '../lib/appMessage';
import './NotificationsPage.css';

type FilterKey='all'|'unread'|'meetings'|'messages'|'calls'|'system';
type SortKey='recent'|'oldest';

const formatDate=(value:string)=>new Intl.DateTimeFormat(getAppLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const relativeTime=(value:string)=>{
  const diff=Math.max(0,Date.now()-new Date(value).getTime());
  const minutes=Math.floor(diff/60000);
  if(minutes<1)return 'À l’instant';
  if(minutes<60)return 'Il y a '+minutes+' min';
  const hours=Math.floor(minutes/60);
  if(hours<24)return 'Il y a '+hours+' h';
  const days=Math.floor(hours/24);
  if(days<7)return 'Il y a '+days+' j';
  return formatDate(value);
};
const categoryOf=(item:RoomNotification):Exclude<FilterKey,'all'|'unread'>=>{
  const type=String(item.type||'').toUpperCase();
  const text=(item.title+' '+item.body).toLowerCase();
  if(type.includes('MESSAGE')||text.includes('message'))return 'messages';
  if(type.includes('CALL')||text.includes('appel'))return 'calls';
  if(type.includes('MEETING')||type.includes('LOBBY')||text.includes('réunion')||text.includes('salle d’attente'))return 'meetings';
  return 'system';
};
const actionLabel=(item:RoomNotification)=>{
  const category=categoryOf(item);
  if(category==='messages')return 'Répondre';
  if(category==='calls')return 'Voir';
  if(category==='meetings')return String(item.type||'').includes('START')?'Rejoindre':'Voir';
  return 'Ouvrir';
};
function NotificationIcon({item}:{item:RoomNotification}){
  const category=categoryOf(item);
  if(category==='messages')return <MessageCircle/>;
  if(category==='calls')return <Phone/>;
  if(category==='meetings')return String(item.type||'').includes('LOBBY')?<Video/>:<CalendarDays/>;
  if(String(item.type||'').includes('SUMMARY'))return <Sparkles/>;
  return <Bell/>;
}

export default function NotificationsPage(){
  const navigate=useNavigate();
  const [items,setItems]=useState<RoomNotification[]>([]);
  const [preferences,setPreferences]=useState<Preferences>({});
  const [pushState,setPushState]=useState<PushState|null>(null);
  const [loading,setLoading]=useState(true);
  const [settingsBusy,setSettingsBusy]=useState('');
  const [error,setError]=useState('');
  const [filter,setFilter]=useState<FilterKey>('all');
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState<SortKey>('recent');

  const unread=useMemo(()=>items.filter((item)=>!item.readAt).length,[items]);
  const today=useMemo(()=>items.filter((item)=>new Date(item.createdAt).toDateString()===new Date().toDateString()).length,[items]);
  const counts=useMemo(()=>({
    meetings:items.filter((item)=>categoryOf(item)==='meetings').length,
    messages:items.filter((item)=>categoryOf(item)==='messages').length,
    calls:items.filter((item)=>categoryOf(item)==='calls').length,
    system:items.filter((item)=>categoryOf(item)==='system').length,
  }),[items]);

  const load=async()=>{
    setLoading(true);setError('');
    try{
      const [notifications,prefs,push]=await Promise.all([
        notificationService.list(),
        appDataService.getPreferences().catch(()=>({} as Preferences)),
        notificationService.getPushState().catch(()=>null),
      ]);
      setItems(Array.isArray(notifications)?notifications:[]);
      setPreferences(prefs||{});
      setPushState(push);
    }catch(cause){setError(cause instanceof Error?cause.message:'Notifications indisponibles.');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    const onNotification=(notification:RoomNotification)=>setItems((current)=>[notification,...current.filter((item)=>item.id!==notification.id)]);
    if(!socket.connected)socket.connect();
    socket.on('notification:new',onNotification);
    return()=>{socket.off('notification:new',onNotification);};
  },[]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return items.filter((item)=>{
      if(filter==='unread'&&item.readAt)return false;
      if(filter!=='all'&&filter!=='unread'&&categoryOf(item)!==filter)return false;
      if(q&&!(item.title+' '+item.body+' '+item.type).toLowerCase().includes(q))return false;
      return true;
    }).sort((a,b)=>sort==='oldest'
      ?new Date(a.createdAt).getTime()-new Date(b.createdAt).getTime()
      :new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  },[filter,items,search,sort]);

  const markRead=async(notification:RoomNotification)=>{
    if(notification.readAt)return notification;
    try{
      const updated=await notificationService.markRead(notification.id);
      const normalized={...notification,...updated,createdAt:updated.createdAt||notification.createdAt,readAt:updated.readAt||new Date().toISOString()};
      setItems((current)=>current.map((item)=>item.id===notification.id?normalized:item));
      return normalized;
    }catch(cause){setError(cause instanceof Error?cause.message:'Mise à jour impossible.');return notification;}
  };
  const openNotification=async(notification:RoomNotification)=>{
    await markRead(notification);
    const target=typeof notification.data?.url==='string'?notification.data.url:'';
    if(target.startsWith('/'))navigate(target);
  };
  const markAllRead=async()=>{
    try{
      await notificationService.markAllRead();
      const now=new Date().toISOString();
      setItems((current)=>current.map((item)=>({...item,readAt:item.readAt||now})));
    }catch(cause){setError(cause instanceof Error?cause.message:'Mise à jour impossible.');}
  };
  const savePreference=async(key:keyof Preferences,value:boolean)=>{
    const previous=preferences;
    const next={...preferences,[key]:value};
    setPreferences(next);setSettingsBusy(String(key));
    try{setPreferences(await appDataService.updatePreferences(next));}
    catch(cause){setPreferences(previous);showAppMessage(cause instanceof Error?cause.message:'Paramètre non enregistré.',{tone:'error'});}
    finally{setSettingsBusy('');}
  };
  const togglePush=async()=>{
    if(!pushState)return;
    setSettingsBusy('push');
    try{
      const next=pushState.subscribed?await notificationService.disablePush():await notificationService.enablePush();
      setPushState(next);
      showAppMessage(next.subscribed?'Notifications push activées.':'Notifications push désactivées.',{tone:'success'});
    }catch(cause){showAppMessage(cause instanceof Error?cause.message:'Modification impossible.',{tone:'error'});}
    finally{setSettingsBusy('');}
  };
  const testPush=async()=>{
    setSettingsBusy('test');
    try{await notificationService.sendPushTest();showAppMessage('Notification de test envoyée.',{tone:'success'});}
    catch(cause){showAppMessage(cause instanceof Error?cause.message:'Test impossible.',{tone:'error'});}
    finally{setSettingsBusy('');}
  };
  const recent=items.slice(0,4);

  return <AppShell title="Notifications">
    <main className="notifications-pro-page">
      <header className="notifications-pro-hero">
        <div><span>Notifications</span><h1>Centre de notifications</h1><p>Restez informé de tout ce qui compte dans votre espace de travail MBotéRoom.</p></div>
        <div className="notifications-pro-hero-note"><BellRing/><div><strong>Ne manquez rien d’important</strong><small>Réunions, messages, appels et mises à jour restent regroupés au même endroit.</small></div></div>
      </header>

      <section className="notifications-pro-stats">
        <article><span><Bell/></span><div><strong>{unread}</strong><b>Non lues</b><small>sur {items.length} notification{items.length>1?'s':''}</small></div></article>
        <article><span className="green"><CalendarDays/></span><div><strong>{today}</strong><b>Aujourd’hui</b><small>Activité reçue ce jour</small></div></article>
        <article><span className="violet"><Video/></span><div><strong>{counts.meetings}</strong><b>Réunions</b><small>Invitations et rappels</small></div></article>
        <article><span className="coral"><MessageCircle/></span><div><strong>{counts.messages}</strong><b>Messages</b><small>Nouveaux échanges</small></div></article>
      </section>

      {error?<div className="notifications-pro-error">{error}</div>:null}

      <div className="notifications-pro-layout">
        <section className="notifications-pro-main">
          <div className="notifications-pro-tabs">
            {([
              ['all','Toutes',items.length],['unread','Non lues',unread],['meetings','Réunions',counts.meetings],
              ['messages','Messages',counts.messages],['calls','Appels',counts.calls],['system','Système',counts.system],
            ] as Array<[FilterKey,string,number]>).map(([key,label,count])=><button key={key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}<b>{count}</b></button>)}
          </div>
          <div className="notifications-pro-toolbar">
            <label><Search/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Rechercher dans vos notifications…"/></label>
            <select value={sort} onChange={(event)=>setSort(event.target.value as SortKey)}><option value="recent">Plus récentes</option><option value="oldest">Plus anciennes</option></select>
          </div>

          {loading?<div className="notifications-pro-empty">Chargement des notifications…</div>:filtered.length?<div className="notifications-pro-list">
            {filtered.map((notification)=>{
              const category=categoryOf(notification);
              const target=typeof notification.data?.url==='string'&&notification.data.url.startsWith('/');
              return <article key={notification.id} className={notification.readAt?'read':'unread'}>
                <i/><span className={'notifications-pro-icon '+category}><NotificationIcon item={notification}/></span>
                <div className="notifications-pro-copy"><strong>{notification.title}</strong>{notification.body?<p>{notification.body}</p>:null}<small><Clock3/>{relativeTime(notification.createdAt)} · {formatDate(notification.createdAt)}</small></div>
                <div className="notifications-pro-row-actions">
                  {target?<button onClick={()=>void openNotification(notification)}>{actionLabel(notification)}</button>:null}
                  {!notification.readAt?<button className="secondary" onClick={()=>void markRead(notification)}>Marquer comme lu</button>:<CircleCheck className="read-check"/>}
                </div>
              </article>;
            })}
          </div>:<div className="notifications-pro-empty"><Bell size={34}/><strong>Aucune notification</strong><p>Aucune notification ne correspond à ce filtre.</p></div>}
          <footer className="notifications-pro-footer"><button onClick={()=>void markAllRead()} disabled={!unread}><CheckCheck/> Tout marquer comme lu</button><span>{filtered.length} résultat{filtered.length>1?'s':''}</span></footer>
        </section>

        <aside className="notifications-pro-side">
          <section>
            <header><span><Settings2/></span><div><h2>Préférences rapides</h2><p>Gérez vos notifications en un clic.</p></div></header>
            <div className="notifications-pro-pref"><span><BellRing/></span><div><strong>Notifications push</strong><small>Sur cet appareil</small></div><button className={pushState?.subscribed?'switch on':'switch'} role="switch" aria-checked={Boolean(pushState?.subscribed)} disabled={!pushState?.supported||!pushState?.configured||settingsBusy==='push'} onClick={()=>void togglePush()}><i/></button></div>
            <div className="notifications-pro-pref"><span><Send/></span><div><strong>Notifications par e-mail</strong><small>Résumé et alertes importantes</small></div><button className={preferences.emailNotifications===true?'switch on':'switch'} role="switch" aria-checked={preferences.emailNotifications===true} disabled={settingsBusy==='emailNotifications'} onClick={()=>void savePreference('emailNotifications',preferences.emailNotifications!==true)}><i/></button></div>
            <div className="notifications-pro-pref"><span><MessageCircle/></span><div><strong>Notifications in-app</strong><small>Badges et activité</small></div><button className={preferences.notifications!==false?'switch on':'switch'} role="switch" aria-checked={preferences.notifications!==false} disabled={settingsBusy==='notifications'} onClick={()=>void savePreference('notifications',preferences.notifications===false)}><i/></button></div>
            <button className="notifications-pro-settings-link" onClick={()=>navigate('/app/settings')}>Voir tous les paramètres <ChevronRight/></button>
            <div className={pushState?.subscribed?'notifications-pro-push-state active':'notifications-pro-push-state'}><CircleCheck/><div><strong>{pushState?.subscribed?'Notifications activées':'Notifications push non actives'}</strong><small>{pushState?.subscribed?'Cet appareil peut recevoir les alertes MBotéRoom.':'Activez-les pour recevoir les alertes lorsque l’application est fermée.'}</small></div></div>
            {pushState?.subscribed?<button className="notifications-pro-test" onClick={()=>void testPush()} disabled={settingsBusy==='test'}><Send/> {settingsBusy==='test'?'Envoi…':'Tester une notification'}</button>:null}
          </section>

          <section>
            <header><span><SlidersHorizontal/></span><div><h2>Résumé du jour</h2><p>Votre activité récente.</p></div></header>
            <button className="notifications-pro-summary-row" onClick={()=>setFilter('meetings')}><CalendarDays/><span><strong>{counts.meetings} réunion{counts.meetings>1?'s':''}</strong><small>Invitations, rappels et salles d’attente</small></span><ChevronRight/></button>
            <button className="notifications-pro-summary-row" onClick={()=>setFilter('messages')}><MessageCircle/><span><strong>{counts.messages} message{counts.messages>1?'s':''}</strong><small>Messages reçus hors ligne</small></span><ChevronRight/></button>
            <button className="notifications-pro-summary-row" onClick={()=>setFilter('calls')}><Phone/><span><strong>{counts.calls} appel{counts.calls>1?'s':''}</strong><small>Activité d’appel</small></span><ChevronRight/></button>
            <button className="notifications-pro-summary-row" onClick={()=>setFilter('system')}><FileText/><span><strong>{counts.system} système</strong><small>Informations MBotéRoom</small></span><ChevronRight/></button>
          </section>

          <section>
            <header><span><Clock3/></span><div><h2>Activité récente</h2><p>Les dernières notifications.</p></div></header>
            {recent.map((notification)=><button key={notification.id} className="notifications-pro-recent" onClick={()=>void openNotification(notification)}><span><NotificationIcon item={notification}/></span><div><strong>{notification.title}</strong><small>{relativeTime(notification.createdAt)}</small></div>{!notification.readAt?<i/>:null}</button>)}
            {!recent.length?<p className="notifications-pro-side-empty">Aucune activité récente.</p>:null}
          </section>
        </aside>
      </div>
    </main>
  </AppShell>;
}
