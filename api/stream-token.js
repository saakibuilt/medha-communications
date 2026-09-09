import { StreamChat } from "stream-chat";
/* Medha Hub calls this from its own origin to open the same chat session in
   its side panel, so the endpoint has to answer a cross-origin preflight.
   The allowlist is explicit - this mints a Stream token, so it must not be
   callable from anywhere. */
const ALLOWED_ORIGINS=new Set([
  "https://medha-hub.web.app",
  "https://medha-hub.firebaseapp.com",
  "https://medha-communications.vercel.app",
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:5000",
]);
function applyCors(req,res){
  const origin=req.headers.origin;
  if(origin&&ALLOWED_ORIGINS.has(origin)){
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Vary","Origin");
  }
  res.setHeader("Access-Control-Allow-Headers","authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
}
export default async function handler(req,res){
  applyCors(req,res);
  if(req.method==="OPTIONS")return res.status(204).end();
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
