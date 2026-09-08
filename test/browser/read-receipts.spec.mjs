/* Sent / delivered / read ticks, and the Mark Read privacy switch. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:900}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await boot(page);

const status=()=>page.evaluate(()=>[...document.querySelectorAll(".message.mine")].map(m=>{
  const s=m.querySelector(".msg-status");
  return s?[...s.classList].find(c=>c.startsWith("msg-status--"))?.replace("msg-status--",""):null;
}).filter(Boolean));
/* Where the status sits, and that only one message carries it. */
const placement=()=>page.evaluate(()=>{
  const all=[...document.querySelectorAll(".msg-status")];
  if(all.length!==1)return {count:all.length};
  const el=all[0],msg=el.closest(".message");
  const body=msg.querySelector(".message-body");
  const bubble=msg.querySelector(".bubble");
  const meta=msg.querySelector(".message-meta");
  const mines=[...document.querySelectorAll(".message.mine")];
  return {count:1,
    inMeta:!!el.closest(".message-meta"),
    lastChildOfBody:body.lastElementChild===el,
    belowBubble:!!bubble&&el.getBoundingClientRect().top>=bubble.getBoundingClientRect().bottom-1,
    belowMeta:el.getBoundingClientRect().top>meta.getBoundingClientRect().bottom,
    onNewestSent:mines.at(-1)===msg,
    label:el.textContent.trim()};
});
const theirStatus=()=>page.evaluate(()=>
  [...document.querySelectorAll(".message:not(.mine)")].some(m=>m.querySelector(".msg-status")));

console.log("-- ticks on own messages only --");
ok("received messages carry no tick",!(await theirStatus()));
let s=await status();
ok("an existing own message shows delivered",s.at(-1)==="delivered",s);
let place=await placement();
ok("exactly one message reports a status",place.count===1,place);
ok("the status is not in the meta line above the bubble",place.inMeta===false,place);
ok("the status sits below the bubble",place.belowBubble&&place.belowMeta,place);
ok("the status is the last thing in the message body",place.lastChildOfBody,place);
ok("the status is on the newest sent message",place.onNewestSent,place);
ok("the status spells out its state",/Delivered/i.test(place.label||""),place);
ok("delivered draws two ticks, no eye",await page.evaluate(()=>{
  const el=document.querySelector(".msg-status");
  return el.querySelectorAll("svg path").length===2&&!el.querySelector(".eye-pupil")}));

console.log("-- sending --");
/* Hold the send open so the in-flight state can be observed. */
await page.evaluate(()=>{
  const ch=window.__space.streamChannels.get("messaging:c1");
  ch.__realSend=ch.sendMessage;
  ch.sendMessage=m=>new Promise(res=>{window.__release=()=>res(ch.__realSend(m))});
});
await page.fill("#message-input","Holding this one");
await page.click(".send-button");
await page.waitForTimeout(300);
let inflight=await page.evaluate(()=>{
  const m=document.querySelector(".message.mine.is-pending");
  return m?{text:m.querySelector(".bubble")?.textContent,
    status:[...m.querySelector(".msg-status").classList].find(c=>c.startsWith("msg-status--")),
    ticks:m.querySelectorAll(".msg-status svg path").length,
    label:m.querySelector(".msg-status")?.textContent.trim()}:null;
});
ok("the bubble appears immediately while in flight",!!inflight,inflight);
ok("in-flight status is sent",inflight?.status==="msg-status--sent",inflight);
ok("sent shows a single tick",inflight?.ticks===1,inflight);
ok("sent is labelled Sent",/Sent/i.test(inflight?.label||""),inflight);

await page.evaluate(()=>window.__release());
await page.waitForTimeout(400);
let settled=await page.evaluate(()=>{
  const m=[...document.querySelectorAll(".message.mine")].at(-1);
  return {pending:m.classList.contains("is-pending"),
    status:[...m.querySelector(".msg-status").classList].find(c=>c.startsWith("msg-status--")),
    ticks:m.querySelectorAll(".msg-status svg path").length,
    text:m.querySelector(".bubble")?.textContent};
});
ok("acknowledged message is no longer pending",!settled.pending,settled);
ok("acknowledged status is delivered",settled.status==="msg-status--delivered",settled);
ok("delivered shows two ticks",settled.ticks===2,settled);
place=await placement();
ok("the status moved to the newly sent message",place.count===1&&place.onNewestSent,place);
ok("the message is not duplicated",(await page.evaluate(()=>
  [...document.querySelectorAll(".bubble")].filter(b=>b.textContent==="Holding this one").length))===1);

console.log("-- read --");
await page.evaluate(()=>{
  const ch=window.__space.streamChannels.get("messaging:c1");
  ch.state.read={u_kavya:{last_read:new Date(Date.now()+1000).toISOString(),user:{id:"u_kavya"}}};
  ch._emit("message.read",{user:{id:"u_kavya"},cid:ch.cid});
});
await page.waitForTimeout(250);
s=await status();
ok("a recipient's read cursor turns the status to read",s.every(x=>x==="read"),s);
place=await placement();
ok("seen is spelled out under the newest sent message",/Seen/i.test(place.label||"")&&place.onNewestSent,place);
ok("read shows an eye, not ticks",await page.evaluate(()=>{
  const el=document.querySelector(".msg-status");
  return !!el.querySelector(".eye-pupil")&&!el.querySelector(".tick-second")}));

