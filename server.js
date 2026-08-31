import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL(".",import.meta.url));
const types={".html":"text/html",".js":"text/javascript",".css":"text/css"};
http.createServer(async(req,res)=>{try{let path=normalize(new URL(req.url,"http://localhost").pathname);if(path==="/")path="/index.html";if(path.includes(".."))throw Error();const data=await readFile(join(root,path));res.writeHead(200,{"Content-Type":types[extname(path)]||"application/octet-stream"});res.end(data)}catch{res.writeHead(404);res.end("Not found")}}).listen(4173,()=>console.log("Medha Communications running at http://localhost:4173"));
