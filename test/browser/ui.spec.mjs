/* Banner + dialog redesign, verified in a real browser. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();

/* ================= BANNER: phone ================= */
console.log("-- banner (phone) --");
let page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await boot(page);

/* a message in a chat that is NOT open */
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:g1")._emit("message.new",{cid:"messaging:g1",channel:{cid:"messaging:g1"},
    message:{id:"b1",text:"Standup moved to 10:30",user:{id:"u_anil",name:"Anil Rao"},created_at:new Date().toISOString()}});
});
await page.waitForTimeout(500);
let r=await page.evaluate(()=>{const b=document.querySelector(".banner");if(!b)return null;
  const rect=b.getBoundingClientRect();
  return {title:b.querySelector(".banner-title").textContent,body:b.querySelector(".banner-body").textContent,
    top:rect.top,inView:rect.top>=0&&rect.bottom<=window.innerHeight,width:rect.width,inner:window.innerWidth,
    chatId:b.dataset.chatId,visible:getComputedStyle(b).opacity}});
ok("banner appears for a message in another chat",!!r,r);
ok("banner is at the top of the screen",r&&r.top<80&&r.inView,r);
ok("banner names sender and group",/Anil Rao in Ops Team/.test(r?.title||""),r?.title);
ok("banner shows the message text",/Standup moved/.test(r?.body||""),r?.body);
ok("banner fits the phone width",r&&r.width<=r.inner,r);
ok("banner is fully faded in",r&&Number(r.visible)===1,r?.visible);

/* tapping it opens that chat */
await page.click(".banner");
await page.waitForTimeout(500);
r=await page.evaluate(()=>({active:window.__space.active?.id,gone:!document.querySelector(".banner")}));
ok("tapping the banner opens that chat",r.active==="g1",r);
ok("banner dismisses after tap",r.gone,r);

/* no banner for the chat already on screen */
await page.evaluate(()=>{const s=window.__space;s.active=s.conversations.find(c=>c.id==="c1");s.renderMessages()});
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:c1")._emit("message.new",{cid:"messaging:c1",channel:{cid:"messaging:c1"},
    message:{id:"b2",text:"visible already",user:{id:"u_kavya"},created_at:new Date().toISOString()}});
});
await page.waitForTimeout(500);
ok("no banner for the conversation being read",await page.evaluate(()=>!document.querySelector(".banner")));

/* no banner for my own message echoed back */
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:g1")._emit("message.new",{cid:"messaging:g1",channel:{cid:"messaging:g1"},
    message:{id:"b3",text:"mine",user:{id:"u_me"},created_at:new Date().toISOString()}});
});
await page.waitForTimeout(400);
ok("no banner for my own message",await page.evaluate(()=>!document.querySelector(".banner")));

/* reaction on MY message banners; on someone else's does not */
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:c1")._emit("reaction.new",
    {message:{id:"m2"},user:{id:"u_kavya",name:"Kavya Sharma"},reaction:{type:"👍"}});
});
await page.waitForTimeout(450);
r=await page.evaluate(()=>{const b=document.querySelector(".banner");
  return b?{title:b.querySelector(".banner-title").textContent,body:b.querySelector(".banner-body").textContent}:null});
ok("reaction on my message shows a banner",!!r&&/Kavya Sharma reacted/.test(r.title),r);
ok("reaction banner quotes my message",/On it/.test(r?.body||""),r?.body);
await page.evaluate(()=>window.__space.dismissBanner());
await page.waitForTimeout(450);
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:c1")._emit("reaction.new",
    {message:{id:"m1"},user:{id:"u_anil",name:"Anil Rao"},reaction:{type:"🎉"}});
});
await page.waitForTimeout(400);
ok("no banner for a reaction on someone else's message",await page.evaluate(()=>!document.querySelector(".banner")));
/* removing a reaction is not banner-worthy */
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:c1")._emit("reaction.deleted",
    {message:{id:"m2"},user:{id:"u_kavya"},reaction:{type:"👍"}});
});
await page.waitForTimeout(400);
ok("no banner when a reaction is removed",await page.evaluate(()=>!document.querySelector(".banner")));

/* auto-dismiss */
await page.evaluate(()=>window.__space.showBanner({chatId:"g1",title:"Test",body:"body",initials:"T",color:"blue",kind:"message"}));
await page.waitForTimeout(300);
ok("banner is up before the timeout",await page.evaluate(()=>!!document.querySelector(".banner")));
await page.waitForTimeout(4600);
ok("banner auto-dismisses",await page.evaluate(()=>!document.querySelector(".banner")));

