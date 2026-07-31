/* =========================================================================
   Waise Theme v1.2.0 - Sidebar lateral del panel de cliente (Pterodactyl)

   Por qué existe este archivo:
   El panel es una SPA con styled-components; la sub-navegación del servidor
   NO tiene un id estable como `#sub-navigation`, así que cualquier CSS que
   dependa de ese id falla en silencio y deja el layout a medias. Aquí se
   localiza el contenedor real por los enlaces que contiene y solo entonces
   se activa el layout de sidebar.

   Reglas de seguridad que sigue este script:
   - NO mueve nodos del DOM. React destruye nodos con parent.removeChild();
     reparentar el menú provocaría NotFoundError (pantalla en blanco) al
     navegar. Aquí solo se añaden/quitan clases.
   - Si no encuentra el contenedor, quita la clase de <html> y el panel se
     queda en su diseño nativo: nunca en un estado intermedio roto.
   - Cualquier excepción desactiva el layout en lugar de dejarlo a medias.
   - Interruptor manual: localStorage['waise-sidebar'] = 'off'
     (o WaiseTheme.disable() desde la consola del navegador).
   ========================================================================= */
(function () {
    'use strict';

    var HTML_READY  = 'waise-sidebar-ready';
    var NAV_CLASS   = 'waise-server-nav';
    var HOST_CLASS  = 'waise-nav-host';
    var STORAGE_KEY = 'waise-sidebar';

    /* Mínimo de enlaces del mismo servidor para considerarlo un menú y no un
       enlace suelto (Consola, Archivos, Bases de datos... siempre son >= 3). */
    var MIN_LINKS = 3;

    /* /server/<id> o /server/<id>/<subpagina> */
    var SERVER_PATH = /^\/server\/([^/?#]+)(?:\/|$)/;

    function isDisabled() {
        try {
            return window.localStorage.getItem(STORAGE_KEY) === 'off';
        } catch (err) {
            /* Modo privado o storage bloqueado: no es motivo para desactivar. */
            return false;
        }
    }

    function isElement(node) {
        return !!node && node.nodeType === 1;
    }

    /* Contenedores demasiado genéricos: aplicarles el layout rompería la página. */
    function isEligibleContainer(node) {
        return isElement(node) &&
            node !== document.body &&
            node !== document.documentElement &&
            node.id !== 'app';
    }

    function serverIdOf(anchor) {
        var href = anchor.getAttribute('href');
        if (!href) {
            return null;
        }
        var pathname;
        try {
            pathname = new URL(href, window.location.origin).pathname;
        } catch (err) {
            return null;
        }
        var match = SERVER_PATH.exec(pathname);
        return match ? match[1] : null;
    }

    function register(groups, node, serverId, depth) {
        if (!isEligibleContainer(node)) {
            return;
        }
        var group = groups.get(node);
        if (!group) {
            group = { count: 0, depth: depth, unique: 0, ids: Object.create(null) };
            groups.set(node, group);
        }
        group.count += 1;
        if (depth < group.depth) {
            group.depth = depth;
        }
        if (!group.ids[serverId]) {
            group.ids[serverId] = true;
            group.unique += 1;
        }
    }

    /**
     * Devuelve el contenedor de la sub-navegación del servidor, o null.
     *
     * Discriminante clave: el menú del servidor apunta MUCHAS veces al MISMO
     * servidor (distintas subpáginas), mientras que la lista del dashboard
     * apunta a servidores DISTINTOS. Por eso se exige unique === 1.
     */
    function findServerNav() {
        var anchors = document.querySelectorAll('a[href*="/server/"]');
        var groups = new Map();
        var i;

        for (i = 0; i < anchors.length; i++) {
            var serverId = serverIdOf(anchors[i]);
            if (!serverId) {
                continue;
            }
            var parent = anchors[i].parentElement;
            /* depth 0: enlaces hermanos directos.
               depth 1: cada enlace envuelto en su propio <div>. */
            register(groups, parent, serverId, 0);
            register(groups, parent ? parent.parentElement : null, serverId, 1);
        }

        var best = null;
        groups.forEach(function (group, node) {
            if (group.count < MIN_LINKS || group.unique !== 1) {
                return;
            }
            if (best) {
                if (group.depth > best.depth) {
                    return;
                }
                if (group.depth === best.depth && group.count <= best.count) {
                    return;
                }
            }
            best = { node: node, count: group.count, depth: group.depth };
        });

        return best ? best.node : null;
    }

    function removeClassFrom(selector, className, keep) {
        var nodes = document.querySelectorAll(selector);
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i] !== keep) {
                nodes[i].classList.remove(className);
            }
        }
    }

    function clear() {
        document.documentElement.classList.remove(HTML_READY);
        removeClassFrom('.' + NAV_CLASS, NAV_CLASS, null);
        removeClassFrom('.' + HOST_CLASS, HOST_CLASS, null);
    }

    function apply() {
        if (isDisabled()) {
            clear();
            return;
        }

        var nav = findServerNav();
        var host = nav && isEligibleContainer(nav.parentElement) ? nav.parentElement : null;

        removeClassFrom('.' + NAV_CLASS, NAV_CLASS, nav);
        removeClassFrom('.' + HOST_CLASS, HOST_CLASS, host);

        if (!nav) {
            /* Página sin menú de servidor (dashboard, cuenta...): layout nativo. */
            document.documentElement.classList.remove(HTML_READY);
            return;
        }

        nav.classList.add(NAV_CLASS);
        if (host) {
            host.classList.add(HOST_CLASS);
        }
        document.documentElement.classList.add(HTML_READY);
    }

    var scheduled = false;

    function schedule() {
        if (scheduled) {
            return;
        }
        scheduled = true;
        var run = function () {
            scheduled = false;
            try {
                apply();
            } catch (err) {
                clear();
                if (window.console && typeof console.warn === 'function') {
                    console.warn('[waise] sidebar desactivada por un error:', err);
                }
            }
        };
        if (typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(run);
        } else {
            window.setTimeout(run, 16);
        }
    }

    function observe() {
        if (typeof window.MutationObserver !== 'function') {
            /* Sin observer: al menos se aplica una vez y en cada navegación. */
            return;
        }
        /* Solo childList: no se observan atributos, así que nuestras propias
           clases no vuelven a disparar el observer. */
        new MutationObserver(schedule).observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function start() {
        observe();
        schedule();
        window.addEventListener('popstate', schedule);
        window.addEventListener('hashchange', schedule);
    }

    window.WaiseTheme = window.WaiseTheme || {};
    window.WaiseTheme.refresh = schedule;
    window.WaiseTheme.disable = function () {
        try {
            window.localStorage.setItem(STORAGE_KEY, 'off');
        } catch (err) { /* sin storage: al menos se limpia esta sesión */ }
        clear();
    };
    window.WaiseTheme.enable = function () {
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch (err) { /* idem */ }
        schedule();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}());