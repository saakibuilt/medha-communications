/* Attachment tray, upload states, preview lightbox and sent rendering. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
let page=await browser.newPage({viewport:{width:1440,height:900}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await boot(page);

/* Control when the upload resolves so the spinner state is observable. */
await page.evaluate(()=>{
  window.__uploadGate=[];
  const real=window.fetch;
  window.fetch=async(url,opts)=>{
    if(String(url).includes("stream-io-api.com")&&String(url).includes("/file")){
      await new Promise(res=>window.__uploadGate.push(res));
      return new Response(JSON.stringify({file:"https://cdn.test/"+(window.__uploadName||"f.pdf")}),
        {status:200,headers:{"Content-Type":"application/json"}});
    }
    return real(url,opts);
  };
});

console.log("-- tray is hidden when empty --");
let r=await page.evaluate(()=>{const h=document.querySelector("#pending-attachments");
  return {display:getComputedStyle(h).display,cards:h.querySelectorAll(".attach-card").length}});
ok("tray hidden with nothing attached",r.display==="none"&&r.cards===0,r);

console.log("\n-- uploading state --");
await page.evaluate(()=>{window.__uploadName="report.pdf";
  const f=new File([new Uint8Array(2048)],"report.pdf",{type:"application/pdf"});
  window.__pending=window.__space.queueAttachment(f)});
await page.waitForTimeout(400);
r=await page.evaluate(()=>{const c=document.querySelector(".attach-card");
  return {exists:!!c,uploading:c?.classList.contains("uploading"),
    spinner:!!c?.querySelector(".attach-spinner"),
    name:c?.querySelector("strong")?.textContent,
    status:c?.querySelector("small")?.textContent,
    remove:!!c?.querySelector(".attach-remove"),
    trayShown:getComputedStyle(document.querySelector("#pending-attachments")).display}});
ok("card appears immediately while uploading",r.exists&&r.uploading,r);
ok("shows a loading spinner",r.spinner);
ok("shows the file name",r.name==="report.pdf",r.name);
ok("says it is uploading",/Uploading/i.test(r.status||""),r.status);
ok("no remove button mid-upload",r.remove===false);
ok("tray becomes visible",r.trayShown==="flex",r.trayShown);

/* sending is blocked while an upload is in flight */
await page.fill("#message-input","with the file");
await page.click(".send-button");
await page.waitForTimeout(400);
r=await page.evaluate(()=>({toast:document.querySelector("#toast")?.textContent,
  input:document.querySelector("#message-input").value}));
ok("cannot send while uploading",/Wait for attachments/i.test(r.toast||""),r);
ok("the typed text is preserved",r.input==="with the file",r.input);

console.log("\n-- ready state --");
await page.evaluate(()=>{window.__uploadGate.forEach(f=>f());window.__uploadGate=[]});
await page.evaluate(()=>window.__pending);
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const c=document.querySelector(".attach-card");
  return {ready:c?.classList.contains("ready"),spinner:!!c?.querySelector(".attach-spinner"),
    remove:!!c?.querySelector(".attach-remove"),preview:!!c?.querySelector("[data-preview-attachment]"),
    size:c?.querySelector("small")?.textContent,glyph:c?.querySelector(".attach-glyph")?.textContent}});
ok("card flips to ready",r.ready&&!r.spinner,r);
ok("remove button appears",r.remove);
ok("preview button appears",r.preview);
ok("shows the file size",/KB|MB|B/.test(r.size||""),r.size);
ok("pdf gets a document glyph",!!r.glyph&&r.glyph.length>0,r.glyph);

console.log("\n-- preview lightbox --");
await page.click("[data-preview-attachment]");
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const d=document.querySelector("#attachment-preview");
  return {open:d.open,name:d.querySelector("#preview-name").textContent,
    fallback:!!d.querySelector(".preview-fallback"),
    download:d.querySelector("#preview-download").getAttribute("download"),
    href:d.querySelector("#preview-download").href}});
ok("preview opens",r.open,r);
ok("preview names the file",r.name==="report.pdf",r.name);
ok("non-previewable file offers to open it",r.fallback);
ok("download link is set",r.download==="report.pdf"&&/cdn.test/.test(r.href),r);
await page.evaluate(()=>document.querySelector("#attachment-preview").close());

console.log("\n-- remove --");
await page.click(".attach-remove");
await page.waitForTimeout(350);
r=await page.evaluate(()=>({cards:document.querySelectorAll(".attach-card").length,
  pending:window.__space.pendingAttachments.length,
  display:getComputedStyle(document.querySelector("#pending-attachments")).display}));
ok("remove deletes the card",r.cards===0&&r.pending===0,r);
ok("tray hides again when empty",r.display==="none",r.display);

console.log("\n-- failed upload --");
await page.evaluate(()=>{window.__realFetch=window.__realFetch||window.fetch;
  window.fetch=async(url,opts)=>{
    if(String(url).includes("stream-io-api.com")&&String(url).includes("/file"))
      return new Response(JSON.stringify({message:"Upload rejected"}),{status:413,headers:{"Content-Type":"application/json"}});
    return window.__realFetch(url,opts)}});
await page.evaluate(async()=>{
  const f=new File([new Uint8Array(512)],"huge.zip",{type:"application/zip"});
  await window.__space.queueAttachment(f)});
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const c=document.querySelector(".attach-card");
  return {failed:c?.classList.contains("failed"),msg:c?.querySelector("small")?.textContent,
    remove:!!c?.querySelector(".attach-remove"),preview:!!c?.querySelector("[data-preview-attachment]")}});
