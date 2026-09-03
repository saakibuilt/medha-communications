/* Emoji picker fit/alignment and the GIF picker replacing the URL field. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const GIFS={results:[...Array(12)].map((_,i)=>({id:String(i),description:`gif ${i}`,
  preview:`https://cdn.test/g${i}.gif`,url:`https://cdn.test/full${i}.gif`,width:200,height:200}))};
const browser=await chromium.launch();

for(const vp of [{w:1440,h:900,n:"laptop"},{w:1024,h:1366,n:"ipad pro"},{w:820,h:1180,n:"ipad air"},
                 {w:768,h:1024,n:"ipad mini"},{w:430,h:932,n:"large phone"},{w:390,h:844,n:"phone"},{w:320,h:700,n:"tiny phone"}]){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h}});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await page.route("**/api/gif-search**",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(GIFS)}));
  await page.route("https://cdn.test/**",r=>r.fulfill({status:200,contentType:"image/svg+xml",
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#9bd"/></svg>'}));
  await boot(page);

  /* ---- emoji ---- */
  await page.evaluate(()=>document.querySelector("#emoji-button").click());
  await page.waitForTimeout(450);
  let r=await page.evaluate(()=>{
    const d=document.querySelector("#emoji-dialog"),p=document.querySelector(".emoji-picker");
    const g=document.querySelector("#emoji-grid"),tiles=[...document.querySelectorAll(".emoji-choice")];
    const pb=p.getBoundingClientRect(),gb=g.getBoundingClientRect();
    const rows=new Map();
    tiles.slice(0,60).forEach(t=>{const b=t.getBoundingClientRect();
      const k=Math.round(b.top);rows.set(k,[...(rows.get(k)||[]),b])});
    const rowArrays=[...rows.values()].filter(a=>a.length>1);
    return {open:d.open,
      pickerW:Math.round(pb.width),inner:window.innerWidth,innerH:window.innerHeight,
      fitsW:pb.left>=-1&&pb.right<=window.innerWidth+1,
      fitsH:pb.top>=-1&&pb.bottom<=window.innerHeight+1,
      /* not full-screen on phones/tablets: a sheet leaves headroom above */
      coversAll:Math.round(pb.height)>=window.innerHeight,
      overflow:document.documentElement.scrollWidth>window.innerWidth,
      cardL:Math.round(pb.left),cardR:Math.round(window.innerWidth-pb.right),
      tiles:tiles.length,
      /* every tile inside the grid box == columns actually fit */
      tilesInside:tiles.every(t=>{const b=t.getBoundingClientRect();return b.left>=gb.left-1&&b.right<=gb.right+1}),
      /* tiles on one row share a top edge and equal width == aligned */
      aligned:rowArrays.every(a=>a.every(b=>Math.abs(b.width-a[0].width)<=1)),
      gridScrollsX:g.scrollWidth>g.clientWidth+1};
  });
  ok(`${vp.n} emoji dialog opens`,r.open,r);
  ok(`${vp.n} emoji picker fits the width`,r.fitsW&&!r.overflow,r);
  ok(`${vp.n} emoji picker fits the height`,r.fitsH,r);
  ok(`${vp.n} emoji tiles all fit their columns`,r.tilesInside,{tiles:r.tiles});
  ok(`${vp.n} emoji rows are aligned`,r.aligned);
  ok(`${vp.n} emoji grid never scrolls sideways`,!r.gridScrollsX);
  /* A transparent full-width dialog hosts the visible card, so the CARD is
     what must be centred - the dialog element is always full width. */
  if(vp.w>640) ok(`${vp.n} emoji card is centred`,Math.abs(r.cardL-r.cardR)<=2,{l:r.cardL,r:r.cardR});
  if(vp.w<=640) ok(`${vp.n} emoji picker is a sheet, not full screen`,!r.coversAll,{h:r.innerH});
  await page.evaluate(()=>document.querySelector("#emoji-dialog").close());
  await page.waitForTimeout(200);

  /* ---- gif ---- */
  await page.evaluate(()=>document.querySelector("#gif-button").click());
  await page.waitForTimeout(700);
  r=await page.evaluate(()=>{
    const d=document.querySelector("#gif-dialog"),p=document.querySelector(".gif-picker");
    const pb=p.getBoundingClientRect();
    const tiles=[...document.querySelectorAll(".gif-tile")];
    const res=document.querySelector("#gif-results").getBoundingClientRect();
    return {open:d.open,urlField:!!document.querySelector("#gif-url"),
      cardL:Math.round(pb.left),cardR:Math.round(window.innerWidth-pb.right),
      hasSearch:!!document.querySelector("#gif-search"),
      tiles:tiles.length,imgs:tiles.filter(t=>t.querySelector("img")).length,
      fitsW:pb.left>=-1&&pb.right<=window.innerWidth+1,
      fitsH:pb.top>=-1&&pb.bottom<=window.innerHeight+1,
      coversAll:Math.round(pb.height)>=window.innerHeight,
      overflow:document.documentElement.scrollWidth>window.innerWidth,
      tilesInside:tiles.every(t=>{const b=t.getBoundingClientRect();return b.left>=res.left-1&&b.right<=res.right+1})};
  });
  ok(`${vp.n} gif dialog opens`,r.open,r);
  ok(`${vp.n} gif URL field is gone`,r.urlField===false);
  ok(`${vp.n} gif picker has a search box`,r.hasSearch);
  ok(`${vp.n} gif tiles render as images`,r.tiles===12&&r.imgs===12,{tiles:r.tiles,imgs:r.imgs});
  ok(`${vp.n} gif picker fits the width`,r.fitsW&&!r.overflow,r);
  ok(`${vp.n} gif picker fits the height`,r.fitsH,r);
  ok(`${vp.n} gif tiles stay inside the grid`,r.tilesInside);
  if(vp.w>640) ok(`${vp.n} gif card is centred`,Math.abs(r.cardL-r.cardR)<=2,{l:r.cardL,r:r.cardR});
  if(vp.w<=640) ok(`${vp.n} gif picker is a sheet, not full screen`,!r.coversAll);
  await page.evaluate(()=>document.querySelector("#gif-dialog").close());
  await page.close();
}

/* ---- behaviour, once ---- */
console.log("\n-- gif behaviour --");
const page=await browser.newPage({viewport:{width:1440,height:900}});
let searchUrls=[];
await page.route("**/api/gif-search**",r=>{searchUrls.push(r.request().url());
  r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(GIFS)})});
