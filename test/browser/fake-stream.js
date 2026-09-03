/* Minimal stand-in for stream-chat: enough surface for app.js to boot and
   for the feature tests to observe which SDK calls were made. */
const calls=[];
globalThis.__streamCalls=calls;
function makeChannel(type,id,data){
  const handlers={};
  const ch={
    type,id,cid:`${type}:${id}`,data:{...(data||{})},
    state:{messages:[],members:{},read:{},membership:{}},
    on(name,fn){(handlers[name]??=[]).push(fn);return {unsubscribe(){}}},
    _handlerNames(){return Object.keys(handlers)},
    _emit(name,event){(handlers[name]||[]).forEach(fn=>fn(event))},
    async watch(){calls.push(["watch",ch.cid]);return ch.state},
    async query(){calls.push(["query",ch.cid]);return {messages:ch.state.messages}},
    async markRead(){calls.push(["markRead",ch.cid])},
    async sendMessage(m){calls.push(["sendMessage",ch.cid,m]);
      const saved={...m,id:m.id||"m_"+(calls.length),user:{id:globalThis.__meId||"u_me"},created_at:new Date().toISOString()};
      ch.state.messages.push(saved);return {message:saved}},
    /* Mirrors the server contract: sendReaction takes a Reaction OBJECT and
       deleteReaction takes a reaction TYPE STRING. Passing the wrong shape
       throws here, the way Stream rejects it in production. */
    async sendReaction(mid,reaction,opts){
      if(typeof reaction!=="object"||reaction===null||typeof reaction.type!=="string")
        throw Error('StreamChat error code 4: SendReaction failed with error: "expected object for field \"reaction\" but got string"');
      calls.push(["sendReaction",mid,reaction,opts])},
    async deleteReaction(mid,type,uid){
      if(typeof type!=="string")throw Error("deleteReaction expects a reaction type string");
      calls.push(["deleteReaction",mid,type,uid])},
    async getReplies(pid,opts){calls.push(["getReplies",pid,opts]);return {messages:globalThis.__threadReplies||[]}},
    async archive(){calls.push(["archive",ch.cid]);ch.data.archived=true},
    async unarchive(){calls.push(["unarchive",ch.cid]);ch.data.archived=false},
    async keystroke(){calls.push(["keystroke",ch.cid])},
    async stopTyping(){calls.push(["stopTyping",ch.cid])},
    countUnread(){return 0},
    countUnreadMentions(){return ch.__mentions||0},
  };
  return ch;
}
globalThis.__fakeChannel=(type,id)=>StreamChat.instance.channel(type,id);
export class StreamChat{
  static instance=null;
  constructor(key){this.key=key;this.channels={};this.listeners={};this.tokenManager={token:"tok"}}
  /* Each page gets its own instance. The module is re-evaluated per page in
     a browser, but the spec reuses one module across pages, so the singleton
     is keyed to the page's own globalThis. */
  static getInstance(key){return StreamChat.instance??=new StreamChat(key)}
  async connectUser(user){this.user=user;globalThis.__meId=user.id;calls.push(["connectUser",user.id]);return {me:user}}
  on(name,fn){(this.listeners[name]??=[]).push(fn);return {unsubscribe(){}}}
  _emit(name,event){(this.listeners[name]||[]).forEach(fn=>fn(event))}
  channel(type,id,data){const cid=`${type}:${id}`;return this.channels[cid]??=makeChannel(type,id,data)}
  async queryChannels(){calls.push(["queryChannels"]);return Object.values(this.channels)}
  async updateMessage(m){calls.push(["updateMessage",m]);return m}
  async deleteMessage(id){calls.push(["deleteMessage",id])}
  async pinMessage(id){calls.push(["pinMessage",id])}
  async unpinMessage(id){calls.push(["unpinMessage",id])}
  async createPoll(p){return {id:"poll_1",...p}}
  async getPoll(id){return {id}}
  async castPollVote(){}
  async removePollVote(){}
  async upsertUsers(){}
}
export default StreamChat;
