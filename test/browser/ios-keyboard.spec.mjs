/* The composer must sit on the keyboard, never fly to the top of the screen.

   Two iOS behaviours have to work, because they need opposite handling:

   MODERN (iOS 17+ with interactive-widget=resizes-content): the browser
   shrinks the LAYOUT viewport, so innerHeight already excludes the keyboard
   and normal flow layout is correct with no scripting.

   LEGACY (older iOS): the layout viewport keeps its full height and is
   scrolled under the keyboard; only visualViewport.height shrinks. The shell
   must size to that, and any scroll iOS applied must be undone.

   The earlier fix pinned the shell with position:fixed and chased the scroll
   with translateY. Fixed elements resolve against the layout viewport, so it
   only lined up once the keyboard had finished animating - the composer still
   flew to the top on the way in, which is what kept being reported. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const KB=336;
const DEVICES=[{w:390,h:844,n:"iPhone"},{w:430,h:932,n:"iPhone Max"},{w:820,h:1180,n:"iPad Air"},{w:768,h:1024,n:"iPad Mini"}];

/* mode "modern": layout viewport shrinks (innerHeight drops).
   mode "legacy": layout viewport unchanged, visual viewport shrunk + scrolled. */
async function openKeyboard(page,kb,mode){
  await page.evaluate(([kb,mode])=>{
    const vv=window.visualViewport;
    const full=window.innerHeight;
    if(mode==="modern"){
      Object.defineProperty(window,"innerHeight",{configurable:true,get:()=>full-kb});
      Object.defineProperty(vv,"height",{configurable:true,get:()=>full-kb});
      Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>0});
    }else{
      Object.defineProperty(vv,"height",{configurable:true,get:()=>full-kb});
      Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>kb});
    }
    document.querySelector("#message-input").focus();
    vv.dispatchEvent(new Event("resize"));
  },[kb,mode]);
  await page.waitForTimeout(600);
}

function measure(){
  const shell=document.querySelector(".app-shell");
  const c=document.querySelector("#composer");
  const sr=shell.getBoundingClientRect(),cr=c.getBoundingClientRect();
  const vv=window.visualViewport;
  /* What the user can actually see, in the same coordinates as the rects. */
  /* The shell is sized to the visible height and never offset, so the visible
     band starts at the top of the (unscrolled) document. */
  const visTop=-window.scrollY;
  return {shellTop:Math.round(sr.top),shellBottom:Math.round(sr.bottom),
    composerTop:Math.round(cr.top),composerBottom:Math.round(cr.bottom),
    visTop:Math.round(visTop),visBottom:Math.round(visTop+vv.height),
    fixed:getComputedStyle(shell).position,
    appHeight:getComputedStyle(document.documentElement).getPropertyValue("--app-height").trim(),
    open:document.body.classList.contains("keyboard-open")};
}

for(const mode of ["modern","legacy"]){
  for(const vp of DEVICES){
    const page=await browser.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:true,isMobile:true});
    page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
    await boot(page);
    await openKeyboard(page,KB,mode);
    const r=await page.evaluate(measure);
    const tag=`${mode} ${vp.n}`;

    ok(`${tag} keyboard detected`,r.open,r);
    /* The shell fits the space left over, so nothing is hidden behind the keyboard. */
    ok(`${tag} shell height excludes the keyboard`,
      Math.abs((r.shellBottom-r.shellTop)-(vp.h-KB))<=2,r);
    /* THE BUG: composer must be at the bottom of the visible band, not the top. */
    ok(`${tag} composer sits on the keyboard`,
      Math.abs(r.composerBottom-r.visBottom)<=24,r);
    ok(`${tag} composer is not thrown to the top`,
      r.composerTop>r.visTop+80,r);
    /* No blank strip between the top of the screen and the shell. */
    ok(`${tag} no blank strip above the shell`,
      Math.abs(r.shellTop-r.visTop)<=2,r);
    ok(`${tag} shell is not position:fixed`,r.fixed!=="fixed",r);
    /* No offsetting: three earlier fixes each moved the shell a different
       amount and each stranded the composer somewhere new. */
    ok(`${tag} shell is not offset from the document top`,r.shellTop===0,r);
    ok(`${tag} --app-height tracks the visible height`,
      r.appHeight===`${vp.h-KB}px`,r);

    /* Closing the keyboard must restore full height. */
    await page.evaluate(()=>{
      const vv=window.visualViewport,full=screen.height;
      Object.defineProperty(window,"innerHeight",{configurable:true,get:()=>full});
      Object.defineProperty(vv,"height",{configurable:true,get:()=>full});
      Object.defineProperty(vv,"offsetTop",{configurable:true,get:()=>0});
      document.querySelector("#message-input").blur();
      vv.dispatchEvent(new Event("resize"));
    });
    await page.waitForTimeout(500);
    const c=await page.evaluate(()=>({
      open:document.body.classList.contains("keyboard-open"),
      fixed:getComputedStyle(document.querySelector(".app-shell")).position}));
    ok(`${tag} keyboard-open cleared on blur`,!c.open,c);
    await page.close();
  }
}

/* A hardware keyboard, a floating iPad keyboard, or an accessory bar changes
   the viewport by little or nothing, so keyboard-open never fires. The type
   box must STILL be bottom-aligned in the visible area - never mid-screen. */
for(const vp of DEVICES){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h},hasTouch:true,isMobile:true});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await boot(page);
  await page.evaluate(()=>{
    /* Focus with no viewport change at all - detection cannot fire. */
    document.querySelector("#message-input").focus();
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForTimeout(400);
  const r=await page.evaluate(measure);
  ok(`undetected ${vp.n} keyboard-open stays off`,!r.open,r);
  ok(`undetected ${vp.n} composer still bottom aligned`,
    Math.abs(r.composerBottom-r.visBottom)<=24,r);
  ok(`undetected ${vp.n} composer not mid-screen`,
    r.composerTop>vp.h/2,r);
  await page.close();
}

/* The viewport meta must carry the hint, or the modern path never engages. */
{
  const page=await browser.newPage();
  await boot(page);
  const content=await page.evaluate(()=>document.querySelector('meta[name=viewport]').content);
  ok("viewport meta requests resizes-content",/interactive-widget=resizes-content/.test(content),content);
  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
