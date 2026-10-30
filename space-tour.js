/* First-run guide for Medha Space: every rail tab and the chat features, with
   a pretend chat/message when the user has none yet (removed afterwards).
   Uses the shared medha-tour.js engine; shown once per user per browser. */
(() => {
  const T = window.MedhaTour;
  if (!T || /[?#&]embed=1/.test(location.href)) return;
  const $ = selector => document.querySelector(selector);
  const vis = selector => T.wait(selector, 2500);
  const rail = view => $(`.rail-item[data-view="${view}"]`);
  async function show(view) {
    const item = rail(view);
    if (item && !item.classList.contains("active")) item.click();
    await T.sleep(400);
  }
  // A conversation to talk about: the first real one, else a pretend row.
  async function chatRow() {
    await show("chat");
    return await T.wait("#chat-list .chat-item:not(.search-person)", 1500)
      || T.demo($("#chat-list"), '<span class="avatar">KS</span><span><strong>Example: Kavya Sharma</strong><br><small>Your chats appear here</small></span>', { prepend:true, className:"chat-item" });
  }
  async function openChat() {
    const row = await chatRow();
    if (row && !row.dataset.tourDemo && !row.classList.contains("active")) { row.click(); await T.sleep(500); }
    return row;
  }
  async function messageBubble() {
    await openChat();
    return await T.wait("#message-area .message", 1500)
      || T.demo($("#message-area"), '<div class="message-body">Example message — hover (or long-press on a phone) a real message for its actions.</div>', { className:"message" });
  }

  const steps = [
    { title:"Welcome to Medha Space", text:"Messages, calls and your team in one place. This guide shows where everything is — tap <b>Next</b>, or <b>Skip</b> any time." },
    { title:"Chats", text:"<b>Chat</b> lists your direct and group conversations.", find:async () => (await show("chat"), rail("chat")) },
    { title:"Search", text:"Find a conversation or a person by name.", find:async () => (await show("chat"), vis("#chat-search")) },
    { title:"Filter your chats", text:"<b>All</b>, <b>Unread</b>, <b>Pinned</b> or <b>Archived</b> — one tap switches.", find:async () => (await show("chat"), (await vis(".tab"))?.parentElement) },
    { title:"Start a chat", text:"Message anyone at Medha — pick a person to open a direct chat.", find:async () => (await show("chat"), vis("#new-chat")) },
    { title:"Create a group", text:"Name a group and add members. Everyone in it sees the conversation.", find:async () => (await show("chat"), vis("#new-group")) },
    { title:"Open a conversation", text:"Tap any chat to open it. Unread chats show a count.", find:chatRow },
    { title:"Write a message", text:"Type here — <b>Enter</b> sends, <b>Shift + Enter</b> adds a new line. Mention someone with @.", find:async () => (await openChat(), vis("#message-input")) },
    { title:"Message tools", text:"Attach files and photos, add emoji or a GIF, or post a poll.", find:async () => (await openChat(), vis("#tools-more")) },
    { title:"Share from apps", text:"Attach a Task or a Warehouse entry as a live card. The apps listed depend on the access Admin/HR gave your role.", find:async () => (await openChat(), vis("#share-work-button")) },
    { title:"Draft with AI", text:"Let AI suggest a reply to the conversation — edit it before sending.", find:async () => (await openChat(), vis("#ai-reply")) },
    { title:"Calls", text:"Start an audio or video call with the people in this chat.", find:async () => (await openChat(), (await vis("#audio-call"))?.parentElement) },
    { title:"Message actions", text:"Hover a message (long-press on a phone) to react, reply in a thread, edit, forward or pin it.", find:messageBubble },
    { title:"Favorites", text:"<b>Favorites</b> keeps the people and chats you use most one tap away. Add one from a chat's details with ☆.", find:async () => vis(".rail-item:not([data-view])") },
    { title:"Calendar", text:"Your meetings by month. Open someone's details to see their calendar too.", find:async () => (await show("calendar"), (await vis("#calendar-grid")) || rail("calendar")) },
    { title:"Medha apps", text:"Open other Medha apps without leaving Space. You see the apps your role can use — Admin/HR manage this in Users → Application Access.", find:async () => (await show("chat"), vis("#workspace-launcher")) },
    { title:"Settings", text:"Your profile and status note, plus toggles for <b>online status</b>, <b>read receipts</b> and <b>message sounds</b>.", find:async () => (await show("settings"), (await vis("#setting-presence"))?.closest("label, .setting-row, .settings-row, li, div") || rail("settings")) },
    { title:"Light or dark", text:"Switch the theme any time. That's everything — you're all set!", find:async () => (await show("chat"), vis("#theme-toggle")) },
  ];

  (async () => {
    // Wait for an authorized launch to finish loading.
    const ready = await T.wait(() => !document.body.classList.contains("space-booting") && $("#launch-gate")?.hidden && $("#chat-list"), 60000);
    const who = $("#current-user")?.textContent.trim();
    if (!ready || !who || /authenticat|signed-in user/i.test(who)) return;
    await T.sleep(800);
    T.start({ key:`medha-space-tour-v1:${who}`, steps, onEnd:() => show("chat") });
  })();
})();
