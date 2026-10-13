// RepCord theme picker
// Loaded in the <head> so the saved theme is applied before the page is drawn.
(function () {
  var STORAGE_KEY = "repcord-theme";
  var root = document.documentElement;

  var names = {
    default: "Default",
    dark: "Dark",
    ocean: "Ocean",
    sunset: "Sunset"
  };

  var state = { theme: "default", color: "#39d353" };

  // ---------- color helpers ----------
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(c) {
    return "#" + [c.r, c.g, c.b].map(function (x) {
      return ("0" + Math.round(x).toString(16)).slice(-2);
    }).join("");
  }

  // h: 0-360, s and v: 0-1
  function hsvToRgb(h, s, v) {
    var c = v * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  function rgbToHsv(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: max ? d / max : 0, v: max };
  }

  // light colors get dark text on top, dark colors get white text
  function isLight(c) {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 150;
  }

  // Whole-page colors for a custom color: the background, cards, lines and text all
  // take the hue of the chosen color. Grey or white picks give neutral grey surfaces.
  var SURFACE_VARS = ["--bg", "--card", "--line", "--text", "--muted", "--nav-bg"];

  function surfaceColors(hex) {
    var hsv = rgbToHsv(hexToRgb(hex));
    var h = Math.round(hsv.h);
    var k = Math.min(1, hsv.s / 0.5); // how colorful the surfaces get (0 = grey)
    function hsl(s, l) { return "hsl(" + h + ", " + Math.round(s * k) + "%, " + l + "%)"; }
    return {
      "--bg": hsl(32, 5),
      "--card": hsl(28, 9),
      "--line": hsl(26, 17),
      "--text": hsl(40, 94),
      "--muted": hsl(18, 62),
      "--nav-bg": "hsla(" + h + ", " + Math.round(28 * k) + "%, 9%, 0.85)"
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  // ---------- apply the theme to the whole page ----------
  var applied = "";
  var glowTimer = 0;

  // The soft glow in the page background is a huge gradient, and the calendar has hundreds of
  // squares, so repainting them on every drag step is slow. They read their own colors
  // (--glow-rgb and --glow-accent) so they can trail behind a little while the user drags.
  // skipSurfaces = true while dragging: the page colors wait until the user pauses or lets go
  function syncGlow(skipSurfaces) {
    clearTimeout(glowTimer);
    glowTimer = 0;
    if (state.theme === "custom") {
      var c = hexToRgb(state.color);
      root.style.setProperty("--glow-rgb", c.r + ", " + c.g + ", " + c.b);
      root.style.setProperty("--glow-accent", state.color);
      if (!skipSurfaces) {
        var surfaces = surfaceColors(state.color);
        SURFACE_VARS.forEach(function (name) {
          root.style.setProperty(name, surfaces[name]);
        });
      }
    } else {
      root.style.removeProperty("--glow-rgb");
      root.style.removeProperty("--glow-accent");
      SURFACE_VARS.forEach(function (name) {
        root.style.removeProperty(name);
      });
    }
  }

  // live = true while the user is dragging: move the glow only every so often
  function apply(live) {
    var key = state.theme === "custom" ? "custom:" + state.color : state.theme;
    if (key === applied) return;          // nothing changed, skip the work
    applied = key;

    if (state.theme === "custom") {
      var c = hexToRgb(state.color);
      if (root.dataset.theme !== "custom") root.dataset.theme = "custom";
      root.style.setProperty("--accent", state.color);
      root.style.setProperty("--accent-rgb", c.r + ", " + c.g + ", " + c.b);
      root.style.setProperty("--on-accent", isLight(c) ? "#0b0d11" : "#ffffff");
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-rgb");
      root.style.removeProperty("--on-accent");
      root.dataset.theme = state.theme;
    }

    if (live) {
      if (!glowTimer) glowTimer = setTimeout(function () { syncGlow(true); }, 600);
    } else {
      syncGlow();
    }
  }

  // ---------- load the saved choice ----------
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      if (saved.theme === "custom" || names[saved.theme]) state.theme = saved.theme;
      if (/^#[0-9a-f]{6}$/i.test(saved.color)) state.color = saved.color.toLowerCase();
    }
  } catch (e) {}

  apply();

  // ---------- picker (runs once the page is ready) ----------
  document.addEventListener("DOMContentLoaded", function () {
    var picker = document.getElementById("themePicker");
    var themeBtn = document.getElementById("themeBtn");
    var panel = document.getElementById("themePanel");
    var themeName = document.getElementById("themeName");
    var wheelSwatch = document.getElementById("wheelSwatch");
    var swatches = document.querySelectorAll("#themePanel .swatch[data-theme]");

    var colorBox = document.getElementById("colorPicker");
    var wheel = document.getElementById("wheel");
    var thumb = document.getElementById("wheelThumb");
    var brightness = document.getElementById("brightness");
    var hexInput = document.getElementById("hexInput");
    var preview = document.getElementById("cpPreview");

    if (!picker) return;

    var hsv = rgbToHsv(hexToRgb(state.color));
    var wheelRect = null;

    // ----- redraw the controls (called at most once per frame) -----
    function renderControls() {
      swatches.forEach(function (s) {
        s.classList.toggle("active", s.dataset.theme === state.theme);
      });
      wheelSwatch.classList.toggle("active", state.theme === "custom");

      themeName.textContent =
        state.theme === "custom"
          ? "Custom color " + state.color.toUpperCase()
          : names[state.theme] + " theme";

      if (colorBox.hidden) return;

      var radius = (wheel.offsetWidth || 168) / 2;
      var angle = hsv.h * Math.PI / 180;
      var dist = hsv.s * radius;
      thumb.style.transform =
        "translate(" + (Math.sin(angle) * dist).toFixed(1) + "px," + (-Math.cos(angle) * dist).toFixed(1) + "px)";
      thumb.style.background = state.color;

      wheel.style.setProperty("--v", hsv.v.toFixed(3));
      colorBox.style.setProperty("--cp-full", rgbToHex(hsvToRgb(hsv.h, hsv.s, 1)));
      preview.style.background = state.color;

      if (document.activeElement !== brightness) brightness.value = Math.round(hsv.v * 100);
      if (document.activeElement !== hexInput) hexInput.value = state.color.toUpperCase();
    }

    // ----- many drag events can arrive per frame: do the real work once per frame -----
    var frame = 0, saveTimer = 0, liveTimer = 0, previewing = false;
    var PREVIEW_VARS = ["--accent", "--accent-rgb", "--on-accent"].concat(SURFACE_VARS);

    // While dragging, only the small color panel changes (cheap). The whole page,
    // with hundreds of calendar squares, is repainted once when the user lets go.
    function previewOnPanel() {
      previewing = true;
      var c = hexToRgb(state.color);
      var s = surfaceColors(state.color);
      panel.style.setProperty("--accent", state.color);
      panel.style.setProperty("--accent-rgb", c.r + ", " + c.g + ", " + c.b);
      panel.style.setProperty("--on-accent", isLight(c) ? "#0b0d11" : "#ffffff");
      SURFACE_VARS.forEach(function (name) {
        panel.style.setProperty(name, s[name]);
      });
    }

    // paints the chosen color on the whole page, once
    function commit() {
      clearTimeout(liveTimer);
      liveTimer = 0;
      if (!previewing) return;
      previewing = false;
      root.classList.add("theme-live");   // no transitions or blur during this one repaint
      apply();
      PREVIEW_VARS.forEach(function (name) {
        panel.style.removeProperty(name);
      });
      requestAnimationFrame(function () { root.classList.remove("theme-live"); });
    }

    function queue() {
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        previewOnPanel();
        renderControls();
        // dragging stopped for a moment: show the color on the whole page
        clearTimeout(liveTimer);
        liveTimer = setTimeout(commit, 450);
        // write to storage once the user pauses, not on every move
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 350);
      });
    }

    function setFromHsv() {
      state.theme = "custom";
      state.color = rgbToHex(hsvToRgb(hsv.h, hsv.s, hsv.v));
      queue();
    }

    // ----- theme buttons -----
    swatches.forEach(function (s) {
      s.addEventListener("click", function () {
        state.theme = s.dataset.theme;
        colorBox.hidden = true;
        apply();
        save();
        renderControls();
      });
    });

    // the rainbow circle opens (or closes) the color wheel
    wheelSwatch.addEventListener("click", function () {
      if (state.theme === "custom") {
        colorBox.hidden = !colorBox.hidden;
      } else {
        state.theme = "custom";
        hsv = rgbToHsv(hexToRgb(state.color));
        colorBox.hidden = false;
        apply();
        save();
      }
      renderControls();
    });

    // ----- the wheel: hue goes around, saturation goes from the middle outwards -----
    var dragging = false;

    function pick(e) {
      var dx = e.clientX - (wheelRect.left + wheelRect.width / 2);
      var dy = e.clientY - (wheelRect.top + wheelRect.height / 2);
      hsv.h = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      hsv.s = Math.min(1, Math.hypot(dx, dy) / (wheelRect.width / 2));
      setFromHsv();
    }

    wheel.addEventListener("pointerdown", function (e) {
      dragging = true;
      wheelRect = wheel.getBoundingClientRect();   // measured once, not on every move
      wheel.setPointerCapture(e.pointerId);
      pick(e);
      e.preventDefault();
    });

    wheel.addEventListener("pointermove", function (e) {
      if (dragging) pick(e);
    });

    function stopDrag() {
      dragging = false;
      commit();
    }
    wheel.addEventListener("pointerup", stopDrag);
    wheel.addEventListener("pointercancel", stopDrag);

    // ----- brightness slider -----
    brightness.addEventListener("input", function () {
      hsv.v = brightness.value / 100;
      setFromHsv();
    });

    brightness.addEventListener("change", commit);

    // ----- type a hex code -----
    hexInput.addEventListener("input", function () {
      var t = hexInput.value.trim();
      if (!/^#?[0-9a-f]{6}$/i.test(t)) return;
      if (t.charAt(0) !== "#") t = "#" + t;
      state.theme = "custom";
      state.color = t.toLowerCase();
      hsv = rgbToHsv(hexToRgb(state.color));
      queue();
    });

    hexInput.addEventListener("blur", function () {
      hexInput.value = state.color.toUpperCase();
    });

    // ----- open / close the panel -----
    themeBtn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        colorBox.hidden = state.theme !== "custom";
        renderControls();
      }
    });

    // clicking outside the picker, or pressing Escape, closes it.
    // (letting go of the mouse outside the panel after a drag must not count as "outside")
    var pressedInside = false;
    panel.addEventListener("pointerdown", function () { pressedInside = true; });
    document.addEventListener("pointerup", function () {
      setTimeout(function () { pressedInside = false; }, 0);
    });

    document.addEventListener("click", function (e) {
      if (pressedInside) return;
      if (!e.target.closest("#themePicker")) panel.hidden = true;
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") panel.hidden = true;
    });

    colorBox.hidden = state.theme !== "custom";
    renderControls();
  });
})();


