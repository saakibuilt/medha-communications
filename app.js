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
let activeCallMode="video";
let activeMediaUnbinders=[];
let activeParticipantSubscription=null;
let activeParticipantSessionKey="";
let activeCallingSubscription=null;
let activeCallMediaEnabled=false;
let activeCallMediaPromise=null;
const streamChannels=new Map();

async function initializeStream(user){
  const localDev=!user&&location.hostname==="localhost";
  const token=localDev?null:await user.getIdToken();
  const response=await fetch("/api/stream-token",{method:"POST",headers:localDev?{"Content-Type":"application/json","X-Local-Stream-Dev":"true"}:{Authorization:`Bearer ${token}`},body:localDev?JSON.stringify({}):undefined});
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
    const message=event.message;
    if(!message||String(message.user?.id)===String(viewerId()))return;
    if(document.visibilityState!=="hidden")return;
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
  return {id:String(message.id),senderId,who:isMine(senderId)?"me":"them",parentId:message.parent_id||null,pinned:!!message.pinned,callId:message.call_id||null,pollId:message.poll_id||null,
    senderName:isMine(senderId)?(currentAppUser?.full_name||currentAppUser?.name||"You"):(profile?.full_name||message.user?.name||active?.name||"Unknown user"),text:message.text||"",
    attachments:(message.attachments||[]).map(a=>({kind:a.type==="image"?"image":"file",name:a.title||a.asset_url?.split("/").pop()||"File",url:a.image_url||a.asset_url||a.file_url||a.og_scrape_url})).filter(a=>a.url),
    reactions:(message.latest_reactions||[]).reduce((all,r)=>{(all[r.type]??=[]).push(r.user_id);return all},{}),createdAt:message.created_at,time:new Date(message.created_at||Date.now()).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})};
}
function streamChannelFor(chat){return streamChannels.get(String(chat.cid||chat.id))||null}
async function ensureStreamUsers(){
  if(!streamClient||!directory.length)return;
  const users=[{id:viewerId(),name:currentAppUser?.full_name||"Local Medha User"},...directory.map(person=>({id:String(person.id),name:person.full_name,image:person.avatar_url}))];
  const response=await fetch("/api/stream-users",{method:"POST",headers:{"Content-Type":"application/json",...(firebaseIdToken?{Authorization:`Bearer ${firebaseIdToken}`}:{"X-Local-Stream-Dev":"true"})},body:JSON.stringify({users})});
  const body=await response.json();if(!response.ok)throw Error(body.error||"Could not prepare Stream users");
}
async function watchStreamChannel(chat){
  const channel=streamChannelFor(chat)||streamClient.channel("messaging",chat.id,{members:[viewerId(),String(chat.participantId)]});
  streamChannels.set(String(chat.cid||chat.id),channel);chat.cid=channel.cid;
  await channel.watch();
  channel.on("message.new",event=>{
    if(event.message?.user?.id===viewerId())return;
    const incoming=streamMessageToApp(event.message);
    if(active?.cid===chat.cid){chat.messages=[...(chat.messages||[]).filter(m=>m.id!==incoming.id),incoming];chat.messagesLoaded=true;renderMessages();scrollMessagesToEnd();channel.markRead()}
    else{chat.unread=(chat.unread||0)+1;renderList()}
  });
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
async function db(path,options={}){
  const authHeader=USE_FIREBASE_JWT&&firebaseIdToken?{Authorization:`Bearer ${firebaseIdToken}`}:{};
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...options,headers:{...headers,...authHeader,"Content-Type":"application/json",...(options.headers||{})}});
  if(!r.ok){let detail="";try{detail=(await r.text()).slice(0,300)}catch{}throw Error(`Supabase ${r.status}${detail?`: ${detail}`:""}`)}
  if(r.status===204)return null;const t=await r.text();return t?JSON.parse(t):null}

function avatar(c,small=false){return `<div class="person-avatar ${c.color||"blue"}${small?" small":""}">${esc(c.initials||"")}</div>`}
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
        updatedAt:c.updatedAt,unread:c.unread||0
      }))
    };
    localStorage.setItem(CACHE_KEY(),JSON.stringify(payload));
    localStorage.setItem(TOP_CHATS_KEY(),JSON.stringify(ordered.slice(0,5).map(c=>({
      cid:c.cid,id:c.id,name:c.name,participantId:c.participantId,kind:c.kind,
      initials:c.initials,color:c.color,team:c.team,updatedAt:c.updatedAt
    }))));
  }catch{/* quota or private mode - the app works without the cache */}
}

