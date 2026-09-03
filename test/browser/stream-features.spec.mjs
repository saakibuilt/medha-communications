/* Drives the five new features through the real app.js in a real browser.
   Only the Stream SDK is stubbed (its secret is Sensitive in Vercel and
   cannot be pulled); index.html, styles.css and app.js are the shipped files. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE="http://localhost:4173";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};

const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
page.on("console",m=>{if(m.type()==="error")console.log("  [console] "+m.text())});

await page.route("https://esm.sh/stream-chat@9.52.0",r=>r.fulfill({status:200,contentType:"text/javascript",
  body:readFileSync(new URL("./fake-stream.js",import.meta.url),"utf8")}));
await page.route("**/@stream-io/video-client**",r=>r.fulfill({status:200,contentType:"text/javascript",body:"export class StreamVideoClient{}; export const CallingState={JOINED:'joined',LEFT:'left',IDLE:'idle'};"}));
await page.route("**/*.supabase.co/**",r=>r.fulfill({status:200,contentType:"application/json",body:"[]"}));
await page.route("**/api/stream-token",r=>r.fulfill({status:200,contentType:"application/json",
  body:JSON.stringify({apiKey:"fake",token:"tok",user:{id:"u_me",name:"Saksham Nirula"}})}));
await page.route("**/api/stream-users",r=>r.fulfill({status:200,contentType:"application/json",body:'{"ok":true}'}));

await page.goto(BASE,{waitUntil:"domcontentloaded"});
await page.waitForFunction(()=>!!window.__space,null,{timeout:15000});
await page.waitForTimeout(1200);

/* ---------- seed two conversations with real message shapes ---------- */
await page.evaluate(()=>{
  const s=window.__space;
  s.currentUserId="u_me";
  s.directory=[
    {id:"u_me",full_name:"Saksham Nirula",email:"s@medha.test"},
    {id:"u_kavya",full_name:"Kavya Sharma",email:"k@medha.test"},
    {id:"u_anil",full_name:"Anil Rao",email:"a@medha.test"}];
  const mk=(id,text,sender,parentId=null)=>({id,senderId:sender,who:sender==="u_me"?"me":"them",
    senderName:sender==="u_me"?"Saksham Nirula":"Kavya Sharma",text,parentId,
    attachments:[],reactions:{},createdAt:new Date(Date.now()-9e5).toISOString(),time:"10:00 AM"});
  const chat={cid:"messaging:c1",id:"c1",name:"Kavya Sharma",participantId:"u_kavya",
    participantIds:["u_me","u_kavya"],kind:"direct",initials:"KS",color:"blue",team:"",
    preview:"hi",updatedAt:new Date().toISOString(),time:"10:00 AM",unread:0,mentions:0,archived:false,
    messages:[mk("m1","Original message","u_kavya"),mk("m2","First reply","u_me","m1"),mk("m3","Second reply","u_kavya","m1")],
    messagesLoaded:true,messageOffset:3,hasMore:false};
  const grp={cid:"messaging:g1",id:"g1",name:"Ops Team",participantId:"u_kavya",
    participantIds:["u_me","u_kavya","u_anil"],kind:"group",initials:"OT",color:"purple",team:"Group chat",
    preview:"",updatedAt:new Date(Date.now()-1e6).toISOString(),time:"9:00 AM",unread:0,mentions:0,archived:false,
    messages:[],messagesLoaded:true,messageOffset:0,hasMore:false};
  s.conversations=[chat,grp];
  s.active=chat;
  s.renderList();s.renderMessages();
});
/* Attach channels through the app's own watch path so the real listeners
   are registered, exactly as they are for a live user. */
await page.evaluate(async()=>{
  const s=window.__space;
  for(const chat of s.conversations)await s.watchStreamChannel(chat);
});
await page.waitForTimeout(400);

const wired=await page.evaluate(()=>window.__space.streamChannels.get("messaging:c1")._handlerNames());
ok("channel wires all live listeners",
  ["message.new","reaction.new","reaction.deleted","message.updated","message.deleted","typing.start","typing.stop"].every(n=>wired.includes(n)),wired);

/* ================= 1. REACTIONS ================= */
console.log("\n-- reactions --");
await page.evaluate(async()=>{globalThis.__streamCalls.length=0;await window.__space.toggleReaction("m1","👍")});
await page.waitForTimeout(200);
let r=await page.evaluate(()=>({
  calls:globalThis.__streamCalls.map(c=>c[0]),
  reactionArg:globalThis.__streamCalls.find(c=>c[0]==="sendReaction")?.[2],
  chip:document.querySelector('.message[data-message-id="m1"] .stored-reactions span')?.className,
  reactions:window.__space.conversations[0].messages[0].reactions}));
