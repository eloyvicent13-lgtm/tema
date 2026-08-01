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
        consoleHistory: true
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
        consoleHistory: 'featConsoleHistory'
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
            } catch (e) {
                /* Una feature rota no debe dejar el panel a medias. */
            }
        });
    }

    function onNavigate() {
        hideHint();
        historyServer = null;
        schedule();
    }

    function init() {
        schedule();

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
        currentServerId: currentServerId
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();