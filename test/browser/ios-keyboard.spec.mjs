/* Reproduces what iOS actually does, which the earlier keyboard spec did not:
   the LAYOUT viewport keeps its full height and is scrolled under the
   keyboard, so position:fixed no longer lines up with what the user sees.

   The visible band on screen is [offsetTop, offsetTop+visualHeight] in layout
   coordinates. A fixed element at top:0 lands at 0 - a whole keyboard height
   too high - which is the "keyboard, blank space, type box on top" report. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const KB=336;

for(const vp of [{w:390,h:844,n:"iPhone"},{w:430,h:932,n:"iPhone Max"},{w:820,h:1180,n:"iPad Air"},{w:768,h:1024,n:"iPad Mini"}]){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:true,isMobile:true});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await boot(page);
  await page.evaluate(kb=>{
    const vv=window.visualViewport;
    const height=window.innerHeight-kb;
    /* iOS: layout viewport unchanged, visual viewport shrunk AND pushed down */
    Object.defineProperty(vv,"height",{configurable:true,get:()=>height});
    Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>kb});
    document.querySelector("#message-input").focus();
    vv.dispatchEvent(new Event("resize"));
  },KB);
  await page.waitForTimeout(600);

  const r=await page.evaluate(kb=>{
    const shell=document.querySelector(".app-shell");
    const c=document.querySelector("#composer");
    const sr=shell.getBoundingClientRect(),cr=c.getBoundingClientRect();
    /* The band the user can actually see, in layout coordinates. */
    const visTop=window.visualViewport.offsetTop;
    const visBottom=visTop+window.visualViewport.height;
    return {shellTop:Math.round(sr.top),shellBottom:Math.round(sr.bottom),
      composerTop:Math.round(cr.top),composerBottom:Math.round(cr.bottom),
      visTop:Math.round(visTop),visBottom:Math.round(visBottom),
      offset:getComputedStyle(document.documentElement).getPropertyValue("--keyboard-offset").trim(),
      open:document.body.classList.contains("keyboard-open")};
  },KB);

  ok(`${vp.n} keyboard detected`,r.open,r);
  ok(`${vp.n} offset variable matches the iOS scroll`,r.offset===`${KB}px`,r.offset);
  /* The whole shell must sit inside the band the user can see. */
  ok(`${vp.n} shell starts at the top of the VISIBLE area`,
    Math.abs(r.shellTop-r.visTop)<=2,{shellTop:r.shellTop,visTop:r.visTop});
  ok(`${vp.n} shell ends where the keyboard starts`,
    Math.abs(r.shellBottom-r.visBottom)<=2,{shellBottom:r.shellBottom,visBottom:r.visBottom});
  ok(`${vp.n} no blank strip above the shell`,r.shellTop>=r.visTop-2,r);
  /* The composer must be inside the visible band, near its bottom. */
  ok(`${vp.n} composer is within the visible area`,
    r.composerTop>=r.visTop-2&&r.composerBottom<=r.visBottom+2,
    {c:[r.composerTop,r.composerBottom],vis:[r.visTop,r.visBottom]});
  ok(`${vp.n} composer sits just above the keyboard`,
    r.visBottom-r.composerBottom<=20,{gap:r.visBottom-r.composerBottom});
  ok(`${vp.n} composer is NOT above the visible area`,r.composerBottom>r.visTop,
    {composerBottom:r.composerBottom,visTop:r.visTop});

  /* closing restores everything */
  await page.evaluate(()=>{
    const vv=window.visualViewport;
    Object.defineProperty(vv,"height",{configurable:true,get:()=>window.innerHeight});
    Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>0});
    document.querySelector("#message-input").blur();
    vv.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(500);
  const after=await page.evaluate(()=>({
    open:document.body.classList.contains("keyboard-open"),
    transform:getComputedStyle(document.querySelector(".app-shell")).transform,
    bottom:Math.round(document.querySelector("#composer").getBoundingClientRect().bottom),
    h:window.innerHeight}));
  ok(`${vp.n} closing clears the keyboard state`,!after.open,after);
  ok(`${vp.n} closing removes the offset`,after.transform==="none"||/matrix\(1, 0, 0, 1, 0, 0\)/.test(after.transform),after.transform);
  ok(`${vp.n} composer returns to the bottom`,after.h-after.bottom<60,after);
  await page.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