ok("add reaction calls sendReaction",r.calls.includes("sendReaction"),r.calls);
ok("sendReaction is given a Reaction object, not a string",r.reactionArg&&typeof r.reactionArg==="object"&&r.reactionArg.type==="\u{1F44D}",r.reactionArg);
ok("added reaction stored for me",(r.reactions["👍"]||[]).includes("u_me"),r.reactions);
ok("own reaction chip marked by-me",r.chip==="by-me",r.chip);

await page.evaluate(async()=>{globalThis.__streamCalls.length=0;await window.__space.toggleReaction("m1","❤️")});
await page.waitForTimeout(200);
r=await page.evaluate(()=>({calls:globalThis.__streamCalls.map(c=>c[0]),reactions:window.__space.conversations[0].messages[0].reactions}));
ok("change reaction sends new one",r.calls.includes("sendReaction"),r.calls);
ok("change reaction drops the old emoji",!r.reactions["👍"]&&(r.reactions["❤️"]||[]).includes("u_me"),r.reactions);

await page.evaluate(async()=>{globalThis.__streamCalls.length=0;await window.__space.toggleReaction("m1","❤️")});
await page.waitForTimeout(200);
r=await page.evaluate(()=>({calls:globalThis.__streamCalls,reactions:window.__space.conversations[0].messages[0].reactions,
  chips:document.querySelectorAll('.message[data-message-id="m1"] .stored-reactions span').length}));
ok("same emoji again calls deleteReaction",r.calls.some(c=>c[0]==="deleteReaction"),r.calls.map(c=>c[0]));
ok("deleteReaction passes my user id",r.calls.find(c=>c[0]==="deleteReaction")?.[3]==="u_me",r.calls);
ok("removed reaction leaves no chip",r.chips===0&&!Object.keys(r.reactions).length,r.reactions);

/* clicking an existing chip toggles it */
await page.evaluate(async()=>{await window.__space.toggleReaction("m1","🎉")});
await page.waitForTimeout(200);
await page.click('.message[data-message-id="m1"] .stored-reactions span');
await page.waitForTimeout(300);
r=await page.evaluate(()=>({chips:document.querySelectorAll('.message[data-message-id="m1"] .stored-reactions span').length}));
ok("clicking own chip removes the reaction",r.chips===0,r);

/* someone else's reaction arriving over the socket */
await page.evaluate(()=>{
  const ch=window.__space.streamChannels.get("messaging:c1");
  ch._emit("reaction.new",{message:{id:"m1"},user:{id:"u_kavya"},reaction:{type:"😂"}});
});
await page.waitForTimeout(300);
r=await page.evaluate(()=>({reactions:window.__space.conversations[0].messages[0].reactions,
  chip:document.querySelector('.message[data-message-id="m1"] .stored-reactions span')?.className}));
ok("reaction.new from another user renders",(r.reactions["😂"]||[]).includes("u_kavya"),r.reactions);
ok("another user's reaction is not marked by-me",r.chip==="",r.chip);
await page.evaluate(()=>{window.__space.streamChannels.get("messaging:c1")._emit("reaction.deleted",{message:{id:"m1"},user:{id:"u_kavya"},reaction:{type:"😂"}})});
await page.waitForTimeout(250);
ok("reaction.deleted clears it live",
  await page.evaluate(()=>!Object.keys(window.__space.conversations[0].messages[0].reactions).length));

/* ================= 2. THREADS ================= */
console.log("\n-- threads --");
r=await page.evaluate(()=>({footer:document.querySelector('.message[data-message-id="m1"] .thread-open')?.textContent.trim(),
  onReply:!!document.querySelector('.message[data-message-id="m2"] .thread-open')}));
ok("parent shows reply count",/2 replies/.test(r.footer||""),r.footer);
ok("a reply itself has no thread footer",r.onReply===false);

await page.click('.message[data-message-id="m1"] .thread-open');
await page.waitForTimeout(400);
r=await page.evaluate(()=>({open:!document.querySelector(".thread-panel").hidden,
  bodyClass:document.body.classList.contains("thread-open"),
  msgs:[...document.querySelectorAll(".thread-message")].map(el=>el.dataset.messageId),
  count:document.querySelector(".thread-count")?.textContent.trim(),
  visible:document.querySelector(".thread-panel").getBoundingClientRect().width}));
