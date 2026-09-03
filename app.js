import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { Buffer } from "https://esm.sh/buffer@6.0.3";
import { StreamChat } from "https://esm.sh/stream-chat@9.52.0";
import { StreamVideoClient, CallingState } from "https://esm.sh/@stream-io/video-client@latest";
/* stream-chat's browser upload helper uses Buffer for multipart encoding. */
globalThis.Buffer=Buffer;
const firebaseApp=initializeApp({apiKey:"AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw",authDomain:"medhaclockin.firebaseapp.com",projectId:"medhaclockin",storageBucket:"medhaclockin.firebasestorage.app",messagingSenderId:"458648237732",appId:"1:458648237732:web:aadb89db358e0cca7b9831"});
const auth=getAuth(firebaseApp); let currentUserId=null; let currentAppUser=null; let launchAuthorized=false;
const $=s=>document.querySelector(s); const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const launchStorageKey="medha-communications-hub-token";
const launchToken=new URLSearchParams(location.hash.slice(1)).get("token")||sessionStorage.getItem(launchStorageKey);
const launchGate=$("#launch-gate");
const SUPABASE_URL="https://nnvyfeckimnjvmeneiro.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_H-o5HRFu3lCq5E9Hf1s3uA_Hi_LaMnY";
const headers={apikey:SUPABASE_ANON_KEY,Authorization:`Bearer ${SUPABASE_ANON_KEY}`};
let conversations=[];
let active=null;
let firebaseIdToken=null;
let streamClient=null;
let videoClient=null;
let activeCall=null;
let incomingCall=null;
let ringTimer=null;
let ringAudioContext=null;
let streamSessionToken=null;
let ringVibrationTimer=null;
let incomingCallTimeout=null;
let outgoingCallTimeout=null;
let outgoingRingSubscription=null;
let activeCallMode="video";
let activeMediaUnbinders=[];
let activeParticipantSubscription=null;
let activeParticipantSessionKey="";
let activeCallParticipantEndSubscription=null;
let activeCallingSubscription=null;
let activeCallMediaEnabled=false;
let activeCallMediaPromise=null;
let activeCallHadRemoteParticipant=false;
let callActivityMessageId=null;
let callActivityChannel=null;
let callActivityMode="video";
let callActivityStartedAt=null;
let callActivityFinalized=false;
let pushSetupPromise=null;
const streamChannels=new Map();
function preferencesKey(){return "medha-communications-preferences-"+(currentUserId||"guest")}
function readPreferences(){try{return {...JSON.parse(localStorage.getItem(preferencesKey())||"{}")}}catch{return {}}}
function soundEnabled(){return readPreferences().sound!==false}
function presenceEnabled(){return readPreferences().presence!==false}
function savePreference(name,value){
  const next={...readPreferences(),[name]:!!value};
  try{localStorage.setItem(preferencesKey(),JSON.stringify(next))}catch{}
  return next;
}
const streamChannelWatchPromises=new Map();
const handledStreamMessageIds=new Set();
let streamConversationsLoadPromise=null;

const WEB_PUSH_PUBLIC_KEY="BHZx1IN2FDoblv8PEfq6fTCORea622j9nL9wSIvX-BI4by1ZYqnXR1TTMNAWcP_xuiuJ0rb-d2u6YNNiHo-c1ak";
const PUSH_SUBSCRIPTION_URL="https://medha-activities.vercel.app/api/push-subscription";
function vapidBytes(value){const padding="=".repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(base64),char=>char.charCodeAt(0))}
async function setupWebPush(user,requestPermission=false){
  if(pushSetupPromise||!user?.getIdToken||!window.isSecureContext||!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))return pushSetupPromise;
  pushSetupPromise=(async()=>{let permission=Notification.permission;if(permission==="default"&&requestPermission)permission=await Notification.requestPermission();if(permission!=="granted")return;const registration=await navigator.serviceWorker.register("/sw.js");let subscription=await registration.pushManager.getSubscription();subscription||=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(WEB_PUSH_PUBLIC_KEY)});const token=await user.getIdToken();const response=await fetch(PUSH_SUBSCRIPTION_URL,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({subscription:subscription.toJSON(),platform:navigator.userAgent})});if(!response.ok)throw Error("Push subscription registration failed")})().catch(error=>console.warn("Medha push is not enabled",error)).finally(()=>{pushSetupPromise=null});
  return pushSetupPromise;
}

async function initializeStream(user){
  const localDev=!user&&location.hostname==="localhost";
  const token=localDev?null:await user.getIdToken();
  const response=await fetchWithTimeout("/api/stream-token",{method:"POST",headers:localDev?{"Content-Type":"application/json","X-Local-Stream-Dev":"true"}:{Authorization:`Bearer ${token}`},body:localDev?JSON.stringify({}):undefined},10000);
  const body=await response.json();
  if(!response.ok)throw Error(body.error||"Could not connect to Stream");
  /* Stream's default request timeout is 3s; cold starts and mobile networks
     can exceed that even when the request is healthy. */
  streamClient=StreamChat.getInstance(body.apiKey,{timeout:10000});
  streamSessionToken=body.token;
  await streamClient.connectUser(body.user,body.token);
  /* Stream is the message source now. Listen globally so a background tab
     receives notifications even when its current channel is not open. A
     service worker/native push provider is still required when the page is
     completely closed. */
  streamClient.on("notification.message_new",event=>{
    applyIncomingStreamMessage(event);
    const message=event.message;
    if(document.visibilityState!=="hidden"||!message)return;
    const row={cid:event.channel?.cid||event.cid,body:message.text||"New message",id:message.id};
    showDesktopNotification(row,event.channel?.name||message.user?.name||"New message");
  });
  setupVideoClient(body);
  return body.user;
}
function streamMessageToApp(message){
  const rawSenderId=String(message.user?.id||"");
  /* Older local development messages used a placeholder ID. Treat those as
     the current local user so legacy messages remain attributed correctly. */
  const senderId=(location.hostname==="localhost"&&(rawSenderId==="medha-local-user"||message.user?.name==="Local Medha User"))?viewerId():rawSenderId;
  const profile=directory.find(person=>String(person.id)===senderId);
  return {id:String(message.id),senderId,who:isMine(senderId)?"me":"them",parentId:message.parent_id||null,pinned:!!message.pinned,callId:message.call_id||null,pollId:message.poll_id||null,poll:message.poll||null,
    senderName:isMine(senderId)?(currentAppUser?.full_name||currentAppUser?.name||"You"):(profile?.full_name||message.user?.name||active?.name||"Unknown user"),text:message.text||"",
    attachments:(message.attachments||[]).map(a=>({kind:a.type==="image"?"image":"file",name:a.title||a.asset_url?.split("/").pop()||"File",url:a.image_url||a.asset_url||a.file_url||a.og_scrape_url})).filter(a=>a.url),
    reactions:(message.latest_reactions||[]).reduce((all,r)=>{const emoji=reactionEmojiFor(r.type);(all[emoji]??=[]).push(r.user_id);return all},{}),createdAt:message.created_at,time:new Date(message.created_at||Date.now()).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})};
}
/* Stream reaction types are identifiers, not arbitrary Unicode strings. Keep
   the visible emoji in the app state while using a reversible safe key on
   Stream, so add, remove, websocket events, and old messages agree. */
function reactionTypeFor(emoji){return "emoji_"+[...String(emoji)].map(char=>char.codePointAt(0).toString(16)).join("_")}
function reactionEmojiFor(type){
  const value=String(type||"");
  if(!value.startsWith("emoji_"))return value;
  try{return value.slice(6).split("_").map(code=>String.fromCodePoint(parseInt(code,16))).join("")}catch{return value}
}
function streamChannelFor(chat){return streamChannels.get(String(chat.cid||chat.id))||null}
function applyIncomingStreamMessage(event){
  const message=event?.message;
  if(!message||String(message.user?.id)===String(viewerId()))return;
  const messageId=String(message.id||"");
  if(messageId&&handledStreamMessageIds.has(messageId))return;
  const cid=event.channel?.cid||event.cid||message.cid;
  const chat=conversations.find(item=>String(item.cid)===String(cid));
  if(!chat){hydrateConversations();return}
  if(messageId){
    handledStreamMessageIds.add(messageId);
    if(handledStreamMessageIds.size>2000)handledStreamMessageIds.delete(handledStreamMessageIds.values().next().value);
  }
  const incoming=streamMessageToApp(message);
  /* Stream unarchives a channel on new activity; mirror that locally so the
     chat does not stay hidden with an unread badge nobody can reach. */
  if(chat.archived)chat.archived=false;
  chat.preview=message.text||"Attachment";
  chat.updatedAt=message.created_at||new Date().toISOString();
  chat.time=new Date(chat.updatedAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  if(active?.cid===chat.cid){
    chat.messages=[...(chat.messages||[]).filter(item=>String(item.id)!==String(incoming.id)),incoming];
    chat.messagesLoaded=true;
    renderMessages();
    scrollMessagesToEnd();
    streamChannelFor(chat)?.markRead().catch(()=>{});
  }else{
    chat.unread=(chat.unread||0)+1;
    if(soundEnabled())playIncomingPing();
    /* mentioned_users comes down with the message, so an @ is counted
       without asking Stream for anything. */
    if((message.mentioned_users||[]).some(user=>String(user.id)===String(viewerId())))
      chat.mentions=(chat.mentions||0)+1;
    /* Only for a chat that is not on screen. Banner-ing the conversation
       the person is already reading would announce a message they can see. */
    showBanner({chatId:chat.id,kind:"message",
      title:chat.kind==="group"?`${incoming.senderName} in ${chat.name}`:incoming.senderName||chat.name,
      body:message.text||"Sent an attachment",
      initials:initialsFor(incoming.senderName||chat.name),color:chat.color});
  }
  renderList();
  writeCache();
}
async function ensureStreamUsers(){
  if(!streamClient||!directory.length)return;
  const users=[{id:viewerId(),name:currentAppUser?.full_name||"Local Medha User"},...directory.map(person=>({id:String(person.id),name:person.full_name,image:person.avatar_url}))];
  const response=await fetch("/api/stream-users",{method:"POST",headers:{"Content-Type":"application/json",...(firebaseIdToken?{Authorization:`Bearer ${firebaseIdToken}`}:{"X-Local-Stream-Dev":"true"})},body:JSON.stringify({users})});
  const body=await response.json();if(!response.ok)throw Error(body.error||"Could not prepare Stream users");
}
async function watchStreamChannel(chat){
  const channel=streamChannelFor(chat)||streamClient.channel("messaging",chat.id,{members:[viewerId(),String(chat.participantId)]});
  streamChannels.set(String(channel.cid),channel);chat.cid=channel.cid;
  const key=String(channel.cid);
  let watchPromise=streamChannelWatchPromises.get(key);
  if(!watchPromise){
    watchPromise=(async()=>{
      await channel.watch();
      channel.on("message.new",event=>{
        if(event.message?.user?.id===viewerId())return;
        applyIncomingStreamMessage({...event,cid:channel.cid,channel:{cid:channel.cid}});
      });
      /* Repaint a poll card the moment anyone votes, so the bars are live for
         everyone in the channel rather than only for whoever clicked. */
      /* Reactions, edits and deletions from other people are pushed down the
         same websocket the channel is already watching, so keeping these in
         sync costs no extra queries. */
      ["reaction.new","reaction.updated","reaction.deleted"].forEach(name=>channel.on(name,event=>{
        const found=findMessageEverywhere(event.message?.id);
        if(!found)return;
        applyLocalReaction(found.message,event.user?.id,name==="reaction.deleted"?null:reactionEmojiFor(event.reaction?.type));
        if(active?.cid===found.chat.cid)renderMessages();
        /* Someone reacting to your message is worth a banner; a removed
           reaction, or one on someone else's message, is not. */
        if(name!=="reaction.deleted"&&String(event.user?.id)!==String(viewerId())
           &&isMine(found.message.senderId)){
          const who=directory.find(person=>String(person.id)===String(event.user?.id));
          const reactorName=who?.full_name||event.user?.name||"Someone";
          showBanner({chatId:found.chat.id,kind:"reaction",
            title:`${reactorName} reacted ${reactionEmojiFor(event.reaction?.type)||""}`.trim(),
            body:String(found.message.text||"your message").replace(/\s+/g," ").slice(0,90),
            initials:initialsFor(reactorName),color:found.chat.color});
          if(soundEnabled())playIncomingPing();
        }
      }));
      channel.on("message.updated",event=>{
        const found=findMessageEverywhere(event.message?.id);
        if(!found)return;
        found.message.text=event.message.text||"";
        found.message._decorated=false;
        if(active?.cid===found.chat.cid)renderMessages();
      });
      channel.on("message.deleted",event=>{
        const id=String(event.message?.id||"");
        const found=findMessageEverywhere(id);
        if(!found)return;
        found.chat.messages=(found.chat.messages||[]).filter(m=>String(m.id)!==id);
        if(active?.cid===found.chat.cid)renderMessages();
        writeCache();
      });
      /* Typing is a transient websocket event - nothing is stored and no
         query is made, so the indicator is free. */
      channel.on("typing.start",event=>{
        if(event.user?.id===viewerId())return;
        setTyping(channel.cid,event.user?.id,event.user?.name,true);
      });
      channel.on("typing.stop",event=>{
        if(event.user?.id===viewerId())return;
        setTyping(channel.cid,event.user?.id,event.user?.name,false);
      });
      ["poll.vote_casted","poll.vote_changed","poll.vote_removed","poll.updated","poll.closed"]
        .forEach(name=>channel.on(name,event=>{
          const poll=event.poll;
          if(!poll?.id)return;
          const message=active?.messages?.find(m=>String(m.pollId)===String(poll.id));
          if(message)message.poll=poll;
          const card=$(`.poll-card[data-poll-card="${CSS.escape(String(poll.id))}"]`);
          if(card)card.outerHTML=pollHtml(poll,message?.id||"");
        }));
      return channel;
    })().catch(error=>{streamChannelWatchPromises.delete(key);throw error});
    streamChannelWatchPromises.set(key,watchPromise);
  }
  await watchPromise;
  return channel;
}

/* ---------- identity ----------
   Every user id in this app is the Firebase uid (text). users.id === uid.
   viewerId() is the ONLY source of truth for "is this message mine". */
function viewerId(){return currentUserId?String(currentUserId):null}
function isMine(senderId){const me=viewerId();return me!==null&&String(senderId)===me}

/* Supabase is reached with the anon key. Once Firebase is registered as a
   third-party auth provider in the Supabase dashboard, flip USE_FIREBASE_JWT
   to true and the RLS policies in supabase-communications-security.sql
   start being enforced per user. Until then the token is sent as a separate
   header that PostgREST ignores, so nothing breaks. */
const USE_FIREBASE_JWT=false;
async function fetchWithTimeout(url,options={},timeoutMs=8000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:options.signal||controller.signal})}
  finally{clearTimeout(timer)}
}
async function db(path,options={}){
  const authHeader=USE_FIREBASE_JWT&&firebaseIdToken?{Authorization:`Bearer ${firebaseIdToken}`}:{};
  const r=await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{...headers,...authHeader,"Content-Type":"application/json",...(options.headers||{})}});
  if(!r.ok){let detail="";try{detail=(await r.text()).slice(0,300)}catch{}throw Error(`Supabase ${r.status}${detail?`: ${detail}`:""}`)}
  if(r.status===204)return null;const t=await r.text();return t?JSON.parse(t):null}

/* A group shows a people glyph rather than initials, which read like a
   person's name and made group chats indistinguishable from direct ones. */
function avatar(c,small=false){
  const group=c?.kind==="group";
  const inner=group
    ?`<svg viewBox="0 0 24 24" aria-hidden="true" class="group-glyph"><circle cx="9" cy="9" r="3.2"/><path d="M3.4 18.2c0-2.7 2.5-4.4 5.6-4.4s5.6 1.7 5.6 4.4"/><circle cx="16.8" cy="10.2" r="2.4"/><path d="M16.8 14.6c2.4 0 4.2 1.4 4.2 3.6"/></svg>`
    :esc(c?.initials||"");
  return `<div class="person-avatar ${c?.color||"blue"}${small?" small":""}${group?" is-group":""}"${group?` title="Group chat"`:""}>${inner}</div>`;
}
function initialsFor(name){return String(name||"?").trim().split(/\s+/).map(x=>x[0]||"").join("").slice(0,2).toUpperCase()||"?"}
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),3200)}

/* ---------- deterministic conversation id ----------
   Both participants derive the SAME id for a direct chat, so user 1 and
   user 2 always read and write one shared conversation row. */
function directConversationId(a,b){const pair=[String(a),String(b)].sort();return `dm_${pair[0]}__${pair[1]}`}

const chatNameCacheKey=()=>`medha-chat-names-${viewerId()||"guest"}`;
function readChatNameCache(){try{return JSON.parse(sessionStorage.getItem(chatNameCacheKey())||"{}")}catch{return{}}}
function writeChatNameCache(cache){try{sessionStorage.setItem(chatNameCacheKey(),JSON.stringify(cache))}catch{}}

/* ---------- local cache ----------
   Keep only non-message sidebar metadata locally. Stream remains the source
   of truth for channels, messages, previews and attachments. */
const CACHE_KEY=()=>`medha-space-cache-${viewerId()||"guest"}`;
const TOP_CHATS_KEY=()=>`medha-top-chats-${viewerId()||"guest"}`;

function readCache(){
  try{
    const raw=localStorage.getItem(CACHE_KEY());
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    /* Remove caches written by older builds so message content is not left
       in this browser after upgrading. */
    if(parsed?.messages||parsed?.conversations?.some(c=>Object.hasOwn(c,"preview"))){
      localStorage.removeItem(CACHE_KEY());
      return null;
    }
    /* Ignore anything older than a day; stale previews are worse than none. */
    if(!parsed?.savedAt||Date.now()-parsed.savedAt>86400000)return null;
    return parsed;
  }catch{return null}
}

function readTopChatsCache(){
  try{
    const parsed=JSON.parse(localStorage.getItem(TOP_CHATS_KEY())||"[]");
    return Array.isArray(parsed)?parsed.slice(0,5):[];
  }catch{return[]}
}

function writeCache(){
  if(!viewerId())return;
  try{
    const ordered=[...conversations].sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
    const payload={
      savedAt:Date.now(),
      activeId:active?.id||null,
      conversations:ordered.map(c=>({
        cid:c.cid,id:c.id,name:c.name,participantId:c.participantId,kind:c.kind,
        initials:c.initials,color:c.color,team:c.team,
        updatedAt:c.updatedAt,unread:c.unread||0,mentions:c.mentions||0,archived:!!c.archived
      }))
    };
    localStorage.setItem(CACHE_KEY(),JSON.stringify(payload));
    /* The ten most recent messages for the five most recent chats, so
       reopening one paints instantly instead of showing a loading line while
       Stream responds. Only fields the renderer needs are kept, and bodies
       are capped, so a long thread cannot blow the storage quota. */
    localStorage.setItem(TOP_CHATS_KEY(),JSON.stringify(ordered.slice(0,5).map(c=>({
      cid:c.cid,id:c.id,name:c.name,participantId:c.participantId,kind:c.kind,
      initials:c.initials,color:c.color,team:c.team,updatedAt:c.updatedAt,
      messages:(c.messages||[]).slice(-10).map(m=>({
        id:m.id,senderId:m.senderId,who:m.who,senderName:m.senderName,
        text:String(m.text||"").slice(0,600),parentId:m.parentId||null,
        pinned:!!m.pinned,pollId:m.pollId||null,
        attachments:(m.attachments||[]).slice(0,6),
        reactions:m.reactions||{},createdAt:m.createdAt,time:m.time}))
    }))));
  }catch{/* quota or private mode - the app works without the cache */}
}

/* Paint from cache before the first network response arrives. */
function hydrateFromCache(){
  const cached=readCache();
  const cachedConversations=cached?.conversations?.length?cached.conversations:readTopChatsCache();
  if(!cachedConversations.length)return false;
  /* Messages already in memory win over anything on disk. This runs again
     every time Chat is re-entered (returning from Favorites, for example),
     and rebuilding the objects from scratch threw away the loaded thread -
     leaving "Loading the latest messages..." with nothing to refetch it,
     because switchChat is not called when the chat is already open. */
  const byId=new Map(conversations.map(c=>[String(c.id),c]));
  const cachedMessagesById=new Map(readTopChatsCache()
    .filter(c=>Array.isArray(c.messages)&&c.messages.length)
    .map(c=>[String(c.id),c.messages]));
  conversations=cachedConversations.map(c=>{
    const live=byId.get(String(c.id));
    if(live?.messagesLoaded&&(live.messages||[]).length)return live;
    const seeded=live?.messages?.length?live.messages:(cachedMessagesById.get(String(c.id))||[]);
    return {...c,...(live||{}),preview:live?.preview||c.preview||"",
      messages:seeded,
      /* Seeded messages are shown immediately but still marked fromCache, so
         switchChat refreshes them from the server rather than trusting disk. */
      messagesLoaded:seeded.length>0,
      messageOffset:seeded.length,
      hasMore:true,
      fromCache:true};
  });
  active=conversations.find(c=>c.id===(active?.id||cached.activeId))||conversations[0]||null;
  renderList();
  if(active){renderMessages();scrollMessagesToEnd()}
  return true;
}

/* ---------- rendering ---------- */
/* All / Unread / Pinned filter for the sidebar tabs. */
let chatFilter="all";
document.querySelectorAll(".sidebar-tabs .tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    document.querySelectorAll(".sidebar-tabs .tab").forEach(t=>t.classList.remove("active"));
    tab.classList.add("active");
    chatFilter=tab.textContent.trim().toLowerCase();
    renderList();
  });
});

