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
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(clients=>{
    const existing=clients.find(client=>"focus" in client);
    return existing?existing.focus():self.clients.openWindow(target);
  }));
});
