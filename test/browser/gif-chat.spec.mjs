/* A GIF must go straight into the chat and play there - never staged as an
   attachment, never rendered as a file card. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const GIFS={results:[...Array(6)].map((_,i)=>({id:String(i),description:`gif ${i}`,
  preview:`https://cdn.test/p${i}.gif`,url:`https://cdn.test/full${i}.gif`,width:200,height:150}))};
const browser=await chromium.launch();

for(const vp of [{w:1440,h:900,n:"laptop"},{w:390,h:844,n:"phone"}]){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h}});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await page.route("**/api/gif-search**",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(GIFS)}));
  await page.route("https://cdn.test/**",r=>r.fulfill({status:200,contentType:"image/svg+xml",
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#8bd"/></svg>'}));
  await boot(page);

  await page.evaluate(()=>{globalThis.__streamCalls.length=0});
  await page.evaluate(()=>document.querySelector("#gif-button").click());
  await page.waitForTimeout(800);
  await page.click(".gif-tile");
  await page.waitForTimeout(900);

  const r=await page.evaluate(()=>{
    const sent=globalThis.__streamCalls.find(c=>c[0]==="sendMessage")?.[2];
    const last=window.__space.active.messages.at(-1);
    const wrap=document.querySelector(".message-gif-wrap");
    const img=document.querySelector(".message-gif-live");
    return {dialogOpen:document.querySelector("#gif-dialog").open,
      pending:window.__space.pendingAttachments.length,
      trayCards:document.querySelectorAll(".attach-card").length,
      sentText:sent?.text,sentType:sent?.attachments?.[0]?.type,
      sentUrl:sent?.attachments?.[0]?.asset_url,
      lastKind:last?.attachments?.[0]?.kind,
      hasWrap:!!wrap,hasImg:!!img,
      imgLazy:img?.getAttribute("loading"),
      imgSrc:img?.getAttribute("src")||"",
      renderedW:wrap?Math.round(wrap.getBoundingClientRect().width):0,
      renderedH:img?Math.round(img.getBoundingClientRect().height):0,
      /* it must NOT be a file card, a cropped tile, or carry a badge */
      fileCards:document.querySelectorAll(".message-file").length,
      mediaTiles:document.querySelectorAll(".media-tile").length,
      badges:document.querySelectorAll(".media-badge").length,
      bubbles:(()=>{const w=document.querySelector(".message-gif-wrap");
        return w?w.closest(".message").querySelectorAll(".bubble").length:-1})(),
      overflow:document.documentElement.scrollWidth>window.innerWidth};
  });

  ok(`${vp.n} picking a GIF closes the picker`,r.dialogOpen===false,r);
  ok(`${vp.n} GIF is never staged as an attachment`,r.pending===0&&r.trayCards===0,
    {pending:r.pending,tray:r.trayCards});
  ok(`${vp.n} GIF is sent immediately`,!!r.sentUrl,r);
  ok(`${vp.n} GIF is sent as image, not file`,r.sentType==="image",r.sentType);
  ok(`${vp.n} GIF is sent with no filler text`,!r.sentText,{text:r.sentText});
  ok(`${vp.n} GIF plays live in the chat`,r.hasWrap&&r.hasImg,r);
  ok(`${vp.n} GIF is not lazy-loaded`,r.imgLazy!=="lazy",r.imgLazy);
  ok(`${vp.n} GIF uses the full-size url`,/full/.test(r.imgSrc),r.imgSrc);
  ok(`${vp.n} GIF is not a file card`,r.fileCards===0,r.fileCards);
  ok(`${vp.n} GIF is not a cropped tile`,r.mediaTiles===0,r.mediaTiles);
  ok(`${vp.n} GIF carries no badge`,r.badges===0,r.badges);
  ok(`${vp.n} GIF has no text bubble under it`,r.bubbles===0,r.bubbles);
  ok(`${vp.n} GIF is visible at a sensible size`,r.renderedW>60&&r.renderedH>40,
    {w:r.renderedW,h:r.renderedH});
  ok(`${vp.n} GIF fits without sideways scrolling`,!r.overflow&&r.renderedW<=vp.w,r);
  await page.close();
}

/* a received GIF renders the same way */
console.log("\n-- received --");
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.route("https://cdn.test/**",r=>r.fulfill({status:200,contentType:"image/svg+xml",
  body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#d8b"/></svg>'}));
await boot(page);
await page.evaluate(()=>{
  const s=window.__space,c=s.active;
  c.messages.push({id:"g1",senderId:"u_kavya",who:"them",senderName:"Kavya Sharma",text:"",
    parentId:null,reactions:{},createdAt:new Date().toISOString(),time:"11:00 AM",
    attachments:[{kind:"gif",name:"party.gif",url:"https://cdn.test/party.gif"}]});
  s.renderMessages();
});
await page.waitForTimeout(500);
const r=await page.evaluate(()=>({
  live:!!document.querySelector(".message-gif-live"),
  fileCards:document.querySelectorAll(".message-file").length,
  tiles:document.querySelectorAll(".media-tile").length}));
ok("a received GIF also plays live",r.live,r);
ok("a received GIF is not a file card or tile",r.fileCards===0&&r.tiles===0,r);
/* Messages sent before the send path stopped writing "Attachment" still carry
   that text in Stream. A GIF must show as the GIF alone - never with the word
   above it - in the chat, in a thread, and in a reply quote. */
{
  const legacy=await page.evaluate(()=>{
    const s=window.__space;
    const gif={kind:"gif",name:"Tom & Jerry",url:"https://media.giphy.com/x.gif"};
    s.active.messages=[
      {id:"L1",senderId:"u_me",who:"me",senderName:"Saksham Nirula",text:"Attachment",
       parentId:null,attachments:[gif],reactions:{},time:"2:26 PM",
       createdAt:new Date().toISOString()},
      {id:"L2",senderId:"u_kavya",who:"them",senderName:"Kavya Sharma",text:"Attachment",
       parentId:null,attachments:[{kind:"image",name:"p.png",url:"/p.png"}],reactions:{},
       time:"2:27 PM",createdAt:new Date().toISOString()},
      {id:"L3",senderId:"u_kavya",who:"them",senderName:"Kavya Sharma",text:"Attachment",
       parentId:null,attachments:[{kind:"file",name:"report.pdf",url:"/r.pdf"}],reactions:{},
       time:"2:28 PM",createdAt:new Date().toISOString()},
      {id:"L4",senderId:"u_me",who:"me",senderName:"Saksham Nirula",text:"look at this",
       parentId:null,attachments:[gif],reactions:{},time:"2:29 PM",
       createdAt:new Date().toISOString()}];
    s.renderMessages();
    const row=id=>document.querySelector(`.message[data-message-id="${id}"]`);
    return {
      gifText:row("L1")?.innerText||"",
      imageText:row("L2")?.innerText||"",
      fileText:row("L3")?.innerText||"",
      captionText:row("L4")?.innerText||"",
      gifImg:!!row("L1")?.querySelector("img"),
    };
  });
  ok("a legacy GIF does not show the word Attachment",!/Attachment/.test(legacy.gifText),legacy);
  ok("a legacy GIF still renders the GIF itself",legacy.gifImg,legacy);
  ok("a legacy image does not show the word Attachment",!/Attachment/.test(legacy.imageText),legacy);
  /* The card already names the file, so the placeholder is noise there too -
     but the card itself must stay. */
  ok("a real file keeps its card",/report\.pdf/.test(legacy.fileText),legacy);
  ok("a file card does not repeat the word Attachment",
    !/Attachment/.test(legacy.fileText),legacy);
  ok("a genuine caption is never suppressed",/look at this/.test(legacy.captionText),legacy);
}


await page.close();

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