function renderList(){
  const q=$("#chat-search").value.trim().toLowerCase();
  const favorites=JSON.parse(sessionStorage.getItem(`medha-favorites-${viewerId()||"guest"}`)||"[]");
  const pinned=pinnedIds();
  const rank=new Map(pinned.map((id,i)=>[String(id),i]));
  const now=new Date();
  conversations.forEach(c=>{
    if(!c.updatedAt)return;
    const u=new Date(c.updatedAt);
    const sameDay=u.toDateString()===now.toDateString();
    c.time=sameDay?u.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})
      :u.toLocaleDateString([],{month:"short",day:"numeric",year:u.getFullYear()===now.getFullYear()?undefined:"numeric"});
  });
  const ordered=[...conversations].sort((a,b)=>{
    const ap=rank.has(String(a.id)),bp=rank.has(String(b.id));
    if(ap!==bp)return ap?-1:1;
    if(ap)return rank.get(String(a.id))-rank.get(String(b.id));
    return new Date(b.updatedAt||0)-new Date(a.updatedAt||0);
  });
  const shown=ordered.filter(c=>{
    if(q&&!`${c.name} ${c.preview}`.toLowerCase().includes(q))return false;
    if(chatFilter==="archived")return !!c.archived;
    /* An archived chat stays out of every other tab until it is unarchived
       or someone sends into it again. */
    if(chatFilter==="pinned")return rank.has(String(c.id));
    if(c.archived&&!rank.has(String(c.id)))return false;
    if(chatFilter==="unread")return !!c.unread;
    if(chatFilter==="favorites")return favorites.includes(String(c.id));
    return true;
  });
  const people=q?directory.filter(person=>String(person.id)!==String(viewerId())&&`${person.full_name} ${person.email||""} ${person.department||""}`.toLowerCase().includes(q)&&!shown.some(chat=>String(chat.participantId)===String(person.id))):[];
  $("#chat-list").innerHTML=shown.length?shown.map(c=>{
    const state=c.kind==="group"?"":presenceFor(c.participantId);
    const pinned=rank.has(String(c.id));
    return `<div class="chat-item ${active&&c.id===active.id?"selected":""}" data-id="${esc(c.id)}">
      <div class="avatar-stack">${avatar(c)}${c.kind==="group"||state==="hidden"?"":`<i class="presence-dot ${state}" title="${state}"></i>`}</div>
      <div class="chat-copy">
        <div class="chat-line">
          <strong>${pinned?'<span class="chat-pin" title="Pinned">\u{1F4CC}</span>':""}${favorites.includes(c.id)?'<span class="chat-fav">\u2605</span>':""}${esc(c.name)}</strong>
          <time>${esc(c.time||"")}</time>
        </div>
        <div class="chat-line-2">
          <p>${esc(c.preview||"")}</p>
          ${c.mentions?`<span class="mention-badge" title="${c.mentions} mention${c.mentions===1?"":"s"}">@${c.mentions>9?"9+":c.mentions}</span>`:""}
          ${c.unread?`<span class="unread-badge">${c.unread>9?"9+":c.unread}</span>`:""}
        </div>
      </div>
    </div>`}).join("")
    :`<p class="empty">${chatFilter==="unread"?"No unread conversations found"
       :chatFilter==="archived"?"No archived conversations found"
       :chatFilter==="pinned"?"No pinned conversations found"
       :chatFilter==="favorites"?"No favorites found"
       :q?(people.length?"":"No conversations found")
       :"No conversations found"}</p>`;
  if(people.length){
    const heading=document.createElement("p");heading.className="search-result-heading";heading.textContent="People";$("#chat-list").prepend(heading);
    $("#chat-list").insertAdjacentHTML("beforeend",people.map(person=>{const state=presenceFor(person.id);return `<div class="chat-item search-person" data-person-id="${esc(person.id)}"><div class="avatar-stack"><span class="person-avatar blue">${esc(initialsFor(person.full_name))}</span>${state==="hidden"?"":`<i class="presence-dot ${state}"></i>`}</div><div class="chat-copy"><div class="chat-line"><strong>${esc(person.full_name)}</strong><time>Start chat</time></div></div></div>`}).join(""));
  }
}

/* ---------- polls ----------
   Renders a poll as a card with a "Poll" tag and one bar per option. Bars
   fill to each option's share of the vote and update live as votes arrive,
   so everyone sees the running result without reopening anything. */
function pollHtml(poll,messageId){
  if(!poll)return "";
  const options=poll.options||[];
  /* Stream reports tallies in vote_counts_by_option, keyed by option id. */
  const counts=poll.vote_counts_by_option||{};
  const total=Object.values(counts).reduce((sum,n)=>sum+(Number(n)||0),0);
  const me=viewerId();
  /* own_votes tells us what this viewer picked, so their choice is marked. */
  const mine=new Set((poll.own_votes||[]).map(v=>String(v.option_id)));
  const closed=!!poll.is_closed;
  const rows=options.map(option=>{
    const id=String(option.id);
    const votes=Number(counts[id]||0);
    const share=total?Math.round((votes/total)*100):0;
    const chosen=mine.has(id);
    return `<button type="button" class="poll-option${chosen?" chosen":""}" data-poll-id="${esc(poll.id||"")}" data-option-id="${esc(id)}" data-message-id="${esc(messageId||"")}"${closed?" disabled":""}>
      <span class="poll-bar" style="width:${share}%"></span>
      <span class="poll-row">
        <span class="poll-text">${chosen?'<span class="poll-check">✓</span>':""}${esc(option.text||"")}</span>
        <span class="poll-count">${share}%<small>${votes}</small></span>
      </span>
    </button>`;
  }).join("");
  return `<div class="poll-card" data-poll-card="${esc(poll.id||"")}">
    <div class="poll-head"><span class="poll-tag">Poll</span>${closed?'<span class="poll-closed">Closed</span>':""}</div>
    <strong class="poll-question">${esc(poll.name||poll.question||"Poll")}</strong>
    <div class="poll-options">${rows}</div>
    <div class="poll-total">${total} vote${total===1?"":"s"}${closed?" · final":""}</div>
  </div>`;
}

function messageHtml(m){
  const mine=m.who==="me";
  const links=(m.attachments||[]).length?m.attachments:((m.text||"").match(/https?:\/\/[^\s]+/g)||[]).filter(u=>/\.gif(?:$|\?)/i.test(u)||/giphy\.com|tenor\.com/i.test(u)).map(url=>({kind:"gif",url,name:"GIF"}));
  const reply=m.parentId?active?.messages?.find(item=>String(item.id)===String(m.parentId)):null;
  /* The quoted message is rendered as its own block above the reply text
     rather than being prepended into m.text - editing the stored text meant
     the quote was saved into the message body and could be double-applied. */
  if(!m._decorated){if(m.pinned&&!String(m.text||"").startsWith("📌"))m.text="📌 "+m.text;m._decorated=true}
  const quoted=reply?`<button type="button" class="reply-quote" data-jump-to="${esc(reply.id||"")}">
      <svg class="reply-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h7a9 9 0 0 1 9 9v2"/></svg>
      <span class="reply-quote-body"><span class="reply-quote-name">${esc(reply.senderName||"Unknown user")}</span><span class="reply-quote-text">${esc((reply.text||"Attachment").replace(/\s+/g," ").slice(0,120))}</span></span>
    </button>`:"";
  /* In a group each message shows its own sender, not the group glyph -
     otherwise every bubble would carry the same icon. */
  const who=mine
    ?{initials:initialsFor(currentAppUser?.full_name||"You"),color:"blue"}
    :active?.kind==="group"
      ?{initials:initialsFor(m.senderName||"?"),color:"blue"}
      :{initials:active?.initials,color:active?.color};
  const reactions=Object.entries(m.reactions||{}).filter(([,u])=>Array.isArray(u)&&u.length);
  const pollCard=m.poll?pollHtml(m.poll,m.id):"";
  /* Replies already show inline (show_in_channel), so the thread footer is
     an extra way to read one conversation on its own - counted from the
     messages already loaded, never from a query. */
  const replyCount=(active?.messages||[]).filter(item=>String(item.parentId||"")===String(m.id)).length;
  const threadFooter=replyCount?`<button type="button" class="thread-open" data-thread-id="${esc(m.id||"")}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-4.2-1L3 20l1.2-4.6A8.4 8.4 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>
      ${replyCount} ${replyCount===1?"reply":"replies"}
    </button>`:"";
  return `<div class="message ${mine?"mine":""}" data-message-id="${esc(m.id||"")}">${avatar(who,true)}<div class="message-body"><div class="message-meta"><strong>${esc(m.senderName||active?.name||"Unknown user")}</strong><time>${esc(m.time)}</time></div>${pollCard}${quoted?`<div class="bubble bubble-reply">${quoted}<span class="reply-body">${esc(m.text||"")}</span></div>`:""}${m.text&&!m.poll&&!quoted?`<div class="bubble">${esc(m.text)}</div>`:""}${attachmentsHtml(links)}${reactions.length?`<div class="stored-reactions">${reactions.map(([emoji,users])=>`<span class="${users.map(String).includes(viewerId())?"by-me":""}" data-reaction-toggle="${esc(emoji)}" title="${users.length} reaction${users.length===1?"":"s"}${users.map(String).includes(viewerId())?" - select to remove yours":""}">${emoji}${users.length>1?` ${users.length}`:""}</span>`).join("")}</div>`:""}${threadFooter}</div></div>`;
}

/* ---------- thread view (replies only) ----------
   Every reply is already in active.messages because it is sent with
   show_in_channel, so opening a thread reads local state and makes no
   Stream call. getReplies is used only when a parent's replies predate
   show_in_channel and are therefore missing locally. */
let threadParentId=null;
const threadPanel=document.createElement("aside");
threadPanel.className="thread-panel";threadPanel.hidden=true;threadPanel.setAttribute("aria-hidden","true");
threadPanel.innerHTML=`<div class="thread-head"><h3>Thread</h3><button type="button" class="thread-close" aria-label="Close thread">&times;</button></div>
  <div class="thread-body" id="thread-body"></div>
  <form class="thread-composer" id="thread-composer"><textarea id="thread-input" rows="1" placeholder="Reply in thread" aria-label="Reply in thread"></textarea><button type="submit" class="send-button">Send</button></form>`;
document.body.append(threadPanel);
threadPanel.querySelector(".thread-close").addEventListener("click",()=>closeThread());

function closeThread(){
  threadParentId=null;threadPanel.hidden=true;threadPanel.setAttribute("aria-hidden","true");
  document.body.classList.remove("thread-open");
}
function threadMessages(){
  const parent=(active?.messages||[]).find(m=>String(m.id)===String(threadParentId));
  if(!parent)return null;
  const replies=(active.messages||[])
    .filter(m=>String(m.parentId||"")===String(parent.id))
    .sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  return {parent,replies};
}
function renderThread(){
  if(!threadParentId){closeThread();return}
  const found=threadMessages();
  if(!found){closeThread();return}
  const {parent,replies}=found;
  const row=m=>`<div class="thread-message ${m.who==="me"?"mine":""}" data-message-id="${esc(m.id||"")}">
      <div class="thread-meta"><strong>${esc(m.senderName||"Unknown user")}</strong><time>${esc(m.time||"")}</time></div>
      <div class="bubble">${esc(m.text||"Attachment")}</div>
      ${attachmentsHtml(m.attachments)}
    </div>`;
  $("#thread-body").innerHTML=`<div class="thread-parent">${row(parent)}</div>
    <div class="thread-count">${replies.length} ${replies.length===1?"reply":"replies"}</div>
    ${replies.map(row).join("")}`;
  const body=$("#thread-body");body.scrollTop=body.scrollHeight;
}
async function openThread(parentId){
  if(!active)return;
  if(document.body.classList.contains("details-open"))closeDetails();
  threadParentId=String(parentId);
  threadPanel.hidden=false;threadPanel.setAttribute("aria-hidden","false");
  document.body.classList.add("thread-open");
  renderThread();
  /* Replies written before show_in_channel existed live only inside the
     thread. Pull them once, merge into the conversation, and they stay
     available inline too. */
  const parent=(active.messages||[]).find(m=>String(m.id)===String(threadParentId));
  const channel=streamChannelFor(active);
  if(!parent||!channel||parent._threadFetched)return;
  parent._threadFetched=true;
  try{
    const thread=await channel.getReplies(parent.id,{limit:100});
    const seen=new Set((active.messages||[]).map(m=>String(m.id)));
    const added=(thread?.messages||[]).filter(reply=>!seen.has(String(reply.id))).map(streamMessageToApp);
    if(!added.length)return;
    active.messages=[...active.messages,...added].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    renderMessages();renderThread();
  }catch{/* the inline copies already on screen are enough */}
}
document.addEventListener("click",e=>{
  const button=e.target.closest("[data-thread-id]");
  if(button){e.preventDefault();openThread(button.dataset.threadId)}
});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&threadParentId)closeThread()});
$("#thread-body").addEventListener("click",e=>{
  const button=e.target.closest("[data-open-attachment]");
  if(!button)return;
  e.preventDefault();
  openAttachmentPreview({url:button.dataset.openAttachment,name:button.dataset.attachmentName,kind:button.dataset.attachmentKind});
});
$("#thread-input").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#thread-composer").requestSubmit()}
});
let threadSending=false;
$("#thread-composer").addEventListener("submit",async e=>{
  e.preventDefault();
  if(threadSending||!active||!threadParentId)return;
  const input=$("#thread-input"),text=input.value.trim();
  if(!text)return;
  threadSending=true;
  try{
    /* show_in_channel keeps the reply visible in the main list too, so the
       thread never becomes a place messages hide. */
    const saved=await persistMessage(active,text,[],{parent_id:threadParentId,show_in_channel:true});
    input.value="";
    if(saved&&!active.messages.some(m=>String(m.id)===String(saved.id))){active.messages.push(saved);active.messagesLoaded=true}
    renderList();renderMessages();renderThread();scrollMessagesToEnd();
  }catch(error){toast(error.message)}
  finally{threadSending=false;input.focus()}
});

/* Sent attachments. Images go in a grid that adapts to how many there are
   (one large, two side by side, three or more in a tight grid), files get a
   row with a glyph, name and size. Both open the same preview lightbox. */
function attachmentsHtml(list){
  const items=(list||[]).filter(a=>a?.url);
  if(!items.length)return "";
  const images=items.filter(a=>a.kind==="image"||a.kind==="gif");
  const files=items.filter(a=>!(a.kind==="image"||a.kind==="gif"));
  const grid=images.length?`<div class="message-media count-${Math.min(images.length,4)}">${images.map(a=>
    `<button type="button" class="media-tile" data-open-attachment="${esc(a.url)}" data-attachment-name="${esc(a.name||"")}" data-attachment-kind="${esc(a.kind||"")}">
      <img src="${esc(a.url)}" alt="${esc(a.name||"Attached image")}" loading="lazy">
      ${a.kind==="gif"?'<span class="media-badge">GIF</span>':""}
    </button>`).join("")}</div>`:"";
  const rows=files.map(a=>`<button type="button" class="message-file" data-open-attachment="${esc(a.url)}" data-attachment-name="${esc(a.name||"")}" data-attachment-kind="${esc(a.kind||"")}">
      <span class="file-glyph">${fileGlyph(a.name,a.kind)}</span>
      <span class="file-copy"><strong>${esc(a.name||"Attached file")}</strong><small>${esc(fileSizeLabel(a.size)||"Open")}</small></span>
      <span class="file-download" aria-hidden="true">\u2193</span>
    </button>`).join("");
  return grid+rows;
}
/* Opening a sent attachment uses the same lightbox as a pending one. */
$("#message-area").addEventListener("click",e=>{
  const button=e.target.closest("[data-open-attachment]");
  if(!button)return;
  e.preventDefault();
  openAttachmentPreview({url:button.dataset.openAttachment,name:button.dataset.attachmentName,kind:button.dataset.attachmentKind});
});

function dayLabel(date){
  const d=new Date(date),now=new Date();
  const diff=Math.round((new Date(now.toDateString())-new Date(d.toDateString()))/86400000);
  if(diff===0)return "Today"; if(diff===1)return "Yesterday";
  return d.toLocaleDateString([],{weekday:"long",month:"short",day:"numeric",year:d.getFullYear()===now.getFullYear()?undefined:"numeric"});
}

/* ---------- chat details panel ---------- */
function detailRow(label,value){
  return value?`<div class="detail-fact"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`:"";
}
function favoriteIds(){
  try{return JSON.parse(sessionStorage.getItem("medha-favorites-"+(viewerId()||"guest"))||"[]").map(String)}catch{return []}
}
function toggleFavorite(chat){
  if(!chat)return;
  const id=String(chat.id),key="medha-favorites-"+(viewerId()||"guest"),items=favoriteIds();
  const next=items.includes(id)?items.filter(item=>item!==id):[...items,id];
  sessionStorage.setItem(key,JSON.stringify(next));
  renderList();
  if(active?.id===chat.id)renderDetailsPanel();
  toast(next.includes(id)?"Added to favorites":"Removed from favorites");
}
function renderDetailsPanel(){
  if(!active)return;
  const person=directory.find(p=>String(p.id)===String(active.participantId));
  const isGroup=active.kind==="group";
  const isSelf=String(active.participantId)===String(viewerId());
  const status=$("#conversation-status").textContent||"";
  const media=(active.messages||[]).flatMap(m=>m.attachments||[]);
  const creatorId=String(active.createdById||"");
  const creator=directory.find(p=>String(p.id)===creatorId);
  const creatorName=creator?.full_name||(creatorId===String(viewerId())?currentAppUser?.full_name:"")||active.createdByName||"Unknown";
  const facts=isGroup
    ?[detailRow("Name",active.name),detailRow("Created by",creatorName),detailRow("Members",String((active.participantIds||[]).length))].filter(Boolean).join("")
    :[detailRow("Name",active.name),detailRow("Status",isSelf?"This is you":status),detailRow("Email",person?.email)].filter(Boolean).join("");
  const facts_el=$("#details-facts");
  if(facts_el)facts_el.innerHTML=facts||'<div class="directory-empty">No details available</div>';
  const contactTitle=$("#contact-details-title");
  if(contactTitle)contactTitle.textContent=isGroup?"Group":"Contact";
  const membersSection=$("#group-members-section");
  const membersList=$("#group-members-list");
  if(membersSection)membersSection.hidden=!isGroup;
  if(membersList&&isGroup){
    const members=(active.participantIds||[]).map(id=>{
      const member=directory.find(p=>String(p.id)===String(id));
      const name=member?.full_name||(String(id)===String(viewerId())?currentAppUser?.full_name:"")||"Unknown user";
      return '<div class="group-member"><span class="person-avatar blue small">'+esc(initialsFor(name))+'</span><strong>'+esc(name)+'</strong>'+(String(id)===creatorId?'<span class="group-owner">Creator</span>':"")+'</div>';
    });
    membersList.innerHTML=members.join("")||'<div class="directory-empty">No members found</div>';
  }
  const presence=$(".details-person .presence");
  if(presence&&isGroup){presence.textContent="";presence.hidden=true}
  if(presence&&!isGroup)presence.hidden=false;
  if(presence&&isSelf){presence.textContent="This is you";presence.className="presence"}
  $("#shared-media").innerHTML=media.length
    ?media.map(a=>a.kind==="gif"
      ?`<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name||"GIF")}"><img src="${esc(a.url)}" alt="Shared GIF" loading="lazy"></a>`
      :`<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name||"File")}">📎 ${esc(a.name||"File")}</a>`).join("")
    :'<div class="directory-empty">No shared media</div>';
  const favoriteButton=$("#details-favorite"),favoriteLabel=$("#details-favorite-label");
  if(favoriteButton&&favoriteLabel){
    const favorite=favoriteIds().includes(String(active.id));
    favoriteLabel.textContent=favorite?"★ Remove from favorites":"☆ Add to favorites";
    favoriteButton.setAttribute("aria-pressed",String(favorite));
  }
}
function renderConversationSearch(query=""){
  const host=$("#conversation-search-results");
  if(!host)return;
  const term=query.trim().toLowerCase();
  if(!term){host.innerHTML='<div class="directory-empty">Type to search this conversation.</div>';return}
  const matches=(active?.messages||[]).filter(message=>{
    const attachments=(message.attachments||[]).map(file=>file.name||"").join(" ");
    return (String(message.text||"")+" "+String(message.senderName||"")+" "+attachments).toLowerCase().includes(term);
  }).slice().reverse();
  host.innerHTML=matches.length?matches.map(message=>'<button type="button" class="conversation-search-result" data-search-message-id="'+esc(message.id||"")+'"><span><strong>'+esc(message.senderName||"Unknown user")+'</strong><time>'+esc(message.time||"")+'</time></span><span>'+esc(message.text||((message.attachments||[])[0]?.name||"Attachment"))+'</span></button>').join(""):'<div class="directory-empty">No matching messages.</div>';
}
function openConversationSearch(){
  if(!active){toast("Select a conversation first");return}
  const dialog=$("#conversation-search-dialog"),input=$("#conversation-search-input");
  input.value="";renderConversationSearch();dialog.showModal();requestAnimationFrame(()=>input.focus());
}
function openDetails(){
  if(!active){toast("Select a conversation first");return}
  renderDetailsPanel();
  if(isMobile())document.body.classList.add("details-page");
  $("#details-panel").classList.add("open");
  $("#details-panel").classList.remove("closed");
  document.body.classList.add("details-open");
}
function closeDetails(){
  document.body.classList.remove("details-page");
  $("#details-panel").classList.remove("open");
  $("#details-panel").classList.add("closed");
  document.body.classList.remove("details-open");
}
function toggleDetails(){
  document.body.classList.contains("details-open")?closeDetails():openDetails();
}

function renderMessages(){
  const area=$("#message-area");
  if(!active){
    $("#conversation-name").textContent="No conversation selected";
    $("#details-name").textContent="No conversation selected";
    $("#conversation-status").textContent="";
    area.innerHTML='<div class="empty-state"><strong>No conversation selected</strong><p>Your conversations appear here once you start or receive a chat.</p></div>';
    return;
  }
  $("#conversation-name").textContent=active.name;
  $("#details-name").textContent=active.name;
  setPresenceLabel();
  renderDetailsPanel();
  const headerAvatar=$(".conversation-header .person-avatar"); if(headerAvatar)headerAvatar.outerHTML=avatar(active);
  const detailAvatar=$(".details-person .person-avatar"); if(detailAvatar)detailAvatar.outerHTML=avatar(active,false);
  /* Shared media is painted by renderDetailsPanel() just above; writing it
     again here overwrote that richer markup with plain links. */

  if(!active.messagesLoaded){area.innerHTML='<div class="directory-loading">Loading the latest messages…</div>';return}
  const msgs=active.messages||[];
  if(!msgs.length){area.innerHTML='<div class="empty-state"><strong>No messages yet</strong><p>Send the first message to start this conversation.</p></div>';return}
  let html=active.hasMore?'<div class="load-more-hint">Scroll up to load earlier messages</div>':"";
  let lastDay="";
  msgs.forEach(m=>{
    const label=m.createdAt?dayLabel(m.createdAt):"Today";
    if(label!==lastDay){html+=`<div class="date-divider"><span>${esc(label)}</span></div>`;lastDay=label}
    html+=messageHtml(m);
  });
  area.innerHTML=html;
}

