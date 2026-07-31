/* =========================================================================
   Waise Theme v1.3.2 - Sidebar lateral del panel de cliente (Pterodactyl)

   Qué hace:
   - Dentro de un servidor: el menú del servidor (Consola, Archivos, Bases de
     datos...) pasa a la columna lateral fija.
   - En las páginas normales (dashboard, cuenta, API, admin): la barra de
     navegación principal pasa a esa misma columna.
   Nunca las dos a la vez: si existe menú de servidor, él ocupa la columna y la
   barra principal se queda arriba, para que no se peleen por el mismo hueco.

   Por qué se detecta por enlaces y no por ids:
   El panel es una SPA con styled-components. `#sub-navigation` no existe en
   todas las versiones y `#navigation` tampoco es fiable, así que cualquier CSS
   que dependa de esos ids falla en silencio y deja el layout a medias (eso
   rompió la v1.1.0). Aquí se localiza el contenedor real por los enlaces que
   contiene y solo entonces se activa el layout.

   Discriminantes:
   - Menú de servidor: 3+ enlaces que apuntan AL MISMO servidor (unique === 1).
     La lista del dashboard apunta a servidores distintos, así que no cuela.
   - Barra principal: 2+ rutas DISTINTAS fuera de /server/... y con un enlace a
     "/" presente. Las sub-pestañas de /account no enlazan a "/", así que no se
     confunden con la barra.

   Reglas de seguridad que sigue este script:
   - NO mueve nodos del DOM. React destruye nodos con parent.removeChild();
     reparentar el menú provocaría NotFoundError (pantalla en blanco) al
     navegar. Aquí solo se añaden/quitan clases.
   - Si no encuentra nada, quita las clases de <html> y el panel se queda en su
     diseño nativo: nunca en un estado intermedio roto.
   - Cualquier excepción desactiva el layout en lugar de dejarlo a medias.
   - Interruptor manual: localStorage['waise-sidebar'] = 'off'
     (o WaiseTheme.disable() desde la consola del navegador).
   ========================================================================= */
