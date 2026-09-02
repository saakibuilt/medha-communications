import crypto from "node:crypto";

const PUSH_ENDPOINT="https://medha-activities.vercel.app/api/space-push";
const HUB_URL="https://medha-hub.web.app/";

function readRawBody(request){
  if(typeof request.body==="string")return Promise.resolve(request.body);
  if(request.body&&typeof request.body==="object")return Promise.resolve(JSON.stringify(request.body));
  return new Promise((resolve,reject)=>{
    let raw="";
    request.on("data",chunk=>{raw+=chunk});
    request.on("end",()=>resolve(raw));
    request.on("error",reject);
  });
}

function validSignature(raw,provided,secret){
  if(!provided||!secret)return false;
  const expected=crypto.createHmac("sha256",secret).update(raw).digest("hex");
  const left=Buffer.from(String(provided));
  const right=Buffer.from(expected);
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}

function idsFromMembers(members){
  return (Array.isArray(members)?members:[]).map(member=>String(
    member?.user_id||member?.user?.id||member?.id||""
  )).filter(Boolean);
}

function callMembers(event){
  return event.members||event.call?.members||event.call?.data?.members||[];
}

function callCreator(event){
  return String(
    event.user?.id||event.call?.created_by?.id||event.call?.created_by_id||
    event.created_by_id||""
  );
}

function messageRecipients(event){
  return idsFromMembers(event.members||event.channel?.members||[])
    .filter(id=>id!==String(event.user?.id||event.message?.user?.id||""));
}

async function forwardPush(recipients,payload){
  if(!recipients.length)return {delivered:0,skipped:"no-recipients"};
  const response=await fetch(PUSH_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({recipients,...payload})});
  const body=await response.text();
  if(!response.ok)throw Error(body||`Push bridge failed (${response.status})`);
  try{return JSON.parse(body)}catch{return {delivered:0}}
}

export const config={api:{bodyParser:false}};

export default async function handler(request,response){
  if(request.method!=="POST")return response.status(405).json({error:"POST required"});
  try{
    const raw=await readRawBody(request),secret=process.env.STREAM_API_SECRET;
    const signature=request.headers["x-signature"]||request.headers["X-Signature"];
    if(!validSignature(raw,signature,secret))return response.status(401).json({error:"Invalid Stream webhook signature"});
    const event=JSON.parse(raw||"{}");
    const type=String(event.type||"");
    if(type==="message.new"){
      const message=event.message||{};
      const sender=message.user?.name||event.user?.name||"New message";
      const result=await forwardPush(messageRecipients(event),{title:sender,body:message.text||"Sent an attachment",url:HUB_URL,tag:`stream-message-${message.id||Date.now()}`});
      return response.status(200).json({ok:true,type,result});
    }
    if(type==="call.ring"){
      const creator=callCreator(event),members=idsFromMembers(callMembers(event)).filter(id=>id!==creator);
      const call=event.call||{},custom=call.custom||call.data?.custom||{};
      const video=call.video===true||custom.mode==="video";
      const caller=event.user?.name||call.created_by?.name||"Medha user";
      const result=await forwardPush(members,{title:`Incoming ${video?"video":"audio"} call`,body:`${caller} is calling you`,url:HUB_URL,tag:`stream-call-${event.call_cid||call.cid||Date.now()}`});
      return response.status(200).json({ok:true,type,result});
    }
    return response.status(200).json({ok:true,ignored:type});
  }catch(error){
    console.error("Stream webhook push bridge failed",error);
    return response.status(500).json({error:"Stream webhook processing failed"});
  }
}