let stickToBottom=true;
function scrollMessagesToEnd(){
  const area=$("#message-area");
  if(!area)return;
  stickToBottom=true;
  /* Jump immediately, then again after layout and once more after images
     and fonts settle - otherwise the height is still growing and the view
     ends up part-way up the thread. */
  area.scrollTop=area.scrollHeight;
  requestAnimationFrame(()=>{
    area.scrollTop=area.scrollHeight;
    setTimeout(()=>{area.scrollTop=area.scrollHeight},60);
  });
  /* An attached image that decodes late would otherwise push the newest
     message below the fold. */
  area.querySelectorAll("img").forEach(img=>{
    if(img.complete)return;
    img.addEventListener("load",()=>{if(stickToBottom)area.scrollTop=area.scrollHeight},{once:true});
  });
}

/* ---------- message loading (server is the source of truth) ---------- */
const PAGE_SIZE=25;
function mapRow(m,nameFor){
  return {id:String(m.id),senderId:String(m.sender_id),who:isMine(m.sender_id)?"me":"them",
    senderName:isMine(m.sender_id)?"You":(nameFor?.(m.sender_id)||active?.name||""),
    text:m.body||"",attachments:Array.isArray(m.attachments)?m.attachments:[],reactions:m.reactions||{},
    createdAt:m.created_at,time:new Date(m.created_at).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})};
}
async function fetchMessagePage(cid,offset=0){
  if(!streamClient)throw Error("Stream is not connected; chat history is unavailable");
  if(streamClient){
    const channel=streamChannels.get(String(cid));
    if(!channel)throw Error("Stream channel is not open");
    const state=await channel.query({messages:{limit:PAGE_SIZE,offset}});
    let messages=(state.messages||[]).map(streamMessageToApp);
    /* Replies sent before show_in_channel was set live inside their thread
       and never come back from channel.query(). Pull the replies for any
       message that has them so older conversations stay complete. */
    const parents=(state.messages||[]).filter(m=>Number(m.reply_count)>0);
    if(parents.length){
      const seen=new Set(messages.map(m=>String(m.id)));
      const threads=await Promise.all(parents.map(parent=>
        channel.getReplies(parent.id,{limit:50}).catch(()=>null)));
      threads.forEach(thread=>(thread?.messages||[]).forEach(reply=>{
        if(seen.has(String(reply.id)))return;
        seen.add(String(reply.id));
        messages.push(streamMessageToApp(reply));
      }));
      messages.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    }
    return {messages,hasMore:(state.messages||[]).length===PAGE_SIZE};
  }
  const cols="id,sender_id,body,attachments,reactions,created_at";
  const query=extra=>`medha_communications_messages?cid=eq.${encodeURIComponent(cid)}&select=${extra}&order=created_at.desc,id.desc&offset=${offset}&limit=${PAGE_SIZE}`;
  let rows;
  try{rows=await db(query(cols))}
  catch(error){if(!String(error.message).includes("Supabase 400"))throw error;rows=await db(query("id,sender_id,body,created_at"))}
  rows=rows||[];
  return {messages:rows.slice().reverse().map(m=>mapRow(m)),hasMore:rows.length===PAGE_SIZE};
}
async function loadChatPage(chat,offset=0){
  if(chat.loadingMessages)return;
  chat.loadingMessages=true;
  try{
    const page=await fetchMessagePage(chat.cid,offset);
    if(offset===0)chat.messages=page.messages;
    else{
      const seen=new Set(chat.messages.map(m=>m.id));
      chat.messages=[...page.messages.filter(m=>!seen.has(m.id)),...chat.messages];
    }
    chat.messageOffset=chat.messages.length;
    chat.hasMore=page.hasMore;
    chat.messagesLoaded=true;
    if(active?.id===chat.id)renderMessages();
    writeCache();
  }finally{chat.loadingMessages=false}
}

/* Refresh the open conversation from the server. Server rows replace local
   state entirely, so a message is never re-attributed to the wrong sender. */
async function refreshActiveMessages(){
  if(!active||active.loadingMessages)return;
  const chat=active,before=chat.messages?.length||0;
  const atBottom=(()=>{const a=$("#message-area");return a.scrollHeight-a.scrollTop-a.clientHeight<80})();
  const page=await fetchMessagePage(chat.cid,0);
  const older=(chat.messages||[]).filter(m=>m.id&&!page.messages.some(p=>p.id===m.id));
  const keptOlder=older.filter(m=>page.messages.length===0||new Date(m.createdAt)<new Date(page.messages[0].createdAt));
  chat.messages=[...keptOlder,...page.messages];
  chat.messagesLoaded=true;
  chat.hasMore=chat.hasMore||page.hasMore;
  if(active?.id===chat.id){renderMessages();if(atBottom||chat.messages.length!==before)scrollMessagesToEnd()}
}

/* ---------- sending ---------- */
async function ensureConversationRow(chat){
  if(chat.cid)return chat.cid;
  const participants=[...new Set([viewerId(),chat.participantId].filter(Boolean).map(String))].sort();
  /* A direct thread needs both people. Writing a one-participant row
     creates a conversation nobody can reply in - that is what left the
     orphaned "Conversation" rows in the sidebar. */
  if((chat.kind||"direct")==="direct"&&participants.length<2)
    throw Error("Could not identify who this chat is with. Reopen it from the directory.");
  const existing=await db(`medha_communications_conversations?id=eq.${encodeURIComponent(chat.id)}&select=cid,participant_ids`);
  if(existing?.length){chat.cid=existing[0].cid;return chat.cid}
  /* resolution=merge-duplicates makes this safe when both people open the
     same new chat at once - the unique key on id decides one winner. */
  const created=await db("medha_communications_conversations",
    {method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},
     body:JSON.stringify({id:chat.id,title:chat.name,kind:chat.kind||"direct",participant_ids:participants})});
  chat.cid=created?.[0]?.cid;
  if(!chat.cid){
    const row=await db(`medha_communications_conversations?id=eq.${encodeURIComponent(chat.id)}&select=cid`);
    chat.cid=row?.[0]?.cid;
  }
  if(!chat.cid)throw Error("Could not open that conversation");
  return chat.cid;
}

/* Turns "@Full Name" in the body into Stream user ids. Only people who are
   actually in the channel can be mentioned, so an @ in a direct chat cannot
   silently notify a third party. Longest name first, so "@Anil Kumar Rao"
   is not matched as "@Anil Kumar". */
function resolveMentions(chat,body){
  const text=String(body||"").toLowerCase();
  if(!text.includes("@"))return [];
  const members=new Set((chat.participantIds||[chat.participantId]).filter(Boolean).map(String));
  const found=new Set();
  let remaining=text;
  directory.slice()
    .filter(person=>person.full_name&&members.has(String(person.id))&&String(person.id)!==String(viewerId()))
    .sort((a,b)=>b.full_name.length-a.full_name.length)
    .forEach(person=>{
      const needle="@"+person.full_name.toLowerCase();
      if(!remaining.includes(needle))return;
      found.add(String(person.id));
      remaining=remaining.split(needle).join(" ");
    });
  return [...found];
}

