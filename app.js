import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
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
   Keeps the sidebar and the newest messages of the 5 most recent chats in
   localStorage, so reopening Space (or a chat) paints instantly instead of
   showing an empty pane while the network round-trip finishes. The server
   remains the source of truth and overwrites this as soon as it answers. */
const CACHE_KEY=()=>`medha-space-cache-${viewerId()||"guest"}`;
const CACHE_CHATS=5, CACHE_MESSAGES=10;

function readCache(){
  try{
    const raw=localStorage.getItem(CACHE_KEY());
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    /* Ignore anything older than a day; stale previews are worse than none. */
    if(!parsed?.savedAt||Date.now()-parsed.savedAt>86400000)return null;
    return parsed;
  }catch{return null}
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
        initials:c.initials,color:c.color,team:c.team,preview:c.preview,
        updatedAt:c.updatedAt,unread:c.unread||0
      })),
      /* Only the newest messages, only for the most recent chats. */
      messages:Object.fromEntries(ordered.slice(0,CACHE_CHATS)
        .filter(c=>c.messagesLoaded&&c.messages?.length)
        .map(c=>[String(c.cid),c.messages.slice(-CACHE_MESSAGES)]))
    };
    localStorage.setItem(CACHE_KEY(),JSON.stringify(payload));
  }catch{/* quota or private mode - the app works without the cache */}
}

/* Paint from cache before the first network response arrives. */
function hydrateFromCache(){
  const cached=readCache();
  if(!cached?.conversations?.length)return false;
  conversations=cached.conversations.map(c=>{
    const msgs=cached.messages?.[String(c.cid)]||[];
    return {...c,messages:msgs,
      messagesLoaded:msgs.length>0,
      messageOffset:msgs.length,
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
       :q?"No conversations match that search."
       :"No conversations yet. Select + to start a chat."}</p>`;
}

function messageHtml(m){
  const mine=m.who==="me";
  const links=(m.attachments||[]).length?m.attachments:((m.text||"").match(/https?:\/\/[^\s]+/g)||[]).filter(u=>/\.gif(?:$|\?)/i.test(u)||/giphy\.com|tenor\.com/i.test(u)).map(url=>({kind:"gif",url,name:"GIF"}));
  const who=mine?{initials:initialsFor(currentAppUser?.full_name||"You"),color:"blue"}:{initials:active?.initials,color:active?.color};
  const reactions=Object.entries(m.reactions||{}).filter(([,u])=>Array.isArray(u)&&u.length);
  return `<div class="message ${mine?"mine":""}" data-message-id="${esc(m.id||"")}">${avatar(who,true)}<div class="message-body"><div class="message-meta"><strong>${mine?"You":esc(m.senderName||active?.name||"")}</strong><time>${esc(m.time)}</time></div>${m.text?`<div class="bubble">${esc(m.text)}</div>`:""}${links.map(a=>a.kind==="gif"?`<a class="message-gif" href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.url)}" alt="Attached GIF" loading="lazy"></a>`:`<a class="message-file" href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`).join("")}${reactions.length?`<div class="stored-reactions">${reactions.map(([emoji,users])=>`<span title="${users.length} reaction${users.length===1?"":"s"}">${emoji}${users.length>1?` ${users.length}`:""}</span>`).join("")}</div>`:""}</div></div>`;
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

async function persistMessage(chat,text,attachments){
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
  const now=new Date().toISOString();
  chat.lastReadAt=now;
  writeCache();
  try{
    await db(`medha_communications_user_conversations?user_id=eq.${encodeURIComponent(viewerId())}&cid=eq.${encodeURIComponent(chat.cid)}`,
      {method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({last_read_at:now})});
  }catch{}
}

async function openDirectChat(person,openingText){
  const me=viewerId();
  if(!me)throw Error("Sign in to Medha Hub before starting a chat");
  const otherId=String(person.id);
  const id=directConversationId(me,otherId);
  let chat=conversations.find(c=>String(c.id)===id);
  if(!chat){
    const name=person.full_name||"Conversation";
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
    const saved=await persistMessage(active,text,attachments);
    messageInput.value="";pendingAttachments=[];renderPending();autosizeComposer();
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
});
$("#chat-search").addEventListener("input",renderList);

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
      <span class="employee-copy"><strong>${esc(p.full_name)}</strong><small>${esc(p.department||p.role||"Medha employee")}</small></span>
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
    await db(`medha_communications_messages?id=eq.${encodeURIComponent(reactionTargetId)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({reactions})});
    message.reactions=reactions;renderMessages();
  }catch(error){toast(error.message)}
});


