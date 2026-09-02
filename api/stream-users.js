import { StreamChat } from "stream-chat";
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST required"});
  const apiKey=process.env.STREAM_API_KEY,secret=process.env.STREAM_API_SECRET;
  const authorization=req.headers.authorization||"";
  if(!apiKey||!secret)return res.status(503).json({error:"Stream is not configured"});
  if(!/^Bearer\s+.+$/i.test(authorization))return res.status(401).json({error:"Medha authentication required"});
  try{
    const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_WEB_API_KEY||"AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw"}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:authorization.replace(/^Bearer\s+/i,"")})});
    if(!response.ok)throw Error("Invalid Medha authentication");
    const body=await new Promise((resolve,reject)=>{let text="";req.on("data",chunk=>text+=chunk);req.on("end",()=>{try{resolve(text?JSON.parse(text):{})}catch(error){reject(error)}});req.on("error",reject)});
    const users=Array.isArray(body.users)?body.users.map(user=>({id:String(user.id||"").trim(),name:String(user.name||"Medha user").trim(),image:user.image})).filter(user=>user.id):[];
    if(!users.length)return res.status(400).json({error:"At least one Stream user is required"});
    await StreamChat.getInstance(apiKey,secret).upsertUsers(users);
    return res.status(200).json({ok:true,count:users.length});
  }catch(error){return res.status(400).json({error:error.message||"Could not provision Stream users"})}
}