/* Paint from cache before the first network response arrives. */
function hydrateFromCache(){
  const cached=readCache();
  const cachedConversations=cached?.conversations?.length?cached.conversations:readTopChatsCache();
  if(!cachedConversations.length)return false;
  conversations=cachedConversations.map(c=>{
    return {...c,preview:"",messages:[],
      messagesLoaded:false,
      messageOffset:0,
      hasMore:true,
      fromCache:true};
  });
  active=conversations.find(c=>c.id===cached.activeId)||conversations[0]||null;
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
  const pinned=JSON.parse(sessionStorage.getItem(`medha-pinned-${viewerId()||"guest"}`)||"[]").slice(0,3);
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
    if(chatFilter==="unread")return !!c.unread;
    if(chatFilter==="pinned")return rank.has(String(c.id));
    return true;
  });
  const people=q?directory.filter(person=>String(person.id)!==String(viewerId())&&`${person.full_name} ${person.email||""} ${person.department||""}`.toLowerCase().includes(q)&&!shown.some(chat=>String(chat.participantId)===String(person.id))):[];
  $("#chat-list").innerHTML=shown.length?shown.map(c=>{
    const state=presenceFor(c.participantId);
    const pinned=rank.has(String(c.id));
    return `<div class="chat-item ${active&&c.id===active.id?"selected":""}" data-id="${esc(c.id)}">
      <div class="avatar-stack">${avatar(c)}<i class="presence-dot ${state}" title="${state}"></i></div>
      <div class="chat-copy">
        <div class="chat-line">
          <strong>${pinned?'<span class="chat-pin" title="Pinned">\u{1F4CC}</span>':""}${favorites.includes(c.id)?'<span class="chat-fav">\u2605</span>':""}${esc(c.name)}</strong>
          <time>${esc(c.time||"")}</time>
        </div>
        <div class="chat-line-2">
          <p>${esc(c.preview||"")}</p>
          ${c.unread?`<span class="unread-badge">${c.unread>9?"9+":c.unread}</span>`:""}
        </div>
      </div>
    </div>`}).join("")
    :`<p class="empty">${chatFilter==="unread"?"No unread conversations."
       :chatFilter==="pinned"?"No pinned conversations. Long-press or right-click a chat to pin it."
       :q&&!people.length?"No conversations or people match that search."
       :"No conversations yet. Select + to start a chat."}</p>`;
  if(people.length){
    const heading=document.createElement("p");heading.className="search-result-heading";heading.textContent="People";$("#chat-list").prepend(heading);
    $("#chat-list").insertAdjacentHTML("beforeend",people.map(person=>`<div class="chat-item search-person" data-person-id="${esc(person.id)}"><div class="avatar-stack"><span class="person-avatar blue">${esc(initialsFor(person.full_name))}</span><i class="presence-dot ${presenceFor(person.id)}"></i></div><div class="chat-copy"><div class="chat-line"><strong>${esc(person.full_name)}</strong><time>Start chat</time></div></div></div>`).join(""));
  }
}