async function persistMessage(chat,text,attachments,extra={}){
  if(!streamClient)throw Error("Stream is not connected; messages were not sent");
  if(streamClient){
    const body=(text||"").trim()||(attachments?.length?"Attachment":"");
    if(!body)throw Error("Enter a message before sending");
    const channel=await watchStreamChannel(chat);
    const mentionIds=resolveMentions(chat,body);
    const saved=await channel.sendMessage({text:body,attachments:(attachments||[]).map(a=>({type:a.kind==="image"?"image":"file",title:a.name,asset_url:a.url})),...(mentionIds.length?{mentioned_users:mentionIds}:{}),...extra});
    chat.preview=body.slice(0,120);chat.updatedAt=new Date().toISOString();
    return streamMessageToApp(saved.message);
  }
  const me=viewerId();
  if(!me)throw Error("Sign in to Medha Hub before sending messages");
  const body=(text||"").trim()||(attachments?.length?"Attachment":"");
  if(!body)throw Error("Enter a message before sending");
  if(body.length>4000)throw Error("Message is too long (4000 characters maximum)");
  const cid=await ensureConversationRow(chat);
  const base={cid,sender_id:me,body};
  const post=payload=>db("medha_communications_messages",
    {method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
  let saved;
  try{
    saved=await post({...base,attachments:attachments||[]});
  }catch(error){
    const message=String(error.message);
    /* Older databases still carry the pre-compaction text key alongside
       cid, and it is NOT NULL, so an insert without it is rejected. Send
       both until supabase-communications-fix-send.sql has been applied. */
    if(message.includes("conversation_id")){
      const legacy={...base,conversation_id:chat.id,attachments:attachments||[]};
      try{saved=await post(legacy)}
      catch(retry){
        if(!String(retry.message).includes("Supabase 400"))throw retry;
        saved=await post({...legacy,attachments:undefined});
      }
    }else if(message.includes("Supabase 400")){
      /* Attachments column missing on very old databases. */
      saved=await post(base);
    }else throw error;
  }
  /* last_message and updated_at are set by a database trigger, so there is
     no follow-up PATCH and no second copy of the preview to keep in sync. */
  chat.preview=body.slice(0,120);
  chat.updatedAt=new Date().toISOString();
  writeCache();
  return saved?.[0]?mapRow(saved[0]):null;
}

/* ---------- conversation list ---------- */
/* One read for the whole sidebar: the view already joins membership to the
   conversation, so opening Space is
     1. select from my_conversations where user_id = me
     2. select messages for the conversation you actually open
   The directory is fetched once and cached, not on every 5s poll. */
let directoryLoadedAt=0;
async function ensureDirectory(){
  if(directory.length&&Date.now()-directoryLoadedAt<10*60*1000)return directory;
  try{
    const rows=await db("users?select=id,full_name,email,department,role&is_active=eq.true&order=full_name.asc");
    directory=(rows||[]).filter(x=>x.full_name);
    directoryLoadedAt=Date.now();
    const cache=readChatNameCache();
    directory.forEach(p=>{cache[String(p.id)]=p.full_name});
    writeChatNameCache(cache);
  }catch{}
  return directory;
}

async function hydrateConversations(){
  if(streamConversationsLoadPromise)return streamConversationsLoadPromise;
  const me=viewerId();
  if(!me){conversations=[];active=null;renderList();renderMessages();return}
  if(!streamClient){conversations=[];active=null;renderList();renderMessages();return}
  if(streamClient){
    streamConversationsLoadPromise=(async()=>{try{
      await ensureDirectory();
      await ensureStreamUsers();
      const channels=await streamClient.queryChannels({type:"messaging",members:{$in:[me]}},{last_message_at:-1},{limit:100});
      const nameOf=id=>directory.find(p=>String(p.id)===String(id))?.full_name||readChatNameCache()[String(id)]||"";
      const loaded=channels.map(channel=>{
        streamChannels.set(String(channel.cid),channel);
        const members=Object.keys(channel.state?.members||channel.data?.members||{}).filter(id=>id!==me);
        const other=members[0]||me;
        const name=channel.data?.name||nameOf(other)||"Conversation";
        const last=channel.state?.messages?.at(-1);
        const participantIds=Object.keys(channel.state?.members||channel.data?.members||{});
        const kind=participantIds.length>2?"group":"direct";
        return {cid:channel.cid,id:channel.id,name,participantId:other,participantIds,createdById:channel.data?.created_by?.id||channel.data?.created_by_id||channel.created_by?.id||"",createdByName:channel.data?.created_by?.name||channel.created_by?.name||"",kind,initials:initialsFor(name),color:kind==="group"?"purple":"blue",team:kind==="group"?"Group chat":"",
          preview:last?.text||"",updatedAt:channel.data?.last_message_at||channel.data?.updated_at||new Date().toISOString(),time:"",unread:channel.countUnread?.()||0,
          /* Stream tracks mentions against the read state it already holds
             from queryChannels, so this is a local read, not a request. */
          mentions:channel.countUnreadMentions?.()||0,
          archived:!!(channel.data?.archived||channel.state?.membership?.archived_at),
          messages:[],messagesLoaded:false,messageOffset:0,hasMore:true,streamChannel:channel};
      });
      const previousCid=active?.cid;conversations=loaded;active=conversations.find(c=>c.cid===previousCid)||null;
      writeCache();
      renderList();renderMessages();return;
    }catch(error){toast(`Stream unavailable: ${error.message}`);return}})();
    try{await streamConversationsLoadPromise}finally{streamConversationsLoadPromise=null}
    return;
  }
  try{
    const cache=readChatNameCache();
    const rows=await db(`medha_communications_my_conversations?user_id=eq.${encodeURIComponent(me)}&select=cid,conversation_key,kind,title,participant_ids,last_message,updated_at,last_read_at&order=updated_at.desc`);
    if(rows?.length)ensureDirectory();
    const nameOf=id=>directory.find(p=>String(p.id)===String(id))?.full_name||cache[String(id)]||"";

    /* Only show threads this user is actually in. A one-participant row is
       ambiguous - it is either a deliberate self-chat or an orphan left by
       the old client - so it is kept here and cleaned up in SQL, where the
       message history can tell the two apart. */
    const usable=(rows||[]).filter(row=>(row.participant_ids||[]).map(String).includes(me));
    const loaded=usable.map(row=>{
      const participantIds=(row.participant_ids||[]).map(String);
      const others=participantIds.filter(id=>id!==me);
      const selfOnly=others.length===0;
      const otherId=selfOnly?me:others[0];
      const name=row.kind==="channel"?(row.title||"Channel")
        :selfOnly?(currentAppUser?.full_name||nameOf(me)||"Myself")
        :(nameOf(otherId)||"Conversation");
      const previous=conversations.find(c=>String(c.cid)===String(row.cid));
      return {cid:row.cid,id:row.conversation_key,name,participantId:otherId,kind:row.kind||"direct",
        initials:initialsFor(name),color:row.kind==="channel"?"amber":"blue",
        team:row.kind==="channel"?"Team channel":"",
        preview:row.last_message||"",updatedAt:row.updated_at,time:"",
        lastReadAt:row.last_read_at,
        /* Unread lives on the server, so reading on a phone clears it on a
           laptop too, and it never returns for those messages. */
        unread:row.last_read_at&&row.updated_at
          ?(new Date(row.updated_at)>new Date(row.last_read_at)?1:0):0,
        messages:previous?.messages||[],messagesLoaded:previous?.messagesLoaded||false,
        messageOffset:previous?.messageOffset||0,hasMore:previous?.hasMore!==false};
    });
    const previousCid=active?.cid;
    conversations=loaded;
    active=conversations.find(c=>String(c.cid)===String(previousCid))||null;
    renderList();renderMessages();
    writeCache();
  }catch(error){
    toast(`Conversations unavailable: ${error.message}`);
  }
}

async function switchChat(id){
  const chat=conversations.find(c=>String(c.id)===String(id));
  if(!chat)return;
  active=chat;
  if(chat.unread){chat.unread=0;chat.mentions=0;markConversationRead(chat)}
  renderList();renderMessages();renderTyping();
  if(isMobile())document.body.classList.add("chat-open");
  closeMobileSidebar();
  if(document.body.classList.contains("details-open"))renderDetailsPanel();
  /* Cached messages paint instantly, then we always refresh from the
     server so nothing shown is stale. */
  if(streamClient)await watchStreamChannel(chat);
  if(chat.cid&&(!chat.messagesLoaded||chat.fromCache)){
    await loadChatPage(chat,0);
    chat.fromCache=false;
  }
  scrollMessagesToEnd();
  setPresenceLabel?.();
}

/* ---------- starting a chat ---------- */
/* Records that this person has read the thread, for every device. */
async function markConversationRead(chat){
  if(!viewerId()||!chat?.cid)return;
  const channel=streamChannelFor(chat);
  if(channel){chat.unread=0;await channel.markRead();writeCache()}
}

async function openDirectChat(person,openingText){
  const me=viewerId();
  if(!me)throw Error("Sign in to Medha Hub before starting a chat");
  if(!streamClient)throw Error("Stream is not connected; chat is unavailable");
  const otherId=String(person.id);
  const id=directConversationId(me,otherId);
  let chat=conversations.find(c=>String(c.id)===id||(
    streamClient&&c.kind==="direct"&&String(c.participantId)===otherId));
  if(!chat){
    const name=person.full_name||"Conversation";
    if(streamClient){
      const channel=streamClient.channel("messaging",id,{members:[me,otherId]});
      chat={id,cid:channel.cid,name,participantId:otherId,kind:"direct",initials:initialsFor(name),color:"blue",team:"",preview:"",updatedAt:new Date().toISOString(),time:"Now",unread:0,messages:[],messagesLoaded:false,messageOffset:0,hasMore:true,streamChannel:channel};
      streamChannels.set(channel.cid,channel);conversations.unshift(chat);active=chat;
      await watchStreamChannel(chat);
      renderList();renderMessages();scrollMessagesToEnd();
      return chat;
    }
    /* The thread may already exist from the other side. Look it up by the
       deterministic key so existing history is shown, not a blank chat. */
    const existing=await db(`medha_communications_conversations?id=eq.${encodeURIComponent(id)}&select=cid,last_message,updated_at`);
    const found=existing?.[0];
    chat={id,cid:found?.cid,name,participantId:otherId,kind:"direct",
      initials:initialsFor(name),color:"blue",team:"",
      preview:found?.last_message||"",
      updatedAt:found?.updated_at||new Date().toISOString(),time:"Now",unread:0,
      messages:[],messagesLoaded:!found,messageOffset:0,hasMore:!!found};
    conversations.unshift(chat);
  }
  active=chat;
  if(streamClient)await watchStreamChannel(chat);
  if(!chat.messagesLoaded&&chat.cid)await loadChatPage(chat,0);
  if(openingText&&openingText.trim()){
    const saved=await persistMessage(chat,openingText,[]);
    if(saved&&!chat.messages.some(m=>m.id===saved.id))chat.messages.push(saved);
  }
  renderList();renderMessages();scrollMessagesToEnd();
  return chat;
}


/* ---------- responsive: chat list drawer on small screens ---------- */
/* Must match the CSS drawer breakpoint below, or the menu button and
   the drawer disagree about when they apply. */
const mobileQuery=window.matchMedia("(max-width:1024px)");
function isMobile(){return mobileQuery.matches}

/* ---------- in-app banner (phones and tablets) ----------
   Web Push covers the app being closed or backgrounded. This covers the gap
   push deliberately leaves: Space is open and in the foreground, so the OS
   shows nothing, but the new message is in a chat the person is not looking
   at. Desktop has the sidebar in view at all times and does not need it. */
const bannerHost=document.createElement("div");
bannerHost.className="banner-host";bannerHost.id="banner-host";
document.body.append(bannerHost);
let bannerTimer=null;
function dismissBanner(){
  const card=bannerHost.firstElementChild;
  if(!card)return;
  clearTimeout(bannerTimer);
  card.classList.remove("in");
  /* Removed on transitionend rather than immediately so the slide-out is
     actually seen; the timeout is the fallback if the transition is
     skipped (reduced motion, a backgrounded tab). */
  const drop=()=>card.remove();
  card.addEventListener("transitionend",drop,{once:true});
  setTimeout(drop,400);
}
/* kind is "message" or "reaction" - both look the same but read differently. */
function showBanner({chatId,title,body,initials,color,kind}){
  if(!isMobile())return;
  bannerHost.innerHTML="";
  const card=document.createElement("button");
  card.type="button";card.className="banner";card.dataset.chatId=chatId||"";
  card.innerHTML=`<span class="person-avatar ${esc(color||"blue")} small">${esc(initials||"?")}</span>
    <span class="banner-copy">
      <span class="banner-title">${esc(title||"New message")}</span>
      <span class="banner-body">${esc(body||"")}</span>
    </span>
    <span class="banner-kind" aria-hidden="true">${kind==="reaction"?"&#9829;":"&#128172;"}</span>`;
  bannerHost.append(card);
  requestAnimationFrame(()=>card.classList.add("in"));
  clearTimeout(bannerTimer);
  bannerTimer=setTimeout(dismissBanner,4200);
}
bannerHost.addEventListener("click",e=>{
  const card=e.target.closest(".banner");
  if(!card)return;
  const id=card.dataset.chatId;
  dismissBanner();
  if(id)switchChat(id);
});
/* A downward swipe is the gesture people expect for dismissing a banner. */
let bannerTouchY=null;
bannerHost.addEventListener("touchstart",e=>{bannerTouchY=e.touches[0].clientY},{passive:true});
bannerHost.addEventListener("touchmove",e=>{
  if(bannerTouchY===null)return;
  if(e.touches[0].clientY-bannerTouchY<-18){bannerTouchY=null;dismissBanner()}
},{passive:true});
["touchend","touchcancel"].forEach(evt=>bannerHost.addEventListener(evt,()=>{bannerTouchY=null},{passive:true}));
function openMobileSidebar(){if(isMobile()){document.body.classList.add("sidebar-open");$("#chat-sidebar").setAttribute("aria-hidden","false")}}
function closeMobileSidebar(){
  document.body.classList.remove("sidebar-open");
  $("#chat-sidebar").setAttribute("aria-hidden",isMobile()?"true":"false");
}
function syncResponsiveChrome(){
  const mobile=isMobile();
  document.body.classList.toggle("is-mobile",mobile);
  if(!mobile){
    document.body.classList.remove("sidebar-open","chat-open","details-page");
    $("#chat-sidebar").setAttribute("aria-hidden","false");
  }else if(active){document.body.classList.add("chat-open")}
  else $("#chat-sidebar").setAttribute("aria-hidden",document.body.classList.contains("sidebar-open")?"false":"true");
}
mobileQuery.addEventListener("change",syncResponsiveChrome);
syncResponsiveChrome();

/* Mobile browsers can keep the layout viewport at full height while the
   keyboard shrinks only the visual viewport. Track that inset so the composer
   follows the keyboard instead of being panned to the top of the page. */
function syncKeyboardViewport(){
  const viewport=window.visualViewport;
  const focused=document.activeElement;
  const textField=focused instanceof HTMLElement&&(
    focused.matches("textarea,input")||focused.isContentEditable);
  const keyboard=textField&&viewport
    ?Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)
    :0;
  document.documentElement.style.setProperty("--keyboard-height",`${Math.round(keyboard)}px`);
  document.body.classList.toggle("keyboard-open",keyboard>80);
}
window.visualViewport?.addEventListener("resize",syncKeyboardViewport);
window.visualViewport?.addEventListener("scroll",syncKeyboardViewport);
document.addEventListener("focusin",()=>requestAnimationFrame(syncKeyboardViewport));
document.addEventListener("focusout",()=>setTimeout(syncKeyboardViewport,120));
syncKeyboardViewport();

/* Back / menu button in the conversation header, only shown on small screens. */
/* Small screens get a three-line menu button that opens the rail and the
   conversation list together, and a back arrow once a chat is open. */
const menuButton=document.createElement("button");
menuButton.type="button";menuButton.className="chat-menu-btn";menuButton.id="chat-menu";
menuButton.setAttribute("aria-label","Open menu");
menuButton.innerHTML='<span></span><span></span><span></span>';
$(".conversation-header").prepend(menuButton);
menuButton.addEventListener("click",openMobileSidebar);

/* Calendar and Settings are full-page views on small screens, so give them
   the same navigation entry point as the chat header. */
["calendar","settings"].forEach(viewName=>{
  const head=document.querySelector(`#${viewName}-view .page-head`);
  if(!head)return;
  const button=document.createElement("button");
  button.type="button";button.className="mobile-view-menu";button.setAttribute("aria-label","Open menu");
  button.innerHTML="<span></span><span></span><span></span>";
  button.addEventListener("click",openMobileSidebar);
  head.prepend(button);
});

const backButton=document.createElement("button");
backButton.type="button";backButton.className="chat-back";backButton.id="chat-back";
backButton.setAttribute("aria-label","Back to conversations");backButton.innerHTML="\u2039";
$(".conversation-header").prepend(backButton);
backButton.addEventListener("click",()=>{
  /* On a phone the list is the previous "page", so go back to it. */
  document.body.classList.remove("chat-open");
  openMobileSidebar();
});

const scrim=document.createElement("div");
scrim.className="sidebar-scrim";scrim.id="sidebar-scrim";
document.body.append(scrim);
scrim.addEventListener("click",()=>{closeMobileSidebar();closeDetails()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMobileSidebar()});

/* Keep the layout correct when the viewport or on-screen keyboard changes. */
function applyViewportHeight(){
  const h=window.visualViewport?window.visualViewport.height:window.innerHeight;
  document.documentElement.style.setProperty("--app-height",`${h}px`);
}
applyViewportHeight();
window.addEventListener("resize",applyViewportHeight);
window.visualViewport?.addEventListener("resize",applyViewportHeight);
window.visualViewport?.addEventListener("scroll",applyViewportHeight);

/* ---------- composer ---------- */
let pendingAttachments=[];
/* Bytes -> "1.4 MB". Shown on every card so an oversized file is obvious
   before it is sent rather than after. */
function fileSizeLabel(bytes){
  const n=Number(bytes)||0;
  if(!n)return "";
  if(n<1024)return `${n} B`;
  if(n<1024*1024)return `${Math.round(n/1024)} KB`;
  return `${(n/(1024*1024)).toFixed(1)} MB`;
}
/* A small glyph per file family, so a PDF does not look like a spreadsheet. */
function fileGlyph(name,kind){
  if(kind==="image")return "\u{1F5BC}";
  if(kind==="gif")return "GIF";
  const ext=String(name||"").split(".").pop().toLowerCase();
  if(["pdf"].includes(ext))return "\u{1F4C4}";
  if(["doc","docx","rtf","txt","md","pages"].includes(ext))return "\u{1F4DD}";
  if(["xls","xlsx","csv","numbers"].includes(ext))return "\u{1F4CA}";
  if(["ppt","pptx","key"].includes(ext))return "\u{1F4CB}";
  if(["zip","rar","7z","tar","gz"].includes(ext))return "\u{1F5DC}";
  if(["mp4","mov","avi","mkv","webm"].includes(ext))return "\u{1F3AC}";
  if(["mp3","wav","m4a","aac","flac"].includes(ext))return "\u{1F3B5}";
  return "\u{1F4CE}";
}
function renderPending(){
  const host=$("#pending-attachments");
  host.classList.toggle("has-items",pendingAttachments.length>0);
  host.innerHTML=pendingAttachments.map((a,i)=>{
    /* While uploading the card shows a spinner and no remove button - there
       is nothing to preview yet and cancelling mid-flight would leave the
       request running. */
    if(a.uploading)return `<div class="attach-card uploading" data-attachment-index="${i}">
      <span class="attach-thumb"><span class="attach-spinner" aria-hidden="true"></span></span>
      <span class="attach-copy"><strong>${esc(a.name||"File")}</strong><small>Uploading\u2026</small></span>
    </div>`;
    if(a.failed)return `<div class="attach-card failed" data-attachment-index="${i}">
      <span class="attach-thumb attach-failed" aria-hidden="true">!</span>
      <span class="attach-copy"><strong>${esc(a.name||"File")}</strong><small>${esc(a.error||"Upload failed")}</small></span>
      <button type="button" class="attach-remove" data-remove-attachment="${i}" aria-label="Remove ${esc(a.name||"attachment")}">\u00d7</button>
    </div>`;
    const isImage=a.kind==="image"||a.kind==="gif";
    const thumb=isImage
      ?`<img src="${esc(a.url)}" alt="" loading="lazy">`
      :`<span class="attach-glyph">${fileGlyph(a.name,a.kind)}</span>`;
    return `<div class="attach-card ready" data-attachment-index="${i}">
      <button type="button" class="attach-thumb attach-open" data-preview-attachment="${i}" aria-label="Preview ${esc(a.name||"attachment")}">${thumb}</button>
      <span class="attach-copy"><strong>${esc(a.name||"File")}</strong><small>${esc(fileSizeLabel(a.size)||(a.kind==="gif"?"GIF":"Ready"))}</small></span>
      <button type="button" class="attach-remove" data-remove-attachment="${i}" aria-label="Remove ${esc(a.name||"attachment")}">\u00d7</button>
    </div>`;
  }).join("");
}
$("#pending-attachments").addEventListener("click",e=>{
  const remove=e.target.closest("[data-remove-attachment]");
  if(remove){
    pendingAttachments.splice(Number(remove.dataset.removeAttachment),1);
    renderPending();autosizeComposer();
    return;
  }
  const preview=e.target.closest("[data-preview-attachment]");
  if(preview)openAttachmentPreview(pendingAttachments[Number(preview.dataset.previewAttachment)]);
});

/* ---------- attachment preview ----------
   One lightbox for pending and sent attachments alike. Images and video get
   an inline preview; anything else offers to open in a new tab, because the
   browser renders a PDF or a document better than an iframe here would. */
const attachmentPreview=document.createElement("dialog");
attachmentPreview.className="attachment-preview";
attachmentPreview.id="attachment-preview";
attachmentPreview.innerHTML=`<div class="preview-head">
    <span class="preview-name" id="preview-name"></span>
    <div class="preview-tools">
      <a class="preview-download" id="preview-download" target="_blank" rel="noopener" download>Download</a>
      <button type="button" class="close-dialog" id="preview-close" aria-label="Close preview">&times;</button>
    </div>
  </div>
  <div class="preview-body" id="preview-body"></div>`;
document.body.append(attachmentPreview);
attachmentPreview.querySelector("#preview-close").addEventListener("click",()=>attachmentPreview.close());
/* Clicking the backdrop closes, matching how every other lightbox behaves. */
attachmentPreview.addEventListener("click",e=>{if(e.target===attachmentPreview)attachmentPreview.close()});
function openAttachmentPreview(attachment){
  if(!attachment?.url){toast("This attachment is still uploading");return}
  const name=attachment.name||"Attachment";
  $("#preview-name").textContent=name;
  const link=$("#preview-download");
  link.href=attachment.url;link.setAttribute("download",name);
  const ext=String(name).split(".").pop().toLowerCase();
  const isImage=attachment.kind==="image"||attachment.kind==="gif"
    ||["png","jpg","jpeg","gif","webp","svg","avif","heic"].includes(ext);
  const isVideo=["mp4","webm","mov","m4v"].includes(ext);
  const isAudio=["mp3","wav","m4a","aac","ogg","flac"].includes(ext);
  $("#preview-body").innerHTML=isImage
    ?`<img src="${esc(attachment.url)}" alt="${esc(name)}">`
    :isVideo?`<video src="${esc(attachment.url)}" controls playsinline></video>`
    :isAudio?`<audio src="${esc(attachment.url)}" controls></audio>`
    :`<div class="preview-fallback"><span class="preview-glyph">${fileGlyph(name,attachment.kind)}</span>
        <strong>${esc(name)}</strong>
        <p>${esc(fileSizeLabel(attachment.size)||"This file type cannot be shown here.")}</p>
        <a class="primary-button" href="${esc(attachment.url)}" target="_blank" rel="noopener">Open file</a>
      </div>`;
  attachmentPreview.showModal();
}

const messageInput=$("#message-input");
function autosizeComposer(){
  messageInput.style.height="auto";
  const max=Math.round((window.visualViewport?.height||window.innerHeight)*0.3);
  messageInput.style.height=`${Math.min(messageInput.scrollHeight,max)}px`;
  messageInput.style.overflowY=messageInput.scrollHeight>max?"auto":"hidden";
}
/* ---------- typing indicators ----------
   Stream rate-limits keystroke() internally to one event every few seconds
   and typing events are websocket-only, so this adds no HTTP calls. The map
   is keyed by channel so a person typing in a background chat never shows
   up in the open one. */
const typingByChannel=new Map();
function setTyping(cid,userId,userName,isTyping){
  const key=String(cid);
  let people=typingByChannel.get(key);
  if(!people){people=new Map();typingByChannel.set(key,people)}
  const id=String(userId||"");
  if(!id)return;
  if(isTyping){
    const known=directory.find(person=>String(person.id)===id);
    clearTimeout(people.get(id)?.timer);
    /* Stream does not always deliver typing.stop (a dropped tab, a lost
       socket), so every start carries its own expiry. */
    people.set(id,{name:known?.full_name||userName||"Someone",
      timer:setTimeout(()=>{people.delete(id);renderTyping()},7000)});
  }else{
    clearTimeout(people.get(id)?.timer);
    people.delete(id);
  }
  renderTyping();
}
function renderTyping(){
  const el=$("#typing");
  if(!el)return;
  const people=active?typingByChannel.get(String(active.cid)):null;
  const names=people?[...people.values()].map(entry=>entry.name):[];
  if(!names.length){el.hidden=true;el.classList.remove("typing-active");return}
  const label=names.length===1?`${names[0]} is typing`
    :names.length===2?`${names[0]} and ${names[1]} are typing`
    :`${names[0]} and ${names.length-1} others are typing`;
  el.innerHTML=`<span class="typing-label">${esc(label)}</span><span class="typing-dots"><span></span><span></span><span></span></span>`;
  el.hidden=false;el.classList.add("typing-active");
}
/* Clears our own indicator on the other side the moment the message goes,
   rather than leaving it to the 7s expiry. */
function stopTypingNow(chat){
  const channel=streamChannelFor(chat||active);
  channel?.stopTyping?.().catch(()=>{});
}
messageInput.addEventListener("input",()=>{
  if(!active)return;
  const channel=streamChannelFor(active);
  if(!channel)return;
  if(messageInput.value.trim())channel.keystroke().catch(()=>{});
  else channel.stopTyping?.().catch(()=>{});
});
messageInput.addEventListener("input",autosizeComposer);
window.addEventListener("resize",autosizeComposer);
autosizeComposer();

async function uploadFile(file){
  if(!viewerId())throw Error("Sign in before attaching files");
  if(!streamClient)throw Error("Stream is not connected; attachments were not uploaded");
  if(streamClient){
    if(!active)throw Error("Select a conversation first");
    const channel=await watchStreamChannel(active);
    /* Use the browser's native multipart implementation. Stream Chat's
       bundled upload helper can mis-detect File objects as Node streams and
       call .on(), which breaks PDF, Office, image and HEIC uploads in-browser. */
    const form=new FormData();
    form.append("file",file,file.name);
    const token=streamClient.tokenManager?.token;
    const response=await fetch(`https://chat.stream-io-api.com/channels/${encodeURIComponent(channel.type)}/${encodeURIComponent(channel.id)}/file?api_key=${encodeURIComponent(streamClient.key)}`,{
      method:"POST",headers:{Authorization:token,"stream-auth-type":"jwt"},body:form
    });
    const uploaded=await response.json().catch(()=>({}));
    if(!response.ok||!uploaded.file)throw Error(uploaded.message||`File upload failed (${response.status})`);
    const image=/^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/i.test(file.type||"");
    return {kind:image?"image":"file",name:file.name,url:uploaded.file};
  }
  const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-");
  const path=`${viewerId()}/${crypto.randomUUID()}-${safe}`;
  const encoded=path.split("/").map(encodeURIComponent).join("/");
  const r=await fetch(`${SUPABASE_URL}/storage/v1/object/medha-communications-files/${encoded}`,
    {method:"POST",headers:{...headers,...(USE_FIREBASE_JWT&&firebaseIdToken?{Authorization:`Bearer ${firebaseIdToken}`}:{}),"Content-Type":file.type||"application/octet-stream","x-upsert":"false"},body:file});
  if(!r.ok)throw Error(`Could not upload ${file.name}`);
  return {kind:"file",name:file.name,url:`${SUPABASE_URL}/storage/v1/object/public/medha-communications-files/${encoded}`};
}

$("#attach-file").addEventListener("click",()=>$("#file-input").click());
/* Uploads run in parallel and each card is placed before its upload starts,
   so the tray fills instantly with spinners instead of appearing one file at
   a time after each round trip. The placeholder object is mutated in place,
   which keeps every card's index stable while other uploads finish. */
async function queueAttachment(file){
  if(file.size>25*1024*1024){toast(`${file.name} is larger than 25 MB`);return}
  const slot={kind:file.type?.startsWith("image/")?"image":"file",name:file.name,size:file.size,uploading:true,url:""};
  pendingAttachments.push(slot);
  renderPending();
  /* A local preview means an image thumbnail is visible while it uploads,
     rather than a grey box that only fills in at the end. */
  let localUrl="";
  if(slot.kind==="image"){try{localUrl=URL.createObjectURL(file);slot.url=localUrl}catch{}}
  try{
    const uploaded=await uploadFile(file);
    Object.assign(slot,uploaded,{uploading:false,failed:false,size:file.size});
  }catch(error){
    Object.assign(slot,{uploading:false,failed:true,error:error.message||"Upload failed"});
    toast(error.message||`Could not upload ${file.name}`);
  }finally{
    if(localUrl)URL.revokeObjectURL(localUrl);
    renderPending();
  }
}
$("#file-input").addEventListener("change",async e=>{
  const files=[...e.target.files];e.target.value="";
  await Promise.all(files.map(queueAttachment));
});

let sending=false;
$("#composer").addEventListener("submit",async e=>{
  e.preventDefault();
  if(sending)return;
  if(!active){toast("Select a conversation first");return}
  const text=messageInput.value.trim();
  /* A half-uploaded file has no url yet, and a failed one never will, so
     neither can be sent. Waiting is better than silently dropping it. */
  if(pendingAttachments.some(a=>a.uploading)){toast("Wait for attachments to finish uploading");return}
  const attachments=pendingAttachments.filter(a=>!a.failed&&a.url);
  if(!text&&!attachments.length)return;
  sending=true;
  const sendButton=$(".send-button");sendButton.disabled=true;
  try{
    /* show_in_channel keeps a reply in the main message list. Without it
       Stream files a parent_id message inside its thread only, so the reply
       disappeared from the conversation after a refresh - channel.query()
       returns main-channel messages, not thread replies. */
    const saved=await persistMessage(active,text,attachments,
      replyTarget?{parent_id:replyTarget.id,show_in_channel:true}:{});
    messageInput.value="";setReplyTarget(null);pendingAttachments=[];renderPending();autosizeComposer();
    stopTypingNow(active);
    if(saved&&!active.messages.some(m=>m.id===saved.id)){active.messages.push(saved);active.messagesLoaded=true}
    renderList();renderMessages();scrollMessagesToEnd();
  }catch(error){toast(error.message)}
  finally{sending=false;sendButton.disabled=false;messageInput.focus()}
});

messageInput.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#composer").requestSubmit()}
});

/* On phones and tablets the composer tools collapse behind a three-dot
   button, so the message row keeps its full width. */
const toolsMore=$("#tools-more");
function closeComposerTools(){
  document.body.classList.remove("tools-open");
  toolsMore?.setAttribute("aria-expanded","false");
}
toolsMore?.addEventListener("click",e=>{
  e.stopPropagation();
  const open=document.body.classList.toggle("tools-open");
  toolsMore.setAttribute("aria-expanded",open?"true":"false");
});
document.addEventListener("click",e=>{
  if(!e.target.closest(".composer-tools"))closeComposerTools();
});
/* Picking a tool closes the menu. */
["#attach-file","#emoji-button","#gif-button"].forEach(sel=>
  $(sel)?.addEventListener("click",()=>closeComposerTools()));
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeComposerTools()});

/* ---------- chat list interaction ---------- */
$("#chat-list").addEventListener("click",e=>{
  const row=e.target.closest("[data-id]");
  if(row){closeChatActions();switchChat(row.dataset.id)}
  const personRow=e.target.closest("[data-person-id]");
  if(personRow){const person=directory.find(item=>String(item.id)===String(personRow.dataset.personId));if(person)openDirectChat(person,"").catch(error=>toast(error.message))}
});
$("#chat-search").addEventListener("input",async()=>{await ensureDirectory();renderList()});

function closeChatActions(){$("#chat-actions").hidden=true}
function pinnedIds(){
  const key="medha-pinned-"+(viewerId()||"guest");
  try{return [...new Set(JSON.parse(localStorage.getItem(key)||sessionStorage.getItem(key)||"[]").map(String))]}catch{return []}
}
function savePinnedIds(items){
  const key="medha-pinned-"+(viewerId()||"guest"),value=JSON.stringify([...new Set(items.map(String))]);
  localStorage.setItem(key,value);sessionStorage.setItem(key,value);
}
function openChatActions(row,event){
  const menu=$("#chat-actions");
  menu.hidden=false;menu.dataset.chatId=row.dataset.id;
  const pinned=pinnedIds();
  let pin=menu.querySelector('[data-chat-action="pin"]');
  if(!pin){pin=document.createElement("button");pin.type="button";pin.dataset.chatAction="pin";menu.prepend(pin)}
  pin.textContent=pinned.includes(row.dataset.id)?"📌 Unpin chat":"📌 Pin chat";
  const chat=conversations.find(c=>String(c.id)===String(row.dataset.id));
  let archive=menu.querySelector('[data-chat-action="archive"]');
  if(!archive){archive=document.createElement("button");archive.type="button";archive.dataset.chatAction="archive";menu.append(archive)}
  archive.textContent=chat?.archived?"\u{1F4E5} Unarchive chat":"\u{1F4E6} Archive chat";
  const rect=menu.getBoundingClientRect();
  menu.style.left=`${Math.min(event.clientX,window.innerWidth-Math.max(rect.width,220)-8)}px`;
  menu.style.top=`${Math.min(event.clientY,window.innerHeight-Math.max(rect.height,150)-8)}px`;
}
$("#chat-list").addEventListener("contextmenu",e=>{
  const row=e.target.closest("[data-id]");
  if(!row)return;
  e.preventDefault();openChatActions(row,e);
});
let longPressTimer=null;
$("#chat-list").addEventListener("touchstart",e=>{
  const row=e.target.closest("[data-id]");
  if(!row)return;
  const touch=e.touches[0];
  longPressTimer=setTimeout(()=>openChatActions(row,{clientX:touch.clientX,clientY:touch.clientY}),500);
},{passive:true});
["touchend","touchmove","touchcancel"].forEach(evt=>$("#chat-list").addEventListener(evt,()=>clearTimeout(longPressTimer),{passive:true}));
document.addEventListener("click",e=>{
  if(!e.target.closest("#chat-actions")&&!e.target.closest(".chat-item"))closeChatActions();
});
$("#chat-actions").addEventListener("click",async e=>{
  const button=e.target.closest("[data-chat-action]");
  if(!button)return;
  const id=$("#chat-actions").dataset.chatId;
  const chat=conversations.find(c=>String(c.id)===String(id));
  if(!chat)return;
  const action=button.dataset.chatAction;
  if(action==="favorite"){
    toggleFavorite(chat);
  }else if(action==="pin"){
    const items=pinnedIds();
    let next;
    if(items.includes(id))next=items.filter(x=>x!==id);
    else if(items.length>=3){toast("You can pin up to 3 chats");next=items}
    else next=[...items,id];
    savePinnedIds(next);renderList();
  }else if(action==="unread"){
    chat.unread=1;renderList();toast("Conversation marked unread");
  }else if(action==="archive"){
    const channel=streamChannelFor(chat);
    if(!channel){toast("Open this conversation once before archiving it");closeChatActions();return}
    const next=!chat.archived;
    chat.archived=next;renderList();writeCache();
    /* Stream stores archived on this user's membership, so the other
       person's sidebar is untouched. */
    try{await (next?channel.archive():channel.unarchive());toast(next?"Conversation archived":"Conversation unarchived")}
    catch(error){chat.archived=!next;renderList();toast(error.message)}
  }
  closeChatActions();
});

/* Load earlier messages when scrolled to the top. */
$("#message-area").addEventListener("scroll",async()=>{
  const area=$("#message-area");
  stickToBottom=area.scrollHeight-area.scrollTop-area.clientHeight<60;
  if(area.scrollTop>40||!active?.messagesLoaded||!active.hasMore||active.loadingMessages)return;
  const oldHeight=area.scrollHeight,oldTop=area.scrollTop;
  await loadChatPage(active,active.messageOffset);
  requestAnimationFrame(()=>{area.scrollTop=area.scrollHeight-oldHeight+oldTop});
});

/* ---------- new chat dialog ---------- */
let directory=[],selectedEmployee=null;
async function loadEmployeeDirectory(){
  await ensureDirectory();
  if(!directory.length)$("#employee-list").innerHTML='<div class="directory-empty">Employee directory unavailable.</div>';
  else renderDirectory("");
}

/* Presence for everyone in the picker, so you can see who is available
   before starting a conversation. */
async function refreshDirectoryPresence(){
  const ids=directory.map(p=>String(p.id)).filter(Boolean);
  if(!ids.length)return;
 try{
   const list=ids.map(id=>`"${id.replace(/"/g,'')}"`).join(",");
   const rows=await db(`medha_communications_presence?user_id=in.(${list})&select=user_id,is_open,last_seen,presence_enabled`);
    (rows||[]).forEach(r=>contactPresence.set(String(r.user_id),r));
    renderDirectory($("#new-chat-person").value||"");
  }catch{}
}