(function () {
    'use strict';

    var HTML_SERVER = 'waise-sidebar-ready';
    var HTML_MAIN   = 'waise-mainnav-ready';
    var NAV_CLASS   = 'waise-server-nav';
    var MAIN_CLASS  = 'waise-main-nav';
    var HOST_CLASS  = 'waise-nav-host';
    var CLEAR_CLASS = 'waise-nav-clear';
    var STORAGE_KEY = 'waise-sidebar';

    /* Mínimo de enlaces del mismo servidor para considerarlo un menú y no un
       enlace suelto (Consola, Archivos, Bases de datos... siempre son >= 3). */
    var MIN_SERVER_LINKS = 3;

    /* La barra principal puede tener muy pocos enlaces (inicio + cuenta). */
    var MIN_MAIN_LINKS = 2;

    /* Cotas de seguridad: un contenedor con demasiados hijos no es una barra de
       navegación, es un envoltorio de página; convertirlo en columna rompería
       el layout. Lo mismo para el host que se neutraliza. */
    var MAX_MAIN_CHILDREN = 12;
    var MAX_HOST_CHILDREN = 3;

    /* /server/<id> o /server/<id>/<subpagina> */
    var SERVER_PATH = /^\/server\/([^/?#]+)(?:\/|$)/;

    /* Rutas de primer nivel del área de cliente. */
    var MAIN_PATH = /^\/(?:$|account(?:\/|$)|admin(?:\/|$)|auth\/logout\/?$)/;

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

    /* El host es el elemento que envuelve la barra y que hay que neutralizar
       (queda vacío al pasar su contenido a posición fija). Debe ser pequeño: si
       tiene muchos hijos es contenido de la página, no la franja de la barra. */
    function isEligibleHost(node) {
        return isEligibleContainer(node) && node.children.length <= MAX_HOST_CHILDREN;
    }

    function pathnameOf(anchor) {
        var href = anchor.getAttribute('href');
        if (!href) {
            return null;
        }
        try {
            return new URL(href, window.location.origin).pathname;
        } catch (err) {
            return null;
        }
    }

    /* Clave de agrupación del menú de servidor: el id del servidor. */
    function serverKeyOf(anchor) {
        var pathname = pathnameOf(anchor);
        if (!pathname) {
            return null;
        }
        var match = SERVER_PATH.exec(pathname);
        return match ? match[1] : null;
    }

    /* Clave de agrupación de la barra principal: la propia ruta. */
    function mainKeyOf(anchor) {
        var pathname = pathnameOf(anchor);
        if (!pathname || SERVER_PATH.test(pathname)) {
            return null;
        }
        return MAIN_PATH.test(pathname) ? pathname : null;
    }

    function register(groups, node, key, depth) {
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
        if (!group.ids[key]) {
            group.ids[key] = true;
            group.unique += 1;
        }
    }

    /* Agrupa los enlaces por contenedor.
       depth 0: enlaces hermanos directos.
       depth 1: cada enlace envuelto en su propio <div>. */
    function collect(keyOf) {
        var anchors = document.querySelectorAll('a[href]');
        var groups = new Map();
        var i;

        for (i = 0; i < anchors.length; i++) {
            var key = keyOf(anchors[i]);
            if (!key) {
                continue;
            }
            var parent = anchors[i].parentElement;
            register(groups, parent, key, 0);
            register(groups, parent ? parent.parentElement : null, key, 1);
        }

        return groups;
    }

    /* Gana el candidato más cercano a los enlaces (depth menor) y, a igualdad,
       el que más enlaces agrupa. */
    function pick(groups, accept) {
        var best = null;

        groups.forEach(function (group, node) {
            if (!accept(group, node)) {
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

    function findServerNav() {
        return pick(collect(serverKeyOf), function (group) {
            return group.count >= MIN_SERVER_LINKS && group.unique === 1;
        });
    }

    function findMainNav() {
        return pick(collect(mainKeyOf), function (group, node) {
            return group.count >= MIN_MAIN_LINKS &&
                group.unique >= 2 &&
                group.ids['/'] === true &&
                node.children.length <= MAX_MAIN_CHILDREN;
        });
    }

    /* Se pone a true si la columna no consigue colocarse: entonces se deja el
       layout nativo y no se vuelve a intentar hasta navegar o redimensionar. */
    var giveUp = false;

    function getStyle(node) {
        try {
            return window.getComputedStyle(node) || {};
        } catch (err) {
            return {};
        }
    }

    function cssValue(style, prop) {
        if (style && typeof style.getPropertyValue === 'function') {
            return style.getPropertyValue(prop) || '';
        }
        return '';
    }

    /* Propiedades que convierten a un ancestro en bloque contenedor de los
       elementos `position: fixed`. Si una está activa, la columna se posiciona
       respecto a ese ancestro (queda pequeña y arriba) en vez de a la ventana. */
    var CB_PROPS = [
        'transform',
        'filter',
        'backdrop-filter',
        '-webkit-backdrop-filter',
        'perspective'
    ];

    function createsContainingBlock(style) {
        for (var i = 0; i < CB_PROPS.length; i++) {
            var value = cssValue(style, CB_PROPS[i]);
            if (value && value !== 'none') {
                return true;
            }
        }
        if (/paint|layout|strict|content/.test(cssValue(style, 'contain'))) {
            return true;
        }
        return /transform|filter|perspective/.test(cssValue(style, 'will-change'));
    }

    /**
     * Marca con CLEAR_CLASS los ancestros de la columna que romperían el
     * `position: fixed`, y desmarca los que ya no lo son. Devuelve la lista.
     */
    function unclipAncestors(nav) {
        var kept = [];
        var node = nav ? nav.parentElement : null;

        while (isElement(node) && node !== document.body) {
            /* Si ya está marcado, su estilo actual está neutralizado por
               nuestra propia regla: se mantiene la marca en lugar de volver a
               medirlo, o entraría en un ciclo de poner y quitar la clase. */
            if (node.classList.contains(CLEAR_CLASS) || createsContainingBlock(getStyle(node))) {
                kept.push(node);
            }
            node = node.parentElement;
        }

        var marked = document.querySelectorAll('.' + CLEAR_CLASS);
        for (var i = 0; i < marked.length; i++) {
            if (kept.indexOf(marked[i]) === -1) {
                marked[i].classList.remove(CLEAR_CLASS);
            }
        }
        for (var j = 0; j < kept.length; j++) {
            kept[j].classList.add(CLEAR_CLASS);
        }

        return kept;
    }

    /* Comprueba que la columna ha quedado de verdad en la lateral y a alto
       completo. Por debajo de 1024px no hay columna, así que siempre pasa. */
    function verify(nav) {
        if (!nav || window.innerWidth < 1024) {
            return true;
        }
        var rect = nav.getBoundingClientRect();
        return rect.top <= 2 &&
            rect.width >= 160 &&
            rect.height >= window.innerHeight * 0.6;
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
        var root = document.documentElement;
        root.classList.remove(HTML_SERVER);
        root.classList.remove(HTML_MAIN);
        removeClassFrom('.' + NAV_CLASS, NAV_CLASS, null);
        removeClassFrom('.' + MAIN_CLASS, MAIN_CLASS, null);
        removeClassFrom('.' + HOST_CLASS, HOST_CLASS, null);
        removeClassFrom('.' + CLEAR_CLASS, CLEAR_CLASS, null);
    }

    function apply() {
        if (isDisabled() || giveUp) {
            clear();
            return;
        }

        var root = document.documentElement;
        var serverNav = findServerNav();
        /* Dentro de un servidor la columna es del menú del servidor; la barra
           principal se queda donde está. */
        var mainNav = serverNav ? null : findMainNav();
        var host = null;

        if (serverNav) {
            host = isEligibleContainer(serverNav.parentElement) ? serverNav.parentElement : null;
        } else if (mainNav) {
            host = isEligibleHost(mainNav.parentElement) ? mainNav.parentElement : null;
        }

        removeClassFrom('.' + NAV_CLASS, NAV_CLASS, serverNav);
        removeClassFrom('.' + MAIN_CLASS, MAIN_CLASS, mainNav);
        removeClassFrom('.' + HOST_CLASS, HOST_CLASS, host);

        if (serverNav) {
            serverNav.classList.add(NAV_CLASS);
            root.classList.add(HTML_SERVER);
        } else {
            root.classList.remove(HTML_SERVER);
        }

        if (mainNav) {
            mainNav.classList.add(MAIN_CLASS);
            root.classList.add(HTML_MAIN);
        } else {
            root.classList.remove(HTML_MAIN);
        }

        if (host) {
            host.classList.add(HOST_CLASS);
        }

        var target = serverNav || mainNav;
        unclipAncestors(target);

        /* Última red de seguridad: si tras neutralizar los ancestros la columna
           sigue sin ocupar la lateral, se vuelve al layout nativo en lugar de
           dejar un recuadro pequeño arriba. */
        if (target && !verify(target)) {
            giveUp = true;
            clear();
            if (window.console && typeof console.warn === 'function') {
                console.warn('[waise] no se pudo colocar la columna lateral; layout nativo restaurado. Contenedor:', target);
            }
        }
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

    /* Al navegar o cambiar el tamaño de la ventana se vuelve a intentar: el
       DOM y el ancho disponible son distintos. */
    function retry() {
        giveUp = false;
        schedule();
    }

    function start() {
        observe();
        schedule();
        window.addEventListener('popstate', retry);
        window.addEventListener('hashchange', retry);
        window.addEventListener('resize', retry);
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
        giveUp = false;
        schedule();
    };
    /* Diagnóstico rápido desde la consola si algo no se detecta o se coloca mal.
       `blockers` son los ancestros que romperían el `position: fixed`; si ya
       están neutralizados por CLEAR_CLASS, la lista sale vacía. */
    window.WaiseTheme.inspect = function () {
        var serverNav = findServerNav();
        var mainNav = serverNav ? null : findMainNav();
        var target = serverNav || mainNav;
        var blockers = [];
        var node = target ? target.parentElement : null;

        while (isElement(node) && node !== document.body) {
            if (createsContainingBlock(getStyle(node))) {
                blockers.push(node);
            }
            node = node.parentElement;
        }

        return {
            serverNav: serverNav,
            mainNav: mainNav,
            rect: target ? target.getBoundingClientRect() : null,
            cleared: document.querySelectorAll('.' + CLEAR_CLASS).length,
            blockers: blockers,
            gaveUp: giveUp,
            disabled: isDisabled()
        };
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
}());