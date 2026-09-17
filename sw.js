self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?.json()||{}}catch{data={body:event.data?.text()||"You have a new Medha notification."}}
  event.waitUntil(self.registration.showNotification(data.title||"Medha",{
    body:data.body||"You have a new notification.",
    icon:"/medha-circular.png",
    badge:"/medha-circular.png",
    tag:data.tag||"medha-communications",
    renotify:true,
    data:{url:data.url||"https://medha-communications.vercel.app/"},
    vibrate:[250,100,250]
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"https://medha-communications.vercel.app/";
  /* The target is the Hub's deep link into this conversation
     (medha-hub.web.app/?open_chat=<cid>). This used to focus whatever window
     it could find and drop the URL entirely - and matchAll only ever returns
     THIS origin's windows, never the Hub's - so tapping a message notification
     surfaced some already-open Space tab on whatever chat it happened to be
     showing, instead of the conversation that was tapped.

     Reuse a window only when it is on the target's own origin, and navigate it
     to the target when it is somewhere else. Otherwise open the link. */
  event.waitUntil((async()=>{
    let targetOrigin;
    try{targetOrigin=new URL(target).origin}catch{targetOrigin=null}
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const reusable=targetOrigin&&windows.find(client=>{
      try{return new URL(client.url).origin===targetOrigin&&"focus" in client}catch{return false}
    });
    if(reusable){
      if(reusable.url!==target&&typeof reusable.navigate==="function"){
        const moved=await reusable.navigate(target).catch(()=>null);
        if(moved)return moved.focus();
      }
      return reusable.focus();
    }
    return self.clients.openWindow(target);
  })());
});
