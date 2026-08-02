/* ==========================================================================
   Waise Theme v1.5.17 - assets/js/waise.js
   ========================================================================== */
(function () {
    'use strict';

    /* ====================================================================
       Parte 1 - Columna lateral
       ==================================================================== */

    var HTML = document.documentElement;
    var MIN_VIEWPORT = 1024;

    var GATE      = { server: 'waise-sidebar-ready', main: 'waise-mainnav-ready' };
    var NAV_CLASS = { server: 'waise-server-nav',    main: 'waise-main-nav' };
    var HOST_CLASS  = 'waise-nav-host';
    var CLEAR_CLASS = 'waise-nav-clear';
    var LABEL_ATTR  = 'data-waise-label';
    /* El title nativo de Pterodactyl viene en ingles y el navegador lo pinta
       encima del rotulo traducido al pasar el raton. Se retira del nodo y se
       guarda aqui para poder devolverlo intacto al desmontar el tema. */
    var TITLE_ATTR  = 'data-waise-title';
    /* Entradas inyectadas por otros modulos (mods, propiedades...). Se marcan
       para poder excluirlas de la heuristica de deteccion: cuentan como hijos
       de la fila y sin esto falsearian directLinkCount en el ciclo siguiente. */
    var NAV_EXTRA_CLASS = 'waise-nav-extra';
    var NAV_ID_ATTR     = 'data-waise-nav';

    var SERVER_ROOTS = ['#sub-navigation', '[class*="SubNavigation"]', '[class*="ServerSubNav"]', '#app'];
    var MAIN_ROOTS   = ['#navigation', '[class*="NavigationBar"]', 'body > nav', '#app'];

    /* Fila derecha de la barra superior (buscar, servidores, admin, cuenta,
       salir). El sufijo de styled-components cambia en cada build del panel,
       así que NUNCA se usa la clase con hash: solo la parte estable. */
    var TOPBAR_SEL   = '[class*="RightNavigation"]';
    var DOCK_CLASS   = 'waise-topbar-dock';
    var DOCK_GATE    = 'waise-topbar-docked';

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

    var MAIN_LABELS = [
        [/^\/account\/api(\/|$)/,      'API'],
        [/^\/account\/ssh(\/|$)/,      'SSH'],
        [/^\/account\/activity(\/|$)/, 'Actividad'],
        [/^\/account(\/|$)/,           'Cuenta'],
        [/^\/admin(\/|$)/,             'Admin'],
        [/^\/(index)?$/,               'Servidores']
    ];

    /* Ultimo recurso para botones que no son enlaces y llegan sin aria-label ni
       title: el boton de cerrar sesion de Pterodactyl solo contiene un SVG de
       FontAwesome con aria-hidden, asi que sin esto se queda sin rotulo y el
       CSS lo anula con :not([data-waise-label]). Se identifica por el icono. */
    var ICON_LABELS = [
        ['sign-out-alt', 'Cerrar sesion'],
        ['sign-out',     'Cerrar sesion'],
        ['sign-in-alt',  'Iniciar sesion'],
        ['search',       'Buscar'],
        ['user',         'Cuenta'],
        ['cogs',         'Admin'],
        ['layer-group',  'Servidores']
    ];

    var applied  = { target: null, kind: null, root: null };
    var labeled  = [];
    var styleLog = [];
    var styleSeen = new Map();
    var rejected = new WeakSet();

    function setImportant(el, prop, value) {
        var props = styleSeen.get(el);
        if (!props) { props = new Set(); styleSeen.set(el, props); }
        if (!props.has(prop)) {
            props.add(prop);
            styleLog.push({ el: el, prop: prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
        }
        if (el.style.getPropertyValue(prop) !== value || el.style.getPropertyPriority(prop) !== 'important') {
            el.style.setProperty(prop, value, 'important');
        }
    }

    function applyReset(el, pairs) {
        for (var i = 0; i < pairs.length; i++) setImportant(el, pairs[i][0], pairs[i][1]);
    }

    function restoreStyles() {
        for (var i = styleLog.length - 1; i >= 0; i--) {
            var s = styleLog[i];
            if (s.value) { s.el.style.setProperty(s.prop, s.value, s.priority); }
            else { s.el.style.removeProperty(s.prop); }
        }
        styleLog = []; styleSeen = new Map();
    }

    function currentServerId() {
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    function directLinkCount(el) {
        var n = 0;
        for (var i = 0; i < el.children.length; i++) {
            var c = el.children[i];
            if (c.classList && c.classList.contains(NAV_EXTRA_CLASS)) { continue; }
            if (c.tagName === 'A' || c.tagName === 'BUTTON') { n++; }
            else if (c.querySelector && c.querySelector('a[href], button')) { n++; }
        }
        return n;
    }

    function findRow(root, validate) {
        var best = null, bestCount = 0, bestDepth = -1;
        (function walk(el, depth) {
            var count = directLinkCount(el);
            if (count >= 2 && (count > bestCount || (count === bestCount && depth > bestDepth)) && validate(el)) {
                best = el; bestCount = count; bestDepth = depth;
            }
            for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1);
        })(root, 0);
        return best;
    }

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

    function validMainRow(el) {
        if (el.querySelector('a[href*="/server/"]')) return false;
        var links = el.querySelectorAll('a[href], button');
        if (links.length < 2 || links.length > 14) return false;
        var known = false;
        for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            if (href === '/' || href === '/index' || href.indexOf('/account') === 0 || href.indexOf('/admin') === 0) {
                known = true; break;
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

    function hideStrays(parent, child) {
        for (var i = 0; i < parent.children.length; i++) {
            var el = parent.children[i];
            if (el === child || el === applied.target) continue;
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
            /* Las entradas propias del tema jamas son "strays": cumplen el
               criterio de tamano (poco alto, pocos nodos) y quedaban apagadas
               con display:none !important de forma permanente, porque
               renderNavItems reutiliza el nodo y nunca reescribe su display.
               De ahi que a veces saliera Dividir y a veces Mods/Plugins. */
            if (el.classList.contains(NAV_EXTRA_CLASS)) continue;
            if (el.getBoundingClientRect().height > 160) continue;
            if (el.querySelectorAll('*').length > 40) continue;
            setImportant(el, 'display', 'none');
        }
    }

    function accessibleName(el) {
        /* TITLE_ATTR primero: en ciclos posteriores el title ya no esta en el
           nodo porque lo retiro labelizeItems. */
        var v = el.getAttribute(TITLE_ATTR) || el.getAttribute('aria-label') || el.getAttribute('title');
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
            try { path = new URL(href, window.location.origin).pathname; } catch (e) { path = href; }
            for (var i = 0; i < MAIN_LABELS.length; i++) {
                if (MAIN_LABELS[i][0].test(path)) return MAIN_LABELS[i][1];
            }
        }
        var icon = el.querySelector('svg[data-icon]');
        var iconName = icon ? icon.getAttribute('data-icon') : null;
        if (!iconName) {
            /* Fallback por clase: algunas versiones renderizan fa-sign-out-alt
               sin exponer data-icon. className en un SVG es SVGAnimatedString. */
            var svg = el.querySelector('svg');
            var cls = svg ? (svg.getAttribute('class') || '') : '';
            var m = cls.match(/\bfa-([a-z0-9-]+)\b/);
            if (m && m[1] !== 'w' && m[1] !== 'fw' && m[1] !== 'inline') iconName = m[1];
        }
        if (iconName) {
            for (var j = 0; j < ICON_LABELS.length; j++) {
                if (ICON_LABELS[j][0] === iconName) return ICON_LABELS[j][1];
            }
        }
        return null;
    }

    function labelizeItems(scope) {
        var items = scope.querySelectorAll('a[href], button');
        for (var i = 0; i < items.length; i++) {
            var el = items[i];
            if (el.textContent && el.textContent.trim() !== '') {
                if (el.hasAttribute(LABEL_ATTR)) el.removeAttribute(LABEL_ATTR);
                continue;
            }
            var label = accessibleName(el);
            if (!label) continue;
            if (el.getAttribute(LABEL_ATTR) !== label) el.setAttribute(LABEL_ATTR, label);
            /* Se guarda el title original una sola vez (cadena vacia = no tenia)
               y se retira, para que el tooltip nativo no muestre el texto en
               ingles junto al rotulo del tema. El aria-label pasa al rotulo
               traducido para que el lector de pantalla diga lo mismo que se ve. */
            if (!el.hasAttribute(TITLE_ATTR)) {
                el.setAttribute(TITLE_ATTR, el.getAttribute('title') || '');
            }
            if (el.hasAttribute('title')) el.removeAttribute('title');
            if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
            if (labeled.indexOf(el) === -1) labeled.push(el);
        }
    }

    function labelize(target, kind) {
        if (kind !== 'main') return;
        labelizeItems(target);
    }

    /* Dentro de un servidor la columna la ocupa el menú del servidor, y la
       barra superior se quedaba con sus cinco acciones duplicando navegación.
       No se mueve el nodo: `NavigationBar` la renderiza React y sacarla de su
       padre revienta con NotFoundError al desmontar. Se ancla por CSS al pie
       de la columna, así que los handlers originales siguen intactos. */
    function dockTopbar(kind) {
        if (kind !== 'server') { undockTopbar(); return; }
        var bar = document.querySelector(TOPBAR_SEL);
        if (!bar || bar === applied.target || bar.contains(applied.target)) { undockTopbar(); return; }
        /* React re-monta `NavigationBar` al cambiar de sección: el nodo viejo
           puede seguir en el documento (o desconectado) con la clase puesta y
           se pintaba un segundo bloque al pie de la columna. Solo la fila
           vigente conserva el anclaje. */
        document.querySelectorAll('.' + DOCK_CLASS).forEach(function (el) {
            if (el !== bar) el.classList.remove(DOCK_CLASS);
        });
        bar.classList.add(DOCK_CLASS);
        HTML.classList.add(DOCK_GATE);
        /* `NavigationBar` cuelga de otro subárbol que el menú del servidor, así
           que sus ancestros nunca pasaron por CB_RESET. Si alguno tiene
           transform/filter/contain se vuelve el bloque contenedor del elemento
           fijo y el anclaje se resuelve contra él, no contra la ventana: la
           fila reaparecía arriba a la derecha. */
        clearAllAncestors(bar);
        labelizeItems(bar);
    }

    function undockTopbar() {
        HTML.classList.remove(DOCK_GATE);
        document.querySelectorAll('.' + DOCK_CLASS).forEach(function (el) {
            el.classList.remove(DOCK_CLASS);
        });
    }

    function verifyPosition(el) {
        var r = el.getBoundingClientRect();
        return r.left <= 8 && r.width >= 120 && r.width <= 420 && r.height >= window.innerHeight * 0.6;
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
        var target = found.target, kind = found.kind, root = found.root;
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
            child = parent; parent = parent.parentElement;
        }
        labelize(target, kind);
        if (!verify) return;
        if (verifyPosition(target)) return;
        clearAllAncestors(target);
        if (verifyPosition(target)) return;
        rejected.add(target);
        revert();
    }

    function revert() {
        HTML.classList.remove(GATE.server, GATE.main);
        undockTopbar();
        if (applied.target) applied.target.classList.remove(NAV_CLASS.server, NAV_CLASS.main);
        document.querySelectorAll('.' + HOST_CLASS + ', .' + CLEAR_CLASS).forEach(function (el) {
            el.classList.remove(HOST_CLASS, CLEAR_CLASS);
        });
        for (var i = 0; i < labeled.length; i++) {
            var lab = labeled[i];
            lab.removeAttribute(LABEL_ATTR);
            if (lab.hasAttribute(TITLE_ATTR)) {
                var orig = lab.getAttribute(TITLE_ATTR);
                if (orig) { lab.setAttribute('title', orig); }
                else { lab.removeAttribute('title'); }
                lab.removeAttribute(TITLE_ATTR);
            }
        }
        labeled = [];
        removeNavItems(null);
        restoreStyles();
        applied = { target: null, kind: null, root: null };
    }

    /* ====================================================================
       Registro de entradas de la columna
       ====================================================================
       Un unico punto escribe en la nav. Los modulos (waise-mods,
       waise-properties...) solo declaran id, rotulo y cuando deben verse; el
       pintado y el re-pintado tras cada re-montaje de React se hacen aqui,
       dentro del mismo ciclo que ya reconcilia la columna. */

    var navItems = [];

    function navHost() {
        if (applied.kind !== 'server') return null;
        if (!applied.target || !applied.target.isConnected) return null;
        return applied.target;
    }

    function removeNavItems(keepHost) {
        document.querySelectorAll('.' + NAV_EXTRA_CLASS).forEach(function (el) {
            if (keepHost && el.parentNode === keepHost) return;
            if (el.parentNode) el.parentNode.removeChild(el);
        });
    }

    function navValue(value) {
        return typeof value === 'function' ? value() : value;
    }

    /* Idempotente a proposito: la insercion dispara el MutationObserver, que
       vuelve a llamar aqui. Si en la segunda pasada se reordenara o se
       reinsertara algo, el ciclo no cerraria nunca. */
    function renderNavItems() {
        var host = navHost();
        if (!host) { removeNavItems(null); return; }
        removeNavItems(host);

        for (var i = 0; i < navItems.length; i++) {
            var item = navItems[i];
            var visible;
            try { visible = item.visible ? !!item.visible() : true; } catch (e) { visible = false; }

            var el = host.querySelector('[' + NAV_ID_ATTR + '="' + item.id + '"]');
            if (!visible) {
                if (el && el.parentNode) el.parentNode.removeChild(el);
                continue;
            }

            if (!el) {
                el = document.createElement('button');
                el.type = 'button';
                el.className = NAV_EXTRA_CLASS;
                el.setAttribute(NAV_ID_ATTR, item.id);
                var iconBox = document.createElement('span');
                iconBox.className = NAV_EXTRA_CLASS + '__icon';
                iconBox.setAttribute('aria-hidden', 'true');
                var labelBox = document.createElement('span');
                labelBox.className = NAV_EXTRA_CLASS + '__label';
                el.appendChild(iconBox);
                el.appendChild(labelBox);
                el.addEventListener('click', (function (handler) {
                    return function (ev) {
                        ev.preventDefault();
                        try { handler(); } catch (e) { /* un modulo roto no tumba la nav */ }
                    };
                })(item.onClick));
                host.appendChild(el);
            }

            /* El SVG lo aporta un modulo del propio tema, nunca el panel ni el
               servidor: no hay entrada de usuario en esta cadena. Se cachea en
               el nodo para no reescribir innerHTML en cada ciclo, que es lo que
               dispararia otra vuelta del MutationObserver. */
            /* Si un ciclo anterior lo apago (ver hideStrays), hay que
               revertirlo aqui: el nodo se reutiliza y nadie mas toca display. */
            if (el.style.display === 'none') el.style.removeProperty('display');

            var icon = navValue(item.icon) || '';
            var iconSpan = el.querySelector('.' + NAV_EXTRA_CLASS + '__icon');
            if (iconSpan && el.waiseIcon !== icon) {
                el.waiseIcon = icon;
                iconSpan.innerHTML = icon;
            }

            var label = navValue(item.label) || '';
            var span  = el.querySelector('.' + NAV_EXTRA_CLASS + '__label');
            if (span && span.textContent !== label) span.textContent = label;

            var title = navValue(item.title) || label;
            if (el.getAttribute('title') !== title) el.setAttribute('title', title);
            if (el.getAttribute('aria-label') !== title) el.setAttribute('aria-label', title);
        }
    }

    function registerNavItem(item) {
        if (!item || !item.id || typeof item.onClick !== 'function') return;
        for (var i = 0; i < navItems.length; i++) {
            if (navItems[i].id === item.id) { navItems[i] = item; renderNavItems(); return; }
        }
        navItems.push(item);
        /* Orden fijo por `order` (y por id a igualdad): el momento de registro
           varia entre recargas -- el splitter se registra al evaluarse su
           <script> y waise-mods.js en DOMContentLoaded -- y sin esto los
           botones cambiaban de sitio de una carga a otra. */
        navItems.sort(function (a, b) {
            var oa = typeof a.order === 'number' ? a.order : 100;
            var ob = typeof b.order === 'number' ? b.order : 100;
            if (oa !== ob) return oa - ob;
            return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
        });
        renderNavItems();
    }

    function unregisterNavItem(id) {
        for (var i = 0; i < navItems.length; i++) {
            if (navItems[i].id === id) { navItems.splice(i, 1); break; }
        }
        renderNavItems();
    }

    /* El anclaje se reconcilia SIEMPRE al final del ciclo, nunca dentro de
       `mark()`: React reutiliza el nodo de `NavigationBar` entre secciones, así
       que la clase sobrevive a la navegación y las salidas anticipadas de
       `refreshSidebar` dejaban el gate del <html> descuadrado (visible fuera del
       servidor, apagado dentro). Un único punto de salida evita esas fugas. */
    function refreshSidebar() {
        if (window.innerWidth < MIN_VIEWPORT) {
            if (applied.target) revert(); else undockTopbar();
            renderNavItems();
            return;
        }
        var found = locate();
        if (!found || rejected.has(found.target)) {
            if (applied.target) revert(); else undockTopbar();
            renderNavItems();
            return;
        }
        if (applied.target === found.target && applied.kind === found.kind && found.target.isConnected) {
            mark(found, false);
        } else {
            revert();
            mark(found, true);
        }
        if (applied.kind) dockTopbar(applied.kind); else undockTopbar();
        renderNavItems();
    }

    /* ====================================================================
       Parte 2 - Parche de grises inline
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

    function isNeutral(c) {
        if (!c || c.a < 0.05) return false;
        if (c.r === 0 && c.g === 0 && c.b === 0) return false;
        return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) < 40 &&
               Math.max(c.r, c.g, c.b) > 18;
    }

    function patchEl(el) {
        if (!(el instanceof HTMLElement)) return;
        if (SKIP.has(el.tagName)) return;
        if (el.classList.contains(HOST_CLASS) || el.classList.contains(NAV_CLASS.server) || el.classList.contains(NAV_CLASS.main)) return;
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
            if (tc && Math.max(tc.r, tc.g, tc.b) < 60) el.style.setProperty('color', '#e8eaf6', 'important');
        }
    }

    /* ====================================================================
       Parte 3 - Server cards (gate: waise-cards-ready)
       ==================================================================== */

    var cardsDone = false;

    /* Selectores específicos primero, luego fallbacks progresivos */
    var SERVER_ROW_SELS = [
        /* Selectores exactos de styled-components */
        '[class*="ServerRow__Row"]',
        '[class*="ServerEntry__Row"]',
        '[class*="ServerEntry"]',
        '[class*="server-row"]',
        '[class*="server_row"]',
        /* Por atributo de datos */
        '[data-server-id]',
        '[data-server]',
        /* El más universal: cualquier enlace directo a /server/<id>
           que no sea solo navegación interna del servidor */
        'a[href^="/server/"]'
    ];

    var SERVER_CONT_SELS = [
        '[class*="ServerRow__Container"]',
        '[class*="ServerList"]',
        '[class*="servers_container"]',
        '[class*="ServerGrid"]',
        '[class*="ContentContainer"]',
        '[class*="Servers"]'
    ];

    function findServerRows() {
        /* Fuente de verdad: los enlaces a /server/<id> exacto (sin subruta).
           En el marcado real la fila ES el propio <a> (GreyRowBox +
           DashboardContainer___StyledServerRow), así que NO subimos por el
           árbol aquí: la promoción a hijo directo de la rejilla la hace
           setupServerCards, que ya conoce el contenedor. Buscar antes por
           [class*="ServerRow..."] era contraproducente: engancha los divs
           INTERNOS de una misma fila. */
        var links = Array.prototype.slice.call(document.querySelectorAll('a[href^="/server/"]'));
        var rootLinks = links.filter(function (a) {
            var path = a.getAttribute('href') || '';
            /* Acepta /server/<id> y /server/<id>/ pero NO /server/<id>/files */
            return /^\/server\/[^/]+(\/)?$/.test(path);
        });
        if (rootLinks.length) return rootLinks;

        /* Respaldo para paneles con marcado propio: selectores de componente,
           descartando los que estén anidados dentro de otro candidato. */
        for (var i = 0; i < SERVER_ROW_SELS.length - 1; i++) {
            var found = Array.prototype.slice.call(document.querySelectorAll(SERVER_ROW_SELS[i]));
            var outer = found.filter(function (el) {
                return !found.some(function (other) {
                    return other !== el && other.contains(el);
                });
            });
            if (outer.length) return outer;
        }

        return [];
    }

    function findServerContainer(rows) {
        /* Ancestro común MÁS PRÓXIMO. Los selectores explícitos se descartaron
           a propósito: acertaban un envoltorio demasiado alto (ContentContainer),
           y un display:grid ahí no afecta a las filas porque no son sus hijos
           directos — ese era el motivo de que las tarjetas no aparecieran. */
        var el = rows[0].parentElement;
        var guard = 0;
        while (el && guard++ < 12) {
            if (rows.every(function (r) { return el.contains(r); })) return el;
            el = el.parentElement;
        }
        /* 3. Padre directo del primer row como último recurso */
        return rows[0].parentElement;
    }

    function setupServerCards() {
        /* Solo actuar en el listado raíz, nunca dentro de un servidor */
        if (currentServerId()) return false;

        /* Tampoco actuar si la URL tiene subruta que no sea la raíz */
        var path = window.location.pathname;
        if (path !== '/' && path !== '/index' && !/^\/(index)?\/?$/.test(path)) return false;

        var rows = findServerRows();
        if (!rows.length) return false;

        /* Sanidad: los rows deben estar visibles en pantalla */
        var visibleRows = rows.filter(function (r) {
            var rect = r.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        if (!visibleRows.length) return false;

        var container = findServerContainer(visibleRows);
        if (!container) return false;

        /* No aplicar si el contenedor es demasiado alto en el árbol */
        if (container === document.body || container === document.documentElement) return false;

        /* Publicar el gate */
        HTML.classList.add('waise-cards-ready');
        container.classList.add('waise-server-grid');

        visibleRows.forEach(function (row) {
            row.classList.add('waise-server-card');

            /* Envoltorios intermedios entre el contenedor y la tarjeta: se
               disuelven con display:contents para que la tarjeta sea el item
               directo de la rejilla (regla .waise-card-host del CSS). Si la
               fila ya es hija directa del contenedor este bucle no hace nada,
               que es el caso del marcado actual. */
            var wrap = row.parentElement;
            var guard = 0;
            while (wrap && wrap !== container && guard++ < 12) {
                wrap.classList.add('waise-card-host');
                wrap = wrap.parentElement;
            }
        });

        /* Hermanos no-tarjeta: ocupan la fila completa. Los envoltorios de
           tarjetas quedan fuera, ya que grid-column sobre un display:contents
           no tendría efecto y estiraría la columna al reactivarse. */
        Array.prototype.forEach.call(container.children, function (child) {
            if (child.classList.contains('waise-server-card')) return;
            if (child.classList.contains('waise-card-host')) return;
            if (child.querySelector('.waise-server-card')) return;
            child.classList.add('waise-grid-full');
        });

        return true;
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
                if (!cardsDone) cardsDone = setupServerCards();
            } catch (e) {
                try { revert(); } catch (e2) { /* nada */ }
            }
        });
    }

    var observer = new MutationObserver(function (muts) {
        var needsSidebarPass = false;
        for (var i = 0; i < muts.length; i++) {
            var m = muts[i];
            if (m.type === 'attributes' && m.attributeName === 'style') {
                if (styleSeen.has(m.target)) { needsSidebarPass = true; }
                else { patchEl(m.target); }
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
        if (!cardsDone) cardsDone = setupServerCards();
        schedule();

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style']
        });

        window.addEventListener('resize', schedule, { passive: true });

        function onNavigate() {
            cardsDone = false;
            HTML.classList.remove('waise-cards-ready');
            document.querySelectorAll('.waise-server-grid, .waise-server-card, .waise-card-host, .waise-grid-full')
                .forEach(function (el) {
                    el.classList.remove('waise-server-grid', 'waise-server-card', 'waise-card-host', 'waise-grid-full');
                });
            schedule();
        }

        window.addEventListener('popstate', onNavigate);

        /* El panel navega con React Router: los clics en el menú llaman a
           pushState, que NO dispara popstate. Sin esto el cambio de sección
           solo se veía cuando alguna mutación del DOM lo arrastraba, y el
           estado del anclaje quedaba desfasado respecto a la URL. */
        ['pushState', 'replaceState'].forEach(function (name) {
            var original = window.history[name];
            if (typeof original !== 'function') return;
            window.history[name] = function () {
                var result = original.apply(this, arguments);
                onNavigate();
                return result;
            };
        });
    }

    /* Publicado de forma sincrona al evaluar el script: los modulos que se
       cargan despues pueden registrarse sin esperar a DOMContentLoaded. */
    window.WaiseNav = {
        register: registerNavItem,
        unregister: unregisterNavItem,
        refresh: renderNavItems
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();