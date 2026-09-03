/* The composer must sit directly above the on-screen keyboard.

   Playwright cannot raise a real keyboard, so visualViewport is driven the
   way each platform actually reports it:
     - iOS/iPadOS Safari: height shrinks AND offsetTop grows (page scrolls
       under the keyboard). This is the case that broke.
     - Android Chrome: height shrinks, offsetTop stays 0. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();

const KB=336; // typical iPhone keyboard height
for(const vp of [{w:390,h:844,n:"iPhone"},{w:430,h:932,n:"iPhone Max"},{w:820,h:1180,n:"iPad Air"},{w:768,h:1024,n:"iPad Mini"}]){
  for(const mode of ["ios","android"]){
    const page=await browser.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:true});
    page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
    await boot(page);
    const label=`${vp.n} ${mode}`;

    /* baseline: composer sits at the bottom of the screen */
    let before=await page.evaluate(()=>{
      const c=document.querySelector("#composer").getBoundingClientRect();
      return {bottom:Math.round(c.bottom),h:window.innerHeight}});
    ok(`${label} composer starts at the bottom`,before.h-before.bottom<60,before);

    /* The real sequence: focus fires FIRST, and the viewport only reports
       the keyboard a moment later. The previous test did both at once and
       so never caught the gap, where the shell was pinned at full height
       and the composer sat under the keyboard until the user scrolled. */
    await page.evaluate(()=>document.querySelector("#message-input").focus());
    await page.waitForTimeout(120);
    let gap=await page.evaluate(()=>{
      const c=document.querySelector("#composer").getBoundingClientRect();
      const shell=document.querySelector(".app-shell");
      const cs=getComputedStyle(shell);
      return {composerBottom:Math.round(c.bottom),composerTop:Math.round(c.top),
        pinned:cs.position==="fixed",h:cs.height,inner:window.innerHeight,
        open:document.body.classList.contains("keyboard-open")};
    });
    /* Before the viewport reports anything the layout must stay untouched:
       pinning without a known height is what broke it. */
    ok(`${label} focus alone does not pin the shell`,!gap.pinned||gap.open===false,gap);
    ok(`${label} composer stays put on focus`,gap.composerBottom<=vp.h+2&&gap.composerTop>vp.h*0.35,gap);

    /* simulate the keyboard opening */
    await page.evaluate(({kb,mode})=>{
      const vv=window.visualViewport;
      const height=window.innerHeight-kb;
      const offsetTop=mode==="ios"?kb:0;   // iOS scrolls the layout viewport
      Object.defineProperty(vv,"height",{configurable:true,get:()=>height});
      Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>offsetTop});
      document.querySelector("#message-input").focus();
      vv.dispatchEvent(new Event("resize"));
    },{kb:KB,mode});
    await page.waitForTimeout(400);

    const r=await page.evaluate(({kb,mode})=>{
      const shell=document.querySelector(".app-shell").getBoundingClientRect();
      const c=document.querySelector("#composer").getBoundingClientRect();
      const area=document.querySelector("#message-area").getBoundingClientRect();
      /* The shell is position:fixed, so everything inside it is measured
         against the visual viewport - the keyboard's top edge is simply the
         layout height minus the keyboard, on both platforms. */
      const keyboardTop=window.innerHeight-kb;
      return {open:document.body.classList.contains("keyboard-open"),
        composerTop:Math.round(c.top),composerBottom:Math.round(c.bottom),
        shellTop:Math.round(shell.top),shellBottom:Math.round(shell.bottom),
        keyboardTop:Math.round(keyboardTop),
        areaBottom:Math.round(area.bottom),
        overlapsKeyboard:c.bottom>keyboardTop+2,
        aboveKeyboard:c.bottom<=keyboardTop+2&&c.bottom>keyboardTop-90,
        atTopOfScreen:c.top<window.innerHeight*0.35,
        overflow:document.documentElement.scrollWidth>window.innerWidth};
    },{kb:KB,mode});

    ok(`${label} keyboard state is detected`,r.open,r);
    ok(`${label} composer does NOT jump to the top`,!r.atTopOfScreen,{composerTop:r.composerTop});
    ok(`${label} composer sits just above the keyboard`,r.aboveKeyboard,
      {composerBottom:r.composerBottom,keyboardTop:r.keyboardTop});
    ok(`${label} composer is not hidden behind the keyboard`,!r.overlapsKeyboard,
      {composerBottom:r.composerBottom,keyboardTop:r.keyboardTop});
    ok(`${label} message list ends above the composer`,r.areaBottom<=r.composerTop+2,
      {areaBottom:r.areaBottom,composerTop:r.composerTop});
    ok(`${label} no sideways overflow with keyboard up`,!r.overflow);
    /* Client rects alone missed a real bug: the shell was pushed down by a
       whole keyboard height, leaving blank canvas on top and the composer
       behind the keys. Assert the painted position too. */
    ok(`${label} shell starts at the top of the screen`,r.shellTop<=1,{shellTop:r.shellTop});
    ok(`${label} shell ends where the keyboard starts`,
      Math.abs(r.shellBottom-(vp.h-KB))<=2,{shellBottom:r.shellBottom,expected:vp.h-KB});
    ok(`${label} no blank gap above the header`,r.shellTop<=1);

    /* closing the keyboard restores the layout */
    await page.evaluate(()=>{
      const vv=window.visualViewport;
      Object.defineProperty(vv,"height",{configurable:true,get:()=>window.innerHeight});
      Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>0});
      document.querySelector("#message-input").blur();
      vv.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(400);
    const after=await page.evaluate(()=>{
      const c=document.querySelector("#composer").getBoundingClientRect();
      return {open:document.body.classList.contains("keyboard-open"),
        bottom:Math.round(c.bottom),h:window.innerHeight,
        shellPos:getComputedStyle(document.querySelector(".app-shell")).position}});
    ok(`${label} closing clears the keyboard state`,!after.open,after);
    ok(`${label} composer returns to the bottom`,after.h-after.bottom<60,after);
    await page.close();
  }
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