function renderDirectory(query){
  const list=$("#employee-list"),q=String(query||"").toLowerCase();
  const matches=directory.filter(p=>`${p.full_name} ${p.email||""} ${p.department||""}`.toLowerCase().includes(q));
  list.innerHTML=matches.length?matches.map(p=>{
    const state=presenceFor(p.id);
    return `<button type="button" class="employee-option" data-person-id="${esc(p.id)}">
      <span class="avatar-stack"><span class="person-avatar blue">${esc(initialsFor(p.full_name))}</span><i class="presence-dot ${state}" title="${state}"></i></span>
      <span class="employee-copy"><strong>${esc(p.full_name)}</strong></span>
      <span class="employee-state ${state}">${state}</span>
    </button>`}).join("")
    :'<div class="directory-empty">No people found</div>';
}
$("#new-chat").addEventListener("click",async()=>{
  selectedEmployee=null;
  $("#new-chat-person").value="";
  $("#new-chat-dialog").showModal();
  await loadEmployeeDirectory();
  await refreshDirectoryPresence();
});
$("#new-chat-person").addEventListener("input",e=>{selectedEmployee=null;renderDirectory(e.target.value)});
$("#employee-list").addEventListener("click",async e=>{
  const button=e.target.closest("[data-person-id]");
  if(!button)return;
  const person=directory.find(p=>String(p.id)===String(button.dataset.personId));
  if(!person)return;
  /* Selecting someone opens the conversation straight away; there is no
     opening-message step to fill in. */
  $("#new-chat-dialog").close();
  try{await openDirectChat(person,"")}
  catch(error){toast(error.message)}
});

let selectedGroupMembers=[];
function renderGroupMembers(query=""){
  const list=$("#group-member-list"),q=String(query||"").toLowerCase();
  const people=directory.filter(p=>String(p.id)!==String(viewerId()));
  const matches=people.filter(p=>`${p.full_name} ${p.email||""} ${p.department||""}`.toLowerCase().includes(q));
  list.innerHTML=matches.length?matches.map(p=>{
    const chosen=selectedGroupMembers.includes(String(p.id));
    return `<button type="button" class="employee-option ${chosen?"selected":""}" data-group-person-id="${esc(p.id)}" aria-pressed="${chosen}">
      <span class="person-avatar blue">${esc(initialsFor(p.full_name))}</span>
      <span class="employee-copy"><strong>${esc(p.full_name)}</strong></span>
      <span class="invite-check">${chosen?"\u2713":""}</span>
    </button>`}).join("")
    :`<div class="directory-empty">${people.length?"No people match that search.":"Employee directory unavailable."}</div>`;
  renderChosenMembers();
}
/* The chips give the selection its own place, so who is in the group is
   readable without scrolling back through the list to hunt for ticks. */
function renderChosenMembers(){
  const wrap=$("#group-chosen"),count=$("#group-member-count"),button=$("#group-create-button");
  const chosen=selectedGroupMembers.map(id=>directory.find(p=>String(p.id)===String(id))).filter(Boolean);
  wrap.hidden=!chosen.length;
  wrap.innerHTML=chosen.map(p=>`<button type="button" class="member-chip" data-remove-member="${esc(p.id)}" title="Remove ${esc(p.full_name)}">
    <span class="person-avatar blue">${esc(initialsFor(p.full_name))}</span>${esc(p.full_name)}<i aria-hidden="true">\u00d7</i></button>`).join("");
  count.textContent=chosen.length?`${chosen.length} selected`:"None selected";
  count.classList.toggle("has-members",!!chosen.length);
  if(button)button.disabled=!chosen.length||!$("#group-chat-name").value.trim();
}
$("#new-group").addEventListener("click",async()=>{
  selectedGroupMembers=[];$("#group-chat-name").value="";$("#group-member-search").value="";
  $("#group-chat-dialog").showModal();
  await ensureDirectory();renderGroupMembers();
});
$("#group-member-search").addEventListener("input",e=>renderGroupMembers(e.target.value));
$("#group-chat-name").addEventListener("input",renderChosenMembers);
function toggleGroupMember(id){
  const key=String(id);
  selectedGroupMembers=selectedGroupMembers.includes(key)
    ?selectedGroupMembers.filter(x=>x!==key):[...selectedGroupMembers,key];
  renderGroupMembers($("#group-member-search").value);
}
$("#group-member-list").addEventListener("click",e=>{
  const button=e.target.closest("[data-group-person-id]");if(!button)return;
  toggleGroupMember(button.dataset.groupPersonId);
});
$("#group-chosen").addEventListener("click",e=>{
  const chip=e.target.closest("[data-remove-member]");if(!chip)return;
  toggleGroupMember(chip.dataset.removeMember);
});
$("#group-chat-form").addEventListener("submit",async e=>{
  if(e.submitter?.value==="cancel")return;
  e.preventDefault();
  if(!streamClient){toast("Stream is not connected");return}
  if(selectedGroupMembers.length<1){toast("Select at least one other member");return}
  const name=$("#group-chat-name").value.trim(),members=[String(viewerId()),...selectedGroupMembers];
  try{
    await ensureStreamUsers();
    const id="group-"+crypto.randomUUID(),channel=streamClient.channel("messaging",id,{name,members});
    await channel.create();await channel.watch();streamChannels.set(channel.cid,channel);
      const chat={cid:channel.cid,id,name,participantId:selectedGroupMembers[0],participantIds:members,createdById:String(viewerId()),createdByName:currentAppUser?.full_name||"You",kind:"group",initials:initialsFor(name),color:"purple",team:"Group chat",preview:"",updatedAt:new Date().toISOString(),unread:0,messages:[],messagesLoaded:true,messageOffset:0,hasMore:false,streamChannel:channel};
    conversations.unshift(chat);active=chat;writeCache();$("#group-chat-dialog").close();renderList();renderMessages();toast("Group chat created");
  }catch(error){toast(error.message)}
});

/* ---------- details panel wiring ---------- */
$("#close-details").addEventListener("click",closeDetails);
$("#details-favorite")?.addEventListener("click",()=>toggleFavorite(active));
$("#details-search")?.addEventListener("click",openConversationSearch);
$("#conversation-search-input")?.addEventListener("input",e=>renderConversationSearch(e.target.value));
$("#conversation-search-results")?.addEventListener("click",e=>{
  const result=e.target.closest("[data-search-message-id]");
  if(!result)return;
  $("#conversation-search-dialog").close();
  const message=$(".message[data-message-id=\""+CSS.escape(result.dataset.searchMessageId)+"\"]");
  if(message){message.scrollIntoView({behavior:"smooth",block:"center"});message.classList.add("search-hit");setTimeout(()=>message.classList.remove("search-hit"),1800)}
});
/* Clicking anywhere in the conversation header opens details. The mobile
   navigation controls are the only exceptions. */
$(".conversation-header").addEventListener("click",e=>{
  if(e.target.closest(".chat-menu-btn,.chat-back"))return;
  openDetails();
});
$("#conversation-name").setAttribute("role","button");
$("#conversation-name").setAttribute("tabindex","0");
$("#conversation-name").setAttribute("title","View chat details");
$("#conversation-name").addEventListener("keydown",e=>{
  if(e.key==="Enter"||e.key===" "){e.preventDefault();openDetails()}
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&document.body.classList.contains("details-open"))closeDetails();
});

/* ---------- Stream Video calling ---------- */
function startRingTone(vibrate=true){
  stopRingTone();
  /* Vibration is independent of Web Audio. Some mobile browsers delay or
     reject AudioContext startup, but the native call-like vibration should
     still begin immediately. */
  if(vibrate&&"vibrate" in navigator){try{navigator.vibrate([260,120,260,500]);ringVibrationTimer=setInterval(()=>navigator.vibrate([260,120,260,500]),2200)}catch{}}
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)throw Error("Audio is unavailable in this browser");
    ringAudioContext=ringAudioContext||new AudioContextClass();ringAudioContext.resume();
    const play=()=>{if(!ringAudioContext)return;const now=ringAudioContext.currentTime,gain=ringAudioContext.createGain();gain.gain.setValueAtTime(.001,now);gain.gain.exponentialRampToValueAtTime(.22,now+.12);gain.gain.exponentialRampToValueAtTime(.001,now+1.5);gain.connect(ringAudioContext.destination);[523.25,659.25,783.99].forEach((frequency,index)=>{const oscillator=ringAudioContext.createOscillator();oscillator.type="sine";oscillator.frequency.value=frequency;oscillator.connect(gain);oscillator.start(now+index*.12);oscillator.stop(now+1.6)});};
    play();ringTimer=setInterval(play,2200);
  }catch{}
}
function stopRingTone(){if(ringTimer){clearInterval(ringTimer);ringTimer=null}if(ringVibrationTimer){clearInterval(ringVibrationTimer);ringVibrationTimer=null}try{navigator.vibrate?.(0)}catch{}if(incomingCallTimeout){clearTimeout(incomingCallTimeout);incomingCallTimeout=null}if(outgoingCallTimeout){clearTimeout(outgoingCallTimeout);outgoingCallTimeout=null}if(ringAudioContext?.state!=="closed")try{ringAudioContext?.suspend()}catch{} }
document.addEventListener("pointerdown",()=>{if(ringTimer)try{ringAudioContext?.resume()}catch{}},{passive:true});
function callDurationText(milliseconds){
  const total=Math.max(0,Math.floor(milliseconds/1000));
  return `${Math.floor(total/60)}:${String(total%60).padStart(2,"0")}`;
}
async function finalizeCallActivity(answered){
  if(!callActivityMessageId||!callActivityChannel||callActivityFinalized)return;
  callActivityFinalized=true;
  const label=callActivityMode==="video"?"🎥 Video call":"☎ Audio call";
  const text=answered&&callActivityStartedAt
    ?`${label} (${callDurationText(Date.now()-callActivityStartedAt)})`
    :`${label} not answered`;
  try{
    const updated=await streamClient.updateMessage({id:callActivityMessageId,text});
    const local=active?.messages?.find(message=>String(message.id)===String(callActivityMessageId));
    if(local){local.text=updated.text;local.time=new Date(updated.created_at||Date.now()).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}
    if(active?.cid===callActivityChannel.cid)renderMessages();
  }catch(error){console.warn("Could not update call activity",error)}
}
function showCallSurface(call,title,mode){
  activeCall=call;activeCallMode=mode;activeCallHadRemoteParticipant=false;activeCallMediaEnabled=call.state.callingState===CallingState.JOINED;const dialog=$("#call-dialog");dialog.classList.toggle("audio-call",mode==="audio");dialog.classList.toggle("video-call",mode!=="audio");dialog.classList.remove("incoming-call");$("#call-title").textContent=title;$("#incoming-call-actions").hidden=true;$("#call-dialog").showModal();
  activeParticipantSubscription?.unsubscribe?.();activeParticipantSubscription=null;activeParticipantSessionKey="";activeMediaUnbinders.forEach(unbind=>{try{unbind()}catch{}});activeMediaUnbinders=[];
  const holder=$("#call-participants");holder.innerHTML="";call.setViewport(holder);
  activeParticipantSubscription=call.state.participants$.subscribe(participants=>{const sessionKey=participants.map(participant=>`${participant.sessionId}:${participant.isLocalParticipant?"local":"remote"}`).sort().join("|");if(sessionKey===activeParticipantSessionKey)return;activeParticipantSessionKey=sessionKey;activeMediaUnbinders.forEach(unbind=>{try{unbind()}catch{}});activeMediaUnbinders=[];holder.innerHTML="";participants.forEach(participant=>{const tile=document.createElement("div");tile.className="call-participant";const participantId=String(participant.user?.id||participant.user_id||"");const profile=directory.find(person=>String(person.id)===participantId);const label=document.createElement("strong");label.textContent=participant.user?.name||profile?.full_name||participant.name||participantId||"Participant";tile.append(label);let video=null;if(mode!=="audio"){video=document.createElement("video");video.autoplay=true;video.playsInline=true;video.muted=participant.isLocalParticipant;video.dataset.sessionId=participant.sessionId;tile.append(video)}let audio=null;if(!participant.isLocalParticipant){audio=document.createElement("audio");audio.autoplay=true;audio.playsInline=true;audio.dataset.sessionId=participant.sessionId;tile.append(audio)}holder.append(tile);if(video){try{const untrack=call.trackElementVisibility(video,participant.sessionId,"videoTrack");if(typeof untrack==="function")activeMediaUnbinders.push(untrack);const unbind=call.bindVideoElement(video,participant.sessionId,"videoTrack");if(typeof unbind==="function")activeMediaUnbinders.push(unbind);video.play().catch(()=>{})}catch(error){console.warn("Could not bind participant video",error)}}if(audio){try{const unbind=call.bindAudioElement(audio,participant.sessionId);if(typeof unbind==="function")activeMediaUnbinders.push(unbind);audio.play().catch(()=>{})}catch(error){console.warn("Could not bind participant audio",error)}}})});
  activeCallParticipantEndSubscription?.unsubscribe?.();activeCallParticipantEndSubscription=call.state.participants$.subscribe(participants=>{const remoteCount=participants.filter(participant=>!participant.isLocalParticipant).length;if(remoteCount)activeCallHadRemoteParticipant=true;if(call.state.callingState===CallingState.JOINED&&activeCallHadRemoteParticipant&&!remoteCount){finalizeCallActivity(!!callActivityStartedAt);dismissCallSurface()}});
  activeCallingSubscription?.unsubscribe?.();activeCallingSubscription=call.state.callingState$.subscribe(state=>{if(state===CallingState.LEFT){finalizeCallActivity(!!callActivityStartedAt);dismissCallSurface();return}if(state===CallingState.JOINED){if(callActivityMessageId&&!callActivityStartedAt)callActivityStartedAt=Date.now();enableCallMedia(call,mode).catch(error=>toast(error.message||"Could not start call media"))}else if(state!==CallingState.JOINED){$("#toggle-call-mic").classList.add("off");$("#toggle-call-camera").classList.add("off")}});
  if(activeCallMediaEnabled)enableCallMedia(call,mode).catch(error=>toast(error.message||"Could not start call media"));
  $("#toggle-call-mic").classList.toggle("off",!activeCallMediaEnabled||call.microphone.state.status!=="enabled");$("#toggle-call-camera").classList.toggle("off",mode!=="video"||!activeCallMediaEnabled||call.camera.state.status!=="enabled");
}
/* ---------- device permissions, asked once ----------
   Browsers keep a real grant themselves, but they only remember it when the
   page actually reads it back. Three things go wrong without this:
     - every call blindly re-runs getUserMedia, so a "this time only" grant
       re-prompts on the next call;
     - a denied device makes each later call throw the same error again;
     - the media stream is torn down and re-acquired per call.
   So the state is read from the Permissions API first, cached for the
   session, and mirrored to localStorage so a reload knows what was already
   settled without asking again. */
const PERMISSION_KEY=()=>`medha-space-permissions-${viewerId()||"guest"}`;
let permissionState=null;
function readPermissionStore(){
  if(permissionState)return permissionState;
  try{permissionState=JSON.parse(localStorage.getItem(PERMISSION_KEY())||"{}")}
  catch{permissionState={}}
  return permissionState;
}
function writePermissionStore(name,value){
  const store=readPermissionStore();
  store[name]=value;store[name+"_at"]=Date.now();
  try{localStorage.setItem(PERMISSION_KEY(),JSON.stringify(store))}catch{/* private mode */}
}
/* The browser is the authority; the store is only a hint so we can skip the
   prompt path. A grant revoked in site settings is picked up here. */
async function permissionStatus(name){
  try{
    const status=await navigator.permissions?.query({name});
    if(status?.state){
      writePermissionStore(name,status.state);
      /* Revoking in site settings fires this, so the next call re-asks
         instead of failing on a stale "granted". */
      status.onchange=()=>writePermissionStore(name,status.state);
      return status.state;
    }
  }catch{/* Safari and Firefox reject camera/microphone queries */}
  return readPermissionStore()[name]||"prompt";
}
/* Returns true when the device may be used. Only ever prompts when the
   browser still says "prompt" - a stored grant or denial is reused. */
async function ensureDevicePermission(name){
  const state=await permissionStatus(name);
  if(state==="granted")return true;
  if(state==="denied"){
    writePermissionStore(name,"denied");
    throw Error(`${name==="camera"?"Camera":"Microphone"} access is blocked. Enable it in your browser's site settings for Medha Space.`);
  }
  /* "prompt": ask once, then remember the answer for the rest of the
     session so a second call does not re-request. */
  const constraints=name==="camera"?{video:true}:{audio:true};
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia(constraints)}
  catch(error){
    writePermissionStore(name,error?.name==="NotAllowedError"?"denied":"prompt");
    throw Error(error?.name==="NotAllowedError"
      ?`${name==="camera"?"Camera":"Microphone"} access was declined. Enable it in your browser's site settings to use calls.`
      :`No ${name==="camera"?"camera":"microphone"} is available on this device.`);
  }
  /* Release the probe stream immediately - Stream's SDK opens its own, and
     holding this one would leave the camera light on between calls. */
  stream.getTracks().forEach(track=>track.stop());
  writePermissionStore(name,"granted");
  return true;
}

async function enableCallMedia(call,mode){
  if(activeCall!==call||call.state.callingState!==CallingState.JOINED)return;
  if(activeCallMediaEnabled)return;
  if(activeCallMediaPromise)return activeCallMediaPromise;
  activeCallMediaPromise=(async()=>{
    /* Checked before enable() so a stored grant goes straight through and a
       stored denial fails with a clear message instead of a second prompt. */
    await ensureDevicePermission("microphone");
    await call.microphone.enable();
    if(mode==="video"){await ensureDevicePermission("camera");await call.camera.enable()}
    else await call.camera.disable().catch(()=>{});
    activeCallMediaEnabled=true;
  })().finally(()=>{activeCallMediaPromise=null});
  await activeCallMediaPromise;
  $("#toggle-call-mic").classList.toggle("off",call.microphone.state.status!=="enabled");$("#toggle-call-camera").classList.toggle("off",mode!=="video"||call.camera.state.status!=="enabled");
}
function setupVideoClient(body){
  if(videoClient)return;
  try{
    videoClient=new StreamVideoClient({apiKey:body.apiKey,user:body.user,token:body.token});
    const handleCalls=calls=>{if(incomingCall&&incomingCall.state.callingState!==CallingState.RINGING){dismissCallSurface();return}const call=calls.find(item=>!item.isCreatedByMe&&item.state.callingState===CallingState.RINGING);if(call&&incomingCall?.cid!==call.cid)showIncomingCall(call)};
    videoClient.state.calls$.subscribe(handleCalls);
    /* calls$ receives live events, but a call that started immediately before
       Space connected may not emit a second event. Query watched calls once
       on boot so an already-ringing call opens the popup immediately. */
    videoClient.queryCalls({filter_conditions:{members:{$in:[String(body.user.id)]}},limit:25,watch:true}).then(result=>handleCalls(result.calls||[])).catch(error=>console.warn("Could not restore incoming calls",error));
  }catch(error){console.warn("Stream Video unavailable",error)}
}
async function refreshIncomingCalls(){
  if(!videoClient||!currentUserId)return;
  try{
    const result=await videoClient.queryCalls({filter_conditions:{members:{$in:[String(currentUserId)]}},limit:25,watch:true});
    const call=(result.calls||[]).find(item=>!item.isCreatedByMe&&item.state.callingState===CallingState.RINGING);
    if(call&&incomingCall?.cid!==call.cid)showIncomingCall(call);
  }catch(error){console.warn("Could not refresh incoming calls",error)}
}
function dismissCallSurface(){stopRingTone();outgoingRingSubscription?.unsubscribe?.();outgoingRingSubscription=null;activeCallingSubscription?.unsubscribe?.();activeCallingSubscription=null;activeCallParticipantEndSubscription?.unsubscribe?.();activeCallParticipantEndSubscription=null;activeParticipantSubscription?.unsubscribe?.();activeParticipantSubscription=null;activeParticipantSessionKey="";activeMediaUnbinders.forEach(unbind=>{try{unbind()}catch{}});activeMediaUnbinders=[];activeCall=null;incomingCall=null;activeCallMediaEnabled=false;activeCallMediaPromise=null;activeCallHadRemoteParticipant=false;$("#call-dialog")?.close();$("#call-minimized").hidden=true;$("#call-participants").innerHTML=""}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshIncomingCalls()});
window.addEventListener("focus",refreshIncomingCalls,{passive:true});
function showIncomingCall(call){
  incomingCall=call;const isVideo=call.state.custom?.mode!=="audio",callerId=String(call.state.createdBy?.id||call.state.created_by?.id||call.state.created_by_id||""),callerProfile=directory.find(person=>String(person.id)===callerId),caller=call.state.createdBy?.name||call.state.created_by?.name||callerProfile?.full_name||callerId||"Medha user",dialog=$("#call-dialog");dialog.classList.toggle("audio-call",!isVideo);dialog.classList.toggle("video-call",isVideo);dialog.classList.add("incoming-call");$("#call-title").textContent=(isVideo?"Incoming video":"Incoming audio")+" call from "+caller;$("#incoming-call-actions").hidden=false;$("#call-participants").innerHTML='<div class="incoming-call-card"><strong>'+esc(caller)+'</strong><span>Incoming '+(isVideo?"video":"audio")+' call</span></div>';$("#call-dialog").showModal();startRingTone();/* Keep unanswered audio/video calls ringing for one minute. */incomingCallTimeout=setTimeout(()=>ignoreIncomingCall(),60000);
}
function minimizeIncomingCall(){if(!incomingCall)return;stopRingTone();$("#call-dialog").close();$("#call-minimized").hidden=false}
function restoreIncomingCall(){if(!incomingCall)return;$("#call-minimized").hidden=true;$("#call-dialog").showModal()}
async function ignoreIncomingCall(){if(incomingCall){try{await incomingCall.camera.disable();await incomingCall.microphone.disable();await incomingCall.leave({reject:true,reason:"timeout"})}catch{}incomingCall=null}stopRingTone();$("#call-minimized").hidden=true;$("#call-dialog").close()}
$("#accept-call").addEventListener("click",async()=>{if(!incomingCall)return;try{stopRingTone();const call=incomingCall,mode=call.state.custom?.mode||"video";await call.join();incomingCall=null;showCallSurface(call,"Call · "+(active?.name||"Medha"),mode)}catch(error){toast(error.message)}});
$("#decline-call").addEventListener("click",async()=>{if(incomingCall){try{await incomingCall.leave({reject:true,reason:"decline"})}catch{}incomingCall=null}stopRingTone();$("#call-dialog").close()});
async function startStreamCall(mode){
  if(!active||!streamClient){toast("Open a Stream conversation first");return}
  try{
    callActivityMessageId=null;callActivityChannel=null;callActivityMode=mode;callActivityStartedAt=null;callActivityFinalized=false;
    if(!videoClient)videoClient=new StreamVideoClient({apiKey:streamClient.key,user:streamClient.user,token:streamSessionToken});
    const members=[...(active.participantIds||[viewerId(),active.participantId]).filter(Boolean).map(id=>({user_id:String(id)}))];
    const callId="medha-"+crypto.randomUUID(),call=videoClient.call("default",callId);
    await call.getOrCreate({ring:true,video:mode==="video",settings:{ring:{incoming_call_timeout_ms:60000,auto_cancel_timeout_ms:60000,missed_call_timeout_ms:60000}},data:{members,custom:{channelCid:active.cid,mode}}});
    showCallSurface(call,(mode==="video"?"Video":"Audio")+" call · "+active.name,mode);
    if(call.state.callingState!==CallingState.JOINED){
      startRingTone(false);
      outgoingRingSubscription=call.state.callingState$.subscribe(state=>{
        if(state===CallingState.JOINED||state===CallingState.LEFT){stopRingTone();outgoingRingSubscription?.unsubscribe?.();outgoingRingSubscription=null}
      });
      outgoingCallTimeout=setTimeout(()=>{if(activeCall===call&&call.state.callingState!==CallingState.JOINED)leaveStreamCall()},60000);
    }
    callActivityChannel=streamChannelFor(active);
    const activity=await callActivityChannel.sendMessage({text:(mode==="video"?"🎥 Video":"☎ Audio")+" call started",call_id:callId,call_type:"default"});
    callActivityMessageId=activity.message?.id||null;
    if(call.state.callingState===CallingState.JOINED)callActivityStartedAt=Date.now();
  }catch(error){toast(error.message)}
}
$("#audio-call").addEventListener("click",()=>startStreamCall("audio"));
$("#video-call").addEventListener("click",()=>startStreamCall("video"));
$("#message-area").addEventListener("click",async e=>{
  const row=e.target.closest(".message");if(!row||!active)return;
  const message=active.messages.find(item=>String(item.id)===String(row.dataset.messageId));
  if(message?.pollId)return;   /* handled by the poll card below */
  if(!message?.callId||!videoClient)return;
  try{const mode=message.text.includes("🎥")?"video":"audio";activeCall=videoClient.call("default",message.callId);await activeCall.join();showCallSurface(activeCall,"Join call · "+active.name,mode);toast("Connected to call")}catch(error){toast(error.message)}
});
/* Clicking a quoted message scrolls to the original and flashes it, so a
   reply can be traced back without hunting through the thread. */
