/* New messages must appear without a refresh, using only the websocket.

   The bug: applyIncomingStreamMessage stored the body only for the chat on
   screen. For a background chat it bumped the unread badge and dropped the
   message. Since that chat kept messagesLoaded:true, switchChat's
   "load only if not loaded" check skipped the fetch, so the message stayed
   invisible until a full page refresh. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await boot(page);

const incoming=(cid,id,text,user="u_kavya")=>({
  cid,channel:{cid},message:{id,text,user:{id:user,name:"Kavya Sharma"},
    created_at:new Date().toISOString(),attachments:[],mentioned_users:[]}});

/* --- a message for the chat already on screen --- */
const live=await page.evaluate(inc=>{
  const s=window.__space;
  s.applyIncomingStreamMessage(inc);
  return {count:s.active.messages.length,
    painted:document.body.innerText.includes("Shipping the build tonight")};
},incoming("messaging:c1","n1","Shipping the build tonight"));
ok("a message for the open chat is stored",live.count===3,live);
ok("a message for the open chat paints without a refresh",live.painted,live);

/* --- a message for a BACKGROUND chat: the reported bug --- */
const bg=await page.evaluate(inc=>{
  const s=window.__space;
  const grp=s.conversations.find(c=>c.id==="g1");
  /* Mark it as previously opened, which is what made the bug reachable. */
  grp.messagesLoaded=true;grp.fromCache=false;grp.messages=[];
  s.applyIncomingStreamMessage(inc);
  return {stored:grp.messages.length,unread:grp.unread,
    text:grp.messages.at(-1)?.text};
},incoming("messaging:g1","n2","Standup moved to 10"));
ok("a background chat still counts the unread",bg.unread===1,bg);
ok("a background chat KEEPS the message body",bg.stored===1,bg);
ok("the stored body is the message that arrived",bg.text==="Standup moved to 10",bg);

/* Switching to it must show the message with no extra fetch. */
const shown=await page.evaluate(async()=>{
  const s=window.__space;
  const before=(window.__fakeStreamCalls||[]).filter(c=>c[0]==="query").length;
  await s.switchChat("g1");
  const after=(window.__fakeStreamCalls||[]).filter(c=>c[0]==="query").length;
  return {painted:document.body.innerText.includes("Standup moved to 10"),
    queries:after-before};
});
ok("switching to it shows the message without a refresh",shown.painted,shown);
ok("switching to it costs no extra channel query",shown.queries===0,shown);

/* --- a chat never opened must NOT be given a lone message as its history --- */
const unopened=await page.evaluate(async inc=>{
  const s=window.__space;
  /* switchChat above made g1 active; a message for the chat on screen takes
     the other branch, so move back to c1 first. */
  await s.switchChat("c1");
  const grp=s.conversations.find(c=>c.id==="g1");
  grp.messagesLoaded=false;grp.messages=[];grp.unread=0;
  s.applyIncomingStreamMessage(inc);
  return {stored:grp.messages.length,unread:grp.unread};
},incoming("messaging:g1","n3","Another one"));
ok("a never-opened chat is not seeded with a partial history",unopened.stored===0,unopened);
ok("a never-opened chat still counts the unread",unopened.unread===1,unopened);

/* --- duplicates must not pile up --- */
const dupe=await page.evaluate(inc=>{
  const s=window.__space;
  const grp=s.conversations.find(c=>c.id==="g1");
  grp.messagesLoaded=true;grp.fromCache=false;grp.messages=[];
  s.applyIncomingStreamMessage(inc);
  s.applyIncomingStreamMessage(inc);
  return grp.messages.length;
},incoming("messaging:g1","n4","Only once please"));
ok("the same message is not stored twice",dupe===1,dupe);

/* --- own messages must never be double-counted --- */
const mine=await page.evaluate(()=>{
  const s=window.__space;
  const before=s.active.messages.length;
  s.applyIncomingStreamMessage({cid:"messaging:c1",channel:{cid:"messaging:c1"},
    message:{id:"n5",text:"from me",user:{id:"u_me"},created_at:new Date().toISOString(),
      attachments:[],mentioned_users:[]}});
  return s.active.messages.length-before;
});
ok("your own echoed message is ignored",mine===0,mine);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
