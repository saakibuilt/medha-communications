/* The GIF endpoint: key failover, shape, and the unconfigured case.
   Giphy itself is stubbed so the suite never spends real quota. */
import handler from "../api/gif-search.js";
let pass=0,fail=0;
const ok=(n,c,e="")=>{c?(pass++,console.log("PASS  "+n)):(fail++,console.log("FAIL  "+n+(e?"  "+JSON.stringify(e):"")))};

function mockRes(){
  const r={code:0,body:null,headers:{}};
  r.status=(c)=>{r.code=c;return r};
  r.json=(b)=>{r.body=b;return r};
  r.setHeader=(k,v)=>{r.headers[k]=v};
  return r;
}
const GIF={data:[{id:"a1",title:"Cat GIF",images:{
  fixed_width:{url:"https://media.giphy.com/full.gif",width:"200",height:"200"},
  fixed_width_downsampled:{url:"https://media.giphy.com/small.gif"},
  original:{url:"https://media.giphy.com/orig.gif"}}}]};

const realFetch=globalThis.fetch;
const realEnv={...process.env};
function stub(map){
  globalThis.fetch=async(url)=>{
    const key=new URL(url).searchParams.get("api_key");
    const status=map[key]??200;
    return {ok:status===200,status,json:async()=>GIF};
  };
}
const run=async(query={})=>{const res=mockRes();await handler({method:"GET",query},res);return res};

/* no key configured */
delete process.env.GIPHY_API_KEYS; delete process.env.GIPHY_API_KEY;
let r=await run();
ok("no key returns 503",r.code===503,r);
ok("503 explains itself",/not configured/i.test(r.body?.error||""),r.body);

/* happy path */
process.env.GIPHY_API_KEYS="good1";
stub({good1:200});
r=await run();
ok("a working key returns results",r.code===200&&r.body.results.length===1,r.body);
const item=r.body.results[0];
ok("preview uses the downsampled image",/small\.gif/.test(item.preview),item);
ok("url uses the full-size image",/full\.gif/.test(item.url),item);
ok("title and dimensions carry through",item.description==="Cat GIF"&&item.width===200,item);
ok("responses are cached briefly",/max-age/.test(r.headers["Cache-Control"]||""),r.headers);

/* failover: rate limit, then auth, then success */
process.env.GIPHY_API_KEYS="limited,rejected,good3";
stub({limited:429,rejected:403,good3:200});
r=await run();
ok("a rate-limited key falls through to the next",r.code===200&&r.body.results.length===1,r.body);
process.env.GIPHY_API_KEYS="a,b,c";
stub({a:429,b:429,c:429});
r=await run();
ok("all keys exhausted reports an error",r.code===502&&/429/.test(r.body.error||""),r.body);

/* a genuine bad request must not burn every key */
let calls=0;
process.env.GIPHY_API_KEYS="k1,k2,k3";
globalThis.fetch=async()=>{calls++;return {ok:false,status:400,json:async()=>({})}};
r=await run();
ok("a 400 stops after one key",calls===1&&r.code===502,{calls,code:r.code});

/* separator tolerance */
process.env.GIPHY_API_KEYS=" good1 , good2 \n good3 ";
stub({good1:200});
r=await run();
ok("keys may be comma or whitespace separated",r.code===200,r.body);

/* query passthrough */
process.env.GIPHY_API_KEYS="good1";
let seen="";
globalThis.fetch=async(url)=>{seen=url;return {ok:true,status:200,json:async()=>GIF}};
await run({q:"thumbs up",limit:"5"});
ok("a query hits the search endpoint",/\/search\?/.test(seen),seen);
ok("the query is passed through",/q=thumbs\+up/.test(seen),seen);
await run({});
ok("no query hits trending",/\/trending\?/.test(seen),seen);
await run({limit:"999"});
ok("limit is capped at 50",/limit=50/.test(seen),seen);
ok("results are rated for the workplace",/rating=pg-13/.test(seen),seen);

globalThis.fetch=realFetch; process.env=realEnv;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
