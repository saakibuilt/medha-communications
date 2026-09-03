/* Edit and forward now use in-page dialogs instead of window.prompt(). */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
let page=await browser.newPage({viewport:{width:1440,height:900}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
/* If any native prompt fires, the test must fail rather than hang. */
page.on("dialog",async d=>{console.log("  [NATIVE DIALOG] "+d.type());await d.dismiss()});
await boot(page);
await page.evaluate(()=>{window.__native=0;
  const p=window.prompt;window.prompt=(...a)=>{window.__native++;return p?.(...a)}});

console.log("-- edit dialog --");
await page.evaluate(()=>window.__space.openEditDialog(window.__space.active.messages.find(m=>m.id==="m2")));
await page.waitForTimeout(500);
let r=await page.evaluate(()=>{const d=document.querySelector("#edit-message-dialog");
  return {open:d.open,value:d.querySelector("#edit-message-text").value,
    glyph:!!d.querySelector(".sheet-glyph svg"),heading:d.querySelector("h2").textContent,
    focused:document.activeElement?.id,native:window.__native,
    inView:(()=>{const b=d.getBoundingClientRect();return b.top>=0&&b.bottom<=window.innerHeight})()}});
ok("edit opens an in-page dialog",r.open,r);
ok("no native prompt is used",r.native===0,r.native);
ok("dialog is prefilled with the message",r.value==="On it.",r.value);
ok("dialog has its glyph and heading",r.glyph&&r.heading==="Edit message",r);
ok("the textarea is focused",r.focused==="edit-message-text",r.focused);
ok("dialog sits fully on screen",r.inView,r);

await page.fill("#edit-message-text","On it - sending by noon.");
await page.click("#edit-message-save");
await page.waitForTimeout(600);
r=await page.evaluate(()=>({open:document.querySelector("#edit-message-dialog").open,
  text:window.__space.active.messages.find(m=>m.id==="m2")?.text,
  rendered:document.querySelector('.message[data-message-id="m2"] .bubble')?.textContent,
  sdk:globalThis.__streamCalls.filter(c=>c[0]==="updateMessage").length}));
ok("saving closes the dialog",r.open===false);
ok("the message text is updated",r.text==="On it - sending by noon.",r.text);
ok("the chat repaints with the new text",/sending by noon/.test(r.rendered||""),r.rendered);
ok("updateMessage is called once",r.sdk===1,r.sdk);

/* cancel leaves the message alone */
await page.evaluate(()=>window.__space.openEditDialog(window.__space.active.messages.find(m=>m.id==="m2")));
await page.waitForTimeout(400);
await page.fill("#edit-message-text","discard this");
await page.click('#edit-message-form .secondary-button');
await page.waitForTimeout(450);
r=await page.evaluate(()=>({open:document.querySelector("#edit-message-dialog").open,
  text:window.__space.active.messages.find(m=>m.id==="m2")?.text}));
ok("cancel closes the dialog",r.open===false);
ok("cancel does not change the message",r.text==="On it - sending by noon.",r.text);

/* empty text is rejected by validation, not silently saved */
await page.evaluate(()=>window.__space.openEditDialog(window.__space.active.messages.find(m=>m.id==="m2")));
await page.waitForTimeout(400);
await page.fill("#edit-message-text","   ");
await page.click("#edit-message-save");
await page.waitForTimeout(450);
ok("an all-space edit does not wipe the message",
  await page.evaluate(()=>window.__space.active.messages.find(m=>m.id==="m2")?.text==="On it - sending by noon."));
await page.evaluate(()=>document.querySelector("#edit-message-dialog").close());

console.log("\n-- forward dialog --");
await page.evaluate(()=>window.__space.openForwardDialog(window.__space.active.messages.find(m=>m.id==="m1")));
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const d=document.querySelector("#forward-dialog");
  return {open:d.open,preview:d.querySelector(".forward-text")?.textContent,
    targets:[...d.querySelectorAll("[data-forward-to]")].map(b=>b.dataset.forwardTo),
    native:window.__native}});
ok("forward opens an in-page dialog",r.open,r);
ok("forward uses no native prompt",r.native===0,r.native);
ok("forward previews the message",/Q3 numbers/.test(r.preview||""),r.preview);
ok("forward lists other conversations only",r.targets.length===1&&r.targets[0]==="g1",r.targets);

await page.evaluate(()=>{globalThis.__streamCalls.length=0});
await page.click('[data-forward-to="g1"]');
await page.waitForTimeout(700);
r=await page.evaluate(()=>({open:document.querySelector("#forward-dialog").open,
  sent:globalThis.__streamCalls.find(c=>c[0]==="sendMessage")?.[2],
  toast:document.querySelector("#toast")?.textContent}));
ok("picking a target forwards and closes",r.open===false,r);
ok("the forwarded text is sent",/Q3 numbers/.test(r.sent?.text||""),r.sent);
ok("forward metadata travels with it",r.sent?.forwarded_message_id==="m1",r.sent);
ok("a confirmation is shown",/Forwarded to/.test(r.toast||""),r.toast);
await page.close();

console.log("\n-- phone --");
page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
page.on("dialog",async d=>{await d.dismiss()});
await boot(page);
for(const [name,fn] of [["edit","openEditDialog"],["forward","openForwardDialog"]]){
  await page.evaluate(f=>window.__space[f](window.__space.active.messages[0]),fn);
  await page.waitForTimeout(550);
  const sel=name==="edit"?"#edit-message-dialog":"#forward-dialog";
  r=await page.evaluate(s=>{const d=document.querySelector(s),b=d.getBoundingClientRect();
    return {w:b.width,inner:window.innerWidth,bottom:Math.round(b.bottom),h:window.innerHeight,
      grip:getComputedStyle(d.querySelector(".sheet-grip")).display,
      overflow:document.documentElement.scrollWidth>window.innerWidth}},sel);
  ok(`${name} dialog is a full-width sheet on phone`,Math.round(r.w)===r.inner&&r.bottom<=r.h+1,r);
  ok(`${name} dialog shows the grip on phone`,r.grip==="block",r.grip);
  ok(`${name} dialog causes no overflow`,!r.overflow,r);
  await page.evaluate(s=>document.querySelector(s).close(),sel);
  await page.waitForTimeout(250);
}
await page.close();
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
