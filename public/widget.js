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

  function init(cfg) {
    var s = cfg.strings[lang] || cfg.strings.en;
    var rtl = lang === "ar";
    var color = cfg.color || "#0e7c86";
    var side = rtl ? "left" : "right";
    var root = el("div", { dir: rtl ? "rtl" : "ltr", style: { position: "fixed", bottom: "20px", zIndex: 2147483000, fontFamily: "system-ui, 'Noto Sans Arabic', sans-serif" } });
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
      document.body.appendChild(el("elevenlabs-convai", { "agent-id": cfg.agentId, "dynamic-variables": JSON.stringify(cfg.dynamicVariables || {}) }));
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
