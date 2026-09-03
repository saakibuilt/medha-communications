import http from "node:http";
import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamChat } from "stream-chat";
try{loadEnvFile(".env.local")}catch{}
const root=fileURLToPath(new URL(".",import.meta.url));
const types={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const json=(res,status,body)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(body))};
async function readBody(req){let body="";for await(const chunk of req)body+=chunk;return body?JSON.parse(body):{}}
async function streamToken(req,res){
  if(req.method!=="POST")return json(res,405,{error:"POST required"});
  const apiKey=process.env.STREAM_API_KEY,secret=process.env.STREAM_API_SECRET;
  if(!apiKey||!secret)return json(res,503,{error:"Stream is not configured. Set STREAM_API_KEY and STREAM_API_SECRET in .env.local."});
  const authorization=req.headers.authorization||"";
  const localDev=String(req.headers.host||"").startsWith("localhost:")&&process.env.LOCAL_STREAM_DEV==="true"&&req.headers["x-local-stream-dev"]==="true";
  if(!localDev&&!/^Bearer\s+.+$/i.test(authorization))return json(res,401,{error:"Medha authentication required"});
  try{
    const body=await readBody(req);
    let user;
    if(localDev)user={id:String(body.userId||process.env.LOCAL_STREAM_USER_ID||"medha-local-user"),name:String(body.name||process.env.LOCAL_STREAM_USER_NAME||"Local Medha User")};
    else{
      const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_WEB_API_KEY||"AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw"}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:authorization.replace(/^Bearer\s+/i,"")})});
      if(!response.ok)throw Error("Invalid Medha authentication");
      const identity=(await response.json()).users?.[0];
      if(!identity?.localId)throw Error("Invalid Medha authentication");
      user={id:identity.localId,name:identity.displayName||identity.email||body.name||"Medha user",image:body.image};
    }
    const client=StreamChat.getInstance(apiKey,secret);
    return json(res,200,{apiKey,token:client.createToken(user.id,Math.floor(Date.now()/1000)+3600),user});
  }catch(error){return json(res,401,{error:error.message||"Could not create Stream session"})}
}
async function streamUsers(req,res){
  if(req.method!=="POST")return json(res,405,{error:"POST required"});
  const apiKey=process.env.STREAM_API_KEY,secret=process.env.STREAM_API_SECRET;
  const localDev=String(req.headers.host||"").startsWith("localhost:")&&process.env.LOCAL_STREAM_DEV==="true"&&req.headers["x-local-stream-dev"]==="true";
  const authorization=req.headers.authorization||"";
  if(!apiKey||!secret)return json(res,503,{error:"Stream is not configured"});
  if(!localDev&&!/^Bearer\s+.+$/i.test(authorization))return json(res,401,{error:"Medha authentication required"});
  try{
    const body=await readBody(req),users=Array.isArray(body.users)?body.users.map(user=>({id:String(user.id||"").trim(),name:String(user.name||"Medha user").trim(),image:user.image})).filter(user=>user.id):[];
    if(!users.length)return json(res,400,{error:"At least one Stream user is required"});
    if(!localDev){
      const response=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_WEB_API_KEY||"AIzaSyDhyDoFRrCXXEkoQ3i6wpqmNd8Po6p_KIw"}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:authorization.replace(/^Bearer\s+/i,"")})});
      if(!response.ok)throw Error("Invalid Medha authentication");
    }
    await StreamChat.getInstance(apiKey,secret).upsertUsers(users);
    return json(res,200,{ok:true,count:users.length});
  }catch(error){return json(res,400,{error:error.message||"Could not provision Stream users"})}
}
/* Mirrors api/gif-search.js so the picker works against `npm run dev`
   too. The key is read from the environment and never reaches the client. */
async function gifSearch(req,res){
  const key=process.env.TENOR_API_KEY;
  if(!key)return json(res,503,{error:"GIF search is not configured"});
  const url=new URL(req.url,"http://localhost");
  const query=String(url.searchParams.get("q")||"").trim().slice(0,100);
  const limit=Math.min(Number(url.searchParams.get("limit"))||24,50);
  const params=new URLSearchParams({key,limit:String(limit),contentfilter:"medium",
    media_filter:"tinygif,gif",client_key:"medha_space"});
  if(query)params.set("q",query);
  try{
    const response=await fetch(`https://tenor.googleapis.com/v2/${query?"search":"featured"}?${params}`);
    if(!response.ok)throw Error(`Tenor responded ${response.status}`);
    const body=await response.json();
    const results=(body.results||[]).map(item=>({
      id:String(item.id||""),description:String(item.content_description||"GIF").slice(0,120),
      preview:item.media_formats?.tinygif?.url||item.media_formats?.gif?.url||"",
      url:item.media_formats?.gif?.url||item.media_formats?.tinygif?.url||"",
      width:item.media_formats?.gif?.dims?.[0]||null,height:item.media_formats?.gif?.dims?.[1]||null,
    })).filter(item=>item.preview&&item.url);
    return json(res,200,{results});
  }catch(error){return json(res,502,{error:error.message||"GIF search failed"})}
}
http.createServer(async(req,res)=>{try{
  const path=normalize(new URL(req.url,"http://localhost").pathname);
  if(path==="/api/gif-search")return gifSearch(req,res);
  if(path==="/api/stream-token")return streamToken(req,res);
  if(path==="/api/stream-users")return streamUsers(req,res);
  let filePath=path;if(filePath==="/")filePath="/index.html";if(filePath.includes(".."))throw Error();
  const data=await readFile(join(root,filePath));res.writeHead(200,{"Content-Type":types[extname(filePath)]||"application/octet-stream"});res.end(data)
}catch{res.writeHead(404);res.end("Not found")}}).listen(4173,()=>console.log("Medha Communications Stream running at http://localhost:4173"));