function messageHtml(m){
  const mine=m.who==="me";
  const links=(m.attachments||[]).length?m.attachments:((m.text||"").match(/https?:\/\/[^\s]+/g)||[]).filter(u=>/\.gif(?:$|\?)/i.test(u)||/giphy\.com|tenor\.com/i.test(u)).map(url=>({kind:"gif",url,name:"GIF"}));
  const reply=m.parentId?active?.messages?.find(item=>String(item.id)===String(m.parentId)):null;
  if(!m._decorated){if(reply)m.text="↩ "+reply.senderName+": "+(reply.text||"Attachment")+"\n"+m.text;if(m.pinned&&!String(m.text||"").startsWith("📌"))m.text="📌 "+m.text;m._decorated=true}
  const who=mine?{initials:initialsFor(currentAppUser?.full_name||"You"),color:"blue"}:{initials:active?.initials,color:active?.color};
  const reactions=Object.entries(m.reactions||{}).filter(([,u])=>Array.isArray(u)&&u.length);
  return `<div class="message ${mine?"mine":""}" data-message-id="${esc(m.id||"")}">${avatar(who,true)}<div class="message-body"><div class="message-meta"><strong>${esc(m.senderName||active?.name||"Unknown user")}</strong><time>${esc(m.time)}</time></div>${m.text?`<div class="bubble">${esc(m.text)}</div>`:""}${links.map(a=>a.kind==="gif"||a.kind==="image"?`<a class="message-gif" href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="${esc(a.name||"Attached image")}" loading="lazy"></a>`:`<a class="message-file" href="${esc(a.url)}" target="_blank" rel="noopener" download>📎 ${esc(a.name||"Attached file")}</a>`).join("")}${reactions.length?`<div class="stored-reactions">${reactions.map(([emoji,users])=>`<span title="${users.length} reaction${users.length===1?"":"s"}">${emoji}${users.length>1?` ${users.length}`:""}</span>`).join("")}</div>`:""}</div></div>`;
}

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
function renderDetailsPanel(){
  if(!active)return;
  const person=directory.find(p=>String(p.id)===String(active.participantId));
  const isSelf=String(active.participantId)===String(viewerId());
  const status=$("#conversation-status").textContent||"";
  const media=(active.messages||[]).flatMap(m=>m.attachments||[]);
  const facts=[
    detailRow("Name",active.name),
    detailRow("Status",isSelf?"This is you":status),
    detailRow("Email",person?.email)
  ].filter(Boolean).join("");
  const facts_el=$("#details-facts");
  if(facts_el)facts_el.innerHTML=facts||'<div class="directory-empty">No details available</div>';
  const presence=$(".details-person .presence");
  if(presence&&isSelf){presence.textContent="This is you";presence.className="presence"}
  $("#shared-media").innerHTML=media.length
    ?media.map(a=>a.kind==="gif"
      ?`<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name||"GIF")}"><img src="${esc(a.url)}" alt="Shared GIF" loading="lazy"></a>`
      :`<a href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.name||"File")}">📎 ${esc(a.name||"File")}</a>`).join("")
    :'<div class="directory-empty">No shared media</div>';
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
  renderDetailsPanel();
  const headerAvatar=$(".conversation-header .person-avatar"); if(headerAvatar)headerAvatar.outerHTML=avatar(active);
  const detailAvatar=$(".details-person .person-avatar"); if(detailAvatar)detailAvatar.outerHTML=avatar(active,false);
  const media=(active.messages||[]).flatMap(m=>m.attachments||[]);
  $("#shared-media").innerHTML=media.length?media.map(a=>`<a href="${esc(a.url)}" target="_blank" rel="noopener">${a.kind==="gif"?"GIF":"📎"}</a>`).join(""):'<div class="directory-empty">No shared media</div>';

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
    const messages=(state.messages||[]).map(streamMessageToApp);
    return {messages,hasMore:messages.length===PAGE_SIZE};
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

async function persistMessage(chat,text,attachments,extra={}){
  if(!streamClient)throw Error("Stream is not connected; messages were not sent");
  if(streamClient){
    const body=(text||"").trim()||(attachments?.length?"Attachment":"");
    if(!body)throw Error("Enter a message before sending");
    const channel=await watchStreamChannel(chat);
    const mentionIds=(chat.kind==="group"?directory.filter(person=>person.full_name&&body.toLowerCase().includes(`@${person.full_name.toLowerCase()}`)).map(person=>String(person.id)):[]);
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
  const me=viewerId();
  if(!me){conversations=[];active=null;renderList();renderMessages();return}
  if(!streamClient){conversations=[];active=null;renderList();renderMessages();return}
  if(streamClient){
    try{
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
        return {cid:channel.cid,id:channel.id,name,participantId:other,participantIds,kind,initials:initialsFor(name),color:kind==="group"?"purple":"blue",team:kind==="group"?"Group chat":"",
          preview:last?.text||"",updatedAt:channel.data?.last_message_at||channel.data?.updated_at||new Date().toISOString(),time:"",unread:channel.countUnread?.()||0,
          messages:[],messagesLoaded:false,messageOffset:0,hasMore:true,streamChannel:channel};
      });
      const previousCid=active?.cid;conversations=loaded;active=conversations.find(c=>c.cid===previousCid)||null;
      writeCache();
      renderList();renderMessages();return;
    }catch(error){toast(`Stream unavailable: ${error.message}`);return}
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
  if(chat.unread){chat.unread=0;markConversationRead(chat)}
  renderList();renderMessages();
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

/* Back / menu button in the conversation header, only shown on small screens. */
/* Small screens get a three-line menu button that opens the rail and the
   conversation list together, and a back arrow once a chat is open. */
const menuButton=document.createElement("button");
menuButton.type="button";menuButton.className="chat-menu-btn";menuButton.id="chat-menu";
menuButton.setAttribute("aria-label","Open menu");
menuButton.innerHTML='<span></span><span></span><span></span>';
$(".conversation-header").prepend(menuButton);
menuButton.addEventListener("click",openMobileSidebar);

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
function renderPending(){
  $("#pending-attachments").innerHTML=pendingAttachments.map((a,i)=>`<span class="attachment-chip">${a.kind==="gif"?"GIF":"📎"} ${esc(a.name||"GIF")} <button type="button" data-remove-attachment="${i}" aria-label="Remove attachment">×</button></span>`).join("");
}
$("#pending-attachments").addEventListener("click",e=>{
  const button=e.target.closest("[data-remove-attachment]");
  if(!button)return;
  pendingAttachments.splice(Number(button.dataset.removeAttachment),1);
  renderPending();
});

const messageInput=$("#message-input");
function autosizeComposer(){
  messageInput.style.height="auto";
  const max=Math.round((window.visualViewport?.height||window.innerHeight)*0.3);
  messageInput.style.height=`${Math.min(messageInput.scrollHeight,max)}px`;
  messageInput.style.overflowY=messageInput.scrollHeight>max?"auto":"hidden";
}
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
$("#file-input").addEventListener("change",async e=>{
  const files=[...e.target.files];e.target.value="";
  for(const file of files){
    if(file.size>25*1024*1024){toast(`${file.name} is larger than 25 MB`);continue}
    try{pendingAttachments.push(await uploadFile(file));renderPending()}
    catch(error){toast(error.message)}
  }
});

let sending=false;
$("#composer").addEventListener("submit",async e=>{
  e.preventDefault();
  if(sending)return;
  if(!active){toast("Select a conversation first");return}
  const text=messageInput.value.trim();
  if(!text&&!pendingAttachments.length)return;
  const attachments=[...pendingAttachments];
  sending=true;
  const sendButton=$(".send-button");sendButton.disabled=true;
  try{
    const saved=await persistMessage(active,text,attachments,replyTarget?{parent_id:replyTarget.id}:{});
    messageInput.value="";messageInput.placeholder="Type a new message";replyTarget=null;pendingAttachments=[];renderPending();autosizeComposer();
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
function openChatActions(row,event){
  const menu=$("#chat-actions");
  menu.hidden=false;menu.dataset.chatId=row.dataset.id;
  const pinned=JSON.parse(sessionStorage.getItem(`medha-pinned-${viewerId()||"guest"}`)||"[]");
  let pin=menu.querySelector('[data-chat-action="pin"]');
  if(!pin){pin=document.createElement("button");pin.type="button";pin.dataset.chatAction="pin";menu.prepend(pin)}
  pin.textContent=pinned.includes(row.dataset.id)?"📌 Unpin chat":"📌 Pin chat";
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
    const key=`medha-favorites-${viewerId()||"guest"}`;
    const items=JSON.parse(sessionStorage.getItem(key)||"[]");
    const next=items.includes(id)?items.filter(x=>x!==id):[...items,id];
    sessionStorage.setItem(key,JSON.stringify(next));renderList();
    toast(next.includes(id)?"Added to favorites":"Removed from favorites");
  }else if(action==="pin"){
    const key=`medha-pinned-${viewerId()||"guest"}`;
    const items=JSON.parse(sessionStorage.getItem(key)||"[]");
    let next;
    if(items.includes(id))next=items.filter(x=>x!==id);
    else if(items.length>=3){toast("You can pin up to 3 chats");next=items}
    else next=[...items,id];
    sessionStorage.setItem(key,JSON.stringify(next));renderList();
  }else if(action==="unread"){
    chat.unread=1;renderList();toast("Conversation marked unread");
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
    const rows=await db(`medha_communications_presence?user_id=in.(${list})&select=user_id,is_open,last_seen`);
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
function renderGroupMembers(){
  const list=$("#group-member-list");
  list.innerHTML=directory.filter(p=>String(p.id)!==String(viewerId())).map(p=>'<button type="button" class="employee-option '+(selectedGroupMembers.includes(String(p.id))?'selected':'')+'" data-group-person-id="'+esc(p.id)+'"><span class="person-avatar blue">'+esc(initialsFor(p.full_name))+'</span><span class="employee-copy"><strong>'+esc(p.full_name)+'</strong></span><span class="invite-check">'+(selectedGroupMembers.includes(String(p.id))?'✓':'')+'</span></button>').join("");
}
$("#new-group").addEventListener("click",async()=>{
  selectedGroupMembers=[];$("#group-chat-name").value="";$("#group-chat-dialog").showModal();
  await ensureDirectory();renderGroupMembers();
});
$("#group-member-list").addEventListener("click",e=>{
  const button=e.target.closest("[data-group-person-id]");if(!button)return;
  const id=String(button.dataset.groupPersonId);selectedGroupMembers=selectedGroupMembers.includes(id)?selectedGroupMembers.filter(x=>x!==id):[...selectedGroupMembers,id];renderGroupMembers();
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
    const chat={cid:channel.cid,id,name,participantId:selectedGroupMembers[0],participantIds:members,kind:"group",initials:initialsFor(name),color:"purple",team:"Group chat",preview:"",updatedAt:new Date().toISOString(),unread:0,messages:[],messagesLoaded:true,messageOffset:0,hasMore:false,streamChannel:channel};
    conversations.unshift(chat);active=chat;writeCache();$("#group-chat-dialog").close();renderList();renderMessages();toast("Group chat created");
  }catch(error){toast(error.message)}
});

/* ---------- details panel wiring ---------- */
$("#close-details").addEventListener("click",closeDetails);
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
function startRingTone(){
  stopRingTone();
  try{
    const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)throw Error("Audio is unavailable in this browser");
    ringAudioContext=ringAudioContext||new AudioContextClass();ringAudioContext.resume();
    const play=()=>{if(!ringAudioContext)return;const now=ringAudioContext.currentTime,gain=ringAudioContext.createGain();gain.gain.setValueAtTime(.001,now);gain.gain.exponentialRampToValueAtTime(.22,now+.12);gain.gain.exponentialRampToValueAtTime(.001,now+1.5);gain.connect(ringAudioContext.destination);[523.25,659.25,783.99].forEach((frequency,index)=>{const oscillator=ringAudioContext.createOscillator();oscillator.type="sine";oscillator.frequency.value=frequency;oscillator.connect(gain);oscillator.start(now+index*.12);oscillator.stop(now+1.6)});};
    play();ringTimer=setInterval(play,2200);
    if("vibrate" in navigator){navigator.vibrate([260,120,260,500]);ringVibrationTimer=setInterval(()=>navigator.vibrate([260,120,260,500]),2200)}
  }catch{}
}
function stopRingTone(){if(ringTimer){clearInterval(ringTimer);ringTimer=null}if(ringVibrationTimer){clearInterval(ringVibrationTimer);ringVibrationTimer=null}try{navigator.vibrate?.(0)}catch{}if(incomingCallTimeout){clearTimeout(incomingCallTimeout);incomingCallTimeout=null}if(ringAudioContext?.state!=="closed")try{ringAudioContext?.suspend()}catch{} }
document.addEventListener("pointerdown",()=>{if(ringTimer)try{ringAudioContext?.resume()}catch{}},{passive:true});
function showCallSurface(call,title,mode){
  activeCall=call;activeCallMode=mode;activeCallMediaEnabled=call.state.callingState===CallingState.JOINED;const dialog=$("#call-dialog");dialog.classList.toggle("audio-call",mode==="audio");dialog.classList.toggle("video-call",mode!=="audio");dialog.classList.remove("incoming-call");$("#call-title").textContent=title;$("#incoming-call-actions").hidden=true;$("#call-dialog").showModal();
  activeParticipantSubscription?.unsubscribe?.();activeParticipantSubscription=null;activeParticipantSessionKey="";activeMediaUnbinders.forEach(unbind=>{try{unbind()}catch{}});activeMediaUnbinders=[];
  const holder=$("#call-participants");holder.innerHTML="";call.setViewport(holder);
  activeParticipantSubscription=call.state.participants$.subscribe(participants=>{const sessionKey=participants.map(participant=>`${participant.sessionId}:${participant.isLocalParticipant?"local":"remote"}`).sort().join("|");if(sessionKey===activeParticipantSessionKey)return;activeParticipantSessionKey=sessionKey;activeMediaUnbinders.forEach(unbind=>{try{unbind()}catch{}});activeMediaUnbinders=[];holder.innerHTML="";participants.forEach(participant=>{const tile=document.createElement("div");tile.className="call-participant";const participantId=String(participant.user?.id||participant.user_id||"");const profile=directory.find(person=>String(person.id)===participantId);const label=document.createElement("strong");label.textContent=participant.user?.name||profile?.full_name||participant.name||participantId||"Participant";tile.append(label);let video=null;if(mode!=="audio"){video=document.createElement("video");video.autoplay=true;video.playsInline=true;video.muted=participant.isLocalParticipant;video.dataset.sessionId=participant.sessionId;tile.append(video)}let audio=null;if(!participant.isLocalParticipant){audio=document.createElement("audio");audio.autoplay=true;audio.playsInline=true;audio.dataset.sessionId=participant.sessionId;tile.append(audio)}holder.append(tile);if(video){try{const untrack=call.trackElementVisibility(video,participant.sessionId,"videoTrack");if(typeof untrack==="function")activeMediaUnbinders.push(untrack);const unbind=call.bindVideoElement(video,participant.sessionId,"videoTrack");if(typeof unbind==="function")activeMediaUnbinders.push(unbind);video.play().catch(()=>{})}catch(error){console.warn("Could not bind participant video",error)}}if(audio){try{const unbind=call.bindAudioElement(audio,participant.sessionId);if(typeof unbind==="function")activeMediaUnbinders.push(unbind);audio.play().catch(()=>{})}catch(error){console.warn("Could not bind participant audio",error)}}})});
  activeCallingSubscription?.unsubscribe?.();activeCallingSubscription=call.state.callingState$.subscribe(state=>{if(state===CallingState.JOINED){enableCallMedia(call,mode).catch(error=>toast(error.message||"Could not start call media"))}else if(state!==CallingState.JOINED){$("#toggle-call-mic").classList.add("off");$("#toggle-call-camera").classList.add("off")}});
  if(activeCallMediaEnabled)enableCallMedia(call,mode).catch(error=>toast(error.message||"Could not start call media"));
  $("#toggle-call-mic").classList.toggle("off",!activeCallMediaEnabled||call.microphone.state.status!=="enabled");$("#toggle-call-camera").classList.toggle("off",mode!=="video"||!activeCallMediaEnabled||call.camera.state.status!=="enabled");
}
async function enableCallMedia(call,mode){
  if(activeCall!==call||call.state.callingState!==CallingState.JOINED)return;
  if(activeCallMediaEnabled)return;
  if(activeCallMediaPromise)return activeCallMediaPromise;
  activeCallMediaPromise=(async()=>{await call.microphone.enable();if(mode==="video")await call.camera.enable();else await call.camera.disable().catch(()=>{});activeCallMediaEnabled=true})().finally(()=>{activeCallMediaPromise=null});
  await activeCallMediaPromise;
  $("#toggle-call-mic").classList.toggle("off",call.microphone.state.status!=="enabled");$("#toggle-call-camera").classList.toggle("off",mode!=="video"||call.camera.state.status!=="enabled");
}
function setupVideoClient(body){
  if(videoClient)return;
  try{
    videoClient=new StreamVideoClient({apiKey:body.apiKey,user:body.user,token:body.token});
    videoClient.state.calls$.subscribe(calls=>{const call=calls.find(item=>!item.isCreatedByMe&&item.state.callingState===CallingState.RINGING);if(call&&incomingCall?.cid!==call.cid)showIncomingCall(call)});
  }catch(error){console.warn("Stream Video unavailable",error)}
}
function showIncomingCall(call){
  incomingCall=call;const isVideo=call.state.custom?.mode!=="audio",callerId=String(call.state.createdBy?.id||call.state.created_by?.id||call.state.created_by_id||""),callerProfile=directory.find(person=>String(person.id)===callerId),caller=call.state.createdBy?.name||call.state.created_by?.name||callerProfile?.full_name||callerId||"Medha user",dialog=$("#call-dialog");dialog.classList.toggle("audio-call",!isVideo);dialog.classList.toggle("video-call",isVideo);dialog.classList.add("incoming-call");$("#call-title").textContent=(isVideo?"Incoming video":"Incoming audio")+" call from "+caller;$("#incoming-call-actions").hidden=false;$("#call-participants").innerHTML='<div class="incoming-call-card"><strong>'+esc(caller)+'</strong><span>Incoming '+(isVideo?"video":"audio")+' call</span></div>';$("#call-dialog").showModal();startRingTone();incomingCallTimeout=setTimeout(()=>ignoreIncomingCall(),30000);
}
function minimizeIncomingCall(){if(!incomingCall)return;$("#call-dialog").close();$("#call-minimized").hidden=false}
function restoreIncomingCall(){if(!incomingCall)return;$("#call-minimized").hidden=true;$("#call-dialog").showModal()}
async function ignoreIncomingCall(){if(incomingCall){try{await incomingCall.camera.disable();await incomingCall.microphone.disable();await incomingCall.leave({reject:true,reason:"timeout"})}catch{}incomingCall=null}stopRingTone();$("#call-minimized").hidden=true;$("#call-dialog").close()}
$("#accept-call").addEventListener("click",async()=>{if(!incomingCall)return;try{stopRingTone();const call=incomingCall,mode=call.state.custom?.mode||"video";await call.join();incomingCall=null;showCallSurface(call,"Call · "+(active?.name||"Medha"),mode)}catch(error){toast(error.message)}});
$("#decline-call").addEventListener("click",async()=>{if(incomingCall){try{await incomingCall.leave({reject:true,reason:"decline"})}catch{}incomingCall=null}stopRingTone();$("#call-dialog").close()});
async function startStreamCall(mode){
  if(!active||!streamClient){toast("Open a Stream conversation first");return}
  try{
    if(!videoClient)videoClient=new StreamVideoClient({apiKey:streamClient.key,user:streamClient.user,token:streamSessionToken});
    const members=[...(active.participantIds||[viewerId(),active.participantId]).filter(Boolean).map(id=>({user_id:String(id)}))];
    const callId="medha-"+crypto.randomUUID(),call=videoClient.call("default",callId);
    await call.getOrCreate({ring:true,notify:true,video:mode==="video",data:{members,custom:{channelCid:active.cid,mode}}});
    showCallSurface(call,(mode==="video"?"Video":"Audio")+" call · "+active.name,mode);
    await streamChannelFor(active).sendMessage({text:(mode==="video"?"🎥 Video":"☎ Audio")+" call started",call_id:callId,call_type:"default"});
  }catch(error){toast(error.message)}
}
$("#audio-call").addEventListener("click",()=>startStreamCall("audio"));
$("#video-call").addEventListener("click",()=>startStreamCall("video"));
$("#message-area").addEventListener("click",async e=>{
  const row=e.target.closest(".message");if(!row||!active)return;
  const message=active.messages.find(item=>String(item.id)===String(row.dataset.messageId));
  if(message?.pollId){try{const poll=await streamClient.getPoll(message.pollId),options=poll.poll?.options||poll.options||[];const choice=prompt("Vote: "+options.map((item,index)=>(index+1)+". "+item.text).join(" | "));if(choice&&options[Number(choice)-1]){await streamClient.castPollVote(message.id,message.pollId,{option_id:options[Number(choice)-1].id},viewerId());toast("Vote recorded")}}catch(error){toast(error.message)}return}
  if(!message?.callId||!videoClient)return;
  try{const mode=message.text.includes("🎥")?"video":"audio";activeCall=videoClient.call("default",message.callId);await activeCall.join();showCallSurface(activeCall,"Join call · "+active.name,mode);toast("Connected to call")}catch(error){toast(error.message)}
});
$("#toggle-call-mic").addEventListener("click",async()=>{if(!activeCall)return;if(activeCall.state.callingState!==CallingState.JOINED){toast("Microphone starts when the call is connected");return}await activeCall.microphone.toggle();const off=activeCall.microphone.state.status!=="enabled";$("#toggle-call-mic").classList.toggle("off",off);$("#toggle-call-mic").title=off?"Turn microphone on":"Mute microphone"});
$("#toggle-call-camera").addEventListener("click",async()=>{if(!activeCall)return;if(activeCall.state.callingState!==CallingState.JOINED){toast("Camera starts when the call is connected");return}await activeCall.camera.toggle();const off=activeCall.camera.state.status!=="enabled";$("#toggle-call-camera").classList.toggle("off",off);$("#toggle-call-camera").title=off?"Turn camera on":"Turn camera off"});
async function leaveStreamCall(){stopRingTone();activeCallingSubscription?.unsubscribe?.();activeCallingSubscription=null;activeParticipantSubscription?.unsubscribe?.();activeParticipantSubscription=null;activeParticipantSessionKey="";activeMediaUnbinders.forEach(unbind=>{try{unbind()}catch{}});activeMediaUnbinders=[];const call=activeCall||incomingCall;if(call){try{await call.camera.disable()}catch{}try{await call.microphone.disable()}catch{}try{if(call.state.callingState===CallingState.RINGING)await call.leave({reject:true,reason:"cancel"});else if(call.state.callingState!==CallingState.LEFT)await call.endCall()}catch{try{await call.leave()}catch{}}}activeCall=null;incomingCall=null;activeCallMediaEnabled=false;activeCallMediaPromise=null;$("#call-dialog").close();$("#call-minimized").hidden=true;$("#call-participants").innerHTML=""}
/* Optional chaining: #close-call is not present in every layout, and a
   missing one used to throw here and abort the rest of boot. */
$("#leave-call")?.addEventListener("click",leaveStreamCall);$("#close-call")?.addEventListener("click",leaveStreamCall);
$("#minimize-call")?.addEventListener("click",()=>{if(incomingCall)minimizeIncomingCall();else $("#call-dialog").close()});
$("#restore-call")?.addEventListener("click",restoreIncomingCall);
$("#ignore-call")?.addEventListener("click",ignoreIncomingCall);
$("#ignore-minimized-call")?.addEventListener("click",ignoreIncomingCall);

/* ---------- rich Stream message actions ---------- */
let replyTarget=null,actionMessageId=null;
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
$("#message-actions").addEventListener("click",async e=>{
  const button=e.target.closest("[data-message-action]");if(!button||!active)return;$("#message-actions").hidden=true;
  const message=active.messages.find(item=>String(item.id)===String(actionMessageId)),channel=streamChannelFor(active);if(!message||!channel)return;
  try{
    if(button.dataset.messageAction==="reply"){replyTarget=message;messageInput.placeholder="Reply to "+message.senderName;messageInput.focus()}
    else if(button.dataset.messageAction==="edit"){
      if(!canEditMessage(message)){toast("Only your latest unread message can be edited");return}
      const text=prompt("Edit message",message.text||"");if(text===null||!text.trim())return;
      const updated=await streamClient.updateMessage({id:message.id,text:text.trim()});message.text=updated.text;renderMessages()
    }else if(button.dataset.messageAction==="delete"){await streamClient.deleteMessage(message.id);active.messages=active.messages.filter(item=>item.id!==message.id);renderMessages()}
    else if(button.dataset.messageAction==="pin"){message.pinned=!message.pinned;await (message.pinned?streamClient.pinMessage(message.id):streamClient.unpinMessage(message.id));renderMessages()}
    else if(button.dataset.messageAction==="forward"){
      const choices=conversations.filter(item=>item.id!==active.id);if(!choices.length){toast("No other conversation available");return}
      const choice=prompt("Forward to: "+choices.map((item,index)=>(index+1)+". "+item.name).join(" | ")),target=choices[Number(choice)-1];if(!target)return;
      const targetChannel=await watchStreamChannel(target);await targetChannel.sendMessage({text:message.text||"Forwarded attachment",forwarded_message_id:message.id,forwarded_from:active.name});toast("Forwarded to "+target.name)
    }
  }catch(error){toast(error.message)}
});
const pollButton=document.createElement("button");pollButton.type="button";pollButton.id="poll-button";pollButton.className="tool-btn";pollButton.title="Create poll";pollButton.textContent="◉";$(".composer-tools")?.append(pollButton);
pollButton.addEventListener("click",()=>{if(active?.kind!=="group"){toast("Polls are available in group chats");return}$("#poll-dialog").showModal()});
$("#poll-form").addEventListener("submit",async e=>{
  if(e.submitter?.value==="cancel")return;e.preventDefault();
  try{const question=$("#poll-question").value.trim(),options=$("#poll-options").value.split("\n").map(item=>item.trim()).filter(Boolean).map(text=>({text}));if(options.length<2){toast("Add at least two options");return}const poll=await streamClient.createPoll({name:question,options,allow_answers:false,allow_user_suggested_options:false},viewerId());await streamChannelFor(active).sendMessage({text:question,poll_id:poll.poll?.id||poll.id});$("#poll-dialog").close();e.target.reset();toast("Poll posted")}catch(error){toast(error.message)}});

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
  const emoji=button.dataset.reaction,me=viewerId();
  const message=active.messages.find(m=>String(m.id)===String(reactionTargetId));
  if(!message)return;
  const users=(message.reactions?.[emoji]||[]).map(String);
  const next=users.includes(me)?users.filter(u=>u!==me):[...users,me];
  const reactions=next.length?{[emoji]:next}:{};
  try{
    if(!streamClient)throw Error("Stream is not connected; reactions are unavailable");
    const channel=streamChannelFor(active);
    const streamMessage=channel?.state?.messages?.find(item=>String(item.id)===String(reactionTargetId));
    if(!channel||!streamMessage)throw Error("Message is not loaded in Stream");
    await channel.sendReaction(reactionTargetId,emoji,{enforce_unique:true});
    message.reactions=reactions;renderMessages();
  }catch(error){toast(error.message)}
});


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
  grid.querySelectorAll("i.span-start[style*='--span-days']").forEach(bar=>{
    const cell=bar.closest("div[data-day]");
    if(!cell)return;
    const days=Number(getComputedStyle(bar).getPropertyValue("--span-days"))||1;
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
      const isStart=dayKey(s)===key,isEnd=dayKey(e)===key;
      const weekday=(new Date(key+"T00:00:00").getDay()+6)%7;   /* Mon = 0 */
      /* The bar restarts on each calendar row, so a span crossing a week
         boundary gets a fresh rounded edge and its own label. */
      const rowStart=isStart||weekday===0;
      const rowEnd=isEnd||weekday===6;
      const span=multi?` span${rowStart?" span-start":""}${rowEnd?" span-end":""}${!rowStart&&!rowEnd?" span-mid":""}`:"";
      const range=multi?` (${s.toLocaleDateString([],{month:"short",day:"numeric"})} – ${e.toLocaleDateString([],{month:"short",day:"numeric"})})`:"";
      /* How many days this run covers in this week row, so the label can be
         centred over the whole strip instead of just its first day. */
      let daysInRow=1;
      if(multi&&rowStart){
        const endKey=dayKey(e);
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
      const style=multi&&rowStart&&daysInRow>1?` style="--span-days:${daysInRow}"`:"";
      return `<i class="${span.trim()}" title="${esc(x.title)}${esc(range)}" data-meeting-id="${esc(x.id||"")}"${style}>${label}</i>`;
    }).join("")}</div>`);
  }
  $("#calendar-grid").innerHTML=cells.join("")||'<div class="empty-state">No scheduled meetings.</div>';
  sizeCalendarSpans();
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

async function loadMeetings(){try{meetings=await db(`medha_communications_meetings?select=id,title,start_at,end_at,invitee_ids,created_by&order=start_at.asc`)||[];meetings=meetings.map(x=>({...x,start:String(x.start_at||""),end:String(x.end_at||x.start_at||"")}));renderCalendar();if(typeof refreshContactPresence==="function")refreshContactPresence()}catch{meetings=[];renderCalendar()}}
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
  document.querySelectorAll(".rail-item[data-view]").forEach(item=>item.classList.toggle("active",item.dataset.view===viewName));
  document.querySelectorAll(".view").forEach(view=>{
    const activeView=view.id===`${viewName}-view`;
    view.classList.toggle("active-view",activeView);
    view.hidden=!activeView;
    view.style.display=activeView?"flex":"none";
  });
  const shell=document.querySelector(".app-shell");
  shell.classList.toggle("calendar-mode",viewName==="calendar");
  $("#chat-sidebar").style.display=viewName==="chat"?"flex":"none";
  const calendarSidebar=$("#calendar-sidebar");calendarSidebar.hidden=viewName!=="calendar";calendarSidebar.style.display=viewName==="calendar"?"flex":"none";if(viewName==="calendar")shell.style.gridTemplateColumns="80px 280px minmax(500px,1fr) 0";else shell.style.removeProperty("grid-template-columns");
  $("#details-panel").classList.remove("open");
  $("#details-panel").classList.add("closed");
  if(viewName==="calendar") renderCalendar();
}
document.querySelectorAll(".rail-item[data-view]").forEach(item=>item.onclick=()=>setWorkspaceView(item.dataset.view));
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
  const userId=active?.participantId;
  const statusEl=$("#conversation-status");
  if(!userId){statusEl.textContent="";return}
  const state=presenceFor(userId);
  const label=state.charAt(0).toUpperCase()+state.slice(1);
  statusEl.textContent=label;statusEl.className=state;
  const detail=$(".details-person .presence");
  if(detail){detail.textContent=label;detail.className=`presence ${state}`}
  const dot=$(".conversation-header .online-dot");
  if(dot){dot.className=`online-dot ${state}`}
}

/* Presence for EVERY person in the sidebar, not just the open chat, so
   the list can show a live dot next to each name. */
async function refreshContactPresence(){
  const ids=[...new Set(conversations.map(c=>c.participantId).filter(Boolean).map(String))];
  if(!ids.length){setPresenceLabel();return}
  try{
    const list=ids.map(id=>`"${id.replace(/"/g,'')}"`).join(",");
    const rows=await db(`medha_communications_presence?user_id=in.(${list})&select=user_id,is_open,last_seen`);
    (rows||[]).forEach(r=>contactPresence.set(String(r.user_id),r));
    setPresenceLabel();
    renderList();
  }catch{}
}