/* A group is only read once everyone else is there. */
console.log("-- group: every member must have read --");
await page.evaluate(async()=>{
  const s=window.__space;
  s.active=s.conversations.find(c=>c.id==="g1");
  s.active.messages=[{id:"gm1",senderId:"u_me",who:"me",senderName:"Saksham Nirula",text:"Standup?",
    attachments:[],reactions:{},createdAt:new Date().toISOString(),time:"10:00 AM"}];
  s.active.messagesLoaded=true;
  const ch=s.streamChannels.get("messaging:g1");
  ch.state.read={u_kavya:{last_read:new Date(Date.now()+1000).toISOString()}};
  s.renderMessages();
});
await page.waitForTimeout(200);
s=await status();
ok("one of two members read keeps it delivered",s.at(-1)==="delivered",s);
await page.evaluate(()=>{
  const s=window.__space,ch=s.streamChannels.get("messaging:g1");
  ch.state.read.u_anil={last_read:new Date(Date.now()+1000).toISOString()};
  s.renderMessages();
});
await page.waitForTimeout(200);
s=await status();
ok("all members read turns it to read",s.at(-1)==="read",s);

console.log("-- Mark Read off --");
await page.evaluate(async()=>{
  const s=window.__space;
  s.active=s.conversations.find(c=>c.id==="c1");
  s.renderMessages();
});
const before=await page.evaluate(()=>globalThis.__streamCalls.filter(c=>c[0]==="markRead").length);
await page.evaluate(()=>document.querySelector('.rail-item[data-view="settings"]').click());
await page.waitForTimeout(300);
ok("the Mark Read toggle exists and is on",await page.evaluate(()=>{
  const el=document.querySelector("#setting-read-receipts");return !!el&&el.checked}));
await page.evaluate(()=>{
  const el=document.querySelector("#setting-read-receipts");
  el.checked=false;el.dispatchEvent(new Event("change",{bubbles:true}));
});
await page.waitForTimeout(200);
ok("turning it off is remembered",await page.evaluate(()=>
  JSON.parse(localStorage.getItem("medha-communications-preferences-u_me")||"{}").readReceipts===false));

await page.evaluate(()=>{
  const s=window.__space;
  s.active=s.conversations.find(c=>c.id==="c1");
  document.querySelector('.rail-item[data-view="chat"]').click();
  s.renderMessages();
});
await page.waitForTimeout(250);
s=await status();
ok("with Mark Read off, read state is not shown - capped at delivered",
  s.length>0&&s.every(x=>x==="delivered"),s);

/* The read cursor is already sitting in channel state; the point is that the
   app must not consult it, and must not tell the server anything either. */
await page.evaluate(()=>{
  const s=window.__space,ch=s.streamChannels.get("messaging:c1");
  ch.state.read={u_kavya:{last_read:new Date(Date.now()+9000).toISOString()}};
  ch._emit("message.read",{user:{id:"u_kavya"},cid:ch.cid});
});
await page.waitForTimeout(250);
s=await status();
ok("a read receipt arriving while off changes nothing",s.every(x=>x==="delivered"),s);

/* Receiving and opening a message must not call markRead while off. */
await page.evaluate(()=>{
  const ch=window.__space.streamChannels.get("messaging:c1");
  ch._emit("message.new",{cid:ch.cid,channel:{cid:ch.cid},
    message:{id:"in1",text:"Ping",user:{id:"u_kavya",name:"Kavya Sharma"},created_at:new Date().toISOString()}});
});
await page.waitForTimeout(400);
await page.evaluate(()=>window.__space.markConversationRead?.(window.__space.active));
await page.waitForTimeout(300);
const after=await page.evaluate(()=>globalThis.__streamCalls.filter(c=>c[0]==="markRead").length);
ok("no markRead is sent to the server while off",after===before,{before,after});
ok("the read stays private in this browser instead",await page.evaluate(()=>
  !!JSON.parse(localStorage.getItem("medha-communications-seen-u_me")||"{}")["messaging:c1"]));

console.log("-- Mark Read back on --");
await page.evaluate(()=>{
  document.querySelector('.rail-item[data-view="settings"]').click();
  const el=document.querySelector("#setting-read-receipts");
  el.checked=true;el.dispatchEvent(new Event("change",{bubbles:true}));
});
await page.waitForTimeout(400);
ok("turning it back on resumes sending read receipts",await page.evaluate(()=>
  globalThis.__streamCalls.filter(c=>c[0]==="markRead").length)>after);
await page.evaluate(()=>{
  document.querySelector('.rail-item[data-view="chat"]').click();
  window.__space.renderMessages();
});
await page.waitForTimeout(250);
s=await status();
ok("read state is visible again",s.some(x=>x==="read"),s);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
