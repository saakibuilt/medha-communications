/* GENERATED — do not edit.
   Copy of Medha Hub's themes/halloween/collection.js. Edit "Medha Hub/themes/halloween/collection.js" and run
   scripts-sync-theme.mjs. */
/* ===========================================================================
   A Medha THEME COLLECTION, in one file.

   A collection is a seasonal skin: it keeps the layout, type and spacing of
   the Original theme and only changes colours and artwork. Everything this
   one needs is below — the light palette, the dark palette, and the images.

   TO MAKE A NEW COLLECTION
     1. Copy this file to collection-<name>.js.
     2. Change `name` (lowercase, no spaces) and `label`.
     3. Change the colours under `light` and `dark`. Every name that appears
        in Medha Hub's theme.css can be overridden here; anything you leave
        out keeps its Original value.
     4. Drop your artwork in assets/<name>-props/ and assets/<name>-characters/
        and point `images` at it.
     5. Load it in the page head, after theme.js:
            <script src="collection-<name>.js"></script>
        and add it to the TARGETS list in scripts-sync-theme.mjs so every app
        gets it too.
     6. Switch to it from Hub Tools, or with
            MedhaTheme.setCollection("<name>")

   Nothing else in the codebase needs to change: the runtime at the foot of
   this file turns the definition into the CSS the pages read, and the scene
   script takes its artwork from `images`.
   =========================================================================== */
(function (global) {
  "use strict";

  var COLLECTION = {
    /* What MedhaTheme.setCollection() is called with, and what
       <html data-theme-collection="..."> carries. */
    name: "halloween",
    label: "Halloween",

    /* ---- COLOURS -----------------------------------------------------------
       Light mode. These override Medha Hub's theme.css while this collection
       is on; leave a name out and the Original value shows through. */
    light: {
      "--canvas": "#f6eee8",
      "--surface": "#fffaf7",
      "--surface-raised": "#fffdfb",
      "--surface-hover": "#fff0d5",
      "--surface-sunken": "#fff7ec",
      "--border": "#e0b8ad",
      "--border-strong": "#b82929",
      "--text": "#241016",
      "--text-secondary": "#68444c",
      "--text-muted": "#9b7187",
      "--brand": "#ce0505",
      "--brand-hover": "#9f0303",
      "--brand-active": "#700000",
      "--brand-soft-bg": "#f5e5ff",
      "--brand-soft-fg": "#5b1c6f",
      "--brand-ring": "rgba(124, 45, 143, .35)",
      "--header-background": "linear-gradient(115deg,#090509 0%,#25040a 46%,#ce0505 130%)",
      "--brand-solid": "#ce0505",
      "--brand-solid-deep": "#900000",
      "--brand-solid-bright": "#ff3930",
      "--accent": "var(--brand)",
      "--accent-dark": "var(--brand-hover)",
      "--accent-deep": "var(--brand-active)",
      "--accent-light": "#f5e5ff",
      "--accent-faint": "#fff0fb",
      "--warning-bg": "#fff0c5",
      "--warning-fg": "#9a4d00",
      "--danger-bg": "#ffe0db",
      "--danger-fg": "#9e2c20",
      "--info-bg": "#eee4ff",
      "--info-fg": "#5b2d91",
      "--brand-tint": "#fff0fb",
      "--brand-tint-strong": "#f5e5ff",
      "--tint-orange-bg": "#fff0d5",
      "--tint-orange-fg": "#b65000",
      "--tint-violet-bg": "#f5e5ff",
      "--tint-violet-fg": "#6a2784",
      "color-scheme": "light",
    },

    /* Dark mode. Same names, the values this collection wears on black. */
    dark: {
      "--canvas": "#070609",
      "--surface": "#130d12",
      "--surface-raised": "#1d1118",
      "--surface-hover": "#29131c",
      "--surface-sunken": "#050407",
      "--border": "#54242a",
      "--border-strong": "#8d3133",
      "--text": "#fff4ed",
      "--text-secondary": "#d4b8b4",
      "--text-muted": "#a98faf",
      "--brand": "#ef2a20",
      "--brand-hover": "#ff5247",
      "--brand-active": "#a80404",
      "--brand-soft-bg": "#3a1c49",
      "--brand-soft-fg": "#ffc06a",
      "--brand-ring": "rgba(255, 158, 61, .48)",
      "--header-background": "linear-gradient(115deg,#040405 0%,#190207 46%,#900000 100%)",
      "--brand-solid": "#ce0505",
      "--brand-solid-deep": "#850000",
      "--brand-solid-bright": "#ff4a40",
      "--accent": "var(--brand)",
      "--accent-dark": "var(--brand-hover)",
      "--accent-deep": "var(--brand-active)",
      "--accent-light": "#3a1c49",
      "--accent-faint": "#22112f",
      "--warning-bg": "#3b280e",
      "--warning-fg": "#ffd27d",
      "--danger-bg": "#481d2b",
      "--danger-fg": "#ffb4a8",
      "--info-bg": "#2b1f4a",
      "--info-fg": "#d5b9ff",
      "--brand-tint": "#281536",
      "--brand-tint-strong": "#3a1c49",
      "--tint-orange-bg": "#42220f",
      "--tint-orange-fg": "#ffc06a",
      "--tint-violet-bg": "#35204a",
      "--tint-violet-fg": "#dfc2ff",
      "color-scheme": "dark",
    },

    /* ---- ARTWORK -----------------------------------------------------------
       Cut-out PNGs with transparent backgrounds. `props` are the small objects
       that sit around the app grid; `characters` are the figures that perch on
       the tiles, named by the pose ids in halloween-layout.mjs. */
    images: {
      props: {
        folder: "themes/halloween/assets/props",
        items: ["pumpkin", "lights", "candy", "tools", "raven"]
      },
      characters: {
        folder: "themes/halloween/assets/characters"
      }
    },

    /* ---- SCENE -------------------------------------------------------------
       How busy the decoration is. Leave `scene` out entirely for a collection
       that only changes colours. */
    scene: {
      script: "themes/halloween/scene.js",
      /* Figures on tiles at once, at most. */
      cast: 3,
      /* Drifting particles across the page. */
      drift: 14
    }
  };

  /* ===========================================================================
     RUNTIME — the same for every collection. Copy it along with the file and
     leave it alone; it only turns the definition above into CSS and publishes
     it for the scene script.
     =========================================================================== */
  function rules(collection) {
    var attr = '[data-theme-collection="' + collection.name + '"]';
    var out = [];
    var block = function (selector, tokens) {
      var body = [];
      for (var name in tokens) {
        if (Object.prototype.hasOwnProperty.call(tokens, name)) {
          body.push(name + ":" + tokens[name]);
        }
      }
      if (body.length) out.push(selector + "{" + body.join(";") + "}");
    };
    block(":root" + attr, collection.light);
    block(':root[data-theme="dark"]' + attr, collection.dark);
    return out.join("\n");
  }

  function install(collection) {
    var id = "medha-collection-" + collection.name;
    var style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      // After theme.css so these win, before the page paints.
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = rules(collection);
  }

  install(COLLECTION);

  global.MedhaCollections = global.MedhaCollections || {};
  global.MedhaCollections[COLLECTION.name] = COLLECTION;
})(typeof window !== "undefined" ? window : globalThis);