/* One place that decides Online / Busy / Offline for a person. */
function presenceFor(userId){
  if(!userId)return "offline";
  if(String(userId)===String(viewerId()))return "online";
  if(meetingStatusFor(userId))return "busy";
  const record=contactPresence.get(String(userId));
  const fresh=record?.is_open&&Date.now()-new Date(record.last_seen).getTime()<45000;
  return fresh?"online":"offline";
}
async function publishPresence(isOpen){
  if(!viewerId())return;
  try{
    await db("medha_communications_presence",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
      body:JSON.stringify({user_id:viewerId(),is_open:isOpen,last_seen:new Date().toISOString()})});
  }catch{}
}
function startPresenceHeartbeat(){
  if(presenceTimer)clearInterval(presenceTimer);
  /* Online means the tab is OPEN, not focused. A background tab still
     counts - previously visibilityState made you look offline the moment
     you switched tabs. Only closing the page marks you offline. */
  const publish=()=>publishPresence(true);
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
  set currentUserId(v){currentUserId=v}};
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
  syncTimer=setInterval(()=>{syncIncomingMessages();refreshContactPresence()},5000);
  setInterval(async()=>{try{firebaseIdToken=await user.getIdToken(true)}catch{}},30*60*1000);
  if("Notification" in window&&Notification.permission==="default"){
    document.addEventListener("pointerdown",()=>Notification.requestPermission().catch(()=>{}),{once:true});
  }
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

renderList();
renderMessages();
authorizeHubLaunch();
loadSuggestions();
