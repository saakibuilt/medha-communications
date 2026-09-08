/* Links in messages: hyperlinked, never duplicated, and shared files render
   as cards with preview / download / open actions. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1100,height:860}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await boot(page);

const SHEET="https://docs.google.com/spreadsheets/d/1Qit50JCPR0oK29ILltQDUHNzrztG-wjp/edit?usp=sharing";
const FOLDER="https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp";
const DRIVEFILE="https://drive.google.com/file/d/1XyZ_file-Id/view?usp=drive_link";
const PDF="https://example.org/reports/Q3%20summary.pdf";
const PLAIN="https://medha.org.in/about";

async function show(messages){
  await page.evaluate(list=>{
    const s=window.__space;
    s.active=s.conversations.find(c=>c.id==="c1");
    s.active.messages=list.map((m,i)=>({id:"L"+i,senderId:m.mine?"u_me":"u_kavya",who:m.mine?"me":"them",
      senderName:m.mine?"Saksham Nirula":"Kavya N.",text:m.text,attachments:m.attachments||[],reactions:{},
      createdAt:new Date(Date.now()-(list.length-i)*1000).toISOString(),time:"12:06 PM"}));
    s.active.messagesLoaded=true;s.renderMessages();
  },messages);
  await page.waitForTimeout(200);
}
const dump=()=>page.evaluate(()=>[...document.querySelectorAll(".message")].map(m=>({
  bubble:m.querySelector(".bubble")?.textContent.trim()||"",
  bubbleHtml:m.querySelector(".bubble")?.innerHTML||"",
  anchors:[...m.querySelectorAll(".bubble a.message-link")].map(a=>a.href),
  cards:[...m.querySelectorAll(".shared-link")].map(c=>({
    kind:c.dataset.linkKind,
    title:c.querySelector(".shared-link-copy strong")?.textContent,
    service:c.querySelector(".shared-link-copy small")?.textContent,
    preview:c.querySelector("[data-link-preview]")?.dataset.linkPreview||null,
    download:[...c.querySelectorAll("a.shared-link-btn")].map(a=>a.getAttribute("href")),
    buttons:c.querySelectorAll(".shared-link-btn").length})),
})));

console.log("-- a shared sheet link --");
await show([{text:SHEET}]);
let r=(await dump())[0];
ok("the raw URL is gone from the message text",!/docs\.google\.com/.test(r.bubble),r.bubble);
ok("no empty bubble is left behind",r.bubble==="",r.bubble);
ok("exactly one card is rendered",r.cards.length===1,r.cards);
ok("the card names the file type",/Google Sheet/.test(r.cards[0]?.title||""),r.cards[0]);
ok("and the provider separately",r.cards[0]?.service==="Google Drive"&&r.cards[0]?.service!==r.cards[0]?.title,r.cards[0]);
ok("preview points at the embeddable view",
  r.cards[0]?.preview==="https://docs.google.com/spreadsheets/d/1Qit50JCPR0oK29ILltQDUHNzrztG-wjp/preview",r.cards[0]);
ok("download points at the export url",
  r.cards[0]?.download.some(h=>h.includes("export?format=xlsx")),r.cards[0]);
ok("open points at the original link",r.cards[0]?.download.some(h=>h.startsWith(SHEET.split("?")[0])),r.cards[0]);
ok("preview, download and open are all offered",r.cards[0]?.buttons===3,r.cards[0]);

console.log("-- text around the link is kept --");
await show([{text:`try this one ${SHEET} if it helps`}]);
r=(await dump())[0];
ok("the sentence survives",/try this one/.test(r.bubble)&&/if it helps/.test(r.bubble),r.bubble);
ok("but not the URL",!/docs\.google/.test(r.bubble),r.bubble);
ok("and the card is still there",r.cards.length===1,r.cards);

console.log("-- a drive folder --");
await show([{text:FOLDER}]);
r=(await dump())[0];
ok("a folder is marked as one",r.cards[0]?.kind==="folder",r.cards[0]);
ok("a folder says so in its title",/folder/i.test(r.cards[0]?.title||""),r.cards[0]);
ok("the subtitle names the provider, not the same words again",
  r.cards[0]?.service==="Google Drive"&&r.cards[0]?.service!==r.cards[0]?.title,r.cards[0]);
ok("a folder previews as an embedded folder view",
  /embeddedfolderview/.test(r.cards[0]?.preview||""),r.cards[0]);
ok("a folder offers no download - only preview and open",r.cards[0]?.buttons===2,r.cards[0]);

console.log("-- a drive file and a direct file --");
await show([{text:DRIVEFILE},{text:PDF}]);
let all=await dump();
ok("a drive file previews at /preview",/file\/d\/1XyZ_file-Id\/preview/.test(all[0].cards[0]?.preview||""),all[0].cards[0]);
ok("a drive file downloads via export",/uc\?export=download/.test(all[0].cards[0]?.download.join(" ")||""),all[0].cards[0]);
ok("a direct file card uses its own filename",/Q3 summary\.pdf/.test(all[1].cards[0]?.title||""),all[1].cards[0]);
ok("a direct file downloads from its own url",all[1].cards[0]?.download.includes(PDF),all[1].cards[0]);

console.log("-- a plain web link --");
await show([{text:`have a look at ${PLAIN} when you can`}]);
r=(await dump())[0];
ok("a plain link stays in the sentence",/medha\.org\.in/.test(r.bubble),r.bubble);
ok("a plain link is a real hyperlink",r.anchors.length===1&&r.anchors[0]===PLAIN,r.anchors);
ok("a plain link gets no file card",r.cards.length===0,r.cards);
ok("the link opens safely in a new tab",await page.evaluate(()=>{
  const a=document.querySelector(".bubble a.message-link");
  return a.target==="_blank"&&/noopener/.test(a.rel)}));

console.log("-- escaping --");
await show([{text:'<img src=x onerror=alert(1)> https://evil.test/"onmouseover="x'}]);
ok("markup in a message is never executed",await page.evaluate(()=>
  !document.querySelector(".bubble img")&&!document.querySelector('.bubble [onmouseover]')));

console.log("-- Stream's own scrape attachment is not duplicated --");
await page.evaluate(sheet=>{
  const s=window.__space;
  const mapped=s.streamMessageToApp({id:"sc1",text:sheet,user:{id:"u_kavya",name:"Kavya N."},
    created_at:new Date().toISOString(),
    attachments:[{type:"link",title:"Loading Google Sheets",og_scrape_url:sheet,title_link:sheet}]});
  window.__mapped=mapped;
},SHEET);
r=await page.evaluate(()=>window.__mapped.attachments);
ok("a link-scrape attachment is dropped on the way in",r.length===0,r);
await page.evaluate(()=>{
  const s=window.__space;
  s.active.messages=[window.__mapped];s.active.messagesLoaded=true;s.renderMessages();
});
await page.waitForTimeout(200);
r=(await dump())[0];
ok("so the link renders once, as one card",r.cards.length===1&&!/docs\.google/.test(r.bubble),r);

console.log("-- a GIF url is not also a file card --");
await show([{text:"https://media.giphy.com/media/abc/giphy.gif"}]);
r=(await dump())[0];
ok("a GIF plays instead of becoming a card",r.cards.length===0,r.cards);
ok("and the GIF itself is rendered",await page.evaluate(()=>!!document.querySelector(".message-gif-live")));

console.log("-- preview opens in the lightbox --");
await show([{text:SHEET}]);
await page.click("[data-link-preview]");
await page.waitForTimeout(300);
r=await page.evaluate(()=>{
  const d=document.querySelector("#attachment-preview")||document.querySelector("dialog[open]");
  const f=document.querySelector(".preview-frame");
  return {open:!!d?.open,frame:f?.getAttribute("src")||null,
    name:document.querySelector("#preview-name")?.textContent,
    action:document.querySelector("#preview-download")?.textContent,
    fits:f?f.getBoundingClientRect().right<=window.innerWidth+1:false};
});
ok("the preview dialog opens",r.open,r);
ok("it embeds the provider preview url",/spreadsheets\/d\/.+\/preview$/.test(r.frame||""),r);
ok("it offers the original as well",/Open original/i.test(r.action||""),r);
ok("the frame fits the screen",r.fits,r);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
