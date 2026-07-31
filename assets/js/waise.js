/* ==========================================================================
   Waise Theme  v1.5.1  waise.js
   Parchea en tiempo real elementos con fondo inline gris/blanco que los
   selectores CSS no pueden alcanzar (styled-components, estilos inline).
   ========================================================================== */
(function () {
  'use strict';

  /* Tags que nunca se parchean */
  var SKIP = new Set([
    'SCRIPT','STYLE','SVG','PATH','CIRCLE','RECT','LINE','POLYGON',
    'HEAD','META','LINK','TITLE','NOSCRIPT','IFRAME',
    'INPUT','SELECT','TEXTAREA','BUTTON','A','IMG','VIDEO','CANVAS'
  ]);

  function parseRGB(str) {
    if (!str || str.indexOf('rgb') === -1) return null;
    var m = str.match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m[3] !== undefined ? +m[3] : 1 };
  }

  /* Neutro = baja saturacion (max-min < 40) y brillo > 18
     Esto cubre grises oscuros (#1a1a1a) Y claros (#f3f4f6, #ffffff) */
  function isNeutral(c) {
    if (!c || c.a < 0.05) return false;
    if (c.r === 0 && c.g === 0 && c.b === 0) return false;
    return (Math.max(c.r,c.g,c.b) - Math.min(c.r,c.g,c.b)) < 40
        && Math.max(c.r,c.g,c.b) > 18;
  }

  function patchEl(el) {
    if (!(el instanceof HTMLElement)) return;
    if (SKIP.has(el.tagName)) return;

    var bg = el.style.backgroundColor;
    if (bg) {
      var c = parseRGB(bg);
      if (c && isNeutral(c)) {
        el.style.setProperty('background-color','rgba(28,32,52,.55)','important');
        el.style.setProperty('backdrop-filter','blur(14px) saturate(140%)','important');
        el.style.setProperty('-webkit-backdrop-filter','blur(14px) saturate(140%)','important');
        el.style.setProperty('border','1px solid rgba(255,255,255,.08)','important');
        el.style.setProperty('color','#e8eaf6','important');
      }
    }

    /* Texto muy oscuro -> aclarar */
    var col = el.style.color;
    if (col) {
      var tc = parseRGB(col);
      if (tc && Math.max(tc.r,tc.g,tc.b) < 60) {
        el.style.setProperty('color','#e8eaf6','important');
      }
    }
  }

  function scanAll() {
    document.querySelectorAll('*').forEach(patchEl);
  }

  var obs = new MutationObserver(function(muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'attributes' && m.attributeName === 'style') {
        patchEl(m.target);
      }
      for (var j = 0; j < m.addedNodes.length; j++) {
        var n = m.addedNodes[j];
        if (n.nodeType !== 1) continue;
        patchEl(n);
        if (n.querySelectorAll) n.querySelectorAll('*').forEach(patchEl);
      }
    }
  });

  function init() {
    scanAll();
    obs.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
