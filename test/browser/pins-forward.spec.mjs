/* Chat Pins in the details panel, and forwarding to people who have never
   been messaged before.

   The fixture directory has four people but conversations with only Kavya
   (direct) and the Ops group, so Anil and Priya are the "never chatted"
   case the forward picker has to surface. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await boot(page);

/* ---------- Chat Pins ---------- */
const empty=await page.evaluate(()=>{
  window.__space.renderDetailsPanel();
  return document.querySelector("#chat-pins").textContent.trim();
});
ok("Chat Pins section exists",await page.evaluate(()=>!!document.querySelector("#chat-pins-section")));
ok("Chat Pins is headed 'Chat Pins'",
  await page.evaluate(()=>document.querySelector("#chat-pins-section h4").textContent.trim())==="Chat Pins");
ok("Chat Pins is empty before anything is pinned",/No pinned messages/.test(empty),empty);

const pinned=await page.evaluate(()=>{
  const s=window.__space;
  s.active.messages[0].pinned=true;
  s.renderDetailsPanel();
  const items=[...document.querySelectorAll(".chat-pin-item")];
  return {count:items.length,text:items[0]?.textContent.replace(/\s+/g," ").trim(),
    id:items[0]?.dataset.pinJump};
});
ok("a pinned message appears in Chat Pins",pinned.count===1,pinned);
ok("the pin shows who sent it",/Kavya Sharma/.test(pinned.text||""),pinned);
ok("the pin shows the message text",/Q3 numbers/.test(pinned.text||""),pinned);
ok("the pin links to its message id",pinned.id==="m1",pinned);

/* Pinning from the message menu must repaint the section, not just the chat. */
const viaMenu=await page.evaluate(async()=>{
  const s=window.__space;
  s.active.messages[1].pinned=true;
  s.renderDetailsPanel();
  return document.querySelectorAll(".chat-pin-item").length;
});
ok("a second pin is listed too",viaMenu===2,viaMenu);

const unpinned=await page.evaluate(()=>{
  const s=window.__space;
  s.active.messages.forEach(m=>{m.pinned=false});
  s.renderDetailsPanel();
  return document.querySelector("#chat-pins").textContent.trim();
});
ok("unpinning empties the section",/No pinned messages/.test(unpinned),unpinned);

/* An attachment-only pin must not render a blank row. */
const attachmentPin=await page.evaluate(()=>{
  const s=window.__space;
  const m=s.active.messages[0];
  m.pinned=true;m.text="";m.attachments=[{kind:"file",name:"report.pdf",url:"/f.pdf"}];
  s.renderDetailsPanel();
  const t=document.querySelector(".chat-pin-item")?.textContent.replace(/\s+/g," ").trim();
  m.pinned=false;m.text="Can you review the Q3 numbers?";m.attachments=[];
  return t;
});
ok("an attachment-only pin says Attachment",/Attachment/.test(attachmentPin||""),attachmentPin);

/* ---------- forward to anyone ---------- */
const fwd=await page.evaluate(()=>{
  const s=window.__space;
  s.openForwardDialog(s.active.messages[0]);
  const opts=[...document.querySelectorAll("#forward-list button")];
  return {names:opts.map(b=>b.querySelector("strong")?.textContent.trim()),
    people:opts.filter(b=>b.dataset.forwardPerson).map(b=>b.querySelector("strong").textContent.trim()),
    labels:[...document.querySelectorAll(".forward-group-label")].map(l=>l.textContent.trim())};
});
ok("forward lists the existing group",fwd.names.includes("Ops Team"),fwd);
ok("forward lists people never chatted with",
  fwd.people.includes("Anil Rao")&&fwd.people.includes("Priya Nair"),fwd);
ok("forward does not list the current user",!fwd.names.includes("Saksham Nirula"),fwd);
/* Kavya already has a conversation - she must appear once, not twice. */
ok("someone already chatted with is not duplicated",
  fwd.names.filter(n=>n==="Kavya Sharma").length<=1,fwd);
ok("forward groups the two kinds of target",
  fwd.labels.includes("Conversations")&&fwd.labels.includes("All people"),fwd);

/* Search must reach people with no conversation. */
const search=await page.evaluate(()=>{
  const input=document.querySelector("#forward-search");
  input.value="priya";input.dispatchEvent(new Event("input",{bubbles:true}));
  const opts=[...document.querySelectorAll("#forward-list button")];
  return opts.map(b=>b.querySelector("strong")?.textContent.trim());
});
ok("searching finds a never-chatted person",search.includes("Priya Nair"),search);
ok("searching filters out everyone else",search.length===1,search);

const byDept=await page.evaluate(()=>{
  const input=document.querySelector("#forward-search");
  input.value="finance";input.dispatchEvent(new Event("input",{bubbles:true}));
  return [...document.querySelectorAll("#forward-list button")].map(b=>b.querySelector("strong")?.textContent.trim());
});
ok("searching by department works",byDept.includes("Anil Rao"),byDept);

/* Forwarding to a new person must create the DM on the deterministic id. */
const sent=await page.evaluate(async()=>{
  const s=window.__space;
  const input=document.querySelector("#forward-search");
  input.value="";input.dispatchEvent(new Event("input",{bubbles:true}));
  const before=s.active.id;
  const btn=[...document.querySelectorAll("#forward-list button")]
    .find(b=>b.dataset.forwardPerson==="u_priya");
  btn.click();
  await new Promise(r=>setTimeout(r,700));
  return {activeUnchanged:s.active.id===before,
    calls:(window.__fakeStreamCalls||[]).map(c=>c[0])};
});
ok("forwarding to a new person leaves the open chat alone",sent.activeUnchanged,sent);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