// RepCord font picker
// The saved font is applied right away (this file is loaded in the <head>), so there is no flash.
(function () {
  var STORAGE_KEY = "repcord-font";
  var ALL_KEY = "repcord-font-all";
  var root = document.documentElement;
  var useForAll = false; // false = titles only, true = every text on the site

  // body = normal text, display = titles and big numbers, scale = size fix for the titles
  var FONTS = [
    { key: "gym", name: "Gym", scale: 1,
      body: '"Barlow", "Segoe UI", Arial, sans-serif',
      display: '"Barlow Condensed", "Barlow", "Segoe UI", Arial, sans-serif',
      load: [] }, // already loaded by index.html
    { key: "rounded", name: "Rounded", scale: 0.85,
      body: '"Nunito", "Segoe UI", Arial, sans-serif',
      display: '"Nunito", "Segoe UI", Arial, sans-serif',
      load: ["Nunito:wght@400;600;700;800"] },
    { key: "modern", name: "Modern", scale: 0.82,
      body: '"Poppins", "Segoe UI", Arial, sans-serif',
      display: '"Poppins", "Segoe UI", Arial, sans-serif',
      load: ["Poppins:wght@400;500;600;700"] },
    { key: "impact", name: "Impact", scale: 0.92,
      body: '"Roboto", "Segoe UI", Arial, sans-serif',
      display: '"Oswald", "Roboto", Arial, sans-serif',
      load: ["Roboto:wght@400;500;700", "Oswald:wght@500;600;700"] },
    { key: "tech", name: "Tech", scale: 0.75,
      body: '"Barlow", "Segoe UI", Arial, sans-serif',
      display: '"JetBrains Mono", ui-monospace, Consolas, monospace',
      load: ["JetBrains+Mono:wght@600;700;800"] },
    { key: "elegant", name: "Elegant", scale: 0.9,
      body: '"Lora", Georgia, serif',
      display: '"Playfair Display", Georgia, serif',
      load: ["Lora:wght@400;500;600;700", "Playfair+Display:wght@600;700;800"] },
    { key: "playful", name: "Playful", scale: 0.85,
      body: '"Fredoka", "Segoe UI", Arial, sans-serif',
      display: '"Fredoka", "Segoe UI", Arial, sans-serif',
      load: ["Fredoka:wght@400;500;600;700"] },
    { key: "poster", name: "Poster", scale: 1.1,
      body: '"Barlow", "Segoe UI", Arial, sans-serif',
      display: '"Bebas Neue", "Barlow Condensed", Impact, sans-serif',
      load: ["Bebas+Neue"] },
    { key: "sporty", name: "Sporty", scale: 1.05,
      body: '"Barlow", "Segoe UI", Arial, sans-serif',
      display: '"Teko", "Barlow Condensed", sans-serif',
      load: ["Teko:wght@500;600;700"] },
    { key: "future", name: "Future", scale: 0.65,
      body: '"Barlow", "Segoe UI", Arial, sans-serif',
      display: '"Orbitron", "Barlow", sans-serif',
      load: ["Orbitron:wght@600;700;800"] },
    { key: "pixel", name: "Pixel", scale: 0.5,
      body: '"Barlow", "Segoe UI", Arial, sans-serif',
      display: '"Press Start 2P", ui-monospace, monospace',
      load: ["Press+Start+2P"] },
    { key: "retro", name: "Retro", scale: 0.85,
      body: '"Nunito", "Segoe UI", Arial, sans-serif',
      display: '"Righteous", "Nunito", sans-serif',
      load: ["Nunito:wght@400;600;700;800", "Righteous"] },
    { key: "comic", name: "Comic", scale: 0.9,
      body: '"Nunito", "Segoe UI", Arial, sans-serif',
      display: '"Bangers", "Nunito", sans-serif',
      load: ["Nunito:wght@400;600;700;800", "Bangers"] },
    { key: "handwritten", name: "Handwritten", scale: 1,
      body: '"Patrick Hand", "Segoe UI", sans-serif',
      display: '"Patrick Hand", "Segoe UI", sans-serif',
      load: ["Patrick+Hand"] },
    { key: "slab", name: "Slab", scale: 0.8,
      body: '"Roboto Slab", Georgia, serif',
      display: '"Roboto Slab", Georgia, serif',
      load: ["Roboto+Slab:wght@400;500;700"] },
    { key: "soft", name: "Soft", scale: 0.85,
      body: '"Quicksand", "Segoe UI", Arial, sans-serif',
      display: '"Quicksand", "Segoe UI", Arial, sans-serif',
      load: ["Quicksand:wght@400;500;600;700"] },
    { key: "classic", name: "Classic", scale: 0.85,
      body: '"Inter", "Segoe UI", Arial, sans-serif',
      display: '"Inter", "Segoe UI", Arial, sans-serif',
      load: ["Inter:wght@400;500;600;700;800"] },
    { key: "plain", name: "Plain", scale: 0.85,
      body: 'system-ui, "Segoe UI", Arial, sans-serif',
      display: 'system-ui, "Segoe UI", Arial, sans-serif',
      load: [] }
  ];

  var current = FONTS[0];

  function find(key) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].key === key) return FONTS[i];
    return null;
  }

  // adds the Google Fonts link for one font (only once)
  function loadFont(f) {
    if (!f.load.length || document.getElementById("gf-" + f.key)) return;
    var link = document.createElement("link");
    link.id = "gf-" + f.key;
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=" + f.load.join("&family=") + "&display=swap";
    document.head.appendChild(link);
  }

  function apply(f) {
    current = f;
    loadFont(f);
    root.style.setProperty("--font-body", useForAll ? f.display : f.body);
    root.style.setProperty("--font-display", f.display);
    root.style.setProperty("--fs", f.scale);
  }

  try {
    useForAll = localStorage.getItem(ALL_KEY) === "1";
    var saved = find(localStorage.getItem(STORAGE_KEY));
    if (saved) apply(saved);
  } catch (e) {}

  document.addEventListener("DOMContentLoaded", function () {
    var picker = document.getElementById("fontPicker");
    var btn = document.getElementById("fontBtn");
    var panel = document.getElementById("fontPanel");
    var list = document.getElementById("fontList");
    var allBox = document.getElementById("fontAll");
    if (!picker) return;

    allBox.checked = useForAll;
    allBox.addEventListener("change", function () {
      useForAll = allBox.checked;
      try { localStorage.setItem(ALL_KEY, useForAll ? "1" : "0"); } catch (e) {}
      apply(current);
    });

    var options = [];

    function markActive() {
      options.forEach(function (o) {
        o.el.classList.toggle("active", o.font.key === current.key);
      });
    }

    FONTS.forEach(function (f) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "font-option";

      var name = document.createElement("strong");
      name.textContent = f.name;
      name.style.fontFamily = f.display;
      name.style.fontSize = (20 * Math.max(f.scale, 0.6)) + "px";

      var sample = document.createElement("span");
      sample.textContent = "Bench Press 80 kg";
      sample.style.fontFamily = f.body;

      el.append(name, sample);
      el.addEventListener("click", function () {
        apply(f);
        try { localStorage.setItem(STORAGE_KEY, f.key); } catch (e) {}
        markActive();
      });

      list.appendChild(el);
      options.push({ el: el, font: f });
    });

    btn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) {
        FONTS.forEach(loadFont); // so every option can show its own preview
        markActive();
      }
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest("#fontPicker")) panel.hidden = true;
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") panel.hidden = true;
    });

    markActive();
  });
})();