/* ==========================================================================
   Waise Theme - assets/js/waise-features.js
   Modulo de funcionalidades. Independiente de waise.js (sidebar) a proposito:
   un fallo aqui no debe tumbar la navegacion del panel.

   Fase 1 - nucleo: preferencias persistentes, toasts, router SPA.
   Fase 2 - copiar direccion, atajos de teclado, historial de consola.
   ========================================================================== */
(function () {
    'use strict';

    var PREFS_KEY = 'waise:prefs';
    var HISTORY_KEY = 'waise:console-history';
    var HISTORY_MAX = 120;

    /* ====================================================================
       Nucleo - preferencias
       ==================================================================== */

    var defaults = {
        copyAddress: true,
        shortcuts: true,
        consoleHistory: true,
        favorites: true,
        serverFilter: true,
        quickNav: true,
        actionGuard: true,
        focusMode: true,
        backToTop: true,
        passwordReveal: true,
        pageTitle: true,
        helpOverlay: true,
        sessionClock: false
    };

    var prefs = (function readPrefs() {
        var out = {};
        for (var k in defaults) {
            if (Object.prototype.hasOwnProperty.call(defaults, k)) out[k] = defaults[k];
        }
        try {
            var raw = window.localStorage.getItem(PREFS_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    for (var key in parsed) {
                        if (Object.prototype.hasOwnProperty.call(defaults, key)) out[key] = parsed[key];
                    }
                }
            }
        } catch (e) { /* localStorage bloqueado o JSON corrupto: valores por defecto */ }
        return out;
    })();

    function savePrefs() {
        try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
        catch (e) { /* modo privado: la preferencia solo dura la sesion */ }
    }

    /* Interruptores maestros fijados por el admin en el Theme Editor. Si uno
       esta en false, la funcion queda apagada aunque el usuario la tenga
       activada en su navegador: apagar algo tiene que apagarlo de verdad. */
    var MASTER_KEYS = {
        copyAddress: 'featCopyAddress',
        shortcuts: 'featShortcuts',
        consoleHistory: 'featConsoleHistory',
        favorites: 'featFavorites',
        serverFilter: 'featServerFilter',
        quickNav: 'featQuickNav',
        actionGuard: 'featActionGuard',
        focusMode: 'featFocusMode',
        backToTop: 'featBackToTop',
        passwordReveal: 'featPasswordReveal',
        pageTitle: 'featPageTitle',
        helpOverlay: 'featHelpOverlay',
        sessionClock: 'featSessionClock'
    };

    function masterAllows(name) {
        var cfg = window.WaiseConfig;
        var key = MASTER_KEYS[name];
        if (!cfg || !key || !Object.prototype.hasOwnProperty.call(cfg, key)) return true;
        return cfg[key] !== false;
    }

    function getPref(name) {
        if (!masterAllows(name)) return false;
        return Object.prototype.hasOwnProperty.call(prefs, name) ? prefs[name] : undefined;
    }

    function setPref(name, value) {
        if (prefs[name] === value) return;
        prefs[name] = value;
        savePrefs();
        window.dispatchEvent(new CustomEvent('waise:pref', { detail: { name: name, value: value } }));
    }

    /* ====================================================================
       Nucleo - toasts
       ==================================================================== */

    var toastHost = null;

    function toast(message, kind) {
        if (!document.body) return;
        if (!toastHost || !toastHost.isConnected) {
            toastHost = document.createElement('div');
            toastHost.className = 'waise-toast-host';
            document.body.appendChild(toastHost);
        }
        var el = document.createElement('div');
        el.className = 'waise-toast waise-toast--' + (kind || 'info');
        el.setAttribute('role', 'status');
        el.textContent = message;
        toastHost.appendChild(el);

        window.setTimeout(function () {
            el.classList.add('waise-toast--out');
            window.setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 260);
        }, 2600);
    }

    /* ====================================================================
       Nucleo - utilidades
       ==================================================================== */

    function currentServerId() {
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text);
        }
        /* Panel servido por HTTP plano: la Clipboard API no existe. */
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            ok ? resolve() : reject(new Error('copy-failed'));
        });
    }

    function iconName(el) {
        var svg = el.querySelector('svg[data-icon]');
        if (svg) return svg.getAttribute('data-icon');
        var any = el.querySelector('svg');
        var cls = any ? (any.getAttribute('class') || '') : '';
        var m = cls.match(/\bfa-([a-z0-9-]+)\b/);
        return m ? m[1] : null;
    }

    /* ====================================================================
       Copiar IP:puerto
       ==================================================================== */

    /* Acepta IPv4 y hostname, con puerto. Se exige el puerto para no
       enganchar versiones ("1.20.4") ni fechas. */
    var ADDRESS_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})[:]\d{2,5}$/i;
    var COPY_FLAG = 'waiseCopy';

    function isAddressText(text) {
        var value = (text || '').trim();
        if (value.length < 9 || value.length > 120) return false;
        return ADDRESS_RE.test(value);
    }

    function addCopyButton(host, address) {
        if (host.dataset[COPY_FLAG]) return;
        host.dataset[COPY_FLAG] = '1';
        host.classList.add('waise-copyable');

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'waise-copy-btn';
        btn.title = 'Copiar ' + address;
        btn.setAttribute('aria-label', 'Copiar direccion ' + address);
        btn.textContent = 'Copiar';

        btn.addEventListener('click', function (ev) {
            /* El bloque de la direccion suele estar dentro de un enlace o de
               una fila clicable: sin esto se navegaria al copiar. */
            ev.preventDefault();
            ev.stopPropagation();
            copyText(address).then(function () {
                btn.classList.add('waise-copy-btn--done');
                btn.textContent = 'Copiado';
                toast('Direccion copiada: ' + address, 'ok');
                window.setTimeout(function () {
                    btn.classList.remove('waise-copy-btn--done');
                    btn.textContent = 'Copiar';
                }, 1800);
            }).catch(function () {
                toast('No se pudo copiar al portapapeles', 'error');
            });
        });

        host.appendChild(btn);
    }

    function scanAddresses() {
        if (!getPref('copyAddress')) return;

        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!isAddressText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
                var parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest('.waise-toast-host')) return NodeFilter.FILTER_REJECT;
                if (parent.tagName === 'INPUT' || parent.tagName === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        var pending = [];
        var node;
        while ((node = walker.nextNode())) {
            var host = node.parentElement;
            if (!host || host.dataset[COPY_FLAG]) continue;
            /* Si el padre contiene mas de un nodo de texto util, el boton se
               ancla igualmente en el: es el contenedor mas ajustado posible. */
            pending.push({ host: host, address: node.nodeValue.trim() });
        }

        for (var i = 0; i < pending.length; i++) {
            addCopyButton(pending[i].host, pending[i].address);
        }
    }

    /* ====================================================================
       Consola - historial y autocompletado
       ==================================================================== */

    var COMMON_COMMANDS = [
        'help', 'list', 'stop', 'restart', 'save-all', 'seed', 'reload',
        'say ', 'me ', 'tell ', 'kick ', 'ban ', 'pardon ', 'op ', 'deop ',
        'whitelist add ', 'whitelist remove ', 'whitelist on', 'whitelist off',
        'gamemode survival ', 'gamemode creative ', 'gamemode adventure ',
        'give ', 'tp ', 'kill ', 'difficulty ', 'time set day', 'time set night',
        'weather clear', 'weather rain', 'weather thunder',
        'xp add ', 'effect give ', 'gamerule ', 'setworldspawn', 'spawnpoint '
    ];

    var CONSOLE_FLAG = 'waiseConsole';
    var history = [];
    var historyServer = null;
    var cursor = -1;   /* -1 = escribiendo algo nuevo, no navegando */
    var draft = '';

    function historyKey() {
        return HISTORY_KEY + ':' + (currentServerId() || 'global');
    }

    function loadHistory() {
        var id = currentServerId();
        if (historyServer === id) return;
        historyServer = id;
        history = [];
        cursor = -1;
        draft = '';
        try {
            var raw = window.localStorage.getItem(historyKey());
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    history = parsed.filter(function (x) { return typeof x === 'string' && x.length; });
                }
            }
        } catch (e) { history = []; }
    }

    function pushHistory(command) {
        var value = (command || '').trim();
        if (!value) return;
        /* Sin duplicados consecutivos: repetir "list" no llena el historial. */
        if (history.length && history[history.length - 1] === value) return;
        history.push(value);
        if (history.length > HISTORY_MAX) history = history.slice(history.length - HISTORY_MAX);
        try { window.localStorage.setItem(historyKey(), JSON.stringify(history)); }
        catch (e) { /* cuota llena: el historial sigue vivo en memoria */ }
    }

    /* React controla el value del input con su propio state: asignar
       input.value directamente no dispara onChange y el panel enviaria el
       texto viejo. Hay que usar el setter nativo y emitir el evento. */
    var nativeSetter = (function () {
        var desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        return desc && desc.set ? desc.set : null;
    })();

    function setInputValue(input, value) {
        if (nativeSetter) nativeSetter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function commonPrefix(list) {
        if (!list.length) return '';
        var prefix = list[0];
        for (var i = 1; i < list.length; i++) {
            var j = 0;
            while (j < prefix.length && j < list[i].length &&
                   prefix.charAt(j).toLowerCase() === list[i].charAt(j).toLowerCase()) j++;
            prefix = prefix.slice(0, j);
            if (!prefix) break;
        }
        return prefix;
    }

    function candidatesFor(value) {
        var seen = {};
        var out = [];
        var needle = value.toLowerCase();
        /* El historial pesa mas que la lista fija: primero lo que el usuario
           ya ha escrito en ESTE servidor, y lo mas reciente antes. */
        var pool = history.slice().reverse().concat(COMMON_COMMANDS);
        for (var i = 0; i < pool.length; i++) {
            var item = pool[i];
            if (item.toLowerCase().indexOf(needle) !== 0) continue;
            var norm = item.trim().toLowerCase();
            if (seen[norm]) continue;
            seen[norm] = true;
            out.push(item);
            if (out.length >= 12) break;
        }
        return out;
    }

    var hintEl = null;

    function hideHint() {
        if (hintEl && hintEl.parentNode) hintEl.parentNode.removeChild(hintEl);
        hintEl = null;
    }

    function showHint(input, list) {
        hideHint();
        if (list.length < 2) return;
        hintEl = document.createElement('div');
        hintEl.className = 'waise-console-hint';
        for (var i = 0; i < list.length; i++) {
            var chip = document.createElement('span');
            chip.className = 'waise-console-hint__item';
            chip.textContent = list[i].trim();
            hintEl.appendChild(chip);
        }
        var host = input.parentElement || document.body;
        if (window.getComputedStyle(host).position === 'static') {
            host.classList.add('waise-console-anchor');
        }
        host.appendChild(hintEl);
        window.setTimeout(hideHint, 4000);
    }

    function onConsoleKeyDown(ev) {
        var input = ev.currentTarget;

        if (ev.key === 'Enter') {
            pushHistory(input.value);
            cursor = -1;
            draft = '';
            hideHint();
            return;
        }

        if (ev.key === 'Tab') {
            var value = input.value;
            if (!value.trim()) return;
            var list = candidatesFor(value);
            if (!list.length) return;
            ev.preventDefault();
            var prefix = commonPrefix(list);
            if (prefix.length > value.length) {
                setInputValue(input, prefix);
            } else if (list.length === 1) {
                setInputValue(input, list[0]);
            }
            showHint(input, list);
            return;
        }

        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        if (!history.length) return;

        /* El panel trae su propio historial en algunas builds: se corta la
           propagacion para que no compitan y salten dos entradas por pulsacion. */
        ev.preventDefault();
        ev.stopImmediatePropagation();
        hideHint();

        if (ev.key === 'ArrowUp') {
            if (cursor === -1) {
                draft = input.value;
                cursor = history.length - 1;
            } else if (cursor > 0) {
                cursor--;
            }
            setInputValue(input, history[cursor]);
        } else {
            if (cursor === -1) return;
            if (cursor < history.length - 1) {
                cursor++;
                setInputValue(input, history[cursor]);
            } else {
                cursor = -1;
                setInputValue(input, draft);
            }
        }

        /* El cursor de texto debe quedar al final, no donde estuviera. */
        window.requestAnimationFrame(function () {
            var end = input.value.length;
            try { input.setSelectionRange(end, end); } catch (e) { /* input sin seleccion */ }
        });
    }

    function findConsoleInput() {
        var inputs = document.querySelectorAll('input[type="text"], input:not([type])');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            var placeholder = (input.getAttribute('placeholder') || '').toLowerCase();
            if (placeholder.indexOf('command') !== -1 || placeholder.indexOf('comando') !== -1) return input;
            if (input.closest('[class*="Console"], #terminal, [class*="terminal"]')) return input;
        }
        return null;
    }

    function setupConsole() {
        if (!getPref('consoleHistory')) return;
        if (!currentServerId()) return;
        var input = findConsoleInput();
        if (!input || input.dataset[CONSOLE_FLAG]) return;
        input.dataset[CONSOLE_FLAG] = '1';
        loadHistory();
        /* Fase de captura: llega antes que el handler de React. */
        input.addEventListener('keydown', onConsoleKeyDown, true);
        input.addEventListener('blur', hideHint);
    }

    /* ====================================================================
       Atajos de teclado
       ==================================================================== */

    function isTyping(el) {
        if (!el) return false;
        if (el.isContentEditable) return true;
        var tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function clickSearchButton() {
        var buttons = document.querySelectorAll('[class*="RightNavigation"] button, nav button');
        for (var i = 0; i < buttons.length; i++) {
            if (iconName(buttons[i]) === 'search') { buttons[i].click(); return true; }
        }
        return false;
    }

    function focusConsole() {
        var input = findConsoleInput();
        if (!input) return false;
        input.focus();
        return true;
    }

    function closeTopModal() {
        var modal = document.querySelector('[role="dialog"], [class*="ModalMask"], [class*="ModalContainer"]');
        if (!modal) return false;
        var buttons = modal.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            var name = iconName(buttons[i]);
            if (name === 'times' || name === 'xmark' || name === 'close') { buttons[i].click(); return true; }
        }
        var mask = document.querySelector('[class*="ModalMask"]');
        if (mask) { mask.click(); return true; }
        return false;
    }

    function onKeyDown(ev) {
        if (!getPref('shortcuts')) return;

        if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === 'k') {
            ev.preventDefault();
            if (!clickSearchButton()) toast('No se encontro el buscador del panel', 'error');
            return;
        }

        if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === '`' || ev.code === 'Backquote')) {
            if (!currentServerId()) return;
            ev.preventDefault();
            if (!focusConsole()) toast('La consola no esta visible en esta pagina', 'error');
            return;
        }

        if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'p') {
            if (!getPref('quickNav')) return;
            ev.preventDefault();
            openPalette();
            return;
        }

        if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key.toLowerCase() === 'f') {
            if (!getPref('focusMode')) return;
            ev.preventDefault();
            toggleFocusMode();
            return;
        }

        if (ev.key === '?' && !isTyping(document.activeElement)) {
            if (!getPref('helpOverlay')) return;
            ev.preventDefault();
            if (!closeHelp()) openHelp();
            return;
        }

        if (ev.key === 'Escape' && closeOverlays()) {
            ev.preventDefault();
            return;
        }

        if (ev.key === 'Escape') {
            if (isTyping(document.activeElement) && document.activeElement.dataset[CONSOLE_FLAG]) {
                hideHint();
                document.activeElement.blur();
                return;
            }
            closeTopModal();
        }
    }

    /* ====================================================================
       Favoritos de servidores y filtro del dashboard
       ==================================================================== */

    var FAV_KEY = 'waise:favorites';
    var FAV_FLAG = 'waiseFav';
    var FILTER_FLAG = 'waiseFilter';

    var favorites = (function readFavorites() {
        try {
            var raw = window.localStorage.getItem(FAV_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(function (x) { return typeof x === 'string' && x.length; });
        } catch (e) { return []; }
    })();

    function saveFavorites() {
        try { window.localStorage.setItem(FAV_KEY, JSON.stringify(favorites)); }
        catch (e) { /* cuota o modo privado: solo dura la sesion */ }
    }

    function isFavorite(id) { return favorites.indexOf(id) !== -1; }

    function toggleFavorite(id) {
        var i = favorites.indexOf(id);
        if (i === -1) favorites.push(id); else favorites.splice(i, 1);
        saveFavorites();
        return i === -1;
    }

    /* Las tarjetas del dashboard son enlaces a /server/<id> sin subruta. Se
       exige esa forma exacta para no capturar enlaces internos del servidor. */
    function serverCards() {
        var out = [];
        var links = document.querySelectorAll('a[href^="/server/"]');
        for (var i = 0; i < links.length; i++) {
            var href = links[i].getAttribute('href') || '';
            var m = href.match(/^\/server\/([A-Za-z0-9]+)\/?$/);
            if (!m) continue;
            links[i].setAttribute('data-waise-server', m[1]);
            out.push(links[i]);
        }
        return out;
    }

    function paintFavButton(btn, active) {
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.classList.toggle('waise-fav-btn--on', active);
        btn.title = active ? 'Quitar de favoritos' : 'Marcar como favorito';
        btn.textContent = active ? '\u2605' : '\u2606';
    }

    function reorderFavorites(cards) {
        if (!cards.length) return;
        var parent = cards[0].parentElement;
        if (!parent) return;
        for (var i = cards.length - 1; i >= 0; i--) {
            var card = cards[i];
            if (card.parentElement !== parent) continue;
            if (!isFavorite(card.getAttribute('data-waise-server'))) continue;
            if (parent.firstChild !== card) parent.insertBefore(card, parent.firstChild);
        }
    }

    function setupFavorites(cards) {
        if (!getPref('favorites')) return;
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            if (card.dataset[FAV_FLAG]) continue;
            card.dataset[FAV_FLAG] = '1';
            card.classList.add('waise-server-card');

            var id = card.getAttribute('data-waise-server');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'waise-fav-btn';
            paintFavButton(btn, isFavorite(id));

            (function (button, serverId) {
                button.addEventListener('click', function (ev) {
                    /* La tarjeta entera es un enlace: sin esto se navegaria. */
                    ev.preventDefault();
                    ev.stopPropagation();
                    var now = toggleFavorite(serverId);
                    paintFavButton(button, now);
                    toast(now ? 'Anadido a favoritos' : 'Quitado de favoritos', 'ok');
                    reorderFavorites(serverCards());
                });
            })(btn, id);

            card.appendChild(btn);
        }
        reorderFavorites(cards);
    }

    function setupServerFilter(cards) {
        if (!getPref('serverFilter')) return;
        if (cards.length < 2) return;
        var list = cards[0].parentElement;
        if (!list || !list.parentElement) return;
        if (list.dataset[FILTER_FLAG]) return;
        list.dataset[FILTER_FLAG] = '1';

        var bar = document.createElement('div');
        bar.className = 'waise-filter';

        var input = document.createElement('input');
        input.type = 'search';
        input.className = 'waise-filter__input';
        input.placeholder = 'Filtrar servidores...';
        input.setAttribute('aria-label', 'Filtrar servidores');

        var count = document.createElement('span');
        count.className = 'waise-filter__count';

        function apply() {
            var needle = input.value.trim().toLowerCase();
            var current = serverCards();
            var shown = 0;
            for (var i = 0; i < current.length; i++) {
                var text = (current[i].textContent || '').toLowerCase();
                var hit = !needle || text.indexOf(needle) !== -1;
                current[i].classList.toggle('waise-hidden', !hit);
                if (hit) shown++;
            }
            count.textContent = shown + ' / ' + current.length;
        }

        input.addEventListener('input', apply);
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') { input.value = ''; apply(); input.blur(); }
        });

        bar.appendChild(input);
        bar.appendChild(count);
        list.parentElement.insertBefore(bar, list);
        apply();
    }

    /* ====================================================================
       Paleta de navegacion rapida (Ctrl+Shift+P)
       ==================================================================== */

    var SERVER_ROUTES = [
        ['Consola', ''],
        ['Ficheros', '/files'],
        ['Bases de datos', '/databases'],
        ['Programaciones', '/schedules'],
        ['Usuarios', '/users'],
        ['Copias de seguridad', '/backups'],
        ['Red', '/network'],
        ['Arranque', '/startup'],
        ['Ajustes', '/settings'],
        ['Actividad', '/activity']
    ];

    var GLOBAL_ROUTES = [
        ['Panel principal', '/'],
        ['Mi cuenta', '/account'],
        ['Claves API', '/account/api'],
        ['Claves SSH', '/account/ssh'],
        ['Administracion', '/admin']
    ];

    var palette = null;

    function buildPaletteItems() {
        var items = [];
        var id = currentServerId();
        if (id) {
            for (var i = 0; i < SERVER_ROUTES.length; i++) {
                items.push({
                    label: 'Servidor: ' + SERVER_ROUTES[i][0],
                    url: '/server/' + id + SERVER_ROUTES[i][1]
                });
            }
        }
        for (var j = 0; j < GLOBAL_ROUTES.length; j++) {
            items.push({ label: GLOBAL_ROUTES[j][0], url: GLOBAL_ROUTES[j][1] });
        }
        for (var k = 0; k < favorites.length; k++) {
            items.push({ label: 'Favorito: ' + favorites[k], url: '/server/' + favorites[k] });
        }
        return items;
    }

    function closePalette() {
        if (!palette) return false;
        if (palette.root.parentNode) palette.root.parentNode.removeChild(palette.root);
        palette = null;
        return true;
    }

    function openPalette() {
        if (!document.body) return;
        closePalette();

        var root = document.createElement('div');
        root.className = 'waise-overlay';

        var box = document.createElement('div');
        box.className = 'waise-palette';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Navegacion rapida');

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'waise-palette__input';
        input.placeholder = 'Ir a...';

        var listEl = document.createElement('div');
        listEl.className = 'waise-palette__list';

        var all = buildPaletteItems();
        var visible = all.slice();
        var active = 0;

        function render() {
            listEl.textContent = '';
            for (var i = 0; i < visible.length; i++) {
                var row = document.createElement('button');
                row.type = 'button';
                row.className = 'waise-palette__item' + (i === active ? ' waise-palette__item--active' : '');
                row.textContent = visible[i].label;
                (function (url) {
                    row.addEventListener('click', function () { closePalette(); window.location.assign(url); });
                })(visible[i].url);
                listEl.appendChild(row);
            }
            if (!visible.length) {
                var empty = document.createElement('div');
                empty.className = 'waise-palette__empty';
                empty.textContent = 'Sin coincidencias';
                listEl.appendChild(empty);
            }
        }

        function filter() {
            var needle = input.value.trim().toLowerCase();
            visible = all.filter(function (it) {
                return !needle || it.label.toLowerCase().indexOf(needle) !== -1;
            });
            active = 0;
            render();
        }

        input.addEventListener('input', filter);
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                if (visible.length) { active = (active + 1) % visible.length; render(); }
            } else if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                if (visible.length) { active = (active - 1 + visible.length) % visible.length; render(); }
            } else if (ev.key === 'Enter') {
                ev.preventDefault();
                if (visible[active]) { var url = visible[active].url; closePalette(); window.location.assign(url); }
            }
        });

        root.addEventListener('mousedown', function (ev) {
            if (ev.target === root) closePalette();
        });

        box.appendChild(input);
        box.appendChild(listEl);
        root.appendChild(box);
        document.body.appendChild(root);
        palette = { root: root };
        render();
        input.focus();
    }

    /* ====================================================================
       Confirmacion de acciones destructivas
       ==================================================================== */

    var GUARD_RE = /^(kill|matar|forzar\s+parada|delete|eliminar|borrar|destroy|reinstall|reinstalar)$/i;
    var GUARD_FLAG = 'waiseArmed';

    function onGuardClick(ev) {
        if (!getPref('actionGuard')) return;
        var target = ev.target;
        if (!target || !target.closest) return;
        var btn = target.closest('button');
        if (!btn) return;
        var label = (btn.textContent || '').trim();
        if (!GUARD_RE.test(label)) return;
        if (btn.dataset[GUARD_FLAG]) return;

        ev.preventDefault();
        ev.stopPropagation();
        btn.dataset[GUARD_FLAG] = '1';
        btn.classList.add('waise-armed');
        toast('Accion destructiva: pulsa otra vez en 4 s para confirmar', 'error');

        window.setTimeout(function () {
            delete btn.dataset[GUARD_FLAG];
            btn.classList.remove('waise-armed');
        }, 4000);
    }

    /* ====================================================================
       Modo enfoque
       ==================================================================== */

    var FOCUS_KEY = 'waise:focus-mode';

    function applyFocusMode(on) {
        document.documentElement.classList.toggle('waise-focus', !!on);
        try { window.localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch (e) { /* ignorado */ }
    }

    function restoreFocusMode() {
        if (!getPref('focusMode')) return;
        try {
            if (window.localStorage.getItem(FOCUS_KEY) === '1') {
                document.documentElement.classList.add('waise-focus');
            }
        } catch (e) { /* ignorado */ }
    }

    function toggleFocusMode() {
        var on = !document.documentElement.classList.contains('waise-focus');
        applyFocusMode(on);
        toast(on ? 'Modo enfoque activado' : 'Modo enfoque desactivado', 'ok');
    }

    /* ====================================================================
       Boton volver arriba
       ==================================================================== */

    var topBtn = null;

    function setupBackToTop() {
        if (!getPref('backToTop')) return;
        if (!document.body) return;
        if (topBtn && topBtn.isConnected) return;

        topBtn = document.createElement('button');
        topBtn.type = 'button';
        topBtn.className = 'waise-top-btn';
        topBtn.title = 'Volver arriba';
        topBtn.setAttribute('aria-label', 'Volver arriba');
        topBtn.textContent = '\u2191';
        topBtn.addEventListener('click', function () {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        document.body.appendChild(topBtn);

        var ticking = false;
        window.addEventListener('scroll', function () {
            if (ticking) return;
            ticking = true;
            window.requestAnimationFrame(function () {
                ticking = false;
                if (!topBtn) return;
                topBtn.classList.toggle('waise-top-btn--on', window.pageYOffset > 400);
            });
        }, { passive: true });
    }

    /* ====================================================================
       Mostrar/ocultar contrasenas
       ==================================================================== */

    var REVEAL_FLAG = 'waiseReveal';

    function setupPasswordReveal() {
        if (!getPref('passwordReveal')) return;
        var inputs = document.querySelectorAll('input[type="password"]');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            if (input.dataset[REVEAL_FLAG]) continue;
            var host = input.parentElement;
            if (!host) continue;
            input.dataset[REVEAL_FLAG] = '1';
            host.classList.add('waise-pass-host');

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'waise-pass-btn';
            btn.title = 'Mostrar contrasena';
            btn.setAttribute('aria-label', 'Mostrar contrasena');
            btn.textContent = 'Ver';

            (function (field, button) {
                button.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    var shown = field.getAttribute('type') === 'text';
                    field.setAttribute('type', shown ? 'password' : 'text');
                    button.textContent = shown ? 'Ver' : 'Ocultar';
                    button.title = shown ? 'Mostrar contrasena' : 'Ocultar contrasena';
                });
            })(input, btn);

            host.appendChild(btn);
        }
    }

    /* ====================================================================
       Titulo de pestana con el servidor activo
       ==================================================================== */

    var lastTitle = '';

    function updatePageTitle() {
        if (!getPref('pageTitle')) return;
        var id = currentServerId();
        if (!id) return;
        var el = document.querySelector('[class*="ServerName"], main h1, h1');
        var name = el ? (el.textContent || '').trim() : '';
        if (!name || name.length > 60) name = id;
        var next = name + ' | ' + (window.location.pathname.split('/')[3] || 'consola');
        if (next === lastTitle) return;
        lastTitle = next;
        document.title = next;
    }

    /* ====================================================================
       Panel de ayuda de atajos
       ==================================================================== */

    var helpEl = null;

    var SHORTCUTS = [
        ['Ctrl + K', 'Buscador del panel'],
        ['Ctrl + `', 'Enfocar la consola'],
        ['Ctrl + Shift + P', 'Navegacion rapida'],
        ['Ctrl + Shift + F', 'Modo enfoque'],
        ['Flecha arriba / abajo', 'Historial de comandos'],
        ['Tab', 'Autocompletar comando'],
        ['?', 'Mostrar esta ayuda'],
        ['Esc', 'Cerrar modal o panel']
    ];

    function closeHelp() {
        if (!helpEl) return false;
        if (helpEl.parentNode) helpEl.parentNode.removeChild(helpEl);
        helpEl = null;
        return true;
    }

    function openHelp() {
        if (!document.body) return;
        closeHelp();
        helpEl = document.createElement('div');
        helpEl.className = 'waise-overlay';

        var box = document.createElement('div');
        box.className = 'waise-help';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Atajos de teclado');

        var title = document.createElement('div');
        title.className = 'waise-help__title';
        title.textContent = 'Atajos de teclado';
        box.appendChild(title);

        for (var i = 0; i < SHORTCUTS.length; i++) {
            var row = document.createElement('div');
            row.className = 'waise-help__row';
            var key = document.createElement('kbd');
            key.className = 'waise-help__key';
            key.textContent = SHORTCUTS[i][0];
            var desc = document.createElement('span');
            desc.textContent = SHORTCUTS[i][1];
            row.appendChild(key);
            row.appendChild(desc);
            box.appendChild(row);
        }

        helpEl.addEventListener('mousedown', function (ev) {
            if (ev.target === helpEl) closeHelp();
        });

        helpEl.appendChild(box);
        document.body.appendChild(helpEl);
    }

    /* ====================================================================
       Reloj de sesion
       ==================================================================== */

    var clockEl = null;
    var clockTimer = null;
    var sessionStart = Date.now();

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function tickClock() {
        if (!clockEl) return;
        var now = new Date();
        var elapsed = Math.floor((Date.now() - sessionStart) / 1000);
        clockEl.textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) +
            '  |  ' + pad2(Math.floor(elapsed / 3600)) + ':' +
            pad2(Math.floor(elapsed / 60) % 60) + ':' + pad2(elapsed % 60);
    }

    function setupSessionClock() {
        if (!getPref('sessionClock')) {
            if (clockEl && clockEl.parentNode) clockEl.parentNode.removeChild(clockEl);
            clockEl = null;
            if (clockTimer) { window.clearInterval(clockTimer); clockTimer = null; }
            return;
        }
        if (clockEl && clockEl.isConnected) return;
        if (!document.body) return;
        clockEl = document.createElement('div');
        clockEl.className = 'waise-clock';
        clockEl.title = 'Hora local | tiempo de sesion';
        document.body.appendChild(clockEl);
        tickClock();
        if (!clockTimer) clockTimer = window.setInterval(tickClock, 1000);
    }

    function closeOverlays() {
        return closePalette() || closeHelp();
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
                setupConsole();
                scanAddresses();
                var cards = serverCards();
                setupFavorites(cards);
                setupServerFilter(cards);
                setupBackToTop();
                setupPasswordReveal();
                setupSessionClock();
                updatePageTitle();
            } catch (e) {
                /* Una feature rota no debe dejar el panel a medias. */
            }
        });
    }

    function onNavigate() {
        hideHint();
        closeOverlays();
        historyServer = null;
        lastTitle = '';
        schedule();
    }

    function init() {
        restoreFocusMode();
        schedule();

        document.addEventListener('click', onGuardClick, true);

        var observer = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                if (muts[i].addedNodes.length) { schedule(); return; }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('popstate', onNavigate);

        /* React Router navega con pushState, que no emite popstate. */
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

    /* API publica para las fases siguientes (Theme Editor, favoritos, etc.). */
    window.Waise = {
        getPref: getPref,
        setPref: setPref,
        toast: toast,
        copyText: copyText,
        currentServerId: currentServerId,
        isFavorite: isFavorite,
        toggleFavorite: toggleFavorite,
        openPalette: openPalette,
        openHelp: openHelp,
        toggleFocusMode: toggleFocusMode
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();