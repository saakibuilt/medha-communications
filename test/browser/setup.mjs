/* Shared page bootstrap for the browser specs. */
import { readFileSync } from "node:fs";
export async function boot(page,{mobile=false}={}){
  await page.route("https://esm.sh/stream-chat@9.52.0",r=>r.fulfill({status:200,contentType:"text/javascript",
    body:readFileSync(new URL("./fake-stream.js",import.meta.url),"utf8")}));
  await page.route("**/@stream-io/video-client**",r=>r.fulfill({status:200,contentType:"text/javascript",
    body:"export class StreamVideoClient{}; export const CallingState={JOINED:'joined'};"}));
  await page.route("**/*.supabase.co/**",r=>r.fulfill({status:200,contentType:"application/json",body:"[]"}));
  await page.route("**/api/stream-token",r=>r.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({apiKey:"fake",token:"tok",user:{id:"u_me",name:"Saksham Nirula"}})}));
  await page.route("**/api/stream-users",r=>r.fulfill({status:200,contentType:"application/json",body:'{"ok":true}'}));
  await page.goto("http://localhost:4173",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>!!window.__space,null,{timeout:15000});
  await page.waitForTimeout(900);
  await page.evaluate(async()=>{
    const s=window.__space;s.currentUserId="u_me";
    s.directory=[{id:"u_me",full_name:"Saksham Nirula",email:"s@medha.test",department:"Engineering"},
      {id:"u_kavya",full_name:"Kavya Sharma",email:"k@medha.test",department:"Operations"},
      {id:"u_anil",full_name:"Anil Rao",email:"a@medha.test",department:"Finance"},
      {id:"u_priya",full_name:"Priya Nair",email:"p@medha.test",department:"Design"}];
    const mk=(id,text,sender,parentId=null,mins=30)=>({id,senderId:sender,who:sender==="u_me"?"me":"them",
      senderName:sender==="u_me"?"Saksham Nirula":sender==="u_anil"?"Anil Rao":"Kavya Sharma",
      text,parentId,attachments:[],reactions:{},createdAt:new Date(Date.now()-mins*6e4).toISOString(),time:"10:00 AM"});
    const chat={cid:"messaging:c1",id:"c1",name:"Kavya Sharma",participantId:"u_kavya",participantIds:["u_me","u_kavya"],
      kind:"direct",initials:"KS",color:"blue",team:"",preview:"Sounds good",updatedAt:new Date().toISOString(),
      time:"10:05 AM",unread:0,mentions:0,archived:false,messagesLoaded:true,messageOffset:2,hasMore:false,
      messages:[mk("m1","Can you review the Q3 numbers?","u_kavya",null,40),mk("m2","On it.","u_me",null,30)]};
    const grp={cid:"messaging:g1",id:"g1",name:"Ops Team",participantId:"u_kavya",participantIds:["u_me","u_kavya","u_anil"],
      kind:"group",initials:"OT",color:"purple",team:"Group chat",preview:"",updatedAt:new Date(Date.now()-6e5).toISOString(),
      time:"9:55 AM",unread:0,mentions:0,archived:false,messages:[],messagesLoaded:true,messageOffset:0,hasMore:false};
    s.conversations=[chat,grp];s.active=chat;
    for(const c of s.conversations)await s.watchStreamChannel(c);
    s.renderList();s.renderMessages();
  });
  await page.waitForTimeout(300);
}