ok("thread panel opens",r.open&&r.visible>200,r);
ok("thread shows parent then both replies",JSON.stringify(r.msgs)===JSON.stringify(["m1","m2","m3"]),r.msgs);
ok("thread count label correct",r.count==="2 replies",r.count);

await page.fill("#thread-input","Reply from the thread");
await page.evaluate(()=>{globalThis.__streamCalls.length=0});
await page.click("#thread-composer .send-button");
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const send=globalThis.__streamCalls.find(c=>c[0]==="sendMessage");
  return {sent:send?.[2],inThread:[...document.querySelectorAll(".thread-message")].length,
    inMain:[...document.querySelectorAll("#message-area .message")].length,input:document.querySelector("#thread-input").value}});
ok("thread reply sets parent_id",r.sent?.parent_id==="m1",r.sent);
ok("thread reply sets show_in_channel",r.sent?.show_in_channel===true,r.sent);
ok("thread reply appears in the thread",r.inThread===4,r);
ok("thread reply also appears in the main list",r.inMain===4,r);
ok("thread input clears after send",r.input==="",r.input);

await page.keyboard.press("Escape");
await page.waitForTimeout(250);
ok("Escape closes the thread",await page.evaluate(()=>document.querySelector(".thread-panel").hidden===true));

/* ================= 3. ARCHIVE ================= */
console.log("\n-- archive --");
r=await page.evaluate(()=>[...document.querySelectorAll(".sidebar-tabs .tab")].map(t=>t.textContent.trim()));
ok("Archived tab present",r.includes("Archived"),r);
await page.evaluate(()=>{globalThis.__streamCalls.length=0});
await page.evaluate(async()=>{
  const menu=document.querySelector("#chat-actions");
  const row=document.querySelector('.chat-item[data-id="c1"]');
  row.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:100,clientY:100}));
});
await page.waitForTimeout(250);
r=await page.evaluate(()=>({visible:!document.querySelector("#chat-actions").hidden,
  buttons:[...document.querySelectorAll("#chat-actions button")].map(b=>b.textContent.trim())}));
ok("context menu offers Archive",r.buttons.some(b=>/Archive chat/.test(b)),r.buttons);
await page.click('#chat-actions [data-chat-action="archive"]');
await page.waitForTimeout(400);
r=await page.evaluate(()=>({calls:globalThis.__streamCalls.map(c=>c[0]),
  archived:window.__space.conversations.find(c=>c.id==="c1").archived,
  listed:[...document.querySelectorAll(".chat-item")].map(el=>el.dataset.id).filter(Boolean)}));
ok("archive calls Stream archive()",r.calls.includes("archive"),r.calls);
ok("chat marked archived",r.archived===true);
ok("archived chat leaves the All tab",!r.listed.includes("c1"),r.listed);

await page.evaluate(()=>{window.__space.chatFilter="archived";window.__space.renderList()});
await page.waitForTimeout(250);
r=await page.evaluate(()=>[...document.querySelectorAll(".chat-item")].map(el=>el.dataset.id).filter(Boolean));
ok("archived chat appears under Archived",r.includes("c1"),r);

await page.evaluate(()=>{globalThis.__streamCalls.length=0});
await page.evaluate(async()=>{
  document.querySelector('.chat-item[data-id="c1"]').dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,clientX:100,clientY:100}));
});
await page.waitForTimeout(200);
r=await page.evaluate(()=>[...document.querySelectorAll("#chat-actions button")].map(b=>b.textContent.trim()));
ok("menu flips to Unarchive",r.some(b=>/Unarchive/.test(b)),r);
await page.click('#chat-actions [data-chat-action="archive"]');
await page.waitForTimeout(350);
r=await page.evaluate(()=>({calls:globalThis.__streamCalls.map(c=>c[0]),archived:window.__space.conversations.find(c=>c.id==="c1").archived}));
ok("unarchive calls Stream unarchive()",r.calls.includes("unarchive"),r.calls);
ok("chat no longer archived",r.archived===false);

await page.evaluate(()=>{window.__space.chatFilter="all";window.__space.renderList()});

