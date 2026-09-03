/* Verifies camera/mic/notification permissions are requested once and reused. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};
const browser=await chromium.launch();
const page=await browser.newPage();
page.on("pageerror",e=>console.log("  [pageerror] "+e.message));
await page.route("https://esm.sh/stream-chat@9.52.0",r=>r.fulfill({status:200,contentType:"text/javascript",body:readFileSync(new URL("./fake-stream.js",import.meta.url),"utf8")}));
await page.route("**/@stream-io/video-client**",r=>r.fulfill({status:200,contentType:"text/javascript",body:"export class StreamVideoClient{}; export const CallingState={JOINED:'joined'};"}));
await page.route("**/*.supabase.co/**",r=>r.fulfill({status:200,contentType:"application/json",body:"[]"}));
await page.route("**/api/stream-token",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify({apiKey:"fake",token:"tok",user:{id:"u_me",name:"Saksham Nirula"}})}));
await page.route("**/api/stream-users",r=>r.fulfill({status:200,contentType:"application/json",body:'{"ok":true}'}));

/* Count every getUserMedia and permissions.query the page makes. */
await page.addInitScript(()=>{
  window.__gum=0;window.__query=[];window.__permState="prompt";
  const fakeTrack={stop(){window.__stopped=(window.__stopped||0)+1}};
  Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{
    getUserMedia:async()=>{window.__gum++;
      if(window.__permState==="denied"){const e=new Error("denied");e.name="NotAllowedError";throw e}
      return {getTracks:()=>[fakeTrack]}}}});
  Object.defineProperty(navigator,"permissions",{configurable:true,value:{
    query:async({name})=>{window.__query.push(name);
      return {state:window.__permState,onchange:null}}}});
});
await page.goto("http://localhost:4173",{waitUntil:"domcontentloaded"});
await page.waitForFunction(()=>!!window.__space?.ensureDevicePermission,null,{timeout:15000});
await page.evaluate(()=>{window.__space.currentUserId="u_me";localStorage.clear();window.__space.resetPermissionCache()});

/* --- first request prompts once --- */
let r=await page.evaluate(async()=>{
  window.__gum=0;
  const okd=await window.__space.ensureDevicePermission("microphone");
  return {okd,gum:window.__gum,stored:window.__space.readPermissionStore().microphone,stopped:window.__stopped}});
ok("first mic request calls getUserMedia once",r.gum===1,r);
ok("first mic request succeeds",r.okd===true);
ok("grant is stored",r.stored==="granted",r.stored);
ok("probe stream is released",r.stopped>=1,r.stopped);

/* --- second request must not prompt again --- */
r=await page.evaluate(async()=>{window.__gum=0;window.__permState="granted";
  await window.__space.ensureDevicePermission("microphone");
  await window.__space.ensureDevicePermission("microphone");
  return {gum:window.__gum}});
ok("a stored grant never re-prompts",r.gum===0,r);

/* --- camera is tracked separately --- */
r=await page.evaluate(async()=>{window.__gum=0;window.__permState="prompt";
  await window.__space.ensureDevicePermission("camera");
  const first=window.__gum;window.__permState="granted";
  await window.__space.ensureDevicePermission("camera");
  return {first,after:window.__gum,store:window.__space.readPermissionStore()}});
ok("camera prompts once on its own",r.first===1&&r.after===1,r);
ok("camera and microphone stored separately",r.store.camera==="granted"&&r.store.microphone==="granted",r.store);

/* --- a denial is remembered, not re-asked --- */
r=await page.evaluate(async()=>{
  localStorage.clear();window.__space.resetPermissionCache();
  window.__permState="denied";window.__gum=0;
  let msg="";
  try{await window.__space.ensureDevicePermission("camera")}catch(e){msg=e.message}
  const afterFirst=window.__gum;
  try{await window.__space.ensureDevicePermission("camera")}catch(e){}
  return {msg,afterFirst,after:window.__gum,stored:window.__space.readPermissionStore().camera}});
ok("a denied device does not call getUserMedia",r.afterFirst===0&&r.after===0,r);
ok("denial is stored",r.stored==="denied",r.stored);
ok("denial explains how to fix it",/site settings/i.test(r.msg),r.msg);

/* --- survives a reload --- */
await page.evaluate(()=>{localStorage.clear();window.__space.resetPermissionCache();window.__permState="prompt"});
await page.evaluate(async()=>{await window.__space.ensureDevicePermission("microphone")});
await page.reload({waitUntil:"domcontentloaded"});
await page.waitForFunction(()=>!!window.__space?.readPermissionStore,null,{timeout:15000});
r=await page.evaluate(()=>{window.__space.currentUserId="u_me";return window.__space.readPermissionStore().microphone});
ok("grant survives a page reload",r==="granted",r);

/* --- the Permissions API is consulted before prompting --- */
r=await page.evaluate(async()=>{window.__query=[];window.__permState="granted";
  window.__space.resetPermissionCache();
  await window.__space.ensureDevicePermission("camera");
  return window.__query});
ok("permission state is read from the browser first",r.includes("camera"),r);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
