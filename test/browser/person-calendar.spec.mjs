/* "View <name>'s calendar" from the chat details panel and the group member sheet. */
import { chromium } from "playwright";
import { boot } from "./setup.mjs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:900}});
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await boot(page);
const day=n=>{const d=new Date();d.setDate(d.getDate()+n);d.setHours(10,0,0,0);return d.toISOString()};
const shared={id:"m_shared",title:"Q3 numbers review",start_at:day(1),end_at:day(1),invitee_ids:["u_me","u_kavya"],created_by:"u_kavya",location:"Room 2"};
const secret={id:"m_secret",title:"Confidential HR chat",start_at:day(2),end_at:day(2),invitee_ids:["u_priya"],created_by:"u_kavya",location:"HR"};
const seen=[];
await page.route("**/rest/v1/medha_communications_meetings**",route=>{
  const url=decodeURIComponent(route.request().url());seen.push(url);
  if(url.includes("and=("))return route.fulfill({json:[shared]});                 // meetings we share
  if(url.includes("select=id,start_at,end_at&"))return route.fulfill({json:[{id:shared.id,start_at:shared.start_at,end_at:shared.end_at},{id:secret.id,start_at:secret.start_at,end_at:secret.end_at}]});
  return route.fulfill({json:[]});
});
// open the direct chat with Kavya and its details panel
await page.evaluate(()=>{const s=window.__space;s.active=s.conversations.find(c=>c.id==="c1");s.renderMessages()});
await page.click("#conversation-name");await page.waitForTimeout(350);
let r=await page.evaluate(()=>{const b=document.querySelector("#details-view-calendar");return b&&{text:b.textContent.trim(),hidden:b.hidden}});
ok("details panel shows View <name>'s calendar",r&&!r.hidden&&r.text==="View Kavya Sharma's calendar",r);
await page.click("#details-view-calendar");await page.waitForTimeout(600);
r=await page.evaluate(()=>({
  view:document.querySelector("#calendar-view")?.classList.contains("active-view"),
  title:document.querySelector("#calendar-view .page-head h2")?.textContent,
  back:!document.querySelector("#calendar-back-mine")?.hidden, create:!document.querySelector("#new-event")?.hidden,
  html:document.querySelector("#calendar-grid")?.innerHTML||"",
  busy:document.querySelectorAll("#calendar-grid i.is-busy").length,
  editOnBusy:document.querySelectorAll("#calendar-grid i.is-busy [data-edit-meeting]").length}));
ok("opens the calendar view titled with their name",r.view&&r.title==="Kavya Sharma's calendar",r.title);
ok("shared meeting shows its title",r.html.includes("Q3 numbers review"));
ok("their other meeting shows only as Busy",r.busy>=1&&!r.html.includes("Confidential"),{busy:r.busy});
ok("busy blocks cannot be edited",r.editOnBusy===0);
ok("Back to my calendar shown, Create event hidden",r.back&&!r.create,r);
ok("busy request never asks for titles",seen.filter(u=>u.includes("select=id,start_at,end_at&")).length>0&&!seen.some(u=>u.includes("select=id,start_at,end_at&")&&u.includes("title")));
await page.screenshot({path:process.argv[2]||"/tmp/person-calendar.png"});
await page.click("#calendar-back-mine");await page.waitForTimeout(300);
r=await page.evaluate(()=>({title:document.querySelector("#calendar-view .page-head h2")?.textContent,create:!document.querySelector("#new-event")?.hidden,html:document.querySelector("#calendar-grid")?.innerHTML||""}));
ok("Back to my calendar restores your own calendar",r.title==="Calendar"&&r.create&&!r.html.includes("is-busy"),r.title);
// group member sheet -> Calendar
await page.evaluate(()=>{const s=window.__space;s.active=s.conversations.find(c=>c.id==="g1");s.renderMessages()});
await page.evaluate(()=>{const b=document.querySelector('.rail-item[data-view="chat"]');b&&b.click()});await page.waitForTimeout(200);
await page.evaluate(()=>{const s=window.__space;s.active=s.conversations.find(c=>c.id==="g1");s.renderMessages()});
await page.click("#conversation-name");await page.waitForTimeout(350);
await page.click('#group-members-list [data-group-member-id="u_anil"]');await page.waitForTimeout(250);
r=await page.evaluate(()=>!!document.querySelector('#group-member-dialog [data-member-profile-action="calendar"]'));
ok("member profile sheet has a Calendar action",r);
await page.click('#group-member-dialog [data-member-profile-action="calendar"]');await page.waitForTimeout(500);
r=await page.evaluate(()=>document.querySelector("#calendar-view .page-head h2")?.textContent);
ok("Calendar action opens that member's calendar",r==="Anil Rao's calendar",r);
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);process.exit(fail?1:0);