/* archived chat returns when a message arrives */
await page.evaluate(()=>{
  const c=window.__space.conversations.find(x=>x.id==="c1");c.archived=true;
  window.__space.streamChannels.get("messaging:c1")._emit("message.new",
    {cid:"messaging:c1",channel:{cid:"messaging:c1"},message:{id:"m_new",text:"back",user:{id:"u_kavya"},created_at:new Date().toISOString()}});
});
await page.waitForTimeout(350);
ok("new message unarchives the chat",await page.evaluate(()=>window.__space.conversations.find(c=>c.id==="c1").archived===false));

/* ================= 4. MENTIONS ================= */
console.log("\n-- mentions --");
r=await page.evaluate(()=>{
  const s=window.__space,grp=s.conversations.find(c=>c.id==="g1"),dm=s.conversations.find(c=>c.id==="c1");
  return {group:s.resolveMentions(grp,"morning @Kavya Sharma and @Anil Rao please review"),
    nonMember:s.resolveMentions(dm,"hey @Anil Rao"),
    member:s.resolveMentions(dm,"hey @Kavya Sharma"),
    self:s.resolveMentions(grp,"note to @Saksham Nirula"),
    none:s.resolveMentions(grp,"no mentions here")}});
ok("group mentions resolve to ids",JSON.stringify(r.group.sort())===JSON.stringify(["u_anil","u_kavya"]),r.group);
ok("cannot mention a non-member",r.nonMember.length===0,r.nonMember);
ok("can mention the other person in a DM",JSON.stringify(r.member)===JSON.stringify(["u_kavya"]),r.member);
ok("cannot mention yourself",r.self.length===0,r.self);
ok("no @ means no lookup",r.none.length===0,r.none);

await page.evaluate(()=>{
  const s=window.__space;s.active=s.conversations.find(c=>c.id==="c1");
  const grp=s.conversations.find(c=>c.id==="g1");grp.mentions=0;grp.unread=0;
  s.streamChannels.get("messaging:g1")._emit("message.new",{cid:"messaging:g1",channel:{cid:"messaging:g1"},
    message:{id:"mm1",text:"@Saksham Nirula can you check",user:{id:"u_anil"},created_at:new Date().toISOString(),
      mentioned_users:[{id:"u_me"}]}});
});
await page.waitForTimeout(350);
r=await page.evaluate(()=>{const g=window.__space.conversations.find(c=>c.id==="g1");
  return {mentions:g.mentions,unread:g.unread,badge:document.querySelector('.chat-item[data-id="g1"] .mention-badge')?.textContent.trim()}});
ok("mention in a background chat is counted",r.mentions===1,r);
ok("mention badge renders",r.badge==="@1",r);
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:g1")._emit("message.new",{cid:"messaging:g1",channel:{cid:"messaging:g1"},
    message:{id:"mm2",text:"just a normal one",user:{id:"u_anil"},created_at:new Date().toISOString()}});
});
await page.waitForTimeout(300);
r=await page.evaluate(()=>{const g=window.__space.conversations.find(c=>c.id==="g1");return {mentions:g.mentions,unread:g.unread}});
ok("a non-mention does not bump mentions",r.mentions===1&&r.unread===2,r);

/* ================= 5. LIVE EDIT / DELETE ================= */
console.log("\n-- live edits and deletes --");
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:c1")._emit("message.updated",{message:{id:"m3",text:"Second reply (edited)"}});
});
await page.waitForTimeout(300);
ok("message.updated repaints the text",
  await page.evaluate(()=>document.querySelector('.message[data-message-id="m3"] .bubble')?.textContent.includes("edited")));
await page.evaluate(()=>{window.__space.streamChannels.get("messaging:c1")._emit("message.deleted",{message:{id:"m3"}})});
await page.waitForTimeout(300);
r=await page.evaluate(()=>({gone:!document.querySelector('.message[data-message-id="m3"]'),
  footer:document.querySelector('.message[data-message-id="m1"] .thread-open')?.textContent.trim()}));
ok("message.deleted removes the message",r.gone);
ok("reply count drops after a reply is deleted",/2 replies/.test(r.footer||""),r.footer);

/* ================= 6. TYPING ================= */
console.log("\n-- typing --");
await page.evaluate(()=>{const s=window.__space;s.active=s.conversations.find(c=>c.id==="c1");s.renderMessages()});
await page.evaluate(()=>{window.__space.streamChannels.get("messaging:c1")._emit("typing.start",{user:{id:"u_kavya",name:"Kavya Sharma"}})});
await page.waitForTimeout(250);
r=await page.evaluate(()=>{const el=document.querySelector("#typing");
  return {hidden:el.hidden,text:el.textContent.replace(/\s+/g," ").trim(),display:getComputedStyle(el).display,dots:el.querySelectorAll(".typing-dots span").length}});