/* only one banner at a time */
await page.evaluate(()=>{const s=window.__space;
  s.showBanner({chatId:"g1",title:"One",body:"a",initials:"O",kind:"message"});
  s.showBanner({chatId:"g1",title:"Two",body:"b",initials:"T",kind:"message"})});
await page.waitForTimeout(300);
ok("banners never stack",await page.evaluate(()=>document.querySelectorAll(".banner").length===1));
await page.evaluate(()=>window.__space.dismissBanner());
await page.close();

/* ================= BANNER: desktop must not show ================= */
console.log("\n-- banner (desktop) --");
page=await browser.newPage({viewport:{width:1440,height:900}});
await boot(page);
await page.evaluate(()=>{
  window.__space.streamChannels.get("messaging:g1")._emit("message.new",{cid:"messaging:g1",channel:{cid:"messaging:g1"},
    message:{id:"d1",text:"desktop",user:{id:"u_anil"},created_at:new Date().toISOString()}});
});
await page.waitForTimeout(450);
ok("no banner on desktop",await page.evaluate(()=>!document.querySelector(".banner")));
ok("unread still counted on desktop",await page.evaluate(()=>window.__space.conversations.find(c=>c.id==="g1").unread>0));

/* ================= DIALOGS ================= */
console.log("\n-- dialogs --");
r=await page.evaluate(()=>({group:!!document.querySelector("#new-group svg"),chat:!!document.querySelector("#new-chat svg"),
  groupText:document.querySelector("#new-group").textContent.trim()}));
ok("group button uses an svg icon, not a glyph char",r.group&&r.groupText==="",r);
ok("new chat button uses an svg icon",r.chat);

await page.click("#new-chat");
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const d=document.querySelector("#new-chat-dialog");
  return {open:d.open,glyph:!!d.querySelector(".sheet-glyph svg"),heading:d.querySelector("h2").textContent,
    people:d.querySelectorAll(".employee-option").length,
    hasSearch:!!d.querySelector("#new-chat-person"),
    overflow:document.documentElement.scrollWidth>window.innerWidth}});
ok("start-chat dialog opens",r.open,r);
ok("start-chat dialog shows its glyph",r.glyph);
ok("start-chat lists people",r.people>=3,r.people);
ok("no horizontal overflow from the dialog",!r.overflow);
await page.fill("#new-chat-person","kav");
await page.waitForTimeout(300);
r=await page.evaluate(()=>[...document.querySelectorAll("#employee-list .employee-option")].map(b=>b.textContent.replace(/\s+/g," ").trim()));
ok("start-chat search filters",r.length===1&&/Kavya/.test(r[0]),r);
await page.evaluate(()=>document.querySelector("#new-chat-dialog").close());

await page.click("#new-group");
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const d=document.querySelector("#group-chat-dialog");
  return {open:d.open,glyph:!!d.querySelector(".sheet-glyph svg"),
    count:d.querySelector("#group-member-count").textContent,
    createDisabled:d.querySelector("#group-create-button").disabled,
    chipsHidden:d.querySelector("#group-chosen").hidden,
    people:d.querySelectorAll("#group-member-list .employee-option").length,
    hasSearch:!!d.querySelector("#group-member-search")}});
ok("group dialog opens",r.open,r);
ok("group dialog shows its glyph",r.glyph);
ok("group dialog has a member search",r.hasSearch);
ok("create is disabled with nothing chosen",r.createDisabled===true);
ok("count reads None selected",r.count==="None selected",r.count);
ok("chip row hidden when empty",r.chipsHidden===true);
ok("group dialog excludes me from the list",r.people===3,r.people);

await page.fill("#group-member-search","an");
await page.waitForTimeout(300);
r=await page.evaluate(()=>[...document.querySelectorAll("#group-member-list .employee-option")].map(b=>b.textContent.replace(/\s+/g," ").trim()));
ok("group member search filters",r.length>=1&&r.every(t=>/an/i.test(t)),r);
await page.fill("#group-member-search","");
await page.waitForTimeout(250);

await page.click('[data-group-person-id="u_kavya"]');
await page.waitForTimeout(350);
r=await page.evaluate(()=>{const d=document.querySelector("#group-chat-dialog");
  return {count:d.querySelector("#group-member-count").textContent,
    chips:[...d.querySelectorAll(".member-chip")].map(c=>c.textContent.replace(/\s+/g," ").trim()),
    chipsHidden:d.querySelector("#group-chosen").hidden,
    selected:d.querySelectorAll(".employee-option.selected").length,
    createDisabled:d.querySelector("#group-create-button").disabled}});
ok("selecting a member shows a chip",r.chips.length===1&&/Kavya/.test(r.chips[0]),r.chips);
ok("count updates",r.count==="1 selected",r.count);
ok("chip row appears",r.chipsHidden===false);
ok("row shows as selected",r.selected===1);
ok("create still disabled without a name",r.createDisabled===true);

