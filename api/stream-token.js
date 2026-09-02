import { StreamChat } from "stream-chat";
export default async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"POST required"});
  const apiKey=process.env.STREAM_API_KEY,secret=process.env.STREAM_API_SECRET;
  if(!apiKey||!secret)return res.status(503).json({error:"Stream is not configured"});
  const authorization=req.headers.authorization||"";
  if(!/^Bearer\s+.+$/i.test(authorization))return res.status(401).json({error:"Medha authentication required"});
  try{
    const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_WEB_API_KEY||"AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw"}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:authorization.replace(/^Bearer\s+/i,"")})});
    if(!response.ok)throw Error("Invalid Medha authentication");
    const identity=(await response.json()).users?.[0];
    if(!identity?.localId)throw Error("Invalid Medha authentication");
    const user={id:identity.localId,name:identity.displayName||identity.email||req.body?.name||"Medha user"};
    const client=StreamChat.getInstance(apiKey,secret);
    return res.status(200).json({apiKey,token:client.createToken(user.id,Math.floor(Date.now()/1000)+3600),user});
  }catch(error){return res.status(401).json({error:error.message||"Could not create Stream session"})}
}