ok("typing indicator shows",r.hidden===false&&r.display!=="none",r);
ok("typing names the person",/Kavya Sharma is typing/.test(r.text),r.text);
ok("typing renders three dots",r.dots===3,r.dots);

await page.evaluate(()=>{window.__space.streamChannels.get("messaging:c1")._emit("typing.start",{user:{id:"u_anil",name:"Anil Rao"}})});
await page.waitForTimeout(200);
ok("two typers read naturally",
  /Kavya Sharma and Anil Rao are typing/.test(await page.evaluate(()=>document.querySelector("#typing").textContent)));
await page.evaluate(()=>{["typing.stop"].forEach(n=>window.__space.streamChannels.get("messaging:c1")._emit(n,{user:{id:"u_anil"}}))});
await page.waitForTimeout(200);
await page.evaluate(()=>{window.__space.streamChannels.get("messaging:c1")._emit("typing.stop",{user:{id:"u_kavya"}})});
await page.waitForTimeout(250);
ok("typing clears on stop",await page.evaluate(()=>document.querySelector("#typing").hidden===true));

/* my own typing must never show to me */
await page.evaluate(()=>{window.__space.streamChannels.get("messaging:c1")._emit("typing.start",{user:{id:"u_me",name:"Saksham Nirula"}})});
await page.waitForTimeout(250);
ok("my own typing is ignored",await page.evaluate(()=>document.querySelector("#typing").hidden===true));

/* typing in a background chat must not leak into the open one */
await page.evaluate(()=>{window.__space.streamChannels.get("messaging:g1")._emit("typing.start",{user:{id:"u_anil",name:"Anil Rao"}})});
await page.waitForTimeout(250);
ok("typing in another chat stays there",await page.evaluate(()=>document.querySelector("#typing").hidden===true));

/* keystroke fires from the composer */
await page.evaluate(()=>{globalThis.__streamCalls.length=0});
await page.fill("#message-input","hello");
await page.waitForTimeout(250);
ok("typing in the composer calls keystroke",
  await page.evaluate(()=>globalThis.__streamCalls.some(c=>c[0]==="keystroke")));
await page.fill("#message-input","");
await page.waitForTimeout(250);
ok("clearing the composer calls stopTyping",
  await page.evaluate(()=>globalThis.__streamCalls.some(c=>c[0]==="stopTyping")));

/* ================= 7. NO EXTRA API CALLS ================= */
console.log("\n-- call budget --");
await page.evaluate(()=>{globalThis.__streamCalls.length=0});
await page.click('.message[data-message-id="m1"] .thread-open');
await page.waitForTimeout(500);
r=await page.evaluate(()=>globalThis.__streamCalls.map(c=>c[0]));
ok("opening a thread makes at most one getReplies and no query",
  !r.includes("query")&&r.filter(x=>x==="getReplies").length<=1,r);
await page.keyboard.press("Escape");
await page.evaluate(()=>{globalThis.__streamCalls.length=0});
await page.click('.message[data-message-id="m1"] .thread-open');
await page.waitForTimeout(400);
r=await page.evaluate(()=>globalThis.__streamCalls.map(c=>c[0]));
ok("reopening the same thread refetches nothing",r.length===0,r);
await page.keyboard.press("Escape");

/* ================= 8. RESPONSIVE ================= */
console.log("\n-- responsive --");
for(const vp of [{w:390,h:844,label:"phone"},{w:820,h:1180,label:"tablet"},{w:1440,h:900,label:"laptop"}]){
  await page.setViewportSize({width:vp.w,height:vp.h});
  await page.waitForTimeout(300);
  await page.evaluate(()=>{window.__space.renderMessages()});
  await page.click('.message[data-message-id="m1"] .thread-open');
  await page.waitForTimeout(350);
  const box=await page.evaluate(()=>{const p=document.querySelector(".thread-panel");const b=p.getBoundingClientRect();
    return {w:b.width,right:b.right,inner:window.innerWidth,overflow:document.documentElement.scrollWidth>window.innerWidth}});
  ok(`thread panel fits on ${vp.label}`,box.w<=box.inner+1&&Math.round(box.right)<=box.inner+1&&!box.overflow,box);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