$("#message-area").addEventListener("click",e=>{
  const quote=e.target.closest(".reply-quote");
  if(!quote)return;
  e.preventDefault();e.stopPropagation();
  const target=$(`.message[data-message-id="${CSS.escape(String(quote.dataset.jumpTo||""))}"]`);
  if(!target){toast("That message is further back in the conversation");return}
  target.scrollIntoView({behavior:"smooth",block:"center"});
  target.classList.remove("message-flash");
  void target.offsetWidth;                 /* restart the animation */
  target.classList.add("message-flash");
  setTimeout(()=>target.classList.remove("message-flash"),1600);
});

/* Voting happens on the bars themselves. Clicking your current choice
   removes it, so a vote can be changed or withdrawn. */
$("#message-area").addEventListener("click",async e=>{
  const option=e.target.closest(".poll-option");
  if(!option||option.disabled)return;
  e.preventDefault();e.stopPropagation();
  const messageId=option.dataset.messageId,pollId=option.dataset.pollId,optionId=option.dataset.optionId;
  if(!messageId||!pollId||!optionId||!streamClient)return;
  const card=option.closest(".poll-card");
  card?.classList.add("poll-busy");
  try{
    const message=active?.messages?.find(m=>String(m.id)===String(messageId));
    const ownVotes=message?.poll?.own_votes||[];
    if(option.classList.contains("chosen")){
      /* Clicking your current choice withdraws it. */
      const own=ownVotes.find(v=>String(v.option_id)===String(optionId));
      if(own?.id)await streamClient.removePollVote(messageId,pollId,own.id,viewerId());
    }else{
      /* One vote per person: drop any existing choice before casting the
         new one, so switching options replaces rather than adds. Polls
         created before max_votes_allowed was set rely on this too. */
      for(const own of ownVotes){
        if(own?.id)await streamClient.removePollVote(messageId,pollId,own.id,viewerId()).catch(()=>{});
      }
      await streamClient.castPollVote(messageId,pollId,{option_id:optionId},viewerId());
    }
    await refreshPoll(messageId,pollId);
  }catch(error){toast(error.message||"Could not record your vote")}
  finally{card?.classList.remove("poll-busy")}
});

/* Pulls the latest tallies for one poll and repaints just that card. */
async function refreshPoll(messageId,pollId){
  if(!streamClient)return;
  try{
    const result=await streamClient.getPoll(pollId,viewerId());
    const poll=result?.poll||result;
    if(!poll)return;
    const message=active?.messages?.find(m=>String(m.id)===String(messageId));
    if(message)message.poll=poll;
    const card=$(`.poll-card[data-poll-card="${CSS.escape(String(pollId))}"]`);
    if(card)card.outerHTML=pollHtml(poll,messageId);
  }catch{}
}

$("#toggle-call-mic").addEventListener("click",async()=>{if(!activeCall)return;if(activeCall.state.callingState!==CallingState.JOINED){toast("Microphone starts when the call is connected");return}
  /* Turning a device back on reuses the stored grant, so unmuting mid-call
     never re-prompts. */
  try{await ensureDevicePermission("microphone")}catch(error){toast(error.message);return}
  await activeCall.microphone.toggle();const off=activeCall.microphone.state.status!=="enabled";$("#toggle-call-mic").classList.toggle("off",off);$("#toggle-call-mic").title=off?"Turn microphone on":"Mute microphone"});
$("#toggle-call-camera").addEventListener("click",async()=>{if(!activeCall)return;if(activeCall.state.callingState!==CallingState.JOINED){toast("Camera starts when the call is connected");return}
  try{await ensureDevicePermission("camera")}catch(error){toast(error.message);return}
  await activeCall.camera.toggle();const off=activeCall.camera.state.status!=="enabled";$("#toggle-call-camera").classList.toggle("off",off);$("#toggle-call-camera").title=off?"Turn camera on":"Turn camera off"});
async function leaveStreamCall(){const call=activeCall||incomingCall;if(call){try{await call.camera.disable()}catch{}try{await call.microphone.disable()}catch{}try{if(call.state.callingState===CallingState.RINGING)await call.leave({reject:true,reason:"cancel"});else if(call.state.callingState!==CallingState.LEFT)await call.endCall()}catch{try{await call.leave()}catch{}}}await finalizeCallActivity(!!callActivityStartedAt);dismissCallSurface()}
/* Optional chaining: #close-call is not present in every layout, and a
   missing one used to throw here and abort the rest of boot. */
$("#leave-call")?.addEventListener("click",leaveStreamCall);$("#close-call")?.addEventListener("click",leaveStreamCall);
$("#minimize-call")?.addEventListener("click",()=>{if(incomingCall)minimizeIncomingCall();else $("#call-dialog").close()});
$("#restore-call")?.addEventListener("click",restoreIncomingCall);
$("#ignore-call")?.addEventListener("click",ignoreIncomingCall);
$("#ignore-minimized-call")?.addEventListener("click",ignoreIncomingCall);

/* ---------- rich Stream message actions ---------- */
let replyTarget=null,actionMessageId=null;
/* A bar above the composer showing who and what you are replying to, so the
   context is visible while typing instead of only hinted at in a
   placeholder. */
const replyBar=document.createElement("div");
replyBar.className="reply-bar";
replyBar.hidden=true;
replyBar.innerHTML=`<svg class="reply-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h7a9 9 0 0 1 9 9v2"/></svg>
  <span class="reply-bar-body"><span class="reply-bar-name"></span><span class="reply-bar-text"></span></span>
  <button type="button" class="reply-cancel" aria-label="Cancel reply" title="Cancel reply">×</button>`;
$("#composer")?.prepend(replyBar);
replyBar.querySelector(".reply-cancel").addEventListener("click",()=>setReplyTarget(null));

function setReplyTarget(message){
  replyTarget=message||null;
  if(!replyTarget){
    replyBar.hidden=true;
    messageInput.placeholder="Type a new message";
    return;
  }
  replyBar.querySelector(".reply-bar-name").textContent=replyTarget.senderName||"Unknown user";
  replyBar.querySelector(".reply-bar-text").textContent=
    String(replyTarget.text||"Attachment").replace(/\s+/g," ").slice(0,140);
  replyBar.hidden=false;
  messageInput.placeholder="Reply to "+(replyTarget.senderName||"message");
  messageInput.focus();
}
/* Escape cancels a reply, matching the rest of the app's dialogs. */
messageInput.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&replyTarget){e.preventDefault();setReplyTarget(null)}
});
function canEditMessage(message){
  if(!message||!isMine(message.senderId)||!active)return false;
  const own=active.messages.filter(item=>isMine(item.senderId));
  if(String(own.at(-1)?.id)!==String(message.id))return false;
  const reads=streamChannelFor(active)?.state?.read||{};
  return !Object.entries(reads).some(([id,state])=>String(id)!==String(viewerId())&&new Date(state.last_read||0)>=new Date(message.createdAt||0));
}
function openMessageActions(row,event){
  actionMessageId=row.dataset.messageId;const menu=$("#message-actions"),message=active?.messages?.find(item=>String(item.id)===String(actionMessageId));
  menu.hidden=false;menu.querySelector('[data-message-action="edit"]').hidden=!canEditMessage(message);
  menu.querySelector('[data-message-action="pin"]').textContent=message?.pinned?"📌 Unpin message":"📌 Pin message";
  const rect=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(event.clientX,window.innerWidth-rect.width-8))+"px";menu.style.top=Math.max(8,Math.min(event.clientY,window.innerHeight-rect.height-8))+"px";
}
$("#message-area").addEventListener("contextmenu",e=>{const row=e.target.closest(".message");if(row){e.preventDefault();openMessageActions(row,e)}});
document.addEventListener("click",e=>{if(!e.target.closest("#message-actions"))$("#message-actions").hidden=true});
/* ---------- edit & forward dialogs ----------
   These replaced window.prompt(), which is a blocking OS-chrome box: it
   cannot be styled, is suppressed in some embedded/PWA contexts, and gave
   forwarding a "type the number of the chat" list. */
const editDialog=document.createElement("dialog");
editDialog.className="sheet-dialog compose-dialog";editDialog.id="edit-message-dialog";
editDialog.innerHTML=`<form method="dialog" id="edit-message-form">
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="dialog-head sheet-head"><div class="sheet-heading">
      <span class="sheet-glyph amber"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5 17.5 10.5"/></svg></span>
      <div><p class="eyebrow">Message</p><h2>Edit message</h2></div></div>
      <button value="cancel" formnovalidate class="close-dialog" aria-label="Close">&times;</button></div>
    <label class="field-label" for="edit-message-text">Message text
      <textarea id="edit-message-text" rows="4" maxlength="4000" required></textarea></label>
    <div class="dialog-actions"><button value="cancel" formnovalidate class="secondary-button">Cancel</button>
      <button value="default" class="primary-button" id="edit-message-save">Save changes</button></div>
  </form>`;
document.body.append(editDialog);
let editingMessageId=null;
function openEditDialog(message){
  editingMessageId=String(message.id);
  const field=$("#edit-message-text");
  field.value=message.text||"";
  editDialog.showModal();
  /* Caret at the end rather than selecting everything, so a small correction
     does not require clicking first. */
  field.focus();field.setSelectionRange(field.value.length,field.value.length);
}
$("#edit-message-text").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();$("#edit-message-form").requestSubmit()}
});
$("#edit-message-form").addEventListener("submit",async e=>{
  if(e.submitter?.value==="cancel"){editingMessageId=null;return}
  e.preventDefault();
  const text=$("#edit-message-text").value.trim();
  const message=active?.messages?.find(item=>String(item.id)===String(editingMessageId));
  if(!text||!message){editDialog.close();return}
  if(text===(message.text||"")){editDialog.close();editingMessageId=null;return}
  const save=$("#edit-message-save");save.disabled=true;
  try{
    const updated=await streamClient.updateMessage({id:message.id,text});
    message.text=updated.text??text;
    /* _decorated caches the pin prefix; clearing it lets the new text render. */
    message._decorated=false;
    renderMessages();renderThread?.();
    editDialog.close();editingMessageId=null;
    toast("Message updated");
  }catch(error){toast(error.message)}
  finally{save.disabled=false}
});

const forwardDialog=document.createElement("dialog");
forwardDialog.className="sheet-dialog";forwardDialog.id="forward-dialog";
forwardDialog.innerHTML=`<form method="dialog" id="forward-form">
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="dialog-head sheet-head"><div class="sheet-heading">
      <span class="sheet-glyph green"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5l7 7-7 7"/><path d="M20 12H5a1 1 0 0 0-1 1v4"/></svg></span>
      <div><p class="eyebrow">Share</p><h2>Forward message</h2></div></div>
      <button value="cancel" formnovalidate class="close-dialog" aria-label="Close">&times;</button></div>
    <div class="forward-preview" id="forward-preview"></div>
    <div class="dialog-search"><svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
      <input id="forward-search" placeholder="Search conversations" autocomplete="off"></div>
    <div class="employee-list" id="forward-list"></div>
    <div class="dialog-actions"><button value="cancel" formnovalidate class="secondary-button">Cancel</button></div>
  </form>`;
document.body.append(forwardDialog);
let forwardingMessage=null;
function renderForwardTargets(query=""){
  const q=String(query||"").toLowerCase();
  const choices=conversations.filter(item=>item.id!==active?.id&&item.name.toLowerCase().includes(q));
  $("#forward-list").innerHTML=choices.length?choices.map(chat=>`
    <button type="button" class="employee-option" data-forward-to="${esc(chat.id)}">
      <span class="person-avatar ${esc(chat.color||"blue")}">${esc(chat.initials||"?")}</span>
      <span class="employee-copy"><strong>${esc(chat.name)}</strong></span>
      <span class="employee-state">${chat.kind==="group"?"Group":"Direct"}</span>
    </button>`).join(""):'<div class="directory-empty">No other conversations to forward to.</div>';
}
function openForwardDialog(message){
  forwardingMessage=message;
  const body=String(message.text||"").replace(/\s+/g," ").slice(0,140);
  $("#forward-preview").innerHTML=`<span class="forward-label">Forwarding</span>
    <span class="forward-text">${esc(body||"Attachment")}</span>`;
  $("#forward-search").value="";
  renderForwardTargets();
  forwardDialog.showModal();
}
$("#forward-search").addEventListener("input",e=>renderForwardTargets(e.target.value));
$("#forward-list").addEventListener("click",async e=>{
  const button=e.target.closest("[data-forward-to]");
  if(!button||!forwardingMessage)return;
  const target=conversations.find(item=>String(item.id)===String(button.dataset.forwardTo));
  if(!target)return;
  button.disabled=true;
  try{
    const targetChannel=await watchStreamChannel(target);
    await targetChannel.sendMessage({text:forwardingMessage.text||"Forwarded attachment",
      attachments:(forwardingMessage.attachments||[]).map(a=>({type:a.kind==="image"?"image":"file",title:a.name,asset_url:a.url})),
      forwarded_message_id:forwardingMessage.id,forwarded_from:active?.name});
    forwardDialog.close();forwardingMessage=null;
    toast("Forwarded to "+target.name);
  }catch(error){toast(error.message)}
  finally{button.disabled=false}
});

$("#message-actions").addEventListener("click",async e=>{
  const button=e.target.closest("[data-message-action]");if(!button||!active)return;$("#message-actions").hidden=true;
  const message=active.messages.find(item=>String(item.id)===String(actionMessageId)),channel=streamChannelFor(active);if(!message||!channel)return;
  try{
    if(button.dataset.messageAction==="reply"){setReplyTarget(message)}
    else if(button.dataset.messageAction==="edit"){
      if(!canEditMessage(message)){toast("Only your latest unread message can be edited");return}
      openEditDialog(message);
    }else if(button.dataset.messageAction==="delete"){await streamClient.deleteMessage(message.id);active.messages=active.messages.filter(item=>item.id!==message.id);renderMessages()}
    else if(button.dataset.messageAction==="pin"){message.pinned=!message.pinned;await (message.pinned?streamClient.pinMessage(message.id):streamClient.unpinMessage(message.id));renderMessages()}
    else if(button.dataset.messageAction==="forward"){
      if(!conversations.some(item=>item.id!==active.id)){toast("No other conversation available");return}
      openForwardDialog(message)
    }
  }catch(error){toast(error.message)}
});
const pollButton=document.createElement("button");pollButton.type="button";pollButton.id="poll-button";pollButton.className="tool-btn";pollButton.title="Create poll";pollButton.textContent="◉";$(".composer-tools")?.append(pollButton);
pollButton.addEventListener("click",()=>{if(active?.kind!=="group"){toast("Polls are available in group chats");return}$("#poll-dialog").showModal()});
$("#poll-form").addEventListener("submit",async e=>{
  if(e.submitter?.value==="cancel")return;e.preventDefault();
  try{const question=$("#poll-question").value.trim(),options=$("#poll-options").value.split("\n").map(item=>item.trim()).filter(Boolean).map(text=>({text}));if(options.length<2){toast("Add at least two options");return}const poll=await streamClient.createPoll({name:question,options,allow_answers:false,allow_user_suggested_options:false,enforce_unique_vote:true,max_votes_allowed:1},viewerId());await streamChannelFor(active).sendMessage({text:question,poll_id:poll.poll?.id||poll.id});$("#poll-dialog").close();e.target.reset();toast("Poll posted")}catch(error){toast(error.message)}});

/* ---------- reactions ---------- */
const reactionMenu=document.createElement("div");
reactionMenu.className="reaction-menu";reactionMenu.hidden=true;
reactionMenu.innerHTML=["👍","❤️","😂","😮","😢","🎉"].map(e=>`<button type="button" data-reaction="${e}">${e}</button>`).join("");
document.body.append(reactionMenu);
let reactionTargetId=null;
function openReactionMenu(messageId,x,y){
  reactionTargetId=messageId;reactionMenu.hidden=false;
  const rect=reactionMenu.getBoundingClientRect();
  reactionMenu.style.left=`${Math.max(8,Math.min(x,window.innerWidth-rect.width-8))}px`;
  reactionMenu.style.top=`${Math.max(8,Math.min(y,window.innerHeight-rect.height-8))}px`;
}
$("#message-area").addEventListener("dblclick",e=>{
  const row=e.target.closest(".message");
  if(!row||!row.dataset.messageId)return;
  e.preventDefault();openReactionMenu(row.dataset.messageId,e.clientX,e.clientY);
});
document.addEventListener("click",e=>{if(!e.target.closest(".reaction-menu"))reactionMenu.hidden=true});
reactionMenu.addEventListener("click",async e=>{
  const button=e.target.closest("[data-reaction]");
  if(!button||!reactionTargetId||!active)return;
  reactionMenu.hidden=true;
  await toggleReaction(reactionTargetId,button.dataset.reaction);
});

/* Selecting an existing chip toggles that reaction, so removing one does not
   require reopening the picker. */
$("#message-area").addEventListener("click",async e=>{
  const chip=e.target.closest("[data-reaction-toggle]");
  if(!chip)return;
  e.preventDefault();e.stopPropagation();
  const row=chip.closest(".message");
  if(row)await toggleReaction(row.dataset.messageId,chip.dataset.reactionToggle);
});

/* enforce_unique means Stream keeps at most one reaction per person per
   message, so picking a different emoji is a change, not a second vote.
   Picking the same emoji again is a removal, which needs deleteReaction -
   sendReaction alone can only ever add. */
async function toggleReaction(messageId,emoji){
  const me=viewerId();
  if(!messageId||!emoji||!me||!active)return;
  const message=active.messages.find(m=>String(m.id)===String(messageId));
  if(!message)return;
  const mine=Object.entries(message.reactions||{}).find(([,users])=>(users||[]).map(String).includes(me));
  const removing=(mine?.[0]||null)===emoji;
  const before=JSON.parse(JSON.stringify(message.reactions||{}));
  applyLocalReaction(message,me,removing?null:emoji);
  renderMessages();
  try{
    if(!streamClient)throw Error("Stream is not connected; reactions are unavailable");
    const channel=streamChannelFor(active);
    if(!channel)throw Error("Message is not loaded in Stream");
    const reactionType=reactionTypeFor(emoji);
    if(removing)await channel.deleteReaction(messageId,reactionType,me);
    /* sendReaction takes a Reaction object; passing the bare emoji string
       fails server-side with "expected object for field reaction". */
    else await channel.sendReaction(messageId,{type:reactionType},{enforce_unique:true});
    writeCache();
  }catch(error){message.reactions=before;renderMessages();toast(error.message)}
}

/* One place that edits the local reaction map, so the optimistic paint and
   the reaction.new / reaction.deleted events can never disagree. Passing
   null for emoji clears whatever that person had. */
function applyLocalReaction(message,userId,emoji){
  const me=String(userId),next={};
  Object.entries(message.reactions||{}).forEach(([type,users])=>{
    const kept=(users||[]).map(String).filter(id=>id!==me);
    if(kept.length)next[type]=kept;
  });
  if(emoji)(next[emoji]??=[]).push(me);
  message.reactions=next;
}
function findMessageEverywhere(messageId){
  const id=String(messageId||"");
  if(!id)return null;
  for(const chat of conversations){
    const found=(chat.messages||[]).find(m=>String(m.id)===id);
    if(found)return {chat,message:found};
  }
  return null;
}


/* ---------- emoji & gif pickers ---------- */

