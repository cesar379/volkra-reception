/* Volkra · chat web. Uso: <script src="https://entrada.volkra.es/widget.js" data-key="wc_..." async></script> */
(function () {
  var s = document.currentScript;
  if (!s || window.__volkraChat) return;
  window.__volkraChat = true;
  var key = s.getAttribute("data-key");
  if (!key) return;
  var color = s.getAttribute("data-color") || "#111827";
  var origin = new URL(s.src).origin;
  var open = false;

  var css = document.createElement("style");
  css.textContent =
    ".vk-btn{position:fixed;right:20px;bottom:20px;z-index:2147483646;width:56px;height:56px;border:0;border-radius:50%;cursor:pointer;display:grid;place-items:center;box-shadow:0 6px 20px rgba(0,0,0,.2);transition:transform .15s}" +
    ".vk-btn:hover{transform:scale(1.05)}" +
    ".vk-frame{position:fixed;right:20px;bottom:88px;z-index:2147483647;width:380px;height:600px;max-height:calc(100vh - 108px);border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);background:#fff;display:none}" +
    "@media (max-width:480px){.vk-frame{right:0;bottom:0;width:100%;height:100%;max-height:none;border-radius:0}}";
  document.head.appendChild(css);

  var chatIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  var btn = document.createElement("button");
  btn.className = "vk-btn";
  btn.type = "button";
  btn.style.background = color;
  btn.setAttribute("aria-label", "Abrir chat");
  btn.innerHTML = chatIcon;

  var frame = null;
  function toggle(v) {
    open = v;
    if (open && !frame) {
      frame = document.createElement("iframe");
      frame.className = "vk-frame";
      frame.title = "Chat";
      frame.src = origin + "/chat/" + encodeURIComponent(key) + "?embed=1";
      document.body.appendChild(frame);
    }
    if (frame) frame.style.display = open ? "block" : "none";
    btn.innerHTML = open ? closeIcon : chatIcon;
    btn.setAttribute("aria-label", open ? "Cerrar chat" : "Abrir chat");
  }
  btn.addEventListener("click", function () { toggle(!open); });
  window.addEventListener("message", function (e) {
    if (e.origin === origin && e.data && e.data.type === "volkra-chat-close") toggle(false);
  });
  if (document.body) document.body.appendChild(btn);
  else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(btn); });
})();
