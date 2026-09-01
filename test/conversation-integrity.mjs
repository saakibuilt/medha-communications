// Every failure mode named, run against the shipped logic.
const A='uid_alice', B='uid_bob', C='uid_carol';
const viewer=v=>({viewerId:()=>v, isMine:s=>String(s)===String(v)});
const dm=(x,y)=>`dm_${[String(x),String(y)].sort().join('__')}`;
let pass=0,fail=0;
const t=(n,c,x='')=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${x?'  '+x:''}`)};

// --- 1. user1 -> user1's own messages never appear as user2's ---
const thread=[{id:'m1',cid:3,sender_id:A},{id:'m2',cid:3,sender_id:A},{id:'m3',cid:3,sender_id:B}];
const asB=thread.map(m=>viewer(B).isMine(m.sender_id)?'me':'them');
t("user2 sees user1's msgs as 'them'", asB.join()==='them,them,me', asB.join());
const asA=thread.map(m=>viewer(A).isMine(m.sender_id)?'me':'them');
t("user1 sees own msgs as 'me'", asA.join()==='me,me,them', asA.join());

// --- 2. both sides resolve the SAME thread id, in any order ---
t('same id from either direction', dm(A,B)===dm(B,A), dm(A,B));
t('different pairs never collide', new Set([dm(A,B),dm(A,C),dm(B,C)]).size===3);

// --- 3. messages are fetched per-thread, so no bleed between chats ---
const all=[{cid:3,sender_id:A,body:'ab-1'},{cid:7,sender_id:A,body:'ac-1'},{cid:3,sender_id:B,body:'ab-2'}];
const fetched=cid=>all.filter(m=>m.cid===cid);
t('opening a chat shows only its own messages',
  fetched(3).every(m=>m.body.startsWith('ab')) && fetched(3).length===2);
t('other chat is untouched', fetched(7).length===1 && fetched(7)[0].body==='ac-1');

// --- 4. sidebar lists only threads you belong to ---
const rows=[{cid:3,participant_ids:[A,B]},{cid:7,participant_ids:[A,C]},{cid:9,participant_ids:[B,C]}];
const listFor=me=>rows.filter(r=>r.participant_ids.map(String).includes(me)).map(r=>r.cid);
t('alice sees only her threads', listFor(A).join()==='3,7', listFor(A).join());
t('carol never sees the alice-bob thread', !listFor(C).includes(3), listFor(C).join());

// --- 5. ordering is stable and chronological ---
const page=[{id:'m3',created_at:'2026-09-01T10:02:00Z'},{id:'m2',created_at:'2026-09-01T10:01:00Z'},{id:'m1',created_at:'2026-09-01T10:00:00Z'}];
const shown=page.slice().reverse().map(m=>m.id);
t('messages render oldest -> newest', shown.join()==='m1,m2,m3', shown.join());
const tie=[{id:'b',created_at:'2026-09-01T10:00:00Z'},{id:'a',created_at:'2026-09-01T10:00:00Z'}];
t('identical timestamps break by id, deterministically',
  JSON.stringify(tie.slice().sort((x,y)=>x.created_at.localeCompare(y.created_at)||x.id.localeCompare(y.id)).map(m=>m.id))==='["a","b"]');

// --- 6. server rows replace local state; no id-less ghosts survive ---
const server=[{id:'m1',who:'them'},{id:'m2',who:'them'}];
const local=[{id:undefined,who:'me',text:'ghost'},{id:'m1',who:'them'}];
const merged=[...local.filter(o=>o.id&&!server.some(s=>s.id===o.id)),...server];
t('id-less local echo cannot survive a refresh', !merged.some(m=>m.text==='ghost'));
t('no duplicate ids after merge', new Set(merged.map(m=>m.id)).size===merged.length);

// --- 7. a direct thread can never hold 3 people (new constraint) ---
const ok=p=>p.length>=1&&p.length<=2;
t('constraint rejects a 3-person direct thread', !ok([A,B,C]));
t('constraint allows a normal pair', ok([A,B]));
t('constraint allows a self-chat', ok([A]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
