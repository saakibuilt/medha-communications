import { StreamChat } from "stream-chat";

const supabaseUrl="https://nnvyfeckimnjvmeneiro.supabase.co";
const supabaseKey="sb_publishable_H-o5HRFu3lCq5E9Hf1s3uA_Hi_LaMnY";
const stream=StreamChat.getInstance(process.env.STREAM_API_KEY,process.env.STREAM_API_SECRET);
const headers={apikey:supabaseKey,Authorization:`Bearer ${supabaseKey}`};
const get=async path=>{const response=await fetch(`${supabaseUrl}/rest/v1/${path}`,{headers});if(!response.ok)throw Error(`${response.status} ${await response.text()}`);return response.json()};
if(!process.env.STREAM_API_KEY||!process.env.STREAM_API_SECRET)throw Error("Stream credentials are required");

const people=await get("users?select=id,full_name,email&is_active=eq.true&limit=5000");
const conversations=await get("medha_communications_conversations?select=id,cid,title,kind,participant_ids&limit=5000");
const names=new Map(people.map(person=>[String(person.id),person.full_name||person.email||"Medha user"]));
const senderIds=new Set(conversations.flatMap(conversation=>(conversation.participant_ids||[]).map(String)));
const users=[...senderIds].map(id=>({id,name:names.get(id)||"Medha user"}));
if(users.length)await stream.upsertUsers(users);
let migrated=0,skipped=0;
for(const conversation of conversations){
  const members=[...new Set((conversation.participant_ids||[]).map(String).filter(Boolean))];
  if(!members.length)continue;
  const id=String(conversation.id).slice(0,64);
  const channel=stream.channel("messaging",id,{members,created_by_id:members[0],name:conversation.title||"Conversation",legacy_cid:String(conversation.cid||"")});
  await channel.create();
  const messages=await get(`medha_communications_messages?cid=eq.${encodeURIComponent(conversation.cid)}&select=id,sender_id,body,attachments,created_at&order=created_at.asc&limit=5000`);
  for(const message of messages){
    try{
      await channel.sendMessage({id:String(message.id),user_id:String(message.sender_id),text:message.body||"",attachments:message.attachments||[],legacy_created_at:message.created_at});
      migrated++;
    }catch(error){
      if(/already exists|duplicate/i.test(String(error.message)))skipped++;
      else throw error;
    }
  }
  console.log(`migrated ${conversation.title||id}: ${messages.length} message(s)`);
}
console.log(`Stream migration complete: ${migrated} migrated, ${skipped} already present`);
