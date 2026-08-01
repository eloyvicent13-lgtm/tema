/* ==========================================================================
   Waise Theme v1.5.14 - assets/js/waise.js
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
            try { path = new URL(href, window.location.origin).pathname; } catch (e) { path = href; }
            for (var i = 0; i < MAIN_LABELS.length; i++) {
                if (MAIN_LABELS[i][0].test(path)) return MAIN_LABELS[i][1];
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
        if (kind !== 'server') return;
        var bar = document.querySelector(TOPBAR_SEL);
        if (!bar || bar === applied.target || bar.contains(applied.target)) return;
        bar.classList.add(DOCK_CLASS);
        HTML.classList.add(DOCK_GATE);
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
        dockTopbar(kind);
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
        for (var i = 0; i < labeled.length; i++) labeled[i].removeAttribute(LABEL_ATTR);
        labeled = [];
        restoreStyles();
        applied = { target: null, kind: null, root: null };
    }

    function refreshSidebar() {
        if (window.innerWidth < MIN_VIEWPORT) { if (applied.target) revert(); return; }
        var found = locate();
        if (!found || rejected.has(found.target)) { if (applied.target) revert(); return; }
        if (applied.target === found.target && applied.kind === found.kind && found.target.isConnected) {
            mark(found, false); return;
        }
        revert();
        mark(found, true);
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
        window.addEventListener('popstate', function () {
            cardsDone = false;
            HTML.classList.remove('waise-cards-ready');
            document.querySelectorAll('.waise-server-grid, .waise-server-card, .waise-card-host, .waise-grid-full')
                .forEach(function (el) {
                    el.classList.remove('waise-server-grid', 'waise-server-card', 'waise-card-host', 'waise-grid-full');
                });
            schedule();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();