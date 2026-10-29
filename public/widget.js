/*
 * CallsDash website widget.
 * Usage: <script src="https://YOUR-HOST/widget.js" data-tenant="clinic-slug" async></script>
 * Optional: data-lang="en|ar" to force the language.
 *
 * Flow: launcher button -> consent notice (Bahrain requires consent before recording) -> ElevenLabs
 * conversational widget for the clinic's agent. Nothing is loaded from ElevenLabs before consent.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__callsdashWidget) return;
  window.__callsdashWidget = true;
  // data-callsdash-widget marks what this script adds to the page, so a screen that previews it can take it away again
  var tenant = script.getAttribute("data-tenant");
  if (!tenant) return console.warn("[CallsDash] data-tenant is missing");
  var base = new URL(script.src).origin;
  var lang = script.getAttribute("data-lang") || ((document.documentElement.lang || navigator.language || "en").slice(0, 2) === "ar" ? "ar" : "en");
  var CONSENT_KEY = "callsdash-consent-" + tenant;

  fetch(base + "/api/widget/config?tenant=" + encodeURIComponent(tenant))
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("config " + r.status)); })
    .then(init)
    .catch(function (e) { console.warn("[CallsDash]", e.message); });

  function el(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "style") Object.assign(n.style, props[k]);
      else if (k === "text") n.textContent = props[k];
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  // The assistant's show_image tool (a client tool, run here in the visitor's browser) draws a catalogue photo over the chat, just above its message box.
  // Only pictures served by this CallsDash address are drawn, whatever the assistant asks for.
  function photoUrl(raw) {
    try {
      var u = new URL(String(raw), base);
      return u.origin === base && /^\/api\/items\/[^/]+\/[^/]+\/image$/.test(u.pathname) ? u.href : null;
    } catch (e) { return null; }
  }

  function showPhoto(raw, caption, rtl, side) {
    var href = photoUrl(raw);
    if (!href) return "That picture cannot be shown.";
    Array.prototype.forEach.call(document.querySelectorAll('[data-callsdash-widget="photo"]'), function (n) { n.remove(); });
    var close = el("button", { type: "button", "aria-label": rtl ? "إغلاق" : "Close", text: "\u00d7", style: {
      position: "absolute", top: "4px", border: "0", background: "rgba(255,255,255,.9)", borderRadius: "999px", width: "28px", height: "28px", fontSize: "18px", lineHeight: "1", cursor: "pointer", color: "#14202b" } });
    close.style[rtl ? "left" : "right"] = "4px";
    var kids = [el("img", { src: href, alt: caption || "", style: { display: "block", width: "100%", maxHeight: "200px", objectFit: "cover" } }), close];
    if (caption) kids.push(el("div", { text: String(caption).slice(0, 200), style: { padding: "8px 12px", fontSize: "14px", lineHeight: "1.4" } }));
    // The photo must sit over the ElevenLabs chat window (z-index 1000 in convai-widget-embed 0.22, which may change), never behind it.
    var card = el("div", { "data-callsdash-widget": "photo", role: "dialog", dir: rtl ? "rtl" : "ltr", style: {
      position: "fixed", width: "240px", maxWidth: "calc(100vw - 80px)", background: "#fff", color: "#14202b", borderRadius: "14px", overflow: "hidden",
      border: "1px solid rgba(0,0,0,.08)", boxShadow: "0 8px 30px rgba(0,0,0,.35)", zIndex: 2147483647, fontFamily: "system-ui, 'Noto Sans Arabic', sans-serif" } }, kids);
    close.addEventListener("click", function () { card.remove(); });
    document.body.appendChild(card);
    place(card, side);
    // The browser's top layer sits above every other layer on the page, whatever z-index the chat window uses; where it is missing
    // (old browsers) the z-index above still applies.
    try {
      card.setAttribute("popover", "manual");
      Object.assign(card.style, { inset: "auto", margin: "0", padding: "0", display: "block" });
      place(card, side);
      card.showPopover();
    } catch (e) { /* no popover support: plain fixed card */ }
    return "Shown.";
  }

  // Over the chat, just above its message box and centred on it, measured when the chat lets us look inside it;
  // otherwise a fixed place that matches its usual layout.
  function place(card, side) {
    card.style.bottom = "250px"; card.style.left = "auto"; card.style.right = "auto"; card.style[side] = "40px";
    try {
      var host = document.querySelector('[data-callsdash-widget="embed"]');
      var box = host && host.shadowRoot && host.shadowRoot.querySelector("textarea, input[type=text]");
      if (!box) return;
      var r = box.getBoundingClientRect(), w = card.offsetWidth || 240;
      if (r.top <= 120 || r.top >= window.innerHeight) return;
      card.style.bottom = Math.round(window.innerHeight - r.top + 24) + "px";
      card.style.right = "auto";
      card.style.left = Math.round(Math.max(8, Math.min(r.left + (r.width - w) / 2, window.innerWidth - w - 8))) + "px";
    } catch (e) { /* closed or changed: keep the fixed place */ }
  }

  // In a typed chat the assistant puts a photo inside its reply as a markdown image, which the ElevenLabs chat draws itself.
  // This keeps those photos small (same rule as lib/chat-photos.ts CHAT_PHOTO_CSS). Its shadow root is open.
  function smallChatPhotos(host) {
    try {
      var root = host.shadowRoot;
      if (!root || root.__callsdashPhotos) return;
      var sheet = new CSSStyleSheet();
      sheet.replaceSync('[data-streamdown="image-wrapper"]{max-width:min(220px,100%)}[data-streamdown="image-wrapper"]>div{width:100%}img[data-streamdown="image"]{display:block;width:100%;max-height:220px;object-fit:cover}');
      root.adoptedStyleSheets = Array.prototype.slice.call(root.adoptedStyleSheets).concat([sheet]);
      root.__callsdashPhotos = true;
    } catch (e) { /* an older browser: photos keep the chat's own size */ }
  }

  function init(cfg) {
    // the dashboard previews the widget (data-preview); if that screen was left before the settings arrived, show nothing
    if (script.hasAttribute("data-preview") && !script.isConnected) { window.__callsdashWidget = false; return; }
    var s = cfg.strings[lang] || cfg.strings.en;
    var rtl = lang === "ar";
    var color = cfg.color || "#0e7c86";
    var side = rtl ? "left" : "right";
    var root = el("div", { "data-callsdash-widget": "launcher", dir: rtl ? "rtl" : "ltr", style: { position: "fixed", bottom: "20px", zIndex: 2147483000, fontFamily: "system-ui, 'Noto Sans Arabic', sans-serif" } });
    root.style[side] = "20px";

    var launcher = el("button", { type: "button", "aria-label": s["widget.open"], text: s["widget.open"], style: {
      background: color, color: "#fff", border: "0", borderRadius: "999px", padding: "12px 20px", fontSize: "15px", cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,.25)" } });
    var panel = el("div", { role: "dialog", "aria-label": s["widget.consentTitle"], style: {
      display: "none", width: "320px", maxWidth: "calc(100vw - 40px)", background: "#fff", color: "#14202b", borderRadius: "14px",
      padding: "16px", boxShadow: "0 8px 30px rgba(0,0,0,.28)", marginBottom: "10px", lineHeight: "1.5", fontSize: "14px" } });
    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);

    function show(html) { panel.innerHTML = ""; html.forEach(function (n) { panel.appendChild(n); }); panel.style.display = "block"; }
    function text(t, bold) { return el("p", { text: t, style: { margin: "0 0 12px", fontWeight: bold ? "700" : "400" } }); }
    function btn(label, primary, onClick) {
      var b = el("button", { type: "button", text: label, style: {
        font: "inherit", cursor: "pointer", borderRadius: "8px", padding: "8px 14px", marginInlineEnd: "8px",
        border: "1px solid " + color, background: primary ? color : "transparent", color: primary ? "#fff" : color } });
      b.addEventListener("click", onClick);
      return b;
    }

    function start() {
      panel.style.display = "none";
      launcher.style.display = "none";
      if (!cfg.agentId) { show([text("Demo: the ElevenLabs agent is not connected yet.")]); return; }
      var loader = el("script", { src: "https://unpkg.com/@elevenlabs/convai-widget-embed", async: "", type: "text/javascript" });
      document.head.appendChild(loader);
      var embed = el("elevenlabs-convai", { "data-callsdash-widget": "embed", "agent-id": cfg.agentId, "dynamic-variables": JSON.stringify(cfg.dynamicVariables || {}) });
      // the tool must also exist on the agent under the same name (Update the assistant adds it)
      embed.addEventListener("elevenlabs-convai:call", function (event) {
        var config = event.detail && event.detail.config;
        if (!config) return;
        smallChatPhotos(embed);
        config.clientTools = Object.assign({}, config.clientTools, {
          show_image: function (p) { return showPhoto(p && p.image_url, p && p.caption, rtl, side); },
        });
      });
      document.body.appendChild(embed);
    }

    function consentCard() {
      show([
        text(s["widget.consentTitle"], true),
        text(s["widget.consent"]),
        el("div", {}, [
          btn(s["widget.accept"], true, function () { try { localStorage.setItem(CONSENT_KEY, "1"); } catch (e) {} start(); }),
          btn(s["widget.decline"], false, function () { show([text(s["widget.declined"])]); }),
        ]),
      ]);
    }

    launcher.addEventListener("click", function () {
      if (cfg.paused) return show([text(s["widget.paused"])]);
      var ok = false;
      try { ok = localStorage.getItem(CONSENT_KEY) === "1"; } catch (e) {}
      if (ok) start(); else consentCard();
    });
  }
})();
