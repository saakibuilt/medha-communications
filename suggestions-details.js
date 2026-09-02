const box=document.querySelector("#suggestions-list");
const safe=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function monthIndex(name){return MONTHS[String(name||"").slice(0,3).toLowerCase()]}
/* Parses every date shape the events feed uses and returns both ends.
   Returns {start, end} end is inclusive and equals start for a one-day event. */
function parseEventRange(value){
  const text=String(value||"").trim();
  if(!text)return null;
  const mk=(y,m,d)=>{const x=new Date(y,m,d);return Number.isNaN(x.getTime())?null:x};
  let m;
  // 9/22/2026 - 9/25/2026   (also single 9/22/2026)
  m=text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\s*(?:[-–—]|to|until|through)\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
  if(m)return{start:mk(+m[3],+m[1]-1,+m[2]),end:mk(+m[6],+m[4]-1,+m[5])};
  // September 14-16, 2026  /  OCTOBER 12-15, 2026  /  May 25-27, 2027
  m=text.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  if(m&&monthIndex(m[1])!==undefined){
    const y=+(m[4]||new Date().getFullYear()),mo=monthIndex(m[1]);
    return{start:mk(y,mo,+m[2]),end:mk(y,mo,+m[3])};
  }
  // 8-9 September 2026  /  8 - 9 Sept 2026
  m=text.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})?/);
  if(m&&monthIndex(m[3])!==undefined){
    const y=+(m[4]||new Date().getFullYear()),mo=monthIndex(m[3]);
    return{start:mk(y,mo,+m[1]),end:mk(y,mo,+m[2])};
  }
  // 28 September - 2 October 2026 (crosses a month)
  m=text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})?/);
  if(m&&monthIndex(m[2])!==undefined&&monthIndex(m[4])!==undefined){
    const y=+(m[5]||new Date().getFullYear());
    const s=mk(y,monthIndex(m[2]),+m[1]);
    let e=mk(y,monthIndex(m[4]),+m[3]);
    if(s&&e&&e<s)e=mk(y+1,monthIndex(m[4]),+m[3]);
    return{start:s,end:e};
  }
  // Sept 28 - Oct 2, 2026
  m=text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*[-–—]\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/);
  if(m&&monthIndex(m[1])!==undefined&&monthIndex(m[3])!==undefined){
    const y=+(m[5]||new Date().getFullYear());
    const s=mk(y,monthIndex(m[1]),+m[2]);
    let e=mk(y,monthIndex(m[3]),+m[4]);
    if(s&&e&&e<s)e=mk(y+1,monthIndex(m[3]),+m[4]);
    return{start:s,end:e};
  }
  // single: 9/22/2026
  m=text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if(m){const d=mk(+m[3],+m[1]-1,+m[2]);return d?{start:d,end:d}:null}
  // single: September 14, 2026  /  14 September 2026
  m=text.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  if(m&&monthIndex(m[1])!==undefined){
    const d=mk(+(m[3]||new Date().getFullYear()),monthIndex(m[1]),+m[2]);
    return d?{start:d,end:d}:null;
  }
  m=text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})?/);
  if(m&&monthIndex(m[2])!==undefined){
    const d=mk(+(m[3]||new Date().getFullYear()),monthIndex(m[2]),+m[1]);
    return d?{start:d,end:d}:null;
  }
  return null;
}