/* ---------- emoji & gif pickers ---------- */

const emojiGroups={"Smileys & people":"😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 👾 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙌 👏 🤝 👍 👎 👌 ✌️ 🤞 🤟 🤘 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 💪 🙏 👀 👁️ 👄 💋 💯" ,"Animals & nature":"🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦄 🐝 🦋 🐌 🐞 🐜 🕷️ 🦂 🐢 🐍 🦎 🦖 🐙 🦀 🐠 🐟 🐡 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦏 🦒 🦘 🦬 🐄 🐎 🐖 🐑 🦙 🐐 🐕 🐈 🐓 🦃 🕊️ 🐇 🐿️ 🦔 🌸 🌹 🌻 🌞 🌝 🌈 ⭐ 🌟 ✨ ⚡ 🔥 🌊 🍀 🌱 🌲 🌴 🌵 🍁" ,"Food & activities":"🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🍞 🧀 🍔 🍟 🍕 🌭 🌮 🌯 🥗 🍿 🍩 🍪 🎂 🍰 🍫 🍭 ☕ 🍺 🍻 🍷 🥂 ⚽ 🏀 🏈 ⚾ 🎾 🏐 🏆 🎮 🎲 🎯 🎨 🎵 🎶 🎤 🎬 🚗 🚕 🚌 🚆 ✈️ 🚀 🚲 ⛵" ,"Objects & symbols":"❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ✅ ❌ ❗ ❓ ‼️ ⁉️ ⚠️ 🚫 💡 🔒 🔓 🔑 🔔 🎁 🎈 🎉 🎊 📌 📎 📝 📅 📁 📂 💻 🖥️ 📱 ☎️ ⌚ 🔍 🔗 🛠️ ⚙️ 🔥 💬 🗨️ 💤 ✔️ ➕ ➖ ➡️ ⬆️ ⬇️"};
let allEmojis=Object.entries(emojiGroups).flatMap(([group,value])=>value.split(" ").map(emoji=>({group,emoji})));function renderEmojiPicker(query=""){const q=query.toLowerCase();$("#emoji-grid").innerHTML=allEmojis.filter(x=>!q||x.emoji.includes(q)||x.group.toLowerCase().includes(q)).map(x=>`<button type="button" class="emoji-choice" data-emoji="${x.emoji}" title="${x.group}">${x.emoji}</button>`).join("")||'<div class="directory-empty">No emoji found</div>'}$("#emoji-button").onclick=()=>{$("#emoji-dialog").showModal();renderEmojiPicker();$("#emoji-search").focus()};$("#close-emoji").onclick=()=>$("#emoji-dialog").close();$("#emoji-search").addEventListener("input",e=>renderEmojiPicker(e.target.value));$("#emoji-grid").addEventListener("click",e=>{const b=e.target.closest("[data-emoji]");if(b){$("#message-input").value+=b.dataset.emoji;$("#message-input").focus();$("#emoji-dialog").close()}});$("#gif-button").onclick=()=>$("#gif-dialog").showModal();$("#gif-form").addEventListener("submit",e=>{if(e.submitter?.value==="cancel"){e.target.closest("dialog").close();return}e.preventDefault();const url=$("#gif-url").value.trim();try{const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw Error();pendingAttachments.push({kind:"gif",name:"GIF",url:parsed.href});renderPending();$("#gif-url").value="";$("#gif-dialog").close()}catch{toast("Enter a valid GIF URL")}});

/* ---------- calendar ---------- */

