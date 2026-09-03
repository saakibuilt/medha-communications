/* iOS-specific regressions: input auto-zoom, sideways scrolling, and the
   composer position when replying while the keyboard is already up. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const GIFS={results:[...Array(6)].map((_,i)=>({id:String(i),description:`g${i}`,
  preview:`https://cdn.test/p${i}.gif`,url:`https://cdn.test/f${i}.gif`}))};
const KB=336;
const browser=await chromium.launch();

/* ---- 1. no input may be under 16px on a touch device ---- */
console.log("-- input font size (iOS auto-zoom) --");
for(const vp of [{w:390,h:844,n:"iPhone"},{w:820,h:1180,n:"iPad Air"},{w:1024,h:1366,n:"iPad Pro"}]){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:true,isMobile:true});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await page.route("**/api/gif-search**",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(GIFS)}));
  await page.route("https://cdn.test/**",r=>r.fulfill({status:200,contentType:"image/svg+xml",
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#9bd"/></svg>'}));
  await boot(page);
  /* open both pickers so their fields exist and are laid out */
  for(const [btn,dlg] of [["#emoji-button","#emoji-dialog"],["#gif-button","#gif-dialog"]]){
    await page.evaluate(s=>document.querySelector(s).click(),btn);
    await page.waitForTimeout(500);
    const small=await page.evaluate(s=>{
      const d=document.querySelector(s);
      return [...d.querySelectorAll("input,textarea")].map(el=>({
        id:el.id,size:parseFloat(getComputedStyle(el).fontSize)})).filter(x=>x.size<16);
    },dlg);
    ok(`${vp.n} ${dlg} fields are >=16px (no iOS zoom)`,small.length===0,small);
    await page.evaluate(s=>document.querySelector(s).close(),dlg);
    await page.waitForTimeout(200);
  }
  const smallAnywhere=await page.evaluate(()=>
    [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]),textarea")]
      .filter(el=>el.offsetParent!==null)
      .map(el=>({id:el.id||el.className,size:parseFloat(getComputedStyle(el).fontSize)}))
      .filter(x=>x.size<16));
  ok(`${vp.n} no visible field is under 16px`,smallAnywhere.length===0,smallAnywhere);
  await page.close();
}

/* ---- 2. pickers never scroll sideways ---- */
console.log("\n-- no sideways scrolling --");
for(const vp of [{w:390,h:844,n:"iPhone"},{w:320,h:700,n:"small"},{w:820,h:1180,n:"iPad"}]){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:true,isMobile:true});
  await page.route("**/api/gif-search**",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(GIFS)}));
  await page.route("https://cdn.test/**",r=>r.fulfill({status:200,contentType:"image/svg+xml",
    body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#9bd"/></svg>'}));
  await boot(page);
  for(const [btn,dlg,grid] of [["#emoji-button","#emoji-dialog","#emoji-grid"],["#gif-button","#gif-dialog","#gif-results"]]){
    await page.evaluate(s=>document.querySelector(s).click(),btn);
    await page.waitForTimeout(700);
    const r=await page.evaluate(g=>({
      pageScrolls:document.documentElement.scrollWidth>window.innerWidth,
      gridScrolls:(()=>{const e=document.querySelector(g);return e.scrollWidth>e.clientWidth+1})(),
      bodyScrolls:document.body.scrollWidth>window.innerWidth}),grid);
    ok(`${vp.n} ${grid} does not scroll sideways`,!r.gridScrolls,r);
    ok(`${vp.n} page does not scroll sideways with ${dlg} open`,!r.pageScrolls&&!r.bodyScrolls,r);
    await page.evaluate(s=>document.querySelector(s).close(),dlg);
    await page.waitForTimeout(200);
  }
  await page.close();
}

/* ---- 3. replying while the keyboard is up ---- */
console.log("\n-- reply with keyboard already open --");
for(const vp of [{w:390,h:844,n:"iPhone"},{w:820,h:1180,n:"iPad"}]){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:true,isMobile:true});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await boot(page);
  /* keyboard already up, the way it is when you reply mid-conversation */
  await page.evaluate(kb=>{
    const vv=window.visualViewport,height=window.innerHeight-kb;
    Object.defineProperty(vv,"height",{configurable:true,get:()=>height});
    Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>kb});
    document.querySelector("#message-input").focus();
    vv.dispatchEvent(new Event("resize"));
  },KB);
  await page.waitForTimeout(500);
  const before=await page.evaluate(()=>Math.round(document.querySelector("#composer").getBoundingClientRect().bottom));

  /* now reply to a message */
  await page.evaluate(()=>{
    const m=window.__space.active.messages[0];
    window.__space.setReplyTarget
      ? window.__space.setReplyTarget(m)
      : document.querySelector('[data-message-action="reply"]')?.click();
  });
  await page.waitForTimeout(700);
  const r=await page.evaluate(kb=>{
    const c=document.querySelector("#composer").getBoundingClientRect();
    const bar=document.querySelector(".reply-bar");
    /* The visible band starts at offsetTop on iOS, so the keyboard's top
       edge is the bottom of that band - not innerHeight minus the keyboard. */
    const keyboardTop=window.visualViewport.offsetTop+window.visualViewport.height;
    return {bottom:Math.round(c.bottom),top:Math.round(c.top),keyboardTop:Math.round(keyboardTop),
      barVisible:!!bar&&!bar.hidden,
      atTop:c.top<(window.visualViewport.offsetTop+window.visualViewport.height*0.35),
      behindKeyboard:c.bottom>keyboardTop+2,
      overflow:document.documentElement.scrollWidth>window.innerWidth};
  },KB);
  ok(`${vp.n} reply bar is shown`,r.barVisible,r);
  ok(`${vp.n} composer does not jump to the top when replying`,!r.atTop,{top:r.top});
  ok(`${vp.n} composer stays above the keyboard when replying`,!r.behindKeyboard,
    {bottom:r.bottom,keyboardTop:r.keyboardTop});
  ok(`${vp.n} replying causes no sideways scrolling`,!r.overflow);
  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
