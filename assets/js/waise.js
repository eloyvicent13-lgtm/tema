/* =========================================================================
   Waise Theme v1.4.0 - Layout del panel de cliente (Pterodactyl)

   Qué hace:
   - Dentro de un servidor: el menú del servidor (Consola, Archivos, Bases de
     datos...) pasa a la columna lateral fija.
   - En las páginas normales (dashboard, cuenta, API, admin): la barra de
     navegación principal pasa a esa misma columna.
   - En el listado de servidores: marca el contenedor y cada fila para que el
     CSS las convierta en tarjetas en rejilla (v1.4.0). El listado se distingue
     del menú de un servidor por el recuento de enlaces: en el listado hay UN
     enlace por servidor (total === unique), en el menú hay varios al MISMO
     servidor (total > unique).
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

    /* Rejilla de tarjetas del listado de servidores. */
    var HTML_CARDS     = 'waise-cards-ready';
    var GRID_CLASS     = 'waise-server-grid';
    var CARD_CLASS     = 'waise-server-card';
    var SPAN_CLASS     = 'waise-grid-full';
    var HOSTCARD_CLASS = 'waise-card-host';

    /* Un contenedor con demasiados hijos no es un listado de servidores, es un
       envoltorio de página: convertirlo en rejilla rompería el layout. */
    var MAX_GRID_CHILDREN = 40;

    /* Mínimo de enlaces del mismo servidor para considerarlo un menú y no un
       enlace suelto (Consola, Archivos, Bases de datos... siempre son >= 3). */
    var MIN_SERVER_LINKS = 3;

    /* La barra principal puede tener muy pocos enlaces (inicio + cuenta). */
    var MIN_MAIN_LINKS = 2;

    /* Los enlaces de la barra principal son de SOLO ICONO: en horizontal se
       entendían, pero en la columna quedan iconos sin nombre. El rótulo se
       publica en este atributo y el CSS lo pinta con ::after. No se inserta
       texto en el DOM para no interferir con React. */
    var LABEL_ATTR = 'data-waise-label';

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

    /* Rótulo por ruta. Se compara por prefijo porque /account y /admin tienen
       subpáginas y el enlace puede apuntar a cualquiera de ellas. */
    function labelFor(pathname) {
        if (pathname === '/') {
            return 'Inicio';
        }
        if (/^\/account(?:\/|$)/.test(pathname)) {
            return 'Cuenta';
        }
        if (/^\/admin(?:\/|$)/.test(pathname)) {
            return 'Administración';
        }
        if (/^\/auth\/logout\/?$/.test(pathname)) {
            return 'Cerrar sesión';
        }
        return null;
    }

    /* Quita el rótulo y el aria-label SOLO si lo pusimos nosotros (coinciden). */
    function dropLabel(node) {
        if (node.getAttribute('aria-label') === node.getAttribute(LABEL_ATTR)) {
            node.removeAttribute('aria-label');
        }
        node.removeAttribute(LABEL_ATTR);
    }

    function clearLabels(keep) {
        var labelled = document.querySelectorAll('[' + LABEL_ATTR + ']');
        for (var i = 0; i < labelled.length; i++) {
            if (keep && keep.contains(labelled[i])) {
                continue;
            }
            dropLabel(labelled[i]);
        }
    }

    /**
     * Rotula los elementos de la barra principal que no tienen texto visible.
     * Es idempotente: no escribe si el valor ya es el correcto, así no genera
     * mutaciones inútiles en cada pasada del observer.
     */
    function labelMainNav(nav) {
        var items = nav.querySelectorAll('a[href], button');
        var i;

        for (i = 0; i < items.length; i++) {
            var item = items[i];

            /* Si ya tiene texto propio no se inventa ninguno: es el caso del
               menú de servidor y de cualquier barra que sí venga rotulada. */
            if (item.textContent.trim() !== '') {
                dropLabel(item);
                continue;
            }

            /* Los botones (buscar, etc.) no tienen ruta: se respeta el nombre
               accesible que traigan y, si no traen ninguno, se dejan como
               están en lugar de adivinar para qué sirven. */
            var label = item.tagName === 'BUTTON'
                ? (item.getAttribute('aria-label') || item.getAttribute('title'))
                : labelFor(pathnameOf(item) || '');

            if (!label) {
                dropLabel(item);
                continue;
            }

            if (item.getAttribute(LABEL_ATTR) !== label) {
                item.setAttribute(LABEL_ATTR, label);
            }
            /* El texto de ::after no forma parte del DOM accesible en todos los
               navegadores; el aria-label garantiza que se anuncie. */
            if (!item.getAttribute('aria-label') && !item.getAttribute('title')) {
                item.setAttribute('aria-label', label);
            }
        }
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

    /* Recuento global de enlaces a servidores de la página. */
    function serverLinkStats() {
        var anchors = document.querySelectorAll('a[href]');
        var ids = Object.create(null);
        var stats = { total: 0, unique: 0 };
        var i;

        for (i = 0; i < anchors.length; i++) {
            var key = serverKeyOf(anchors[i]);
            if (!key) {
                continue;
            }
            stats.total += 1;
            if (!ids[key]) {
                ids[key] = true;
                stats.unique += 1;
            }
        }

        return stats;
    }

    /**
     * Contenedor del listado de servidores. Solo se acepta si agrupa TODOS los
     * enlaces a servidores de la página y ninguno se repite. Así el menú de un
     * servidor (varios enlaces al mismo id) o un enlace suelto dentro de una
     * página de servidor nunca se confunden con el listado.
     */
    function findServerGrid() {
        var stats = serverLinkStats();

        if (stats.total === 0 || stats.total !== stats.unique) {
            return null;
        }

        return pick(collect(serverKeyOf), function (group, node) {
            return group.count === stats.total &&
                group.unique === stats.unique &&
                node.children.length <= MAX_GRID_CHILDREN;
        });
    }

    function isServerAnchor(node) {
        return isElement(node) && node.tagName === 'A' && !!serverKeyOf(node);
    }

    /* Enlace de servidor de una tarjeta: el propio nodo o el ÚNICO que
       contenga. Con dos o más no es una tarjeta y se descarta. */
    function cardAnchorIn(node) {
        if (isServerAnchor(node)) {
            return node;
        }
        if (!isElement(node)) {
            return null;
        }

        var anchors = node.querySelectorAll('a[href]');
        var found = null;
        var i;

        for (i = 0; i < anchors.length; i++) {
            if (!isServerAnchor(anchors[i])) {
                continue;
            }
            if (found) {
                return null;
            }
            found = anchors[i];
        }

        return found;
    }

    function clearCards(keep) {
        var nodes = document.querySelectorAll(
            '.' + CARD_CLASS + ', .' + SPAN_CLASS + ', .' + HOSTCARD_CLASS
        );
        var i;

        for (i = 0; i < nodes.length; i++) {
            if (keep && keep !== nodes[i] && keep.contains(nodes[i])) {
                continue;
            }
            nodes[i].classList.remove(CARD_CLASS);
            nodes[i].classList.remove(SPAN_CLASS);
            nodes[i].classList.remove(HOSTCARD_CLASS);
        }
    }

    /**
     * Marca cada hijo del listado: tarjeta, envoltorio de tarjeta, o elemento a
     * fila completa (título, buscador, paginación). Devuelve cuántas tarjetas
     * ha encontrado; con 0 la rejilla no se activa y el listado se queda nativo.
     */
    function markGrid(grid) {
        var children = grid.children;
        var cards = 0;
        var i;

        for (i = 0; i < children.length; i++) {
            var child = children[i];
            var anchor = cardAnchorIn(child);

            if (!anchor) {
                child.classList.remove(CARD_CLASS);
                child.classList.remove(HOSTCARD_CLASS);
                child.classList.add(SPAN_CLASS);
                continue;
            }

            child.classList.remove(SPAN_CLASS);

            if (anchor === child) {
                child.classList.remove(HOSTCARD_CLASS);
                child.classList.add(CARD_CLASS);
            } else {
                /* El envoltorio se disuelve con `display: contents` (CSS) para
                   que la tarjeta sea el item de la rejilla y no arrastre el
                   margen vertical de la lista original. */
                child.classList.remove(CARD_CLASS);
                child.classList.add(HOSTCARD_CLASS);
                anchor.classList.add(CARD_CLASS);
            }

            cards += 1;
        }

        return cards;
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
        removeClassFrom('.' + GRID_CLASS, GRID_CLASS, null);
        root.classList.remove(HTML_CARDS);
        clearCards(null);
        clearLabels(null);
    }

    function apply() {
        if (isDisabled()) {
            clear();
            return;
        }

        var root = document.documentElement;
        /* `giveUp` solo desactiva la columna lateral, que es la que depende de
           `position: fixed`. La rejilla de tarjetas no, así que sigue activa. */
        var serverNav = giveUp ? null : findServerNav();
        /* Dentro de un servidor la columna es del menú del servidor; la barra
           principal se queda donde está. */
        var mainNav = (giveUp || serverNav) ? null : findMainNav();
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
            clearLabels(mainNav);
            labelMainNav(mainNav);
        } else {
            root.classList.remove(HTML_MAIN);
            clearLabels(null);
        }

        if (host) {
            host.classList.add(HOST_CLASS);
        }

        /* Rejilla de tarjetas: solo donde se lista más de un servidor distinto
           (dashboard). Dentro de un servidor no se busca siquiera. */
        var grid = serverNav ? null : findServerGrid();
        var cards = 0;

        removeClassFrom('.' + GRID_CLASS, GRID_CLASS, grid);

        if (grid) {
            clearCards(grid);
            cards = markGrid(grid);
        } else {
            clearCards(null);
        }

        if (grid && cards > 0) {
            grid.classList.add(GRID_CLASS);
            root.classList.add(HTML_CARDS);
        } else {
            if (grid) {
                grid.classList.remove(GRID_CLASS);
            }
            root.classList.remove(HTML_CARDS);
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
        var grid = serverNav ? null : findServerGrid();
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
            grid: grid,
            cards: document.querySelectorAll('.' + CARD_CLASS).length,
            serverLinks: serverLinkStats(),
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