let meetings=[];let calendarCursor=new Date();
function renderCalendar(){const y=calendarCursor.getFullYear(),m=calendarCursor.getMonth();$("#calendar-month").textContent=calendarCursor.toLocaleDateString([], {month:"long",year:"numeric"});const first=(new Date(y,m,1).getDay()+6)%7,last=new Date(y,m+1,0).getDate(),cells=[];for(let i=0;i<first;i++)cells.push('<div class="muted"></div>');for(let d=1;d<=last;d++){const date=new Date(y,m,d),key=date.toISOString().slice(0,10),items=meetings.filter(x=>x.start.slice(0,10)===key);cells.push(`<div class="${key===new Date().toISOString().slice(0,10)?"today":""}">${d}${items.map(x=>`<i title="${esc(x.title)}">${esc(x.title)}</i>`).join("")}</div>`)}$("#calendar-grid").innerHTML=cells.join("")||'<div class="empty-state">No scheduled meetings.</div>';const future=meetings.filter(x=>new Date(x.start)>=new Date()).sort((a,b)=>new Date(a.start)-new Date(b.start));$("#agenda-list").innerHTML=future.length?future.map(x=>`<div class="agenda-item"><b>${new Date(x.start).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</b><div><strong>${esc(x.title)}</strong><span>${new Date(x.start).toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"})}</span></div></div>`).join(""):"<div class=\"empty-state\">No upcoming meetings.</div>"}
async function loadMeetings(){try{meetings=await db(`medha_communications_meetings?select=id,title,start_at,end_at,invitee_ids,created_by&order=start_at.asc`)||[];meetings=meetings.map(x=>({...x,start:String(x.start_at||""),end:String(x.end_at||x.start_at||"")}));renderCalendar();if(typeof refreshContactPresence==="function")refreshContactPresence()}catch{meetings=[];renderCalendar()}}
$("#calendar-prev").onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar()};$("#calendar-next").onclick=()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar()};$("#calendar-today").onclick=()=>{calendarCursor=new Date();renderCalendar()};$("#new-event").onclick=()=>$("#event-dialog").showModal();$("#event-form").addEventListener("submit",async e=>{if(e.submitter?.value==="cancel"){e.target.closest("dialog").close();return}e.preventDefault();if(!currentUserId){toast("Sign in to create meetings");return}const title=$("#event-title").value.trim(),start=$("#event-start").value,end=$("#event-end").value;if(new Date(end)<=new Date(start)){toast("End time must be after start time");return}try{await db("medha_communications_meetings",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({title,start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString(),invitee_ids:$("#event-invitees").value.split(",").map(x=>x.trim()).filter(Boolean),created_by:currentUserId})});$("#event-dialog").close();e.target.reset();await loadMeetings();toast("Meeting created")}catch(err){toast(err.message)}});
function openEventForCalendarDate(day){const date=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),day,9,0);const end=new Date(date);end.setHours(10);const localValue=value=>{const pad=n=>String(n).padStart(2,"0");return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`};$("#event-form").reset();$("#event-start").value=localValue(date);$("#event-end").value=localValue(end);$("#event-dialog").showModal()}
$("#calendar-grid").addEventListener("dblclick",event=>{const cell=event.target.closest("#calendar-grid>div");if(!cell||cell.classList.contains("muted"))return;const first=(new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1).getDay()+6)%7;const day=[...$("#calendar-grid").children].indexOf(cell)-first+1;if(day>0)openEventForCalendarDate(day)});
document.querySelectorAll("#event-start,#event-end").forEach(input=>input.addEventListener("click",()=>input.showPicker?.()));document.querySelectorAll("dialog .close-dialog").forEach(button=>button.addEventListener("click",()=>button.closest("dialog").close()));
const locationInput=document.createElement("input");locationInput.id="event-location";locationInput.maxLength=240;locationInput.placeholder="Optional meeting location";const locationLabel=document.createElement("label");locationLabel.textContent="Meeting location";locationLabel.append(locationInput);const locationTags=document.createElement("div");locationTags.className="location-tags";locationTags.innerHTML='<button type="button" data-location-tag="Online">Online</button><button type="button" data-location-tag="Office">Office</button>';locationLabel.append(locationTags);$("#event-invitees").closest("label").before(locationLabel);locationTags.addEventListener("click",e=>{const tag=e.target.closest("[data-location-tag]");if(tag)locationInput.value=tag.dataset.locationTag});window.addEventListener("communications:add-suggestion-event",event=>{const d=event.detail||{},dateText=String(d.start||""),dateMatch=dateText.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/)||dateText.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:.*?(\d{4}))?/),date=dateMatch?(dateMatch[3]?new Date(+dateMatch[3],+dateMatch[1]-1,+dateMatch[2]):new Date(`${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]||new Date().getFullYear()}`)):new Date(),timeMatch=String(d.time||"").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i),hour=timeMatch?(+timeMatch[1]%12)+(timeMatch[3].toUpperCase()==="PM"?12:0):9,minute=timeMatch?+(timeMatch[2]||0):0,pad=n=>String(n).padStart(2,"0"),value=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}`;$("#event-form").reset();$("#event-title").value=d.title||"";$("#event-start").value=value;const end=new Date(date);end.setHours(hour+1,minute,0,0);$("#event-end").value=`${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;locationInput.value=d.location&&d.location!=="Not published"?d.location:"";$("#event-dialog").showModal()});
$("#event-title").closest("label").childNodes[0].textContent="Event Title";$("#event-title").placeholder="Event title";
const communicationsDb=db;db=async(path,options={})=>{if(path==="medha_communications_meetings"&&options.method==="POST"&&options.body){const payload=JSON.parse(options.body);payload.location=$("#event-location")?.value.trim()||null;options={...options,body:JSON.stringify(payload)}}return communicationsDb(path,options)};
let editingMeeting=null;const eventDialogTitle=$("#event-dialog h2"),eventDialogSubmit=$("#event-form button[value=default]");function dateTimeValue(value){if(!value)return"";const d=new Date(value),pad=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`}function openMeetingEditor(meeting){editingMeeting=meeting;eventDialogTitle.textContent="Edit event";eventDialogSubmit.textContent="Save changes";$("#event-title").value=meeting.title||"";$("#event-start").value=dateTimeValue(meeting.start);$("#event-end").value=dateTimeValue(meeting.end);$("#event-invitees").value=(meeting.invitee_ids||[]).join(",");$("#event-location").value=meeting.location||"";$("#event-dialog").showModal()}$("#calendar-grid").addEventListener("click",async event=>{const marker=event.target.closest("#calendar-grid i");if(!marker)return;const cell=marker.closest("#calendar-grid>div"),first=(new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1).getDay()+6)%7,day=[...$("#calendar-grid").children].indexOf(cell)-first+1,key=`${calendarCursor.getFullYear()}-${String(calendarCursor.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,meeting=meetings.find(item=>item.title===marker.title&&item.start?.slice(0,10)===key);if(!meeting)return;try{const rows=await db(`medha_communications_meetings?id=eq.${encodeURIComponent(meeting.id)}&select=id,title,start_at,end_at,invitee_ids,location`);openMeetingEditor({...meeting,...(rows?.[0]||{}),start:rows?.[0]?.start_at||meeting.start,end:rows?.[0]?.end_at||meeting.end})}catch{openMeetingEditor(meeting)}});$("#event-form").addEventListener("submit",async event=>{if(!editingMeeting)return;event.preventDefault();event.stopImmediatePropagation();if(!currentUserId){toast("Sign in to edit events");return}const title=$("#event-title").value.trim(),start=$("#event-start").value,end=$("#event-end").value;if(new Date(end)<=new Date(start)){toast("End time must be after start time");return}try{await db(`medha_communications_meetings?id=eq.${encodeURIComponent(editingMeeting.id)}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({title,start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString(),location:$("#event-location").value.trim()||null,invitee_ids:$("#event-invitees").value.split(",").map(x=>x.trim()).filter(Boolean)})});$("#event-dialog").close();event.target.reset();editingMeeting=null;eventDialogTitle.textContent="New meeting";eventDialogSubmit.textContent="Create meeting";await loadMeetings();toast("Event updated")}catch(error){toast(error.message)}},true);
$("#new-event").addEventListener("click",()=>{editingMeeting=null;eventDialogTitle.textContent="New meeting";eventDialogSubmit.textContent="Create meeting"});
const calendarRender=renderCalendar;renderCalendar=function(){calendarRender();const list=$("#calendar-sidebar-list"),future=meetings.filter(x=>x.start&&new Date(x.start)>=new Date()).sort((a,b)=>new Date(a.start)-new Date(b.start));if(list)list.innerHTML=future.length?future.map(x=>`<div class="calendar-side-event"><time>${new Date(x.start).toLocaleDateString([], {month:"short",day:"numeric"})}</time><div><strong>${esc(x.title||"Meeting")}</strong><span>${new Date(x.start).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span></div></div>`).join(""):"<div class=\"empty-state\">No upcoming meetings.</div>"};
function externalStartDate(value){const text=String(value||""),numeric=text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/),named=text.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:.*?(\d{4}))?/);if(numeric)return new Date(Number(numeric[3]),Number(numeric[1])-1,Number(numeric[2]));if(named){const year=Number(named[3]||new Date().getFullYear()),date=new Date(`${named[1]} ${named[2]}, ${year}`);if(!Number.isNaN(date.getTime()))return date}return null}
async function loadSuggestions(){const list=$("#suggestions-list");try{const [eventsResponse,exhibitionsResponse]=await Promise.all([fetch("https://medha-newsevents.vercel.app/api/events"),fetch("https://medha-newsevents.vercel.app/api/exhibitions")]);if(!eventsResponse.ok||!exhibitionsResponse.ok)throw Error("Events & News unavailable");const [events,exhibitions]=await Promise.all([eventsResponse.json(),exhibitionsResponse.json()]),items=[...(events.sources||[]).flatMap(source=>(source.items||[]).map(item=>({...item,kind:"Event"}))),...(exhibitions.sources||[]).flatMap(source=>(source.items||[]).map(item=>({...item,kind:"Exhibition"})))].map(item=>({...item,start:externalStartDate(item.date)})).filter(item=>item.start&&item.start>=new Date()).sort((a,b)=>a.start-b.start).slice(0,20);list.innerHTML=items.length?items.map(item=>`<a class="suggestion-item" href="${esc(item.link||"https://medha-newsevents.vercel.app/")}" target="_blank" rel="noopener"><span>${item.kind}</span><strong>${esc(item.title)}</strong><time>${item.start.toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"})}</time></a>`).join(""):"<div class=\"empty-state\">No upcoming events or exhibitions.</div>"}catch{list.innerHTML='<div class="empty-state">Events &amp; News is unavailable.</div>'}}

