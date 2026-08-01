/* ==========================================================================
   Waise Theme v1.5.3 - assets/js/waise.js

   Dos trabajos independientes, ambos tolerantes a fallo:

   1) COLUMNA LATERAL. Localiza la navegacion REAL del panel (nunca adivina
      ids a ciegas) y publica los gates que espera waise.css:
        - /server/<id>/...  -> el menu del servidor ocupa la columna
                               (`waise-sidebar-ready` + `.waise-server-nav`)
        - resto de paginas  -> la barra principal ocupa la columna
                               (`waise-mainnav-ready` + `.waise-main-nav`)
      Los ancestros que crean bloque contenedor (transform / filter /
      backdrop-filter / contain / will-change) se neutralizan con estilos
      INLINE !important: las reglas de waise.css llevan `!important` pero solo
      2 clases de especificidad, y `#navigation { backdrop-filter: ... }` gana
      por id, asi que sin inline el `position: fixed` se quedaria anclado
      dentro de la barra superior.
      Tras aplicar se VERIFICA la geometria final; si la columna no acaba
      pegada al borde y a altura completa, se revierte todo y el panel se
      queda con su layout nativo.

   2) PARCHE DE GRISES INLINE (v1.5.1). styled-components y algunos
      componentes escriben background-color inline que ningun selector CSS
      puede alcanzar.
   ========================================================================== */
