/* Phone / tablet navigation: the rail is a bottom sheet. The menu button
   slides it up with every destination; choosing one closes it and brings the
   page in. Desktop keeps the side rail. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const rect=(page,sel)=>page.evaluate(s=>{const el=document.querySelector(s);if(!el)return null;const r=el.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),width:Math.round(r.width),vh:innerHeight,vw:innerWidth}},sel);
const sheetOpen=page=>page.evaluate(()=>document.body.classList.contains("rail-sheet-open"));
const settle=page=>page.waitForTimeout(450);

for (const size of [{name:"phone",width:390,height:844},{name:"phone-s",width:320,height:658},{name:"tablet",width:768,height:1024},{name:"ipad-l",width:1024,height:768}]) {
  const page=await browser.newPage({viewport:{width:size.width,height:size.height},hasTouch:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await boot(page);
  const tag=size.name;
  let r=await rect(page,".rail");
  ok(`${tag}: the menu is hidden below the screen until asked for`, !(await sheetOpen(page)) && r.top>=r.vh-2, r);

  const menuSel=await page.evaluate(()=>document.body.classList.contains("sidebar-open")?"#sidebar-menu":"#chat-menu");
  ok(`${tag}: the first page shows a menu button (${menuSel})`, await page.isVisible(menuSel));
  await page.click(menuSel); await settle(page);
  r=await rect(page,".rail");
  ok(`${tag}: the menu button slides the sheet up from the bottom`, (await sheetOpen(page)) && Math.abs(r.bottom-r.vh)<=2 && r.top<r.vh, r);
  ok(`${tag}: the sheet spans the full width`, r.left===0 && r.width===r.vw, r);
  const items=await page.evaluate(()=>[...document.querySelectorAll(".rail .rail-item")].filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&b.bottom<=innerHeight+1}).map(el=>el.textContent.trim()));
  ok(`${tag}: every destination is in the sheet (${items.join(", ")})`, ["Favorites","Chat","Calendar","Apps","Settings"].every(x=>items.some(i=>i.includes(x))), items);
  const sizes=await page.evaluate(()=>[...document.querySelectorAll(".rail .rail-item")].map(el=>Math.round(el.getBoundingClientRect().height)));
  ok(`${tag}: icons are large touch targets (>=44px)`, sizes.every(h=>h>=44), sizes);
  ok(`${tag}: the page behind is dimmed`, await page.evaluate(()=>getComputedStyle(document.getElementById("sidebar-scrim")).display!=="none"));

  await page.click('.rail .rail-item[data-view="settings"]'); await settle(page);
  const settings=await page.evaluate(()=>({shown:!document.getElementById("settings-view").hidden,animated:document.getElementById("settings-view").classList.contains("view-enter")}));
  ok(`${tag}: choosing Settings closes the sheet`, !(await sheetOpen(page)));
  ok(`${tag}: Settings is shown and animates in`, settings.shown&&settings.animated, settings);

  await page.click("#settings-view .mobile-view-menu"); await settle(page);
  ok(`${tag}: the Settings page opens the same sheet`, await sheetOpen(page));
  await page.click('.rail .rail-item[data-view="calendar"]'); await settle(page);
  ok(`${tag}: Calendar opens from the sheet`, await page.evaluate(()=>!document.getElementById("calendar-view").hidden) && !(await sheetOpen(page)));

  await page.click("#calendar-view .mobile-view-menu"); await settle(page);
  await page.click('.rail .rail-item[data-view="chat"]'); await settle(page);
  // A conversation is already open in the fixture, so Chat returns to it;
  // with none open it would show the list instead.
  ok(`${tag}: Chat returns to the open conversation`, await page.evaluate(()=>getComputedStyle(document.getElementById("chat-view")).display!=="none") && !(await sheetOpen(page)));

  await page.click("#chat-menu"); await settle(page);
  ok(`${tag}: the conversation header opens the sheet too`, await sheetOpen(page));
  if(await sheetOpen(page)){
    await page.click("#sidebar-scrim",{position:{x:10,y:10}}); await settle(page);
    ok(`${tag}: tapping outside closes the sheet`, !(await sheetOpen(page)));
  }
  const sideways=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  ok(`${tag}: nothing scrolls sideways`, !sideways);
  ok(`${tag}: no page errors`, !errors.length, errors.slice(0,2));
  if(size.name==="phone")await page.click(await page.isVisible("#sidebar-menu")?"#sidebar-menu":"#chat-menu").catch(()=>{}),await settle(page),await page.screenshot({path:"/private/tmp/claude-501/-Users-saaki-Desktop-Medha/f2033461-e2ec-44fb-b3d5-b125c4c30c41/scratchpad/sheet-phone.png"});
  await page.close();
}
{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await boot(page);
  const r=await rect(page,".rail");
  ok("laptop: the rail stays a left column", r.left===0 && r.width<120 && r.top===0, r);
  await page.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