/* ---------- event invitees ---------- */

const eventInvitees=new Set(),eventInviteeSearch=$("#event-invitees"),eventInviteeList=document.createElement("div");eventInviteeList.className="employee-list event-invitee-list";eventInviteeSearch.placeholder="Search Medha employees to invite...";eventInviteeSearch.after(eventInviteeList);function renderEventInvitees(query=""){const q=query.toLowerCase();const matches=directory.filter(p=>`${p.full_name} ${p.email||""} ${p.department||""}`.toLowerCase().includes(q));eventInviteeList.innerHTML=matches.length?matches.map(p=>`<button type="button" class="employee-option ${eventInvitees.has(p.id)?"selected":""}" data-event-person-id="${esc(p.id)}"><div class="person-avatar blue">${esc(initialsFor(p.full_name))}</div><div><strong>${esc(p.full_name)}</strong><small>${esc(p.department||p.role||"Medha employee")} · ${esc(p.email||"")}</small></div><span class="invite-check">${eventInvitees.has(p.id)?"✓":""}</span></button>`).join(""):"<div class=\"directory-empty\">No Medha employees found</div>"}eventInviteeSearch.addEventListener("input",e=>renderEventInvitees(e.target.value));eventInviteeList.addEventListener("click",e=>{const button=e.target.closest("[data-event-person-id]");if(!button)return;const id=button.dataset.eventPersonId;if(eventInvitees.has(id))eventInvitees.delete(id);else eventInvitees.add(id);eventInviteeSearch.value="";eventInviteeSearch.value=[...eventInvitees].join(",");renderEventInvitees("")});$("#new-event").onclick=async()=>{$("#event-dialog").showModal();eventInvitees.clear();eventInviteeSearch.value="";await loadEmployeeDirectory();renderEventInvitees("")};

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
function showDesktopNotification(row){
  if("Notification" in window&&Notification.permission==="granted"){
    const chat=conversations.find(c=>String(c.cid)===String(row.cid));
    try{new Notification(chat?.name||"New message",{body:notificationText(row.body),tag:`medha-message-${row.id}`})}catch{}
  }
}
async function syncIncomingMessages(){
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
  if(!launchToken){launchGate.hidden=false;finishSpaceLoading("Waiting for a secure Hub launch");return}
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