const emojiGroups={"Smileys & people":"😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙌 👏 🤝 👍 👎 👌 ✌️ 🤞 🤟 🤘 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 💪 🙏 👀 👁️ 👄 💋 💯" ,"Animals & nature":"🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦄 🐝 🦋 🐌 🐞 🐜 🕷️ 🦂 🐢 🐍 🦎 🦖 🐙 🦀 🐠 🐟 🐡 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦏 🦒 🦘 🦬 🐄 🐎 🐖 🐑 🦙 🐐 🐕 🐈 🐓 🦃 🕊️ 🐇 🐿️ 🦔 🌸 🌹 🌻 🌞 🌝 🌈 ⭐ 🌟 ✨ ⚡ 🔥 🌊 🍀 🌱 🌲 🌴 🌵 🍁" ,"Food & activities":"🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍞 🧀 🍔 🍟 🍕 🌭 🌮 🌯 🥗 🍿 🍩 🍪 🎂 🍰 🍫 🍭 ☕ 🍺 🍻 🍷 🥂 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏆 🎮 🎲 🎯 🎨 🎵 🎶 🎤 🎬 🚗 🚕 🚌 🚆 ✈️ 🚀 🚲 ⛵" ,"Objects & symbols":"❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✅ ❌ ❗ ❓ ‼️ ⁉️ ⚠️ 🚫 💡 🔒 🔓 🔑 🔔 🎁 🎈 🎉 🎊 📌 📎 📝 📅 📁 📂 💻 🖥️ 📱 ☎️ ⌚ 🔍 🔗 🛠️ ⚙️ 🔥 💬 🗨️ 💤 ✔️ ➕ ➖ ➡️ ⬆️ ⬇️"};
let allEmojis=Object.entries(emojiGroups).flatMap(([group,value])=>value.split(" ").map(emoji=>({group,emoji})));function renderEmojiPicker(query=""){const q=query.toLowerCase();$("#emoji-grid").innerHTML=allEmojis.filter(x=>!q||x.emoji.includes(q)||x.group.toLowerCase().includes(q)).map(x=>`<button type="button" class="emoji-choice" data-emoji="${x.emoji}" title="${x.group}">${x.emoji}</button>`).join("")||'<div class="directory-empty">No emoji found</div>'}$("#emoji-button").onclick=()=>{$("#emoji-dialog").showModal();renderEmojiPicker();$("#emoji-search").focus()};$("#close-emoji").onclick=()=>$("#emoji-dialog").close();$("#emoji-search").addEventListener("input",e=>renderEmojiPicker(e.target.value));$("#emoji-grid").addEventListener("click",e=>{const b=e.target.closest("[data-emoji]");if(b){$("#message-input").value+=b.dataset.emoji;$("#message-input").focus();$("#emoji-dialog").close()}});$("#gif-button").onclick=()=>$("#gif-dialog").showModal();$("#gif-form").addEventListener("submit",e=>{if(e.submitter?.value==="cancel"){e.target.closest("dialog").close();return}e.preventDefault();const url=$("#gif-url").value.trim();try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw Error();pendingAttachments.push({kind:"gif",name:"GIF",url:parsed.href});renderPending();$("#gif-url").value="";$("#gif-dialog").close()}catch{toast("Enter a valid GIF URL")}});

/* ---------- calendar ---------- */

let meetings=[];let calendarCursor=new Date();
/* Stretches each multi-day bar across the days it covers. Done from JS
   because a CSS percentage resolves against the day cell, not the strip,
   so the bar either fell short of, or ran past, the final day. */
function sizeCalendarSpans(){
  const grid=$("#calendar-grid");
  if(!grid)return;
  const cells=[...grid.querySelectorAll("div[data-day]")];
  if(!cells.length)return;
  const byDay=new Map(cells.map(c=>[c.dataset.day,c]));
  const gridBox=grid.getBoundingClientRect();
  const pad=n=>String(n).padStart(2,"0");
  grid.querySelectorAll("i.span-start[data-span-days]").forEach(bar=>{
    const cell=bar.closest("div[data-day]");
    if(!cell)return;
    const days=Number(bar.dataset.spanDays)||1;
    if(days<2)return;
    const first=new Date(cell.dataset.day+"T00:00:00");
    const lastDate=new Date(first);
    lastDate.setDate(lastDate.getDate()+days-1);
    const lastCell=byDay.get(`${lastDate.getFullYear()}-${pad(lastDate.getMonth()+1)}-${pad(lastDate.getDate())}`);
    if(!lastCell)return;
    const from=cell.getBoundingClientRect(),to=lastCell.getBoundingClientRect();
    bar.style.left=`${Math.round(from.left-gridBox.left)+6}px`;
    bar.style.top=`${Math.round(from.top-gridBox.top)+26}px`;
    bar.style.width=`${Math.max(0,Math.round(to.right-from.left)-14)}px`;
  });
}

function renderCalendar(){
  const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();
  $("#calendar-month").textContent=calendarCursor.toLocaleDateString([],{month:"long",year:"numeric"});
  const first=(new Date(y,m,1).getDay()+6)%7,last=new Date(y,m+1,0).getDate(),cells=[];
  const pad=n=>String(n).padStart(2,"0");
  const dayKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayKey=dayKey(new Date());
  /* A meeting covers every day from its start to its end, so a 1-3 Sept
     event appears on the 1st, 2nd and 3rd rather than only the 1st. */
  const coversDay=(meeting,key)=>{
    if(!meeting.start)return false;
    const s=new Date(meeting.start),e=new Date(meeting.end||meeting.start);
    if(Number.isNaN(s.getTime()))return false;
    const startKey=dayKey(s),endKey=Number.isNaN(e.getTime())?startKey:dayKey(e);
    return key>=startKey&&key<=endKey;
  };
  for(let i=0;i<first;i++)cells.push('<div class="muted"></div>');
  for(let d=1;d<=last;d++){
    const key=dayKey(new Date(y,m,d));
    const items=meetings.filter(x=>coversDay(x,key));
    cells.push(`<div class="${key===todayKey?"today":""}" data-day="${key}">${d}${items.map(x=>{
      const s=new Date(x.start),e=new Date(x.end||x.start);
      const multi=dayKey(s)!==dayKey(e);
      const monthStart=new Date(y,m,1),monthEnd=new Date(y,m+1,0);
      /* Clamp the visible segment so events that began before this month or
         end after it still get a bar starting/ending inside this grid. */
      const segmentStart=multi&&s<monthStart?monthStart:s;
      const segmentEnd=multi&&e>monthEnd?monthEnd:e;
      const segmentStartKey=dayKey(segmentStart),segmentEndKey=dayKey(segmentEnd);
      const isStart=segmentStartKey===key,isEnd=segmentEndKey===key;
      const weekday=(new Date(key+"T00:00:00").getDay()+6)%7;   /* Mon = 0 */
      /* The bar restarts on each calendar row, so a span crossing a week
         boundary gets a fresh rounded edge and its own label. */
      const rowStart=isStart||weekday===0;
      const rowEnd=isEnd||weekday===6;
      /* Only the first cell of each weekly segment owns the visible tag.
         Continuation dates are deliberately empty, not blank tag elements. */
      if(multi&&!rowStart)return "";
      const span=multi?` span${rowStart?" span-start":""}${rowEnd?" span-end":""}${!rowStart&&!rowEnd?" span-mid":""}`:"";
      const range=multi?` (${s.toLocaleDateString([],{month:"short",day:"numeric"})} – ${e.toLocaleDateString([],{month:"short",day:"numeric"})})`:"";
      /* How many days this run covers in this week row, so the label can be
         centred over the whole strip instead of just its first day. */
      let daysInRow=1;
      if(multi&&rowStart){
        const endKey=segmentEndKey;
        const probe=new Date(key+"T00:00:00");
        daysInRow=0;
        while(dayKey(probe)<=endKey){
          daysInRow++;
          if(((probe.getDay()+6)%7)===6)break;
          probe.setDate(probe.getDate()+1);
        }
        daysInRow=Math.max(1,daysInRow);
      }
      const label=(!multi||rowStart)?esc(x.title):"";
      const style=multi&&rowStart&&daysInRow>1?` style="--span-days:${daysInRow}" data-span-days="${daysInRow}"`:"";
      const controls=(!multi||rowStart)?`<span class="calendar-event-actions"><button type="button" data-edit-meeting="${esc(x.id||"")}" aria-label="Edit ${esc(x.title)}" title="Edit event">✎</button><button type="button" data-delete-meeting="${esc(x.id||"")}" aria-label="Delete ${esc(x.title)}" title="Delete event">×</button></span>`:"";
      return `<i class="${span.trim()}"${style} title="${esc(x.title)}${esc(range)}" data-meeting-id="${esc(x.id||"")}"><span class="calendar-event-label">${label}</span>${controls}</i>`;
    }).join("")}</div>`);
  }
  $("#calendar-grid").innerHTML=cells.join("")||'<div class="empty-state">No scheduled meetings.</div>';
  sizeCalendarSpans();
  /* Re-measure once CSS grid sizing and responsive fonts have settled. */
  requestAnimationFrame(sizeCalendarSpans);
  const now=new Date();
  const future=meetings.filter(x=>new Date(x.end||x.start)>=now).sort((a,b)=>new Date(a.start)-new Date(b.start));
  $("#agenda-list").innerHTML=future.length?future.map(x=>{
    const s=new Date(x.start),e=new Date(x.end||x.start);
    const multi=s.toDateString()!==e.toDateString();
    const when=multi
      ?`${s.toLocaleDateString([],{month:"short",day:"numeric"})} – ${e.toLocaleDateString([],{month:"short",day:"numeric"})}`
      :s.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"});
    return `<div class="agenda-item"><b>${s.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}</b><div><strong>${esc(x.title)}</strong><span>${esc(when)}</span></div></div>`;
  }).join(""):'<div class="empty-state">No upcoming meetings.</div>';
}

function renderInvitedMeetings(){
  const list=$("#invited-list");
  if(!list)return;
  const me=String(viewerId()||"");
  const invited=meetings.filter(item=>item.start&&new Date(item.end||item.start)>=new Date()&&String(item.created_by)!==me&&(item.invitee_ids||[]).map(String).includes(me)).sort((a,b)=>new Date(a.start)-new Date(b.start));
  list.innerHTML=invited.length?invited.map(item=>{
    const start=new Date(item.start),creator=directory.find(person=>String(person.id)===String(item.created_by));
    return `<div class="agenda-item"><b>${esc(start.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}))}</b><div><strong>${esc(item.title||"Untitled event")}</strong><span>${esc(start.toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"}))} · From ${esc(creator?.full_name||"another employee")}</span></div></div>`;
  }).join(""):"<div class=\"empty-state\">No invitations found.</div>";
}
async function loadMeetings(){
  const me=String(viewerId()||"");
  /* Calendar visibility is per employee: creator OR listed invitee. Never
     request the complete meetings table for a signed-out/unknown user. */
  if(!me){meetings=[];renderCalendar();renderInvitedMeetings();return}
  try{
    const filter=encodeURIComponent(`(created_by.eq.${me},invitee_ids.cs.{${me}})`);
    meetings=await db(`medha_communications_meetings?select=id,title,start_at,end_at,invitee_ids,created_by,location&or=${filter}&order=start_at.asc`)||[];
    meetings=meetings.map(x=>({...x,start:String(x.start_at||""),end:String(x.end_at||x.start_at||"")}));
    renderCalendar();renderInvitedMeetings();
    if(typeof refreshContactPresence==="function")refreshContactPresence();
  }catch{meetings=[];renderCalendar();renderInvitedMeetings()}
}
$("#calendar-prev").onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar()};$("#calendar-next").onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar()};$("#calendar-today").onclick=()=>{calendarCursor=new Date();renderCalendar()};$("#new-event").onclick=()=>$("#event-dialog").showModal();$("#event-form").addEventListener("submit",async e=>{if(e.submitter?.value==="cancel"){e.target.closest("dialog").close();return}e.preventDefault();if(!currentUserId){toast("Sign in to create meetings");return}const title=$("#event-title").value.trim(),start=$("#event-start").value,end=$("#event-end").value;if(new Date(end)<=new Date(start)){toast("End time must be after start time");return}try{await db("medha_communications_meetings",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({title,start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString(),invitee_ids:$("#event-invitees").value.split(",").map(x=>x.trim()).filter(Boolean),created_by:currentUserId})});$("#event-dialog").close();e.target.reset();await loadMeetings();toast("Meeting created")}catch(err){toast(err.message)}});
function openEventForCalendarDate(day){const date=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),day,9,0);const end=new Date(date);end.setHours(10);const localValue=value=>{const pad=n=>String(n).padStart(2,"0");return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`};$("#event-form").reset();$("#event-start").value=localValue(date);$("#event-end").value=localValue(end);$("#event-dialog").showModal()}
$("#calendar-grid").addEventListener("dblclick",event=>{const cell=event.target.closest("#calendar-grid>div");if(!cell||cell.classList.contains("muted"))return;const first=(new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1).getDay()+6)%7;const day=[...$("#calendar-grid").children].indexOf(cell)-first+1;if(day>0)openEventForCalendarDate(day)});
document.querySelectorAll("#event-start,#event-end").forEach(input=>input.addEventListener("click",()=>input.showPicker?.()));document.querySelectorAll("dialog .close-dialog").forEach(button=>button.addEventListener("click",()=>button.closest("dialog").close()));
const locationInput=document.createElement("input");locationInput.id="event-location";locationInput.maxLength=240;locationInput.placeholder="Optional meeting location";const locationLabel=document.createElement("label");locationLabel.textContent="Meeting location";locationLabel.append(locationInput);const locationTags=document.createElement("div");locationTags.className="location-tags";locationTags.innerHTML='<button type="button" data-location-tag="Online">Online</button><button type="button" data-location-tag="Office">Office</button>';locationLabel.append(locationTags);$("#event-invitees").closest("label").before(locationLabel);locationTags.addEventListener("click",e=>{const tag=e.target.closest("[data-location-tag]");if(tag)locationInput.value=tag.dataset.locationTag});window.addEventListener("communications:add-suggestion-event",event=>{const d=event.detail||{},dateText=String(d.start||""),dateMatch=dateText.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)||dateText.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:.*?(\d{4}))?/),date=dateMatch?(dateMatch[3]?new Date(+dateMatch[3],+dateMatch[1]-1,+dateMatch[2]):new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]||new Date().getFullYear()}`)):new Date(),timeMatch=String(d.time||"").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i),hour=timeMatch?(+timeMatch[1]%12)+(timeMatch[3].toUpperCase()==="PM"?12:0):9,minute=timeMatch?+(timeMatch[2]||0):0,pad=n=>String(n).padStart(2,"0"),value=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}`;$("#event-form").reset();$("#event-title").value=d.title||"";$("#event-start").value=value;const end=new Date(date);end.setHours(hour+1,minute,0,0);$("#event-end").value=`${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;locationInput.value=d.location&&d.location!=="Not published"?d.location:"";$("#event-dialog").showModal()});
$("#event-title").closest("label").childNodes[0].textContent="Event Title";$("#event-title").placeholder="Event title";
const communicationsDb=db;db=async(path,options={})=>{if(path==="medha_communications_meetings"&&options.method==="POST"&&options.body){const payload=JSON.parse(options.body);payload.location=$("#event-location")?.value.trim()||null;options={...options,body:JSON.stringify(payload)}}return communicationsDb(path,options)};
let editingMeeting=null;const eventDialogTitle=$("#event-dialog h2"),eventDialogSubmit=$("#event-form button[value=default]");function dateTimeValue(value){if(!value)return"";const d=new Date(value),pad=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}function openMeetingEditor(meeting){editingMeeting=meeting;eventDialogTitle.textContent="Edit event";eventDialogSubmit.textContent="Save changes";$("#event-title").value=meeting.title||"";$("#event-start").value=dateTimeValue(meeting.start);$("#event-end").value=dateTimeValue(meeting.end);$("#event-invitees").value=(meeting.invitee_ids||[]).join(",");$("#event-location").value=meeting.location||"";$("#event-dialog").showModal()}$("#calendar-grid").addEventListener("click",async event=>{
  const marker=event.target.closest("#calendar-grid i");
  if(!marker)return;
  /* Markers carry their meeting id, so clicking any day of a multi-day
     event opens the right one. Matching on title plus date used to fail
     on every day except the first. */
  const meeting=meetings.find(item=>String(item.id)===String(marker.dataset.meetingId));
  if(!meeting)return;
  try{
    const rows=await db(`medha_communications_meetings?id=eq.${encodeURIComponent(meeting.id)}&select=id,title,start_at,end_at,invitee_ids,location`);
    openMeetingEditor({...meeting,...(rows?.[0]||{}),start:rows?.[0]?.start_at||meeting.start,end:rows?.[0]?.end_at||meeting.end});
  }catch{openMeetingEditor(meeting)}
});$("#event-form").addEventListener("submit",async event=>{if(!editingMeeting)return;event.preventDefault();event.stopImmediatePropagation();if(!currentUserId){toast("Sign in to edit events");return}const title=$("#event-title").value.trim(),start=$("#event-start").value,end=$("#event-end").value;if(new Date(end)<=new Date(start)){toast("End time must be after start time");return}try{await db(`medha_communications_meetings?id=eq.${encodeURIComponent(editingMeeting.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({title,start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString(),location:$("#event-location").value.trim()||null,invitee_ids:$("#event-invitees").value.split(",").map(x=>x.trim()).filter(Boolean)})});$("#event-dialog").close();event.target.reset();editingMeeting=null;eventDialogTitle.textContent="New meeting";eventDialogSubmit.textContent="Create meeting";await loadMeetings();toast("Event updated")}catch(error){toast(error.message)}},true);
$("#new-event").addEventListener("click",()=>{editingMeeting=null;eventDialogTitle.textContent="New meeting";eventDialogSubmit.textContent="Create meeting"});
const calendarRender=renderCalendar;renderCalendar=function(){calendarRender();const list=$("#calendar-sidebar-list"),future=meetings.filter(x=>x.start&&new Date(x.end||x.start)>=new Date()).sort((a,b)=>new Date(a.start)-new Date(b.start));if(list)list.innerHTML=future.length?future.map(x=>{
  const s=new Date(x.start),e=new Date(x.end||x.start);
  const multi=s.toDateString()!==e.toDateString();
  const when=multi?`${s.toLocaleDateString([],{month:"short",day:"numeric"})} – ${e.toLocaleDateString([],{month:"short",day:"numeric"})}`
                  :s.toLocaleDateString([],{month:"short",day:"numeric"});
  const sub=multi?`${Math.round((e-s)/86400000)+1} days`:s.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  return `<div class="calendar-side-event"><time>${esc(when)}</time><div><strong>${esc(x.title||"Meeting")}</strong><span>${esc(sub)}</span></div></div>`;
}).join(""):"<div class=\"empty-state\">No upcoming meetings.</div>"};
function externalStartDate(value){const text=String(value||""),numeric=text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/),named=text.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:.*?(\d{4}))?/);if(numeric)return new Date(Number(numeric[3]),Number(numeric[1])-1,Number(numeric[2]));if(named){const year=Number(named[3]||new Date().getFullYear()),date=new Date(`${named[1]} ${named[2]}, ${year}`);if(!Number.isNaN(date.getTime()))return date}return null}
async function loadSuggestions(){const list=$("#suggestions-list");try{const [eventsResponse,exhibitionsResponse]=await Promise.all([fetch("https://medha-newsevents.vercel.app/api/events"),fetch("https://medha-newsevents.vercel.app/api/exhibitions")]);if(!eventsResponse.ok||!exhibitionsResponse.ok)throw Error("Events & News unavailable");const [events,exhibitions]=await Promise.all([eventsResponse.json(),exhibitionsResponse.json()]),items=[...(events.sources||[]).flatMap(source=>(source.items||[]).map(item=>({...item,kind:"Event"}))),...(exhibitions.sources||[]).flatMap(source=>(source.items||[]).map(item=>({...item,kind:"Exhibition"})))].map(item=>({...item,start:externalStartDate(item.date)})).filter(item=>item.start&&item.start>=new Date()).sort((a,b)=>a.start-b.start).slice(0,20);list.innerHTML=items.length?items.map(item=>`<a class="suggestion-item" href="${esc(item.link||"https://medha-newsevents.vercel.app/")}" target="_blank" rel="noopener"><span>${item.kind}</span><strong>${esc(item.title)}</strong><time>${item.start.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"})}</time></a>`).join(""):"<div class=\"empty-state\">No upcoming events or exhibitions.</div>"}catch{list.innerHTML='<div class="empty-state">Events &amp; News is unavailable.</div>'}}

/* ---------- event invitees ---------- */

const eventInvitees=new Set(),eventInviteeSearch=$("#event-invitees"),eventInviteeList=document.createElement("div");eventInviteeList.className="employee-list event-invitee-list";eventInviteeSearch.placeholder="Search Medha employees to invite...";eventInviteeSearch.after(eventInviteeList);function renderEventInvitees(query=""){const q=query.toLowerCase();const matches=directory.filter(p=>`${p.full_name} ${p.email||""} ${p.department||""}`.toLowerCase().includes(q));eventInviteeList.innerHTML=matches.length?matches.map(p=>`<button type="button" class="employee-option ${eventInvitees.has(p.id)?"selected":""}" data-event-person-id="${esc(p.id)}"><div class="person-avatar blue">${esc(initialsFor(p.full_name))}</div><div><strong>${esc(p.full_name)}</strong><small>${esc(p.department||"")} ${p.department&&p.email?" · ":""}${esc(p.email||"")}</small></div><span class="invite-check">${eventInvitees.has(p.id)?"✓":""}</span></button>`).join(""):"<div class=\"directory-empty\">No Medha employees found</div>"}eventInviteeSearch.addEventListener("input",e=>renderEventInvitees(e.target.value));eventInviteeList.addEventListener("click",e=>{const button=e.target.closest("[data-event-person-id]");if(!button)return;const id=button.dataset.eventPersonId;if(eventInvitees.has(id))eventInvitees.delete(id);else eventInvitees.add(id);eventInviteeSearch.value="";eventInviteeSearch.value=[...eventInvitees].join(",");renderEventInvitees("")});$("#new-event").onclick=async()=>{$("#event-dialog").showModal();eventInvitees.clear();eventInviteeSearch.value="";await loadEmployeeDirectory();renderEventInvitees("")};

/* ---------- workspace views ---------- */

function setWorkspaceView(viewName){
  const conversationView=viewName==="chat"||viewName==="favorites";
  const baseView=conversationView?"chat":viewName;
  /* Details and threads belong to the currently visible chat only. Never
     carry either surface into Favorites, Calendar, or Settings. */
  closeThread();
  closeDetails();
  if(viewName==="chat"){
    chatFilter="all";
    document.querySelectorAll(".sidebar-tabs .tab").forEach((tab,index)=>tab.classList.toggle("active",index===0));
    /* Chat is a separate navigation destination. Paint the cached full
       conversation list immediately when returning from Favorites; Stream
       synchronization can replace it afterward without a blank state. */
    hydrateFromCache();
    renderList();
    /* Returning to Chat does not go through switchChat, so nothing would
       fetch the open conversation. Paint whatever is cached, then top it up
       from the server. */
    if(active&&streamClient){
      const chat=active;
      (async()=>{
        try{
          await watchStreamChannel(chat);
          if(!chat.messagesLoaded||chat.fromCache){
            await loadChatPage(chat,0);
            chat.fromCache=false;
            if(active?.id===chat.id)scrollMessagesToEnd();
          }
        }catch(error){toast(error.message)}
      })();
    }
  }
  document.querySelectorAll(".rail-item[data-view]").forEach(item=>item.classList.toggle("active",item.dataset.view===baseView));
  document.querySelectorAll(".rail-item[data-rail-filter]").forEach(item=>item.classList.remove("active"));
  document.querySelectorAll(".view").forEach(view=>{
    const activeView=view.id===`${baseView}-view`;
    view.classList.toggle("active-view",activeView);
    view.hidden=!activeView;
    view.style.display=activeView?"flex":"none";
  });
  const shell=document.querySelector(".app-shell");
  shell.classList.toggle("calendar-mode",viewName==="calendar");
  /* Settings hides the chat sidebar but its 300px grid column stayed, so the
     page rendered inside that narrow slot - a 220px card on a 1440px screen.
     full-page collapses the unused columns so the view gets the real width. */
  shell.classList.toggle("full-page",viewName==="settings");
  $("#chat-sidebar").style.display=conversationView?"flex":"none";
  const calendarSidebar=$("#calendar-sidebar");calendarSidebar.hidden=viewName!=="calendar";calendarSidebar.style.display=viewName==="calendar"?"flex":"none";if(viewName==="calendar")shell.style.gridTemplateColumns="80px 280px minmax(500px,1fr) 0";else shell.style.removeProperty("grid-template-columns");
  if(viewName==="calendar") renderCalendar();
  if(viewName==="settings") renderSettings();
}
function renderSettings(){
  const name=currentAppUser?.full_name||currentAppUser?.name||streamClient?.user?.name||"Signed-in user";
  const email=currentAppUser?.email||streamClient?.user?.email||"";
  const avatar=$("#settings-avatar");
  if(avatar){avatar.textContent=initialsFor(name);avatar.className="person-avatar blue large"}
  if($("#settings-name"))$("#settings-name").textContent=name;
  if($("#settings-email"))$("#settings-email").textContent=email||"No email available";
  if($("#setting-sound"))$("#setting-sound").checked=soundEnabled();
  if($("#setting-presence"))$("#setting-presence").checked=presenceEnabled();
}
$("#setting-sound")?.addEventListener("change",event=>{
  savePreference("sound",event.target.checked);
  if($("#settings-note"))$("#settings-note").textContent=event.target.checked?"Notification sounds enabled":"Notification sounds disabled";
});
$("#setting-presence")?.addEventListener("change",async event=>{
  const enabled=event.target.checked;
  savePreference("presence",enabled);
  if(!enabled){contactPresence.set(String(viewerId()),{is_open:false,presence_enabled:false,last_seen:new Date().toISOString()});}
  await publishPresence(enabled);
  setPresenceLabel();renderList();
  if($("#settings-note"))$("#settings-note").textContent=enabled?"Your status is visible to teammates":"Your status is hidden from teammates";
});
document.querySelectorAll(".rail-item[data-view]").forEach(item=>item.onclick=()=>setWorkspaceView(item.dataset.view));
document.querySelectorAll(".rail-item[data-rail-filter]").forEach(item=>item.onclick=()=>{
  setWorkspaceView("favorites");
  document.querySelectorAll(".sidebar-tabs .tab").forEach(tab=>tab.classList.remove("active"));
  chatFilter=item.dataset.railFilter;
  item.classList.add("active");
  renderList();
});
setWorkspaceView("chat");
renderCalendar();

/* ---------- presence ---------- */
const contactPresence=new Map();let presenceTimer=null;
function meetingStatusFor(userId){
  const now=Date.now();
  return meetings.some(meeting=>(String(meeting.created_by)===String(userId)||(meeting.invitee_ids||[]).map(String).includes(String(userId)))
    &&new Date(meeting.start).getTime()<=now&&new Date(meeting.end||meeting.start).getTime()>=now);
}
function setPresenceLabel(){
  const statusRow=$("#conversation-status")?.parentElement;
  const detail=$(".details-person .presence");
  const dot=$(".conversation-header .online-dot");
  if(active?.kind==="group"){
    if(statusRow)statusRow.hidden=true;
    if(detail){detail.textContent="";detail.hidden=true}
    if(dot)dot.hidden=true;
    return;
  }
  if(statusRow)statusRow.hidden=false;
  if(detail)detail.hidden=false;
  if(dot)dot.hidden=false;
  const userId=active?.participantId;
  const statusEl=$("#conversation-status");
  if(!userId){statusEl.textContent="";return}
  const state=presenceFor(userId);
  if(state==="hidden"){
    statusEl.textContent="";statusEl.className="";
    if(detail){detail.textContent="";detail.hidden=true}
    if(dot)dot.hidden=true;
    return;
  }
  const label=state.charAt(0).toUpperCase()+state.slice(1);
  statusEl.textContent=label;statusEl.className=state;
  if(detail){detail.textContent=label;detail.className=`presence ${state}`}
  if(dot){dot.className=`online-dot ${state}`}
}

/* Presence for EVERY person in the sidebar, not just the open chat, so
   the list can show a live dot next to each name. */
async function refreshContactPresence(){
  const ids=[...new Set(conversations.map(c=>c.participantId).filter(Boolean).map(String))];
  if(!ids.length){setPresenceLabel();return}
  try{
    const list=ids.map(id=>`"${id.replace(/"/g,'')}"`).join(",");
    try{
      const rows=await db(`medha_communications_presence?user_id=in.(${list})&select=user_id,is_open,last_seen,presence_enabled`);
      (rows||[]).forEach(r=>contactPresence.set(String(r.user_id),r));
    }catch{
      const rows=await db(`medha_communications_presence?user_id=in.(${list})&select=user_id,is_open,last_seen`);
      (rows||[]).forEach(r=>contactPresence.set(String(r.user_id),r));
    }
    setPresenceLabel();
    renderList();
  }catch{}
}

/* One place that decides Online / Busy / Offline for a person. */
function presenceFor(userId){
  if(!userId)return "offline";
  const record=contactPresence.get(String(userId));
  if(record?.presence_enabled===false)return "hidden";
  if(String(userId)===String(viewerId()))return "online";
  if(meetingStatusFor(userId))return "busy";
  const fresh=record?.is_open&&Date.now()-new Date(record.last_seen).getTime()<45000;
  return fresh?"online":"offline";
}
async function publishPresence(isOpen){
  if(!viewerId())return;
  try{
    await db("medha_communications_presence",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({user_id:viewerId(),is_open:presenceEnabled()&&isOpen,presence_enabled:presenceEnabled(),last_seen:new Date().toISOString()})});
  }catch{}
}
function startPresenceHeartbeat(){
  if(presenceTimer)clearInterval(presenceTimer);
  /* Online means the tab is OPEN, not focused. A background tab still
     counts - previously visibilityState made you look offline the moment
     you switched tabs. Only closing the page marks you offline. */
  const publish=()=>{if(presenceEnabled())publishPresence(true)};
  publish();
  presenceTimer=setInterval(publish,15000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")publish()});
  window.addEventListener("pagehide",()=>{publishPresence(false);writeCache()});
  window.addEventListener("beforeunload",()=>publishPresence(false));
}

/* ---------- incoming message sync + notifications ---------- */
let syncInProgress=false;
let notificationCursor=new Date().toISOString();
const pingedMessageIds=new Set();
let notificationReady=false,audioContext=null;
/* Browsers only allow audio after a user gesture, and a resumed context can
   be suspended again when the tab is backgrounded. Unlock on the first
   gesture, then re-check before every ping. Not once:true — if the first
   attempt is blocked, later gestures get another chance. */
function unlockNotifications(){
  try{
    audioContext??=new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==="suspended")audioContext.resume();
  }catch{}
  notificationReady=true;
}
["pointerdown","keydown","touchstart"].forEach(evt=>
  document.addEventListener(evt,unlockNotifications,{capture:true,passive:true}));
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&audioContext?.state==="suspended")
    audioContext.resume().catch(()=>{});
});
function playIncomingPing(){
  if(!soundEnabled())return;
  try{
    audioContext??=new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==="suspended"){audioContext.resume().catch(()=>{})}
    if(audioContext.state!=="running")return;
    const ctx=audioContext,now=ctx.currentTime,DUR=1.1;

    /* One warm bell: a root note with two quieter harmonics, a soft swell
       instead of a click, and a long even decay so it fades out gently.
       No compressor - it was pulling the level down rather than adding
       loudness. The gain is held near full scale for most of the sound. */
    const master=ctx.createGain();
    master.gain.setValueAtTime(0.0001,now);
    master.gain.linearRampToValueAtTime(0.95,now+0.05);      /* soft swell */
    master.gain.setValueAtTime(0.95,now+0.42);               /* hold, stays loud */
    master.gain.exponentialRampToValueAtTime(0.0001,now+DUR);/* smooth fade */

    /* Rounds off the top end so the tone is warm, not piercing. */
    const tone=ctx.createBiquadFilter();
    tone.type="lowpass";
    tone.frequency.setValueAtTime(3200,now);
    tone.Q.setValueAtTime(0.5,now);
    master.connect(tone);
    tone.connect(ctx.destination);

    /* G5 with its octave and twelfth, each softer than the last. */
    [{f:784,g:0.95},{f:1568,g:0.25},{f:2352,g:0.10}].forEach(p=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.type="sine";
      osc.frequency.setValueAtTime(p.f,now);
      gain.gain.setValueAtTime(p.g,now);
      /* Upper partials fade first, the way a real bell behaves. */
      gain.gain.exponentialRampToValueAtTime(p.g*0.04,now+DUR*(p.f>1000?0.6:1));
      osc.connect(gain).connect(master);
      osc.start(now);
      osc.stop(now+DUR+0.05);
    });
  }catch{}
}

