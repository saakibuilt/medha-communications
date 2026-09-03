/* Settings must be centered, full width and free of overflow at every size. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const sizes=[{w:1680,h:1050,n:"large laptop"},{w:1440,h:900,n:"laptop"},{w:1280,h:800,n:"small laptop"},
  {w:1024,h:1366,n:"ipad pro"},{w:820,h:1180,n:"ipad air"},{w:768,h:1024,n:"ipad mini"},
  {w:600,h:960,n:"small tablet"},{w:430,h:932,n:"large phone"},{w:390,h:844,n:"phone"},{w:320,h:700,n:"tiny phone"}];
for(const vp of sizes){
  const page=await browser.newPage({viewport:{width:vp.w,height:vp.h}});
  page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
  await boot(page);
  await page.evaluate(()=>document.querySelector('.rail-item[data-view="settings"]').click());
  await page.waitForTimeout(350);
  const r=await page.evaluate(()=>{
    const view=document.querySelector("#settings-view"),card=document.querySelector(".settings-card");
    const head=document.querySelector("#settings-view .page-head");
    const vb=view.getBoundingClientRect(),cb=card.getBoundingClientRect(),hb=head.getBoundingClientRect();
    const opts=[...document.querySelectorAll(".settings-option")];
    const avatar=document.querySelector("#settings-avatar").getBoundingClientRect();
    return {gapL:Math.round(cb.left-vb.left),gapR:Math.round(vb.right-cb.right),
      cardW:Math.round(cb.width),viewW:Math.round(vb.width),
      headL:Math.round(head.querySelector("h2").getBoundingClientRect().left),cardL:Math.round(cb.left),
      overflow:document.documentElement.scrollWidth>window.innerWidth,
      /* nothing may spill out of the card or overlap its neighbour */
      optOverflow:opts.some(o=>{const b=o.getBoundingClientRect();return b.right>cb.right+1||b.left<cb.left-1}),
      optOverlap:opts.some((o,i)=>{if(!i)return false;
        const a=opts[i-1].getBoundingClientRect(),b=o.getBoundingClientRect();return b.top<a.bottom-1}),
      toggleInside:[...document.querySelectorAll(".settings-option i")].every(t=>{
        const b=t.getBoundingClientRect();return b.right<=cb.right+1&&b.width>0}),
      textClipped:opts.some(o=>{const s=o.querySelector("small");return s&&s.scrollWidth>s.clientWidth+1}),
      avatarVisible:avatar.width>0&&avatar.height>0,
      cardVisible:cb.width>0&&cb.height>0};
  });
  const centered=Math.abs(r.gapL-r.gapR)<=2;
  ok(`${vp.n} (${vp.w}px) card is centered`,centered,{gapL:r.gapL,gapR:r.gapR});
  ok(`${vp.n} (${vp.w}px) card fills its padded column`,Math.abs(r.cardW-(r.viewW-r.gapL-r.gapR))<=1,{cardW:r.cardW,viewW:r.viewW,gapL:r.gapL,gapR:r.gapR});
  ok(`${vp.n} (${vp.w}px) side padding is sensible`,r.gapL>=16&&r.gapL<=Math.max(40,(r.viewW-760)/2+40),{gapL:r.gapL,viewW:r.viewW});
  ok(`${vp.n} (${vp.w}px) no horizontal scrolling`,!r.overflow);
  ok(`${vp.n} (${vp.w}px) heading aligns with the card`,Math.abs(r.headL-r.cardL)<=1,{headL:r.headL,cardL:r.cardL});
  ok(`${vp.n} (${vp.w}px) rows stay inside the card`,!r.optOverflow);
  ok(`${vp.n} (${vp.w}px) rows do not overlap`,!r.optOverlap);
  ok(`${vp.n} (${vp.w}px) toggles are visible and inside`,r.toggleInside);
  ok(`${vp.n} (${vp.w}px) descriptions are not clipped`,!r.textClipped);
  ok(`${vp.n} (${vp.w}px) profile and card render`,r.avatarVisible&&r.cardVisible);
  await page.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