await page.route("https://cdn.test/**",r=>r.fulfill({status:200,contentType:"image/svg+xml",
  body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#9bd"/></svg>'}));
await boot(page);
await page.evaluate(()=>document.querySelector("#gif-button").click());
await page.waitForTimeout(600);
ok("opening loads trending GIFs with no query",searchUrls.some(u=>/q=(&|$)/.test(u)),searchUrls);
searchUrls=[];
await page.fill("#gif-search","dog");
await page.waitForTimeout(800);
ok("typing searches for that term",searchUrls.some(u=>/q=dog/.test(u)),searchUrls);
ok("search is debounced to one request",searchUrls.length===1,searchUrls.length);
/* clicking a tile attaches it and closes */
await page.click(".gif-tile");
await page.waitForTimeout(500);
let r=await page.evaluate(()=>({open:document.querySelector("#gif-dialog").open,
  pending:window.__space.pendingAttachments.map(a=>({kind:a.kind,url:a.url})),
  cards:document.querySelectorAll(".attach-card").length,
  liveGifs:document.querySelectorAll(".message-gif-live").length}));
ok("clicking a GIF closes the picker",r.open===false,r);
/* A GIF is sent straight to the conversation now, so it must NOT be staged
   in the composer tray. gif-chat.spec.mjs covers how it renders. */
ok("clicking a GIF does not stage an attachment",r.pending.length===0,r.pending);
ok("clicking a GIF leaves the composer tray empty",r.cards===0,r.cards);
ok("clicking a GIF sends it to the chat",r.liveGifs>0,{liveGifs:r.liveGifs});
/* a missing API key must explain itself, not fail silently */
await page.evaluate(()=>{window.__space.pendingAttachments=[];window.__space.renderPending()});
await page.unroute("**/api/gif-search**");
await page.route("**/api/gif-search**",r=>r.fulfill({status:503,contentType:"application/json",
  body:JSON.stringify({error:"GIF search is not configured"})}));
await page.evaluate(()=>document.querySelector("#gif-button").click());
await page.waitForTimeout(700);
r=await page.evaluate(()=>document.querySelector("#gif-results").textContent);
ok("an unconfigured key shows a clear message",/not set up|admin|Giphy/i.test(r),r);
await page.close();

/* The GIF sheet showed only two or three enormous tiles at a time, because
   masonry columns let each keep its own aspect ratio. And Favorites hid the
   tabs entirely, which on a phone (where the rail is a drawer) left no way
   back to All/Unread/Pinned/Archived. */
for(const [w,h,label] of [[360,780,"small phone"],[390,844,"iPhone"],[430,932,"iPhone Max"]]){
  const page=await browser.newPage({viewport:{width:w,height:h},hasTouch:true,isMobile:true});
  await page.route("**/fake-gif/**",async r=>{
    const m=/w(\d+)h(\d+)/.exec(r.request().url())||[0,200,150];
    return r.fulfill({status:200,contentType:"image/svg+xml",
      body:`<svg xmlns="http://www.w3.org/2000/svg" width="${m[1]}" height="${m[2]}"><rect width="100%" height="100%" fill="#ccc"/></svg>`});
  });
  await page.route("**/api/gif-search**",r=>r.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({results:Array.from({length:30},(_,i)=>{const hh=[112,150,200,260][i%4];
      return {id:"g"+i,description:"GIF "+i,preview:`/fake-gif/w200h${hh}.svg`,
        url:`/fake-gif/w200h${hh}.svg`,width:200,height:hh};})})}));
  await boot(page);
  await page.evaluate(()=>document.querySelector('[data-composer-action="gif"],#gif-button,[data-action="gif"]')?.click());
  await page.waitForTimeout(1400);
  const g=await page.evaluate(()=>{
    const box=document.querySelector("#gif-results");
    const tiles=[...box.querySelectorAll(".gif-tile")];
    const br=box.getBoundingClientRect();
    const inView=tiles.filter(t=>{const q=t.getBoundingClientRect();
      return q.top>=br.top-1&&q.bottom<=br.bottom+1}).length;
    /* overflow-x is hidden!important, so scrollWidth can never exceed
       clientWidth - asserting on that passed even while columns 3+ were
       clipped and unreachable. What actually matters is whether every tile
       can be reached by scrolling down: anything sitting outside the box
       horizontally is lost, and anything below is fine. */
    const clipped=tiles.filter(t=>{const q=t.getBoundingClientRect();
      return q.right>br.right+1||q.left<br.left-1});
    /* Scroll to the bottom and count what is still unreachable. */
    box.scrollTop=box.scrollHeight;
    const stillClipped=tiles.filter(t=>{const q=t.getBoundingClientRect();
      return q.right>br.right+1||q.left<br.left-1}).length;
    box.scrollTop=0;
    return {inView,tileH:Math.round(tiles[0].getBoundingClientRect().height),
      vertical:box.scrollHeight>box.clientHeight+2,
      sideways:box.scrollWidth>box.clientWidth+2,
      outside:clipped.length,stillClipped};
  });
  ok(`${label} GIF sheet scrolls vertically`,g.vertical,g);
  ok(`${label} GIF sheet never scrolls sideways`,!g.sideways,g);
  ok(`${label} every GIF stays inside the sheet`,g.outside===0,g);
  ok(`${label} no GIF is clipped out of reach`,g.stillClipped===0,g);
  /* The actual regression to guard: too few GIFs visible at once. */
  ok(`${label} shows at least 6 GIFs at once`,g.inView>=6,g);
  ok(`${label} shows at most 10 GIFs at once`,g.inView<=10,g);
  ok(`${label} GIF tiles are not tiny`,g.tileH>=100,g);

  /* Favorites must keep the tabs on a phone. */
  await page.evaluate(()=>document.querySelector('[data-rail-filter="favorites"]').click());
  await page.waitForTimeout(400);
  const f=await page.evaluate(()=>{
    const t=document.querySelector(".sidebar-tabs");
    return {fav:document.querySelector("#chat-sidebar").classList.contains("favorites-sidebar"),
      h:Math.round(t.getBoundingClientRect().height),
      tabs:[...document.querySelectorAll(".sidebar-tabs .tab")].map(x=>x.textContent.trim())};
  });
  ok(`${label} is in the favorites view`,f.fav,f);
  ok(`${label} favorites still shows the tabs`,f.h>0,f);
  ok(`${label} favorites can reach every tab`,
    ["All","Unread","Pinned","Archived"].every(n=>f.tabs.some(t=>t.startsWith(n))),f);
  await page.close();
}

/* On the desktop rail the Favorites button already does this, so the tabs
   stay hidden there - the fix must not leak onto wide screens. */
{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await boot(page);
  await page.evaluate(()=>document.querySelector('[data-rail-filter="favorites"]').click());
  await page.waitForTimeout(400);
  const d=await page.evaluate(()=>Math.round(document.querySelector(".sidebar-tabs").getBoundingClientRect().height));
  ok("desktop favorites still hides the tabs",d===0,d);
  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