/* Type testping() in the browser console to hear the sound on demand.
   If that is silent the problem is the audio device, tab mute or system
   volume - not the message polling. */
/* Exposed for diagnostics and tests. */
window.__space={get presenceFor(){return presenceFor},get writeCache(){return writeCache},
  get readCache(){return readCache},get hydrateFromCache(){return hydrateFromCache},
  get conversations(){return conversations},set conversations(v){conversations=v},
  get active(){return active},set active(v){active=v},
  get contactPresence(){return contactPresence},
  set currentUserId(v){currentUserId=v},
  /* Exposed so the feature tests can drive the same functions the UI calls,
     rather than re-implementing them. */
  get setTyping(){return setTyping},get renderTyping(){return renderTyping},
  get applyLocalReaction(){return applyLocalReaction},get toggleReaction(){return toggleReaction},
  get resolveMentions(){return resolveMentions},get openThread(){return openThread},
  get renderThread(){return renderThread},get closeThread(){return closeThread},
  get renderList(){return renderList},get renderMessages(){return renderMessages},
  get messageHtml(){return messageHtml},get findMessageEverywhere(){return findMessageEverywhere},
  get directory(){return directory},set directory(v){directory=v},
  get streamChannels(){return streamChannels},
  get watchStreamChannel(){return watchStreamChannel},
  get showBanner(){return showBanner},get dismissBanner(){return dismissBanner},
  get renderPending(){return renderPending},get openAttachmentPreview(){return openAttachmentPreview},
  get openEditDialog(){return openEditDialog},get openForwardDialog(){return openForwardDialog},
  get attachmentsHtml(){return attachmentsHtml},get fileSizeLabel(){return fileSizeLabel},
  get fileGlyph(){return fileGlyph},get queueAttachment(){return queueAttachment},
  get pendingAttachments(){return pendingAttachments},
  set pendingAttachments(v){pendingAttachments=v},
  get renderGroupMembers(){return renderGroupMembers},
  get selectedGroupMembers(){return selectedGroupMembers},
  get ensureDevicePermission(){return ensureDevicePermission},
  get readPermissionStore(){return readPermissionStore},
  get writePermissionStore(){return writePermissionStore},
  resetPermissionCache(){permissionState=null},
  set chatFilter(v){chatFilter=v},get chatFilter(){return chatFilter}};
window.testping=()=>{
  unlockNotifications();
  playIncomingPing();
  const ctx=audioContext;
  return ctx?`audio context: ${ctx.state}`:"audio context could not be created";
};

function notificationText(text){
  const words=String(text||"New message").trim().split(/\s+/);
  return words.slice(0,10).join(" ")+(words.length>10?" …":"");
}
function showDesktopNotification(row,explicitTitle=""){
  if("Notification" in window&&Notification.permission==="granted"){
    const chat=conversations.find(c=>String(c.cid)===String(row.cid));
    try{new Notification(explicitTitle||chat?.name||"New message",{body:notificationText(row.body),tag:`medha-message-${row.id}`})}catch{}
  }
}
async function syncIncomingMessages(){
  if(streamClient)return;
  if(!viewerId()||syncInProgress)return;
  syncInProgress=true;
  try{
    await hydrateConversations();
    if(active?.messagesLoaded)await refreshActiveMessages();
    const ids=conversations.map(c=>c.cid).filter(Boolean);
    if(!ids.length)return;
    const list=ids.join(",");
    const rows=await db(`medha_communications_messages?cid=in.(${list})&sender_id=neq.${encodeURIComponent(viewerId())}&created_at=gt.${encodeURIComponent(notificationCursor)}&select=id,cid,sender_id,body,created_at&order=created_at.asc`);
    /* Advance the cursor to the newest message we actually saw, using the
       database's own timestamp. Setting it to the browser clock skipped
       anything that arrived while this sync was running, and any clock
       skew between the browser and the database made it worse - which is
       why new messages often never pinged. */
    if((rows||[]).length){
      notificationCursor=rows[rows.length-1].created_at;
    }
    /* One ping per batch, so ten messages arriving together do not
       machine-gun the speaker. Push notifications are handled server-side
       and are deliberately untouched here. */
    const fresh=(rows||[]).filter(row=>!pingedMessageIds.has(String(row.id)));
    fresh.forEach(row=>pingedMessageIds.add(String(row.id)));
    if(pingedMessageIds.size>500){
      /* Keep the guard set small; anything this old cannot recur. */
      pingedMessageIds.clear();
    }
    if(fresh.length)playIncomingPing();
    fresh.forEach(row=>{
      const chat=conversations.find(c=>String(c.cid)===String(row.cid));
      if(chat&&chat.cid!==active?.cid)chat.unread=(chat.unread||0)+1;
      else if(chat&&chat.cid===active?.cid)markConversationRead(chat);
      if(notificationReady)showDesktopNotification(row);
    });
    if(fresh.length)renderList();
  }catch{}
  finally{syncInProgress=false}
}

/* ---------- profile + boot ---------- */
const spaceLaunchLoader=document.querySelector("#space-launch-loader");
const spaceLoaderStatus=document.querySelector("#space-loader-status");
function finishSpaceLoading(message){
  if(spaceLoaderStatus&&message)spaceLoaderStatus.textContent=message;
  document.body.classList.remove("space-booting");
  spaceLaunchLoader?.setAttribute("aria-hidden","true");
}
async function loadCurrentProfile(user){
  if(!user)return;
  let name=user.displayName||user.email||"Signed-in user";
  try{
    const rows=await db(`users?id=eq.${encodeURIComponent(user.uid)}&select=id,full_name,email,department,role,is_active`);
    currentAppUser=rows?.[0]||null;
    name=currentAppUser?.full_name||name;
  }catch{currentAppUser=null}
  $("#current-user").textContent=name;
  $("#current-user-initials").textContent=initialsFor(name);
}

let syncTimer=null;
async function initializeAuthorizedUser(user){
  if(!user)return;
  currentUserId=user.uid;
  try{firebaseIdToken=await user.getIdToken()}catch{firebaseIdToken=null}
  $("#current-user").textContent=user.displayName||user.email||"Authenticating…";
  await loadCurrentProfile(user);
  try{await initializeStream(user)}catch(error){toast(error.message);finishSpaceLoading("Stream connection unavailable");return}
  /* Show the cached sidebar immediately; the fetch below replaces it. */
  hydrateFromCache();
  startPresenceHeartbeat();
  await Promise.all([hydrateConversations(),loadMeetings()]);
  /* Open the most recent chat and land on the newest message. The cache
     may already have set `active`, so this must not be skipped - that is
     what left the view sitting at the top of the day on refresh. */
  const openId=active?.id||conversations[0]?.id;
  if(openId)await switchChat(openId);
  if(syncTimer)clearInterval(syncTimer);
  syncTimer=setInterval(()=>{
    /* Stream's WebSocket delivers messages instantly. Presence is the only
       remaining periodic read, and it does not need a 5-second query. */
    if(document.visibilityState!=="hidden")refreshContactPresence();
  },15000);
  setInterval(async()=>{try{firebaseIdToken=await user.getIdToken(true)}catch{}},30*60*1000);
  /* Register an existing permission silently. On iOS/iPadOS the first
     permission request must happen from a user gesture, so subscribe from
     the first pointer interaction when permission is still undecided. */
  if("Notification" in window&&Notification.permission==="granted"){
    writePermissionStore("notifications","granted");
    setupWebPush(user,false);
  }
  /* Asked once per device. If the person dismisses the prompt we do not ask
     again on the next visit - Notification.permission stays "default" in
     that case, so without this flag every reload would prompt afresh. */
  if("Notification" in window&&Notification.permission==="default"&&!readPermissionStore().notifications_asked){
    document.addEventListener("pointerdown",async()=>{
      writePermissionStore("notifications_asked",true);
      await setupWebPush(user,true);
      writePermissionStore("notifications",Notification.permission);
    },{once:true});
  }
  if("Notification" in window&&Notification.permission==="denied")writePermissionStore("notifications","denied");
}

async function authorizeHubLaunch(){
  if(!launchToken){
    if(location.hostname==="localhost"){
      try{
        await ensureDirectory();
        const cachedUser={id:"Ogwzr3nw5EeXtQLYA2ZMwEJEdIU2",name:"Saksham Nirula"};
        currentUserId=cachedUser.id;currentAppUser={id:cachedUser.id,full_name:cachedUser.name,email:""};
        hydrateFromCache();
        const localUser=await initializeStream(null);
        launchAuthorized=true;currentUserId=localUser.id;currentAppUser={id:localUser.id,full_name:localUser.name,email:""};
        $("#current-user").textContent=localUser.name;$("#current-user-initials").textContent=initialsFor(localUser.name);
        startPresenceHeartbeat();await Promise.all([hydrateConversations(),loadMeetings()]);
        const openId=active?.id||conversations[0]?.id;if(openId)await switchChat(openId);
        finishSpaceLoading("Local Stream workspace ready");launchGate.hidden=true;return;
      }catch(error){finishSpaceLoading(error.message||"Stream connection unavailable")}
    }
    launchGate.hidden=false;finishSpaceLoading("Waiting for a secure Hub launch");return
  }
  try{
    let customToken;
    if(location.hostname==="localhost"&&launchToken.startsWith("custom:")){customToken=launchToken.slice(7)}
    else{
      const r=await fetch("/api/hub-session",{method:"POST",headers:{Authorization:`Bearer ${launchToken}`}});
      if(!r.ok)throw Error();
      customToken=(await r.json()).customToken;
    }
    sessionStorage.setItem(launchStorageKey,launchToken);
    launchAuthorized=true;
    const signedIn=await signInWithCustomToken(auth,customToken);
    await initializeAuthorizedUser(signedIn.user);
    finishSpaceLoading("Your conversations are ready");
    launchGate.hidden=true;
    history.replaceState(null,"",location.pathname+location.search);
  }catch{
    sessionStorage.removeItem(launchStorageKey);
    launchAuthorized=false;
    finishSpaceLoading("Return to Medha Hub to open Space");
    launchGate.hidden=false;
    try{await signOut(auth)}catch{}
  }
}
onAuthStateChanged(auth,user=>{
  if(!launchAuthorized){currentUserId=null;return}
  if(user)initializeAuthorizedUser(user);
  else $("#current-user").textContent="Authentication required";
});

/* Calendar event actions use capture so the legacy marker listener cannot
   accidentally open the edit form when the event body is clicked. */
function meetingDetailsText(meeting){
  const start=new Date(meeting.start),end=new Date(meeting.end||meeting.start);
  const date=start.toLocaleDateString([], {weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const time=start.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})+" – "+end.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  const creator=directory.find(person=>String(person.id)===String(meeting.created_by));
  const invitees=(meeting.invitee_ids||[]).map(id=>directory.find(person=>String(person.id)===String(id))?.full_name||String(id)).filter(Boolean);
  return {date,time,creator:creator?.full_name||(String(meeting.created_by)===String(viewerId())?currentAppUser?.full_name:"Unknown employee")||"Unknown employee",invitees:invitees.length?invitees.join(", "):"No invitees"};
}
function openMeetingDetails(meeting){
  const details=meetingDetailsText(meeting);
  $("#event-details-title").textContent=meeting.title||"Untitled event";
  $("#event-details-when").textContent=details.date+" · "+details.time;
  $("#event-details-location").textContent=meeting.location||"No location";
  $("#event-details-creator").textContent=details.creator;
  $("#event-details-invitees").textContent=details.invitees;
  $("#event-details-dialog").showModal();
}
async function deleteMeeting(meeting){
  if(!meeting||!confirm(`Delete “${meeting.title||"this event"}”?`))return;
  try{
    await db(`medha_communications_meetings?id=eq.${encodeURIComponent(meeting.id)}`,{method:"DELETE",headers:{Prefer:"return=minimal"}});
    meetings=meetings.filter(item=>String(item.id)!==String(meeting.id));
    renderCalendar();toast("Event deleted");
  }catch(error){toast(error.message||"Could not delete event")}
}
document.addEventListener("click",async event=>{
  const marker=event.target.closest("#calendar-grid i");
  if(!marker)return;
  event.preventDefault();event.stopPropagation();
  const meeting=meetings.find(item=>String(item.id)===String(marker.dataset.meetingId));
  if(!meeting)return;
  const edit=event.target.closest("[data-edit-meeting]"),remove=event.target.closest("[data-delete-meeting]");
  if(remove){await deleteMeeting(meeting);return}
  if(edit){
    try{const rows=await db(`medha_communications_meetings?id=eq.${encodeURIComponent(meeting.id)}&select=id,title,start_at,end_at,invitee_ids,location`);openMeetingEditor({...meeting,...(rows?.[0]||{}),start:rows?.[0]?.start_at||meeting.start,end:rows?.[0]?.end_at||meeting.end})}catch{openMeetingEditor(meeting)}
    return;
  }
  openMeetingDetails(meeting);
},true);

renderList();
renderMessages();
authorizeHubLaunch();
loadSuggestions();