await page.fill("#group-chat-name","Q3 Planning");
await page.waitForTimeout(300);
ok("create enables with a name and a member",
  await page.evaluate(()=>document.querySelector("#group-create-button").disabled===false));

await page.click(".member-chip");
await page.waitForTimeout(350);
r=await page.evaluate(()=>{const d=document.querySelector("#group-chat-dialog");
  return {chips:d.querySelectorAll(".member-chip").length,selected:d.querySelectorAll(".employee-option.selected").length,
    disabled:d.querySelector("#group-create-button").disabled,count:d.querySelector("#group-member-count").textContent}});
ok("removing a chip deselects the row",r.chips===0&&r.selected===0,r);
ok("create disables again with no members",r.disabled===true);
ok("count resets",r.count==="None selected",r.count);

/* selection survives a search that hides the person */
await page.click('[data-group-person-id="u_priya"]');
await page.fill("#group-member-search","anil");
await page.waitForTimeout(300);
r=await page.evaluate(()=>({chips:[...document.querySelectorAll(".member-chip")].map(c=>c.textContent.trim()),
  listed:document.querySelectorAll("#group-member-list .employee-option").length}));
ok("a chosen member stays chosen while filtered out",r.chips.length===1&&/Priya/.test(r.chips[0]),r);
await page.evaluate(()=>document.querySelector("#group-chat-dialog").close());
await page.close();

/* ---- cancel must never trigger validation on the required name ---- */
console.log("\n-- cancel --");
page=await browser.newPage({viewport:{width:1440,height:900}});
await boot(page);
for(const [label,sel] of [["Cancel",'#group-chat-form .secondary-button'],["X",'#group-chat-form .close-dialog']]){
  await page.click("#new-group");
  await page.waitForTimeout(400);
  /* Leave the required name empty and pick a member, the exact state that
     made Cancel demand a group name. */
  await page.click('[data-group-person-id="u_kavya"]');
  await page.waitForTimeout(250);
  await page.click(sel);
  await page.waitForTimeout(400);
  r=await page.evaluate(()=>({open:document.querySelector("#group-chat-dialog").open,
    invalid:!document.querySelector("#group-chat-name").checkValidity(),
    groups:window.__space.conversations.filter(c=>c.kind==="group").length}));
  ok(`${label} closes the group dialog with an empty name`,r.open===false,r);
  ok(`${label} does not create a group`,r.groups===1,r);
}
/* the same for the start-chat dialog */
await page.click("#new-chat");
await page.waitForTimeout(400);
await page.click('#new-chat-form .secondary-button');
await page.waitForTimeout(350);
ok("Cancel closes the start-chat dialog",await page.evaluate(()=>document.querySelector("#new-chat-dialog").open===false));
/* Esc still works too */
await page.click("#new-group");
await page.waitForTimeout(400);
await page.keyboard.press("Escape");
await page.waitForTimeout(350);
ok("Escape closes the group dialog",await page.evaluate(()=>document.querySelector("#group-chat-dialog").open===false));
await page.close();

/* ================= DIALOGS ON PHONE ================= */
console.log("\n-- dialogs (phone) --");
page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
await boot(page);
/* On a phone the sidebar holding both buttons is off-canvas until opened,
   so open it the way a person would before reaching the buttons. */
for(const id of ["#new-chat","#new-group"]){
  await page.evaluate(()=>document.body.classList.add("sidebar-open"));
  await page.waitForTimeout(350);
  await page.click(id);
  await page.waitForTimeout(550);
  const dlg=id==="#new-chat"?"#new-chat-dialog":"#group-chat-dialog";
  r=await page.evaluate(sel=>{const d=document.querySelector(sel),b=d.getBoundingClientRect();
    return {w:b.width,inner:window.innerWidth,bottom:Math.round(b.bottom),h:window.innerHeight,
      grip:getComputedStyle(d.querySelector(".sheet-grip")).display,
      overflow:document.documentElement.scrollWidth>window.innerWidth,
      fitsHeight:b.height<=window.innerHeight+1}},dlg);
  ok(`${id} is a full-width bottom sheet on phone`,Math.round(r.w)===r.inner&&r.bottom<=r.h+1,r);
  ok(`${id} shows the sheet grip on phone`,r.grip==="block",r.grip);
  ok(`${id} fits the phone screen`,!r.overflow&&r.fitsHeight,r);
  await page.evaluate(sel=>document.querySelector(sel).close(),dlg);
  await page.waitForTimeout(250);
}
await page.close();

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