ok("failed upload is marked failed",r.failed,r);
ok("failure shows a reason",!!r.msg&&r.msg.length>2,r.msg);
ok("failed card can be removed",r.remove);
ok("failed card has no preview",r.preview===false);
/* a failed attachment must not be sent */
await page.fill("#message-input","hello");
await page.click(".send-button");
await page.waitForTimeout(600);
r=await page.evaluate(()=>{const last=window.__space.active.messages.at(-1);
  return {text:last?.text,atts:(last?.attachments||[]).length}});
ok("failed attachment is not sent",r.text==="hello"&&r.atts===0,r);
await page.evaluate(()=>{window.__space.pendingAttachments=[];window.__space.renderPending();
  if(window.__realFetch)window.fetch=window.__realFetch});

console.log("\n-- sent attachments in chat --");
await page.evaluate(()=>{
  const s=window.__space,chat=s.active;
  chat.messages.push({id:"a1",senderId:"u_kavya",who:"them",senderName:"Kavya Sharma",text:"Here you go",
    parentId:null,reactions:{},createdAt:new Date().toISOString(),time:"11:00 AM",
    attachments:[{kind:"image",name:"chart.png",url:"https://cdn.test/chart.png",size:120000},
      {kind:"file",name:"notes.pdf",url:"https://cdn.test/notes.pdf",size:2400000}]});
  chat.messages.push({id:"a2",senderId:"u_kavya",who:"them",senderName:"Kavya Sharma",text:"",
    parentId:null,reactions:{},createdAt:new Date().toISOString(),time:"11:01 AM",
    attachments:[1,2,3].map(n=>({kind:"image",name:`p${n}.png`,url:`https://cdn.test/p${n}.png`}))});
  s.renderMessages();
});
await page.waitForTimeout(400);
r=await page.evaluate(()=>{const m=document.querySelector('.message[data-message-id="a1"]');
  const m2=document.querySelector('.message[data-message-id="a2"]');
  return {grid:!!m.querySelector(".message-media.count-1"),
    tiles:m.querySelectorAll(".media-tile").length,
    file:!!m.querySelector(".message-file"),
    fileName:m.querySelector(".file-copy strong")?.textContent,
    fileSize:m.querySelector(".file-copy small")?.textContent,
    threeUp:!!m2.querySelector(".message-media.count-3"),
    threeTiles:m2.querySelectorAll(".media-tile").length}});
ok("one image renders as a single tile",r.grid&&r.tiles===1,r);
ok("file renders as its own card",r.file&&r.fileName==="notes.pdf",r);
ok("file card shows its size",/MB/.test(r.fileSize||""),r.fileSize);
ok("three images use the 3-up grid",r.threeUp&&r.threeTiles===3,r);

/* clicking a sent image opens the lightbox with an inline preview */
await page.click('.message[data-message-id="a1"] .media-tile');
await page.waitForTimeout(450);
r=await page.evaluate(()=>{const d=document.querySelector("#attachment-preview");
  return {open:d.open,img:!!d.querySelector(".preview-body img"),name:d.querySelector("#preview-name").textContent}});
ok("clicking a sent image opens the preview",r.open&&r.img,r);
ok("preview names the sent image",r.name==="chart.png",r.name);
await page.evaluate(()=>document.querySelector("#attachment-preview").close());
await page.waitForTimeout(250);
await page.click('.message[data-message-id="a1"] .message-file');
await page.waitForTimeout(450);
ok("clicking a sent file opens the preview",
  await page.evaluate(()=>document.querySelector("#attachment-preview").open===true));
await page.evaluate(()=>document.querySelector("#attachment-preview").close());

console.log("\n-- no layout overflow --");
r=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>window.innerWidth}));
ok("desktop has no horizontal overflow",!r.overflow,r);
await page.close();

console.log("\n-- phone --");
page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
await boot(page);
await page.evaluate(()=>{
  const s=window.__space,chat=s.active;
  chat.messages.push({id:"p1",senderId:"u_kavya",who:"them",senderName:"Kavya Sharma",text:"files",
    parentId:null,reactions:{},createdAt:new Date().toISOString(),time:"11:00 AM",
    attachments:[{kind:"image",name:"a.png",url:"https://cdn.test/a.png"},
      {kind:"image",name:"b.png",url:"https://cdn.test/b.png"},
      {kind:"file",name:"a-very-long-document-name-that-should-truncate.pdf",url:"https://cdn.test/x.pdf",size:900000}]});
  s.renderMessages();
});
await page.waitForTimeout(400);
r=await page.evaluate(()=>{
  const m=document.querySelector('.message[data-message-id="p1"]');
  const media=m.querySelector(".message-media").getBoundingClientRect();
  const file=m.querySelector(".message-file").getBoundingClientRect();
  return {mediaW:media.width,fileW:file.width,inner:window.innerWidth,
    overflow:document.documentElement.scrollWidth>window.innerWidth,
    twoUp:!!m.querySelector(".message-media.count-2")}});
ok("media grid fits the phone",r.mediaW<=r.inner,r);
ok("file card fits the phone",r.fileW<=r.inner,r);
ok("two images use the 2-up grid",r.twoUp,r);
ok("phone has no horizontal overflow",!r.overflow,r);
await page.click('.message[data-message-id="p1"] .media-tile');
await page.waitForTimeout(500);
r=await page.evaluate(()=>{const d=document.querySelector("#attachment-preview").getBoundingClientRect();
  return {w:d.width,inner:window.innerWidth,h:d.height,ih:window.innerHeight,
    overflow:document.documentElement.scrollWidth>window.innerWidth}});
ok("preview is full-screen on phone",Math.round(r.w)===r.inner&&!r.overflow,r);
await page.close();

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
