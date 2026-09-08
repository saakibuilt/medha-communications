/* Dark theme + responsive fit, verified in a real browser.

   Two things are checked at every size, in both themes:
   1. nothing scrolls sideways, escapes the viewport, or overlaps a
      neighbouring region;
   2. dark actually themes every surface - no rule left painting a light
      background or dark-on-dark text. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();

const SIZES=[
  {name:"phone",  width:390, height:844, touch:true},
  {name:"phone-s",width:320, height:658, touch:true},
  {name:"tablet", width:768, height:1024,touch:true},
  {name:"ipad-l", width:1024,height:768, touch:true},
  {name:"laptop", width:1440,height:900, touch:false},
];

/* sRGB relative luminance, for "is this surface actually dark?" */
const lum=rgb=>{
  const [r,g,b]=rgb.match(/\d+(\.\d+)?/g).slice(0,3).map(n=>{
    const c=Number(n)/255; return c<=.03928?c/12.92:((c+.055)/1.055)**2.4;});
  return .2126*r+.7152*g+.0722*b;
};

for(const size of SIZES){
  console.log(`-- ${size.name} (${size.width}x${size.height}) --`);
  const page=await browser.newPage({viewport:{width:size.width,height:size.height},hasTouch:size.touch});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await boot(page);

  for(const theme of ["light","dark"]){
    await page.evaluate(t=>document.documentElement.setAttribute("data-theme",t),theme);
    await page.waitForTimeout(250);
    const tag=`${size.name}/${theme}`;

    /* 1. no sideways scrolling anywhere */
    const scroll=await page.evaluate(()=>({
      doc:document.documentElement.scrollWidth,
      inner:window.innerWidth,
      body:document.body.scrollWidth,
    }));
    ok(`${tag}: page does not scroll sideways`,scroll.doc<=scroll.inner+1&&scroll.body<=scroll.inner+1,scroll);

    /* 2. nothing visible escapes the viewport horizontally */
    const escapees=await page.evaluate(()=>{
      const out=[];
      for(const el of document.querySelectorAll("body *")){
        if(el.closest("dialog:not([open])"))continue;
        /* The rail, chat list and details panel are deliberately off-canvas
           drawers below 1024px; only judge them when they are open. */
        if(!document.body.classList.contains("sidebar-open")&&el.closest(".rail,.chat-sidebar"))continue;
        if(!document.body.classList.contains("details-page")&&el.closest(".details-panel"))continue;
        const s=getComputedStyle(el);
        if(s.display==="none"||s.visibility==="hidden"||s.opacity==="0"||s.position==="fixed")continue;
        const r=el.getBoundingClientRect();
        if(r.width===0||r.height===0)continue;
        if(r.right>window.innerWidth+1||r.left<-1)
          out.push({sel:el.className&&typeof el.className==="string"?"."+el.className.split(" ")[0]:el.tagName,
            left:Math.round(r.left),right:Math.round(r.right),vw:window.innerWidth});
      }
      return out.slice(0,6);
    });
    ok(`${tag}: no element escapes the viewport`,escapees.length===0,escapees);

    /* 3. the composer and its send button stay reachable on screen */
    const composer=await page.evaluate(()=>{
      const c=document.querySelector("#chat-view .composer");
      const send=c?.querySelector(".send-button");
      const ai=c?.querySelector("#ai-reply");
      if(!c||!send)return null;
      const cr=c.getBoundingClientRect(),sr=send.getBoundingClientRect(),ar=ai?.getBoundingClientRect();
      return {inView:cr.bottom<=window.innerHeight+1&&cr.top>=0,
        sendInView:sr.right<=window.innerWidth+1&&sr.bottom<=window.innerHeight+1&&sr.width>0,
        aiInView:!!ar&&ar.right<=window.innerWidth+1&&ar.width>0,
        aiRight:ar?Math.round(window.innerWidth-ar.right):null};
    });
    ok(`${tag}: composer sits fully on screen`,composer&&composer.inView,composer);
    ok(`${tag}: send button is reachable`,composer&&composer.sendInView,composer);
    ok(`${tag}: AI reply button is visible`,composer&&composer.aiInView,composer);

    /* 4. the message area never collides with the composer */
    const overlap=await page.evaluate(()=>{
      const m=document.querySelector("#message-area"),c=document.querySelector("#chat-view .composer");
      if(!m||!c)return null;
      const mr=m.getBoundingClientRect(),cr=c.getBoundingClientRect();
      return {gap:Math.round(cr.top-mr.bottom),ok:cr.top>=mr.bottom-1};
    });
    ok(`${tag}: messages do not overlap the composer`,overlap&&overlap.ok,overlap);

    /* 5. touch targets are big enough where there is a touch screen */
    if(size.touch){
      const small=await page.evaluate(()=>{
        const out=[];
        for(const el of document.querySelectorAll(".rail-item,.header-action,.tool-btn,.icon-button,.tab,.theme-choice-btn")){
          const s=getComputedStyle(el);
          if(s.display==="none"||s.visibility==="hidden")continue;
          if(el.closest("dialog:not([open])"))continue;
          const r=el.getBoundingClientRect();
          if(r.width===0)continue;
          if(r.width<34||r.height<34)out.push({sel:el.id||el.className,w:Math.round(r.width),h:Math.round(r.height)});
        }
        return out.slice(0,6);
      });
      ok(`${tag}: touch targets are at least 34px`,small.length===0,small);
    }

    /* 6. dark really is dark - no light surface left behind */
    if(theme==="dark"){
      const surfaces=await page.evaluate(()=>{
        const pick=["body",".rail",".chat-sidebar",".main-area",".composer","#message-area",
          ".bubble",".settings-card",".details-panel",".search-wrap",".toast",".theme-choice"];
        const out={};
        for(const sel of pick){
          const el=document.querySelector(sel);
          if(!el)continue;
          const s=getComputedStyle(el);
          out[sel]={bg:s.backgroundColor,fg:s.color};
        }
        return out;
      });
      const light=Object.entries(surfaces).filter(([,v])=>{
        if(/rgba\(0, 0, 0, 0\)|transparent/.test(v.bg))return false;
        return lum(v.bg)>0.35;
      }).map(([k,v])=>`${k}:${v.bg}`);
      ok(`${tag}: no light surfaces remain`,light.length===0,light);

      /* text must stay legible against its own background */
      const lowContrast=Object.entries(surfaces).filter(([,v])=>{
        if(/rgba\(0, 0, 0, 0\)|transparent/.test(v.bg))return false;
        const a=lum(v.bg)+.05,b=lum(v.fg)+.05;
        return (Math.max(a,b)/Math.min(a,b))<3.2;
      }).map(([k,v])=>`${k} ${v.fg} on ${v.bg}`);
      ok(`${tag}: text keeps contrast on its surface`,lowContrast.length===0,lowContrast);

      /* the rail carries Medha red, not a grey */
      const rail=await page.evaluate(()=>{
        const el=document.querySelector(".rail");
        return el?getComputedStyle(el).backgroundImage+"|"+getComputedStyle(el).backgroundColor:"";
      });
      /* red means R clearly dominates G and B in the rail's own paint */
      const railRed=await page.evaluate(()=>{
        const cs=getComputedStyle(document.querySelector(".rail"));
        const m=(cs.backgroundImage+" "+cs.backgroundColor).match(/rgba?\(([^)]+)\)/g)||[];
        return m.map(x=>x.match(/\d+/g).slice(0,3).map(Number));
      });
      ok(`${tag}: rail is Medha red`,
        railRed.length>0&&railRed.every(([r,g,b])=>r>g+8&&r>b+4),JSON.stringify(railRed).slice(0,140));
    }
  }

  /* 7. the theme switch works from the header and from settings */
  await page.evaluate(()=>document.documentElement.setAttribute("data-theme","light"));
  await page.click("#theme-toggle");
  await page.waitForTimeout(150);
  let t=await page.evaluate(()=>document.documentElement.getAttribute("data-theme"));
  ok(`${size.name}: header toggle switches to dark`,t==="dark",t);
  await page.click("#theme-toggle");
  await page.waitForTimeout(150);
  t=await page.evaluate(()=>document.documentElement.getAttribute("data-theme"));
  ok(`${size.name}: header toggle switches back to light`,t==="light",t);

  await page.evaluate(()=>window.__space.setView?.("settings"));
  const choice=await page.evaluate(()=>{
    const dark=document.querySelector('[data-theme-choice="dark"]');
    if(!dark)return null;
    dark.click();
    const light=document.querySelector('[data-theme-choice="light"]');
    return {theme:document.documentElement.getAttribute("data-theme"),
      darkPressed:dark.getAttribute("aria-pressed"),lightPressed:light.getAttribute("aria-pressed"),
      sameRow:Math.abs(dark.getBoundingClientRect().top-light.getBoundingClientRect().top)<2};
  });
  ok(`${size.name}: settings Dark button applies dark`,choice&&choice.theme==="dark",choice);
  ok(`${size.name}: settings buttons show which is active`,choice&&choice.darkPressed==="true"&&choice.lightPressed==="false",choice);
  ok(`${size.name}: Light and Dark sit on the same row`,choice&&choice.sameRow,choice);

  /* the choice survives a reload */
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForTimeout(400);
  t=await page.evaluate(()=>document.documentElement.getAttribute("data-theme"));
  ok(`${size.name}: theme choice persists across reload`,t==="dark",t);
  await page.evaluate(()=>{try{localStorage.removeItem("medhaSpaceTheme")}catch{}});

  await page.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
