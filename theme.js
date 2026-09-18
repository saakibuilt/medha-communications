/* GENERATED — do not edit.
   Copy of Medha Hub's theme.js, the single source of truth for every Medha app's
   active theme. Edit "Medha Hub/theme.js"
   and run scripts-sync-theme.mjs. */
/* ============================================================================
   Medha — the single source of truth for the ACTIVE theme.

   This file lives in Medha Hub next to theme.css (which holds the colours) and
   is copied into every application by scripts-sync-theme.mjs. It owns one job:
   deciding, applying, storing and propagating whether Medha is in light or
   dark mode, identically in Hub, ClockIn, Warehouse, Activities, Users, Space,
   News & Events, Files Storage, Grants and Marketing.

   Load it in <head>, before any stylesheet, so the page never paints the
   wrong theme:

       <script src="theme.js"></script>

   The contract:
     • Light mode  = no attribute on <html>.
     • Dark mode   = <html data-theme="dark">.
     • The choice is stored in localStorage under "medha-theme".
     • ?theme=dark|light (query or hash) seeds an app opened from Hub with the
       theme Hub is showing, and is then saved like any other choice — the
       apps live on separate origins and cannot share localStorage.
     • ?theme-preview=dark|light forces a load WITHOUT saving: a preview frame
       must never change what this device has chosen.

   API — window.MedhaTheme:
     get()            "dark" | "light" — what is on screen now.
     stored()         the saved choice, or null when the device has never set one.
     set(theme)       apply and save; returns the theme applied.
     toggle()         flip and save; returns the new theme.
     bind(el)         wire a button: click toggles, aria-label/title stay right.
     decorate(url)    add ?theme= to a link so another app opens in this theme.
     subscribe(fn)    call fn(theme) on every change, including from other tabs.
   ========================================================================= */
(function (global) {
  "use strict";

  var STORAGE_KEY = "medha-theme";
  var ATTR = "data-theme";
  var FORCED_ATTR = "data-theme-forced";
  var EVENT = "medha-theme-change";
  var root = document.documentElement;
  var listeners = [];

  function readStored() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === "dark" || value === "light" ? value : null;
    } catch (error) {
      // Private mode, or storage blocked: the theme still works, it just
      // cannot be remembered.
      return null;
    }
  }

  function write(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      /* not fatal — see readStored */
    }
  }

  function urlTheme(param) {
    var search = new URLSearchParams(location.search).get(param);
    if (search === "dark" || search === "light") return search;
    // Hub's ClockIn launch puts its payload in the hash, so look there too.
    var hash = new URLSearchParams(location.hash.replace(/^#/, "")).get(param);
    return hash === "dark" || hash === "light" ? hash : null;
  }

  /* A preview frame is shown in a theme without adopting it. */
  function forcedTheme() { return urlTheme("theme-preview"); }

  /* An app opened from Hub is seeded with the theme Hub is showing, and keeps
     it like any other saved choice. */
  function seededTheme() { return urlTheme("theme"); }

  function systemTheme() {
    try {
      return global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch (error) {
      return "light";
    }
  }

  function apply(theme) {
    if (theme === "dark") root.setAttribute(ATTR, "dark");
    else root.removeAttribute(ATTR);
    return theme;
  }

  function current() {
    return root.getAttribute(ATTR) === "dark" ? "dark" : "light";
  }

  function announce(theme) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](theme); } catch (error) { /* one bad listener never stops the rest */ }
    }
    try {
      global.dispatchEvent(new CustomEvent(EVENT, { detail: { theme: theme } }));
    } catch (error) {
      /* very old browsers: the subscribe() callbacks above already ran */
    }
  }

  // Decide and paint immediately — this runs before the page has any content.
  var forced = forcedTheme();
  var seeded = forced ? null : seededTheme();
  apply(forced || seeded || readStored() || systemTheme());
  if (forced) root.setAttribute(FORCED_ATTR, forced);
  if (seeded) write(seeded);

  var MedhaTheme = {
    STORAGE_KEY: STORAGE_KEY,
    EVENT: EVENT,

    get: current,
    stored: readStored,
    /* True when this load is a preview forced by the URL. Such a page must
       never overwrite the saved choice. */
    isForced: function () { return !!forced; },

    set: function (theme) {
      var next = theme === "dark" ? "dark" : "light";
      apply(next);
      if (!forced) write(next);
      announce(next);
      return next;
    },

    toggle: function () {
      return MedhaTheme.set(current() === "dark" ? "light" : "dark");
    },

    bind: function (el) {
      if (!el) return;
      var label = function () {
        var text = current() === "dark" ? "Switch to light mode" : "Switch to dark mode";
        el.setAttribute("aria-label", text);
        el.setAttribute("title", text);
      };
      label();
      el.addEventListener("click", function () { MedhaTheme.toggle(); });
      MedhaTheme.subscribe(label);
    },

    /* Hand the current theme to another Medha app on another origin, where
       localStorage cannot be shared. Pass preview:true for a frame that must
       show a theme without the app adopting it. */
    decorate: function (url, options) {
      try {
        var target = new URL(url, location.href);
        target.searchParams.set(options && options.preview ? "theme-preview" : "theme", current());
        return target.href;
      } catch (error) {
        return url;
      }
    },

    subscribe: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
      return function () {
        var index = listeners.indexOf(fn);
        if (index > -1) listeners.splice(index, 1);
      };
    },
  };

  // Another tab of the same app changed the theme: follow it.
  global.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY || forced) return;
    var next = event.newValue === "dark" ? "dark" : "light";
    if (next === current()) return;
    apply(next);
    announce(next);
  });

  global.MedhaTheme = MedhaTheme;
})(typeof window !== "undefined" ? window : globalThis);
