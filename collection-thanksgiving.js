/* GENERATED — do not edit.
   Copy of Medha Hub's themes/thanksgiving/collection.js. Edit "Medha Hub/themes/thanksgiving/collection.js" and run
   scripts-sync-theme.mjs. */
/* ===========================================================================
   THANKSGIVING — a Medha theme set, in one file.

   A copy of themes/halloween/collection.js with a harvest palette and
   Thanksgiving props. Medha red stays the brand signal; everything around it
   turns to cream, amber and cranberry.

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
    name: "thanksgiving",
    label: "Thanksgiving",

    /* ---- COLOURS -----------------------------------------------------------
       Light mode. These override Medha Hub's theme.css while this collection
       is on; leave a name out and the Original value shows through. */
    light: {
      "color-scheme": "light",
      "--canvas": "#fdf3e3",
      "--surface": "#fffaf1",
      "--surface-raised": "#fffdf8",
      "--surface-hover": "#fbeed2",
      "--surface-sunken": "#f7ecd8",
      "--border": "#e8cda2",
      "--border-strong": "#c9922f",
      "--text": "#3b2415",
      "--text-secondary": "#7a5a3c",
      "--text-muted": "#a78660",
      "--brand": "#ce0505",
      "--brand-hover": "#a80404",
      "--brand-active": "#870404",
      "--brand-soft-bg": "#fdeadf",
      "--brand-soft-fg": "#9a3412",
      "--brand-ring": "rgba(206, 5, 5, .32)",
      "--header-background": "linear-gradient(120deg, #6b2708 0%, #b8500f 46%, #e0a129 100%)",
      "--brand-solid": "#ce0505",
      "--brand-solid-deep": "#a80404",
      "--brand-solid-bright": "#e0782a",
      "--accent": "var(--brand)",
      "--accent-dark": "var(--brand-hover)",
      "--accent-deep": "var(--brand-active)",
      "--accent-light": "#fdeadf",
      "--accent-faint": "#fff6ec",
      "--warning-bg": "#fdecc4",
      "--warning-fg": "#8a5108",
      "--danger-bg": "#fbe0d8",
      "--danger-fg": "#9e2c20",
      "--info-bg": "#e7efdc",
      "--info-fg": "#4d6b22",
      "--success-bg": "#e4eed2",
      "--success-fg": "#4d7018",
      "--brand-tint": "#fff4e7",
      "--brand-tint-strong": "#fbe2cb",
      "--tint-orange-bg": "#fbe6c8",
      "--tint-orange-fg": "#a8530c",
      "--tint-amber-bg": "#fdecc4",
      "--tint-amber-fg": "#8a5108",
      "--tint-rose-bg": "#fadfd8",
      "--tint-rose-fg": "#a52a1c",
      "--tint-violet-bg": "#ece2f2",
      "--tint-violet-fg": "#6a4a86",
      "--shadow-color": "#3b2415",
      "--scrim": "#3b2415",
    },

    /* Dark mode: embers, cocoa and candlelight. */
    dark: {
      "color-scheme": "dark",
      "--canvas": "#140d08",
      "--surface": "#1f1610",
      "--surface-raised": "#2b1f15",
      "--surface-hover": "#372617",
      "--surface-sunken": "#0f0a06",
      "--border": "#54361f",
      "--border-strong": "#8a5a2c",
      "--text": "#fdf1e0",
      "--text-secondary": "#d6b992",
      "--text-muted": "#a98a68",
      "--brand": "#e0782a",
      "--brand-hover": "#f2a03c",
      "--brand-active": "#a8530c",
      "--brand-soft-bg": "#3a2412",
      "--brand-soft-fg": "#f2c235",
      "--brand-ring": "rgba(224, 120, 42, .46)",
      "--header-background": "linear-gradient(120deg, #0d0906 0%, #3a1a08 48%, #b8500f 100%)",
      "--brand-solid": "#ce0505",
      "--brand-solid-deep": "#a80404",
      "--brand-solid-bright": "#e0782a",
      "--accent": "var(--brand)",
      "--accent-dark": "var(--brand-hover)",
      "--accent-deep": "var(--brand-active)",
      "--accent-light": "#3a2412",
      "--accent-faint": "#241708",
      "--warning-bg": "#3b2a0c",
      "--warning-fg": "#f2c235",
      "--danger-bg": "#42190f",
      "--danger-fg": "#ffb4a8",
      "--info-bg": "#25300f",
      "--info-fg": "#bcd67a",
      "--success-bg": "#24300f",
      "--success-fg": "#a7cc5e",
      "--brand-tint": "#2b1f15",
      "--brand-tint-strong": "#3a2412",
      "--tint-orange-bg": "#3d2109",
      "--tint-orange-fg": "#f2b06a",
      "--tint-amber-bg": "#3b2a0c",
      "--tint-amber-fg": "#f2c235",
      "--tint-rose-bg": "#3c1a14",
      "--tint-rose-fg": "#ffb0a0",
      "--tint-violet-bg": "#2b2237",
      "--tint-violet-fg": "#cbb2e0",
      "--shadow-color": "#000000",
      "--scrim": "#000000",
    },

    /* ---- ARTWORK -----------------------------------------------------------
       Cut-out PNGs with transparent backgrounds. `props` are the small objects
       that drift behind the app grid. */
    images: {
      props: {
        folder: "themes/thanksgiving/assets/props",
        /* Photoreal cut-outs, same treatment as Halloween's. assets/README.md
           lists what each file should be; the scene skips any that are not
           there yet, so the theme works on its colours until they land. */
        items: ["turkey", "pie", "corn", "cornucopia", "gourds", "wheat", "candles"]
      }
      /* No `characters` yet — live turkeys on the tiles want a pose library
         like themes/halloween/layout.mjs. See assets/README.md. */
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