(function () {
    'use strict';

    /* ====================================================================
       Parte 1 - Columna lateral
       ==================================================================== */

    var HTML = document.documentElement;
    var MIN_VIEWPORT = 1024;              /* mismo breakpoint que waise.css */

    var GATE      = { server: 'waise-sidebar-ready', main: 'waise-mainnav-ready' };
    var NAV_CLASS = { server: 'waise-server-nav',    main: 'waise-main-nav' };
    var HOST_CLASS  = 'waise-nav-host';
    var CLEAR_CLASS = 'waise-nav-clear';
    var LABEL_ATTR  = 'data-waise-label';

    /* `#app` va al final: es el ultimo recurso si el panel no expone ids. */
    var SERVER_ROOTS = ['#sub-navigation', '[class*="SubNavigation"]', '[class*="ServerSubNav"]', '#app'];
    var MAIN_ROOTS   = ['#navigation', '[class*="NavigationBar"]', 'body > nav', '#app'];

    /* Superficie del contenedor que se queda vacio al pasar el menu a fijo. */
    var HOST_RESET = [
        ['background-color', 'transparent'],
        ['background-image', 'none'],
        ['border', '0'],
        ['box-shadow', 'none'],
        ['padding', '0'],
        ['margin', '0'],
        ['min-height', '0'],
        ['height', 'auto']
    ];

    /* Propiedades que crean bloque contenedor y romperian `position: fixed`. */
    var CB_RESET = [
        ['transform', 'none'],
        ['filter', 'none'],
        ['backdrop-filter', 'none'],
        ['-webkit-backdrop-filter', 'none'],
        ['perspective', 'none'],
        ['contain', 'none'],
        ['will-change', 'auto'],
        ['overflow', 'visible']
    ];

    /* Rotulos para los enlaces de solo icono de la barra principal. */
    var MAIN_LABELS = [
        [/^\/account\/api(\/|$)/,      'API'],
        [/^\/account\/ssh(\/|$)/,      'SSH'],
        [/^\/account\/activity(\/|$)/, 'Actividad'],
        [/^\/account(\/|$)/,           'Cuenta'],
        [/^\/admin(\/|$)/,             'Admin'],
        [/^\/(index)?$/,               'Servidores']
    ];

    var applied  = { target: null, kind: null, root: null };
    var labeled  = [];
    var styleLog = [];            /* [{ el, prop, value, priority }] */
    var styleSeen = new Map();    /* el -> Set(prop) : solo se guarda el original */
    var rejected = new WeakSet(); /* menus que ya fallaron la verificacion */

    /* ------------------------------------------------- estilos inline ---- */

    function setImportant(el, prop, value) {
        var props = styleSeen.get(el);
        if (!props) {
            props = new Set();
            styleSeen.set(el, props);
        }
        if (!props.has(prop)) {
            props.add(prop);
            styleLog.push({
                el: el,
                prop: prop,
                value: el.style.getPropertyValue(prop),
                priority: el.style.getPropertyPriority(prop)
            });
        }
        if (el.style.getPropertyValue(prop) !== value ||
            el.style.getPropertyPriority(prop) !== 'important') {
            el.style.setProperty(prop, value, 'important');
        }
    }

    function applyReset(el, pairs) {
        for (var i = 0; i < pairs.length; i++) {
            setImportant(el, pairs[i][0], pairs[i][1]);
        }
    }

    function restoreStyles() {
        for (var i = styleLog.length - 1; i >= 0; i--) {
            var s = styleLog[i];
            if (s.value) {
                s.el.style.setProperty(s.prop, s.value, s.priority);
            } else {
                s.el.style.removeProperty(s.prop);
            }
        }
        styleLog = [];
        styleSeen = new Map();
    }

    /* ------------------------------------------------------ deteccion ---- */

    function currentServerId() {
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    function directLinkCount(el) {
        var n = 0;
        for (var i = 0; i < el.children.length; i++) {
            var c = el.children[i];
            if (c.tagName === 'A' || c.tagName === 'BUTTON') {
                n++;
            } else if (c.querySelector && c.querySelector('a[href], button')) {
                n++;
            }
        }
        return n;
    }

    /* Devuelve el contenedor cuyos HIJOS DIRECTOS son los enlaces del menu.
       Si empatan en numero de enlaces, gana el mas profundo. */
    function findRow(root, validate) {
        var best = null, bestCount = 0, bestDepth = -1;

        (function walk(el, depth) {
            var count = directLinkCount(el);
            if (count >= 2 &&
                (count > bestCount || (count === bestCount && depth > bestDepth)) &&
                validate(el)) {
                best = el;
                bestCount = count;
                bestDepth = depth;
            }
            for (var i = 0; i < el.children.length; i++) {
                walk(el.children[i], depth + 1);
            }
        })(root, 0);

        return best;
    }

    /* Menu del servidor: enlaces del servidor ACTUAL y al menos uno con
       subruta (/server/<id>/files). Asi nunca confunde el listado de
       servidores del dashboard, cuyas tarjetas apuntan a /server/<id>. */
    function validServerRow(el) {
        var id = currentServerId();
        if (!id) return false;

        var links = el.querySelectorAll('a[href]');
        var own = 0, deep = 0;
        for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            if (href.indexOf('/server/' + id) !== 0) continue;
            own++;
            if (href.length > ('/server/' + id).length + 1) deep++;
        }
        if (own < 2 || deep < 1) return false;

        return el.getBoundingClientRect().top < 260;
    }

    /* Barra principal: tiene enlaces de panel (raiz, cuenta, admin), no es el
       menu de un servidor y esta en la franja superior de la pagina. */
    function validMainRow(el) {
        if (el.querySelector('a[href*="/server/"]')) return false;

        var links = el.querySelectorAll('a[href], button');
        if (links.length < 2 || links.length > 14) return false;

        var known = false;
        for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            if (href === '/' || href === '/index' ||
                href.indexOf('/account') === 0 || href.indexOf('/admin') === 0) {
                known = true;
                break;
            }
        }
        if (!known) return false;

        var r = el.getBoundingClientRect();
        return r.top < 160 && r.width > 240;
    }

    function locate() {
        var i, j, roots, row;

        if (currentServerId()) {
            for (i = 0; i < SERVER_ROOTS.length; i++) {
                roots = document.querySelectorAll(SERVER_ROOTS[i]);
                for (j = 0; j < roots.length; j++) {
                    row = findRow(roots[j], validServerRow);
                    if (row) return { target: row, kind: 'server', root: roots[j] };
                }
            }
        }

        for (i = 0; i < MAIN_ROOTS.length; i++) {
            roots = document.querySelectorAll(MAIN_ROOTS[i]);
            for (j = 0; j < roots.length; j++) {
                row = findRow(roots[j], validMainRow);
                if (row) return { target: row, kind: 'main', root: roots[j] };
            }
        }

        return null;
    }

    function createsContainingBlock(el) {
        var cs = window.getComputedStyle(el);
        if (!cs) return false;
        return (cs.transform && cs.transform !== 'none') ||
               (cs.filter && cs.filter !== 'none') ||
               (cs.backdropFilter && cs.backdropFilter !== 'none') ||
               (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none') ||
               (cs.perspective && cs.perspective !== 'none') ||
               (cs.contain && /paint|layout|strict|content/.test(cs.contain)) ||
               (cs.willChange && /transform|filter|perspective/.test(cs.willChange));
    }

    /* ------------------------------------------------------- aplicacion -- */

    /* Oculta lo que queda en la barra vacia (logo, overlays). Nunca se llama
       cuando la raiz detectada es #app: ahi los hermanos son la pagina. */
    function hideStrays(parent, child) {
        for (var i = 0; i < parent.children.length; i++) {
            var el = parent.children[i];
            if (el === child || el === applied.target) continue;
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
            if (el.getBoundingClientRect().height > 160) continue;
            if (el.querySelectorAll('*').length > 40) continue;
            setImportant(el, 'display', 'none');
        }
    }

    function accessibleName(el) {
        var v = el.getAttribute('aria-label') || el.getAttribute('title');
        if (v && v.trim()) return v.trim();

        var svgTitle = el.querySelector('svg > title');
        if (svgTitle && svgTitle.textContent.trim()) return svgTitle.textContent.trim();

        var describedBy = el.getAttribute('aria-describedby');
        if (describedBy) {
            var tip = document.getElementById(describedBy);
            if (tip && tip.textContent.trim()) return tip.textContent.trim();
        }

        var href = el.getAttribute('href');
        if (href) {
            var path = href;
            try {
                path = new URL(href, window.location.origin).pathname;
            } catch (e) {
                path = href;
            }
            for (var i = 0; i < MAIN_LABELS.length; i++) {
                if (MAIN_LABELS[i][0].test(path)) return MAIN_LABELS[i][1];
            }
        }
        return null;
    }

    /* Los enlaces de la barra principal son de solo icono: el nombre se
       publica en data-waise-label y waise.css lo pinta con ::after, sin
       insertar nodos en un arbol que controla React. */
    function labelize(target, kind) {
        if (kind !== 'main') return;

        var items = target.querySelectorAll('a[href], button');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];

            if (el.textContent && el.textContent.trim() !== '') {
                if (el.hasAttribute(LABEL_ATTR)) el.removeAttribute(LABEL_ATTR);
                continue;
            }

            var label = accessibleName(el);
            if (!label) continue;

            if (el.getAttribute(LABEL_ATTR) !== label) el.setAttribute(LABEL_ATTR, label);
            if (labeled.indexOf(el) === -1) labeled.push(el);
        }
    }

    function verifyPosition(el) {
        var r = el.getBoundingClientRect();
        return r.left <= 8 &&
               r.width >= 120 && r.width <= 420 &&
               r.height >= window.innerHeight * 0.6;
    }

    function clearAllAncestors(target) {
        var el = target.parentElement, guard = 0;
        while (el && el !== document.body && guard++ < 40) {
            el.classList.add(CLEAR_CLASS);
            applyReset(el, CB_RESET);
            el = el.parentElement;
        }
    }

    function mark(found, verify) {
        var target = found.target;
        var kind = found.kind;
        var root = found.root;
        var canHide = root.id !== 'app' && root !== document.body;

        applied = { target: target, kind: kind, root: root };

        HTML.classList.add(GATE[kind]);
        target.classList.add(NAV_CLASS[kind]);

        var child = target, parent = target.parentElement, guard = 0, insideNav = true;
        while (parent && parent !== document.body && guard++ < 40) {
            if (insideNav) {
                parent.classList.add(HOST_CLASS);
                if (parent.id !== 'app') applyReset(parent, HOST_RESET);
                if (canHide) hideStrays(parent, child);
            }
            if (insideNav || createsContainingBlock(parent)) {
                parent.classList.add(CLEAR_CLASS);
                applyReset(parent, CB_RESET);
            }
            if (parent === root) insideNav = false;
            child = parent;
            parent = parent.parentElement;
        }

        labelize(target, kind);

        if (!verify) return;
        if (verifyPosition(target)) return;

        /* Segundo intento: neutralizar TODA la cadena de ancestros. */
        clearAllAncestors(target);
        if (verifyPosition(target)) return;

        /* No cuadra: se devuelve el panel a su layout nativo y no se vuelve
           a intentar con este menu. */
        rejected.add(target);
        revert();
    }

    function revert() {
        HTML.classList.remove(GATE.server, GATE.main);

        if (applied.target) {
            applied.target.classList.remove(NAV_CLASS.server, NAV_CLASS.main);
        }
        document.querySelectorAll('.' + HOST_CLASS + ', .' + CLEAR_CLASS).forEach(function (el) {
            el.classList.remove(HOST_CLASS, CLEAR_CLASS);
        });
        for (var i = 0; i < labeled.length; i++) {
            labeled[i].removeAttribute(LABEL_ATTR);
        }
        labeled = [];

        restoreStyles();
        applied = { target: null, kind: null, root: null };
    }

    function refreshSidebar() {
        if (window.innerWidth < MIN_VIEWPORT) {
            if (applied.target) revert();
            return;
        }

        var found = locate();
        if (!found || rejected.has(found.target)) {
            if (applied.target) revert();
            return;
        }

        /* Mismo menu: solo se reaplican las marcas (React puede haber
           reescrito el atributo style al re-renderizar). */
        if (applied.target === found.target &&
            applied.kind === found.kind &&
            found.target.isConnected) {
            mark(found, false);
            return;
        }

        revert();
        mark(found, true);
    }

    /* ====================================================================
       Parte 2 - Parche de grises inline (heredado de v1.5.1)
       ==================================================================== */

    var SKIP = new Set([
        'SCRIPT', 'STYLE', 'SVG', 'PATH', 'CIRCLE', 'RECT', 'LINE', 'POLYGON',
        'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT', 'IFRAME',
        'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'IMG', 'VIDEO', 'CANVAS'
    ]);

    function parseRGB(str) {
        if (!str || str.indexOf('rgb') === -1) return null;
        var m = str.match(/[\d.]+/g);
        if (!m || m.length < 3) return null;
        return { r: +m[0], g: +m[1], b: +m[2], a: m[3] !== undefined ? +m[3] : 1 };
    }

    /* Neutro = saturacion baja y no negro puro: cubre grises oscuros
       (#1a1a1a) y claros (#f3f4f6, #ffffff). */
    function isNeutral(c) {
        if (!c || c.a < 0.05) return false;
        if (c.r === 0 && c.g === 0 && c.b === 0) return false;
        return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) < 40 &&
               Math.max(c.r, c.g, c.b) > 18;
    }

    function patchEl(el) {
        if (!(el instanceof HTMLElement)) return;
        if (SKIP.has(el.tagName)) return;

        /* Nunca sobre los elementos que gestiona la columna lateral. */
        if (el.classList.contains(HOST_CLASS) ||
            el.classList.contains(NAV_CLASS.server) ||
            el.classList.contains(NAV_CLASS.main)) return;

        var bg = el.style.backgroundColor;
        if (bg) {
            var c = parseRGB(bg);
            if (c && isNeutral(c)) {
                el.style.setProperty('background-color', 'rgba(28,32,52,.55)', 'important');
                el.style.setProperty('backdrop-filter', 'blur(14px) saturate(140%)', 'important');
                el.style.setProperty('-webkit-backdrop-filter', 'blur(14px) saturate(140%)', 'important');
                el.style.setProperty('border', '1px solid rgba(255,255,255,.08)', 'important');
                el.style.setProperty('color', '#e8eaf6', 'important');
            }
        }

        var col = el.style.color;
        if (col) {
            var tc = parseRGB(col);
            if (tc && Math.max(tc.r, tc.g, tc.b) < 60) {
                el.style.setProperty('color', '#e8eaf6', 'important');
            }
        }
    }

    /* ====================================================================
       Arranque y observadores
       ==================================================================== */

    var pending = false;

    function schedule() {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(function () {
            pending = false;
            try {
                refreshSidebar();
            } catch (e) {
                /* Ante cualquier fallo, el panel debe seguir usable. */
                try { revert(); } catch (e2) { /* nada mas que hacer */ }
            }
        });
    }

    var observer = new MutationObserver(function (muts) {
        var needsSidebarPass = false;

        for (var i = 0; i < muts.length; i++) {
            var m = muts[i];

            if (m.type === 'attributes' && m.attributeName === 'style') {
                /* Si React ha reescrito el style de un elemento nuestro, hay
                   que reaplicar; si no, es un gris inline mas. */
                if (styleSeen.has(m.target)) {
                    needsSidebarPass = true;
                } else {
                    patchEl(m.target);
                }
                continue;
            }

            for (var j = 0; j < m.addedNodes.length; j++) {
                var n = m.addedNodes[j];
                if (n.nodeType !== 1) continue;
                needsSidebarPass = true;
                patchEl(n);
                if (n.querySelectorAll) n.querySelectorAll('*').forEach(patchEl);
            }

            if (m.removedNodes.length) needsSidebarPass = true;
        }

        if (needsSidebarPass) schedule();
    });

    function init() {
        document.querySelectorAll('*').forEach(patchEl);
        schedule();

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style']
        });

        window.addEventListener('resize', schedule, { passive: true });
        window.addEventListener('popstate', schedule);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();