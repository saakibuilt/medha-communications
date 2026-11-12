/* Medha first-run tour: dims the page, outlines the real control and floats a
   Back / Next / Skip box beside it. Each step's find() may perform the click it
   describes (open a tab, a card…) before returning the element to highlight;
   steps whose element is missing for this user are skipped. Anything a step
   adds for illustration carries data-tour-demo and is removed when the tour
   ends. Shown once per key (per user, per browser).

   MedhaTour.start({ key, steps:[{ title, text, mobileText?, find }], force? })
   MedhaTour.help(run) adds the floating "?" button that replays the tour.
   Shared copy: clockin, medha communications stream, medha-users, medha-grants. */
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0;
  async function wait(find, ms = 5000) {
    const get = typeof find === "string" ? () => document.querySelector(find) : find;
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
      const el = get();
      if (visible(el)) return el;
    }
    return null;
  }
  const mobile = (width = 1023) => matchMedia(`(max-width: ${width}px)`).matches;
  const seen = key => { try { return !!localStorage.getItem(key); } catch { return true; } };

  const CSS = `
.mt-layer{position:fixed;inset:0;z-index:2147483000}
.mt-spot{position:fixed;border-radius:12px;pointer-events:none;transition:left .25s,top .25s,width .25s,height .25s;
  box-shadow:0 0 0 3px var(--brand-solid-bright,#ce0505),0 0 0 9999px rgba(15,23,42,.58)}
.mt-spot.mt-none{left:50%!important;top:50%!important;width:0!important;height:0!important;box-shadow:0 0 0 9999px rgba(15,23,42,.58)}
.mt-pop{position:fixed;box-sizing:border-box;padding:16px 18px;border-radius:14px;background:var(--surface,#fff);color:var(--text,#1c1016);
  border:1px solid rgba(206,5,5,.18);box-shadow:0 18px 50px rgba(0,0,0,.35);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:left .25s,top .25s}
.mt-count{margin:0;color:var(--brand-solid-bright,#ce0505);font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.mt-pop h2{margin:4px 0 6px;font-size:17px;line-height:1.3;color:inherit}
.mt-text{margin:0 0 14px;color:var(--text-soft,#64748b)}
.mt-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}.mt-nav{display:flex;gap:8px}
.mt-pop button{font:inherit;font-weight:700;border-radius:8px;cursor:pointer;min-height:38px;padding:8px 16px}
.mt-skip{border:0;background:none;color:var(--brand-solid-bright,#ce0505);padding:8px 4px!important}
.mt-back{border:1px solid rgba(206,5,5,.3);background:transparent;color:inherit}
.mt-next{border:0;background:var(--brand-solid-bright,#ce0505);color:#fff}
.mt-pop button:disabled{opacity:.5;cursor:default}
.mt-help{position:fixed;right:var(--mt-help-right,18px);bottom:var(--mt-help-bottom,18px);z-index:2147482000;width:36px;height:36px;border-radius:50%;
  border:1px solid rgba(206,5,5,.25);background:var(--surface,#fff);color:var(--brand-solid-bright,#ce0505);font:800 17px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer;display:grid;place-items:center;padding:0}
.mt-help:hover{background:var(--brand-solid-bright,#ce0505);color:#fff}
@media print{.mt-help{display:none}}
.mt-guide{display:inline-flex;align-items:center;gap:9px;align-self:flex-start;margin:10px 14px;padding:6px 14px 6px 6px;border-radius:999px;
  border:1.5px dashed color-mix(in srgb,currentColor 55%,transparent);background:color-mix(in srgb,currentColor 7%,transparent);color:var(--text,#111);
  font:700 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;text-decoration:none;transition:background .15s}
.mt-guide:hover,.mt-guide:focus-visible{background:color-mix(in srgb,currentColor 16%,transparent);border-style:solid;outline:none}
.mt-guide-icon{flex:none;display:grid;place-items:center;width:24px;height:24px;border-radius:50%;border:2px solid currentColor;font-size:14px;font-weight:900;line-height:1}
.mt-guide.mt-push{margin-top:auto}
.mt-guide.mt-compact{align-self:center;margin-left:auto;margin-right:auto;padding:6px;gap:0}
.mt-guide.mt-compact span:last-child{display:none}
.mt-guide.mt-rail{flex-direction:column;gap:3px;align-self:center;margin:6px auto;padding:6px 6px 5px;border-radius:14px;font-size:10.5px}
/* Same "?" as Tasks everywhere: color:var(--text) flips with the theme on its own, no separate dark-mode patch needed. */.mt-guide-icon{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
@media(pointer:coarse){.mt-pop button{min-height:44px}}
[data-tour-demo]{outline:2px dashed var(--brand-solid-bright,#ce0505);outline-offset:2px}`;

  function clearDemos() {
    const docs = [document, ...[...document.querySelectorAll("iframe")].map(frame => { try { return frame.contentDocument; } catch { return null; } })];
    docs.forEach(doc => doc?.querySelectorAll("[data-tour-demo]").forEach(node => node.remove()));
  }

  function addStyle() {
    if (document.getElementById("mt-style")) return;
    const style = document.createElement("style");
    style.id = "mt-style"; style.textContent = CSS;
    document.head.append(style);
  }
  // A step without find() still points at something: the page's title.
  const home = () => [...document.querySelectorAll("#page-title, .page-heading h1, main h1, h1")].find(visible) || null;

  function start({ key, steps, onEnd, force = false }) {
    if (!key || (!force && seen(key)) || document.querySelector(".mt-layer")) return false;
    addStyle();
    // Every tour ends on a step that always shows, so skipping a role's missing
    // last steps lands here instead of on a step with nothing to point at.
    // Only the steps for this user: skip() rules a step out up front (e.g. a page this
    // role doesn't have), and a step whose control turns out to be missing is dropped
    // as the tour goes, so "Step 1 of N" counts what this user actually sees.
    steps = [...steps.filter(item => { try { return !item.skip?.(); } catch { return true; } }),
      { title:"You're all set", text:"Tap <b>? How to use</b> at the bottom of the menu any time to see this again." }];
    let step = 0, target = null, run = 0, frame = 0;
    const layer = document.createElement("div");
    layer.className = "mt-layer";
    layer.innerHTML = '<div class="mt-spot mt-none" aria-hidden="true"></div><div class="mt-pop" role="dialog" aria-modal="true" aria-labelledby="mt-title"></div>';
    const spot = layer.firstElementChild, pop = layer.lastElementChild;
    const finish = () => {
      try { localStorage.setItem(key, new Date().toISOString()); } catch {}
      cancelAnimationFrame(frame); layer.remove(); document.removeEventListener("keydown", onKey); clearDemos(); onEnd?.();
    };
    function onKey(event) { if (event.key === "Escape") finish(); }
    // Follow the target through scrolling, resizing and layout changes.
    const place = () => {
      frame = requestAnimationFrame(place);
      const vw = innerWidth, vh = innerHeight, gap = 12;
      let rect = null;
      if (visible(target)) {
        const r = target.getBoundingClientRect(), view = target.ownerDocument.defaultView;
        const offset = view !== window && view.frameElement ? view.frameElement.getBoundingClientRect() : { left:0, top:0 };
        rect = { left:r.left + offset.left - 6, top:r.top + offset.top - 6, width:r.width + 12, height:r.height + 12 };
      }
      spot.classList.toggle("mt-none", !rect);
      if (rect) Object.assign(spot.style, { left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px` });
      const w = Math.min(340, vw - 24), h = pop.offsetHeight;
      let top = vh / 2 - h / 2, left = vw / 2 - w / 2;
      if (rect) {
        left = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, gap), vw - w - gap);
        top = rect.top + rect.height + gap + h <= vh - gap ? rect.top + rect.height + gap
          : rect.top - gap - h >= gap ? rect.top - gap - h
          : rect.top + rect.height / 2 - h / 2;
        // No room above or below a tall target: sit beside it instead of on top.
        if (top < rect.top + rect.height && top + h > rect.top) {
          if (rect.left + rect.width + gap + w <= vw - gap) left = rect.left + rect.width + gap;
          else if (rect.left - gap - w >= gap) left = rect.left - gap - w;
        }
      }
      top = Math.min(Math.max(top, gap), Math.max(gap, vh - h - gap));
      Object.assign(pop.style, { width:`${w}px`, left:`${left}px`, top:`${top}px` });
    };
    const render = busy => {
      const { title, text, mobileText } = steps[step], last = step === steps.length - 1;
      pop.innerHTML = `<p class="mt-count">Step ${step + 1} of ${steps.length}</p>
        <h2 id="mt-title">${title}</h2><p class="mt-text">${busy ? "Opening…" : (mobile() && mobileText) || text}</p>
        <div class="mt-foot"><button type="button" class="mt-skip" data-mt="skip">Skip</button>
          <span class="mt-nav">${step ? `<button type="button" class="mt-back" data-mt="back" ${busy ? "disabled" : ""}>Back</button>` : ""}
          <button type="button" class="mt-next" data-mt="next" ${busy ? "disabled" : ""}>${last ? "Done" : "Next"}</button></span></div>`;
      if (!busy) pop.querySelector('[data-mt="next"]').focus();
    };
    const go = async (to, direction = 1) => {
      const ticket = ++run;
      step = to; render(true);
      let found = null;
      try { found = steps[step].find ? await steps[step].find() : home(); } catch { found = null; }
      if (ticket !== run) return;
      // A step with find() but nothing to show for this user is skipped; a step
      // without find() is a centred message.
      if (steps[step].find && !visible(found)) {
        steps.splice(step, 1);
        const next = direction > 0 ? step : step - 1;
        if (next >= 0 && next < steps.length) return go(next, direction);
        return go(Math.min(Math.max(step, 0), steps.length - 1), 1);
      }
      found?.scrollIntoView({ block:"center", inline:"nearest" });
      await sleep(250);
      if (ticket !== run) return;
      target = found; render(false);
    };
    layer.addEventListener("click", event => {
      const action = event.target.closest("[data-mt]")?.dataset.mt;
      if (action === "skip" || (action === "next" && step === steps.length - 1)) finish();
      else if (action === "next") go(step + 1, 1);
      else if (action === "back") go(step - 1, -1);
    });
    document.addEventListener("keydown", onKey);
    document.body.append(layer);
    place();
    go(0);
    return true;
  }

  // Add an illustration-only element (removed when the tour ends).
  function demo(parent, html, { prepend = false, tag = "div", className = "" } = {}) {
    if (!parent) return null;
    const node = parent.ownerDocument.createElement(tag);
    node.dataset.tourDemo = "1";
    if (className) node.className = className;
    node.innerHTML = html;
    prepend ? parent.prepend(node) : parent.append(node);
    return node;
  }

  /* "How to use" help control that replays the tour: an outlined "?" with a label,
     placed at the bottom of the app's menu (into/before), deliberately unlike the
     menu items. rail:true stacks it for icon rails. Without a menu it falls back to
     a small floating "?". Re-attaches if the app re-renders its menu. */
  function help(run, { into, before, rail = false, push = false } = {}) {
    addStyle();
    const make = () => {
      const menu = typeof into === "function" ? into() : into;
      if (!menu) {
        if (document.querySelector(".mt-help, .mt-guide")) return;
        const button = document.createElement("button");
        button.type = "button"; button.className = "mt-help"; button.textContent = "?";
        button.title = "How to use this app"; button.setAttribute("aria-label", "How to use this app");
        button.addEventListener("click", () => run());
        document.body.append(button);
        return;
      }
      const existing = menu.querySelector(".mt-guide");
      // A collapsed (icon-only) menu shows just the "?".
      if (existing) { existing.classList.toggle("mt-compact", menu.getBoundingClientRect().width < 140); return; }
      const link = document.createElement("button");
      link.type = "button";
      link.className = `mt-guide${rail ? " mt-rail" : ""}${push ? " mt-push" : ""}`;
      link.title = "How to use this app — step-by-step guide";
      link.innerHTML = '<span class="mt-guide-icon" aria-hidden="true">?</span><span>How to use</span>';
      link.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); run(); });
      const anchor = typeof before === "function" ? before() : before;
      anchor && anchor.parentElement === menu ? menu.insertBefore(link, anchor) : menu.append(link);
    };
    make();
    setInterval(make, 1000);
  }

  window.MedhaTour = { start, wait, sleep, visible, mobile, seen, demo, clearDemos, help };
})();
