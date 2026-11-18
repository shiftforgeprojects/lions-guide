/* Lions Guide chat bubble. Add to any website with one line:
   <script src="https://YOUR-GUIDE-ADDRESS/bubble.js" defer></script>
   The bubble opens the same guide, so answers are identical to the full page. */
(function () {
  if (window.__lionBubble) return; window.__lionBubble = true;
  var me = document.currentScript || (function () { var s = document.getElementsByTagName("script"); return s[s.length - 1]; })();
  var base = (me && me.getAttribute("data-url")) || (me && me.src ? me.src.replace(/bubble\.js(\?.*)?$/, "") : "./");
  var open = false, frame = null;
  var css = document.createElement("style");
  css.textContent =
    "#lgb-btn{position:fixed;right:18px;bottom:18px;z-index:2147483000;width:62px;height:62px;border-radius:50%;border:0;cursor:pointer;background:#ffcf06;color:#003c73;box-shadow:0 6px 20px rgba(0,40,90,.35);display:grid;place-items:center;font:700 13px/1 system-ui,sans-serif}" +
    "#lgb-btn svg{width:30px;height:30px}#lgb-btn:focus-visible{outline:3px solid #003c73;outline-offset:3px}" +
    "#lgb-tip{position:fixed;right:90px;bottom:30px;z-index:2147483000;background:#003c73;color:#fff;padding:9px 13px;border-radius:12px;font:600 14px/1.2 system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,40,90,.3)}" +
    "#lgb-panel{position:fixed;right:18px;bottom:92px;z-index:2147483001;width:400px;height:min(680px,calc(100vh - 112px));border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 12px 40px rgba(0,30,80,.4);display:none;border:1px solid #c9d6ea}" +
    "#lgb-panel.on{display:block}#lgb-panel iframe{width:100%;height:100%;border:0;display:block}" +
    "@media (max-width:560px){#lgb-panel{right:0;bottom:0;width:100%;height:100%;border-radius:0}#lgb-panel.on~#lgb-btn{display:none}#lgb-close{display:grid!important}}" +
    "#lgb-close{display:none;position:absolute;right:10px;top:10px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;background:#ffcf06;color:#003c73;font:700 20px/1 system-ui;place-items:center;cursor:pointer}";
  document.head.appendChild(css);
  var tip = document.createElement("div"); tip.id = "lgb-tip"; tip.textContent = "Ask about Lions"; 
  var panel = document.createElement("div"); panel.id = "lgb-panel"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Lions Guide chat");
  var x = document.createElement("button"); x.id = "lgb-close"; x.type = "button"; x.setAttribute("aria-label", "Close chat"); x.textContent = "×";
  var btn = document.createElement("button"); btn.id = "lgb-btn"; btn.type = "button"; btn.setAttribute("aria-label", "Open Lions Guide chat");
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>';
  function toggle(on) {
    open = on === undefined ? !open : on;
    if (open && !frame) { frame = document.createElement("iframe"); frame.title = "Lions Guide"; frame.src = base + "index.html?embed=1"; frame.setAttribute("allow", "microphone"); panel.insertBefore(frame, x); }
    panel.classList.toggle("on", open); tip.style.display = "none";
    btn.setAttribute("aria-label", open ? "Close Lions Guide chat" : "Open Lions Guide chat");
    if (open) { try { frame.focus(); } catch (e) {} }
  }
  btn.addEventListener("click", function () { toggle(); }); x.addEventListener("click", function () { toggle(false); });
  window.addEventListener("message", function (e) { if (e.data === "lg-close" && frame && e.source === frame.contentWindow) { toggle(false); frame.remove(); frame = null; } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) toggle(false); });
  panel.appendChild(x);
  function mount() { document.body.appendChild(panel); document.body.appendChild(btn); document.body.appendChild(tip); setTimeout(function () { if (!open) tip.style.display = "none"; }, 9000); }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();