const startDate=value=>parseEventRange(value)?.start||null;
const endDateOf=value=>parseEventRange(value)?.end||null;
const modeFor=item=>/virtual|online|webinar|remote/i.test(`${item.location||""} ${item.description||""} ${item.title||""}`)?"Virtual":item.location?"In person":"Attendance mode not published";
const fmtDate=d=>d?d.toLocaleDateString([],{month:"long",day:"numeric",year:"numeric"}):"Not published";
const endLabel=value=>fmtDate(endDateOf(value));
const startLabel=value=>fmtDate(parseEventRange(value)?.start);
const suggestionCacheKey="medha-communications-suggestions-v1",suggestionCacheTtl=12*60*60*1000;async function renderDetailedSuggestions(){try{let payload=null;const cached=JSON.parse(localStorage.getItem(suggestionCacheKey)||"null");if(cached&&Date.now()-cached.savedAt<suggestionCacheTtl)payload=cached.payload;if(!payload){const [eventResponse,exhibitionResponse]=await Promise.all([fetch("https://medha-newsevents.vercel.app/api/events"),fetch("https://medha-newsevents.vercel.app/api/exhibitions")]);if(!eventResponse.ok||!exhibitionResponse.ok)throw Error();payload={events:await eventResponse.json(),exhibitions:await exhibitionResponse.json()};localStorage.setItem(suggestionCacheKey,JSON.stringify({savedAt:Date.now(),payload}))}const items=[...(payload.events.sources||[]).flatMap(source=>(source.items||[]).map(item=>({...item,kind:"Event"}))),...(payload.exhibitions.sources||[]).flatMap(source=>(source.items||[]).map(item=>({...item,kind:"Exhibition"})))].map(item=>({...item,start:startDate(item.date)})).filter(item=>item.start&&item.start>=new Date()).sort((a,b)=>a.start-b.start).slice(0,20);box.innerHTML=items.length?items.map(item=>`<a class="suggestion-item suggestion-detailed" data-raw-date="${safe(item.date||"")}" href="${safe(item.link||"https://medha-newsevents.vercel.app/")}" target="_blank" rel="noopener"><span>${safe(item.kind)} · ${safe(modeFor(item))}</span><strong>${safe(item.title)}</strong><small><b>Start:</b> ${safe(startLabel(item.date))} · <b>End:</b> ${safe(item.endDate?fmtDate(new Date(item.endDate)):endLabel(item.date))}</small><small><b>Time:</b> ${safe(item.time||"Not published")}</small><small><b>Location:</b> ${safe(item.location||"Not published")}</small></a>`).join(""):"<div class=\"empty-state\">No upcoming events or exhibitions.</div>"}catch{}}
const suggestionsObserver=new MutationObserver(()=>{if(!box.querySelector(".suggestion-detailed"))renderDetailedSuggestions()});suggestionsObserver.observe(box,{childList:true,subtree:true});renderDetailedSuggestions();
const addButtonObserver=new MutationObserver(()=>{box.querySelectorAll(".suggestion-detailed").forEach(card=>{if(card.querySelector(".suggestion-add"))return;const add=document.createElement("button");add.type="button";add.className="suggestion-add";add.title="Add to calendar";add.setAttribute("aria-label","Add to calendar");add.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';add.addEventListener("click",event=>{event.preventDefault();event.stopPropagation();const details=[...card.querySelectorAll("small")].map(x=>x.textContent),start=(details.find(x=>x.includes("Start:"))||"").replace(/^.*Start:\s*/,"").replace(/\s*·.*$/,"").trim(),end=(details.find(x=>x.includes("End:"))||"").replace(/^.*End:\s*/,"").trim(),time=(details.find(x=>x.includes("Time:"))||"").replace(/^.*Time:\s*/,"").trim(),location=(details.find(x=>x.includes("Location:"))||"").replace(/^.*Location:\s*/,"").trim();const range=parseEventRange(card.dataset.rawDate||"");
window.dispatchEvent(new CustomEvent("communications:add-suggestion-event",{detail:{title:card.querySelector("strong")?.textContent||"",start,end,time,location,startDate:range?.start||null,endDate:range?.end||null}}))});card.append(add)})});addButtonObserver.observe(box,{childList:true,subtree:true});
/* Fills the New meeting dialog from a suggestion. Uses the dates parsed
   from the feed's own string, so a range like "8-11 September 2026" sets
   the 8th as the start and the 11th as the end instead of collapsing to
   a single day. */
window.addEventListener("communications:add-suggestion-event",event=>{
  const d=event.detail||{};
  const pad=n=>String(n).padStart(2,"0");
  const local=x=>`${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
  const range=parseEventRange(d.start||"");
  let start=d.startDate?new Date(d.startDate):range?.start;
  let end=d.endDate?new Date(d.endDate):range?.end;
  if(!start||Number.isNaN(start.getTime()))start=new Date();
  if(!end||Number.isNaN(end.getTime()))end=new Date(start);

  const timeMatch=String(d.time||"").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  const hour=timeMatch?(+timeMatch[1]%12)+(timeMatch[3].toUpperCase()==="PM"?12:0):9;
  const minute=timeMatch?+(timeMatch[2]||0):0;
  start.setHours(hour,minute,0,0);
  /* A multi-day event ends on its last day; a single day ends an hour later. */
  if(end.toDateString()===start.toDateString())end.setHours(hour+1,minute,0,0);
  else end.setHours(17,0,0,0);

  const titleEl=document.querySelector("#event-title");
  if(titleEl)titleEl.value=(d.title||"").replace(/\s+/g," ").trim().slice(0,160);
  const startEl=document.querySelector("#event-start");
  if(startEl)startEl.value=local(start);
  const endEl=document.querySelector("#event-end");
  if(endEl)endEl.value=local(end);
  const location=document.querySelector("#event-location");
  if(location)location.value=d.location&&d.location!=="Not published"?d.location:"";
  const dialog=document.querySelector("#event-dialog");
  if(dialog&&!dialog.open)dialog.showModal();
});

setTimeout(()=>box.querySelectorAll(".suggestion-detailed").forEach(card=>{if(card.querySelector(".suggestion-add"))return;const add=document.createElement("button");add.type="button";add.className="suggestion-add";add.title="Add to calendar";add.setAttribute("aria-label","Add to calendar");add.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';add.onclick=event=>{event.preventDefault();event.stopPropagation();const details=[...card.querySelectorAll("small")].map(x=>x.textContent),pick=label=>(details.find(x=>x.includes(`${label}:`))||"").replace(new RegExp(`^.*${label}:\\s*`),"").replace(/\\s*·.*$/,"" ).trim();const range=parseEventRange(card.dataset.rawDate||"");
window.dispatchEvent(new CustomEvent("communications:add-suggestion-event",{detail:{title:card.querySelector("strong")?.textContent||"",start:pick("Start"),end:pick("End"),time:pick("Time"),location:pick("Location"),startDate:range?.start||null,endDate:range?.end||null}}))};card.append(add)}),0);
