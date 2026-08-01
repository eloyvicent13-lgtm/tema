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
        sessionClock: false,
        statusNotify: false,
        consoleExport: true,
        consoleSearch: true,
        macros: true,
        unsavedGuard: true,
        density: true,
        recentServers: true,
        uiZoom: true,
        netStatus: true,
        pasteGuard: true,
        serverGroups: true,
        accountTools: true
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
        sessionClock: 'featSessionClock',
        statusNotify: 'featStatusNotify',
        consoleExport: 'featConsoleExport',
        consoleSearch: 'featConsoleSearch',
        macros: 'featMacros',
        unsavedGuard: 'featUnsavedGuard',
        density: 'featDensity',
        recentServers: 'featRecentServers',
        uiZoom: 'featUiZoom',
        netStatus: 'featNetStatus',
        pasteGuard: 'featPasteGuard',
        serverGroups: 'featServerGroups',
        accountTools: 'featAccountTools'
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
        input.addEventListener('paste', onConsolePaste, true);
    }

    /* ====================================================================
       Guardia de pegado multilinea en consola
       ==================================================================== */

    var pasteArmed = false;

    function onConsolePaste(ev) {
        if (!getPref('pasteGuard')) return;
        var data = ev.clipboardData || window.clipboardData;
        if (!data) return;
        var text = '';
        try { text = data.getData('text') || ''; } catch (e) { return; }
        var lines = text.replace(/\n+$/, '').split('\n');
        if (lines.length < 2) return;
        if (pasteArmed) { pasteArmed = false; return; }

        /* Pegar 40 lineas en la consola las envia como 40 comandos: se pide
           una segunda pulsacion antes de dejarlo pasar. */
        ev.preventDefault();
        ev.stopPropagation();
        pasteArmed = true;
        toast(lines.length + ' lineas en el portapapeles: pega otra vez en 5 s para confirmar', 'error');
        window.setTimeout(function () { pasteArmed = false; }, 5000);
    }

    /* ====================================================================
       Macros de comandos (Alt + 1..9)
       ==================================================================== */

    var MACRO_KEY = 'waise:macros';

    function macroKey() { return MACRO_KEY + ':' + (currentServerId() || 'global'); }

    function loadMacros() {
        try {
            var raw = window.localStorage.getItem(macroKey());
            var parsed = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(function (x) { return typeof x === 'string' && x.length; });
        } catch (e) { return []; }
    }

    function saveMacros(list) {
        try { window.localStorage.setItem(macroKey(), JSON.stringify(list)); }
        catch (e) { /* cuota llena: la macro no persiste */ }
    }

    function storeMacro() {
        var input = findConsoleInput();
        if (!input) { toast('La consola no esta visible en esta pagina', 'error'); return; }
        var value = (input.value || '').trim();
        if (!value) { toast('Escribe un comando antes de guardarlo como macro', 'error'); return; }
        var list = loadMacros();
        var existing = list.indexOf(value);
        if (existing !== -1) { toast('Ya es la macro Alt+' + (existing + 1), 'ok'); return; }
        if (list.length >= 9) list.shift();
        list.push(value);
        saveMacros(list);
        toast('Macro guardada en Alt+' + list.length + ': ' + value, 'ok');
    }

    function runMacro(index) {
        var list = loadMacros();
        var value = list[index];
        if (!value) { toast('Sin macro en Alt+' + (index + 1), 'error'); return; }
        var input = findConsoleInput();
        if (!input) { toast('La consola no esta visible en esta pagina', 'error'); return; }
        /* Se rellena pero NO se envia: el usuario confirma con Enter. */
        setInputValue(input, value);
        input.focus();
        window.requestAnimationFrame(function () {
            var end = input.value.length;
            try { input.setSelectionRange(end, end); } catch (e) { /* input sin seleccion */ }
        });
    }

    /* ====================================================================
       Exportar la consola
       ==================================================================== */

    function consoleText() {
        var host = document.querySelector('.xterm-rows') ||
                   document.querySelector('#terminal') ||
                   document.querySelector('[class*="terminal"]');
        if (!host) return null;
        var text = host.innerText || host.textContent || '';
        text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
        return text.trim() ? text : null;
    }

    function exportConsole() {
        if (!getPref('consoleExport')) return;
        var text = consoleText();
        if (!text) { toast('No se encontro contenido de consola en esta pagina', 'error'); return; }
        var name = 'consola-' + (currentServerId() || 'panel') + '-' +
                   new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        toast('Consola exportada: ' + name, 'ok');
    }

    /* ====================================================================
       Buscar dentro de la consola
       ==================================================================== */

    var findBar = null;

    function consoleRows() {
        var host = document.querySelector('.xterm-rows');
        if (!host) return null;
        var rows = host.children;
        return rows && rows.length ? rows : null;
    }

    function closeConsoleFind() {
        var rows = consoleRows();
        if (rows) {
            for (var i = 0; i < rows.length; i++) rows[i].classList.remove('waise-hidden');
        }
        if (!findBar) return false;
        if (findBar.parentNode) findBar.parentNode.removeChild(findBar);
        findBar = null;
        return true;
    }

    function openConsoleFind() {
        if (!getPref('consoleSearch')) return;
        if (!consoleRows()) {
            /* Con el renderizador de canvas de xterm no hay nodos por linea. */
            toast('Esta consola no permite filtrar por lineas', 'error');
            return;
        }
        if (findBar) { findBar.querySelector('input').focus(); return; }

        findBar = document.createElement('div');
        findBar.className = 'waise-cfind';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'waise-cfind__input';
        input.placeholder = 'Filtrar lineas de consola...';
        input.setAttribute('aria-label', 'Filtrar lineas de consola');

        var count = document.createElement('span');
        count.className = 'waise-cfind__count';

        function apply() {
            var rows = consoleRows();
            if (!rows) return;
            var needle = input.value.trim().toLowerCase();
            var shown = 0;
            for (var i = 0; i < rows.length; i++) {
                var hit = !needle || (rows[i].textContent || '').toLowerCase().indexOf(needle) !== -1;
                rows[i].classList.toggle('waise-hidden', !hit);
                if (hit) shown++;
            }
            count.textContent = shown + ' / ' + rows.length;
        }

        input.addEventListener('input', apply);
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape') { ev.stopPropagation(); closeConsoleFind(); }
        });

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'waise-cfind__close';
        close.textContent = '\u00d7';
        close.title = 'Cerrar filtro';
        close.addEventListener('click', closeConsoleFind);

        findBar.appendChild(input);
        findBar.appendChild(count);
        findBar.appendChild(close);
        document.body.appendChild(findBar);
        apply();
        input.focus();
    }

    /* ====================================================================
       Notificaciones de cambio de estado del servidor
       ==================================================================== */

    var STATUS_RE = /^(offline|starting|running|online|stopping|installing|desconectado|iniciando|encendido|apagando)$/i;
    var lastStatus = null;
    var statusTimer = null;

    function readStatus() {
        var nodes = document.querySelectorAll('[class*="tatus"], [class*="tatus"] span');
        for (var i = 0; i < nodes.length && i < 200; i++) {
            var text = (nodes[i].textContent || '').trim();
            if (text.length > 12) continue;
            if (STATUS_RE.test(text)) return text.toLowerCase();
        }
        return null;
    }

    function notify(title, body) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try { new Notification(title, { body: body, tag: 'waise-status' }); }
        catch (e) { /* algunos navegadores exigen ServiceWorker: se ignora */ }
    }

    function pollStatus() {
        if (!getPref('statusNotify') || !currentServerId()) { lastStatus = null; return; }
        var status = readStatus();
        if (!status) return;
        if (lastStatus === null) { lastStatus = status; return; }
        if (status === lastStatus) return;
        var previous = lastStatus;
        lastStatus = status;
        var kind = /offline|desconectado/.test(status) ? 'error' : 'ok';
        toast('Estado del servidor: ' + previous + ' -> ' + status, kind);
        notify('Waise - ' + (currentServerId() || 'servidor'), 'Estado: ' + status);
    }

    function toggleStatusNotify() {
        var on = !getPref('statusNotify');
        if (on && 'Notification' in window && Notification.permission === 'default') {
            /* La peticion de permiso exige gesto del usuario: llega desde la
               pulsacion de teclado, que cuenta como tal. */
            Notification.requestPermission();
        }
        setPref('statusNotify', on);
        lastStatus = null;
        toast(on ? 'Avisos de estado activados' : 'Avisos de estado desactivados', 'ok');
    }

    /* ====================================================================
       Aviso de cambios sin guardar en el editor de ficheros
       ==================================================================== */

    var dirty = false;
    var dirtyPath = '';

    function isEditorRoute() {
        return /\/server\/[^/]+\/files\/(edit|new)/.test(window.location.pathname);
    }

    function markDirty(ev) {
        if (!getPref('unsavedGuard') || !isEditorRoute()) return;
        var el = ev.target;
        if (!el || !el.closest) return;
        if (!el.closest('.ace_editor, .CodeMirror, [class*="editor"], textarea')) return;
        if (ev.key && ev.key.length > 1 && ev.key !== 'Backspace' && ev.key !== 'Delete' && ev.key !== 'Enter') return;
        dirty = true;
        dirtyPath = window.location.pathname;
    }

    function clearDirty(ev) {
        if (!dirty) return;
        var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!btn) return;
        if (!/guardar|save/i.test((btn.textContent || '').trim())) return;
        dirty = false;
        dirtyPath = '';
    }

    function onBeforeUnload(ev) {
        if (!dirty || !getPref('unsavedGuard')) return;
        ev.preventDefault();
        ev.returnValue = '';
        return '';
    }

    /* ====================================================================
       Densidad compacta y zoom de interfaz
       ==================================================================== */

    var DENSITY_KEY = 'waise:density';
    var ZOOM_KEY = 'waise:zoom';
    var ZOOM_MIN = 80;
    var ZOOM_MAX = 130;

    function applyDensity(on) {
        document.documentElement.classList.toggle('waise-compact', !!on);
        try { window.localStorage.setItem(DENSITY_KEY, on ? '1' : '0'); } catch (e) { /* ignorado */ }
    }

    function toggleDensity() {
        if (!getPref('density')) return;
        var on = !document.documentElement.classList.contains('waise-compact');
        applyDensity(on);
        toast(on ? 'Modo compacto activado' : 'Modo compacto desactivado', 'ok');
    }

    function readZoom() {
        var value = 100;
        try { value = parseInt(window.localStorage.getItem(ZOOM_KEY), 10) || 100; }
        catch (e) { value = 100; }
        if (value < ZOOM_MIN) value = ZOOM_MIN;
        if (value > ZOOM_MAX) value = ZOOM_MAX;
        return value;
    }

    function applyZoom(value) {
        document.documentElement.style.fontSize = value === 100 ? '' : value + '%';
        try { window.localStorage.setItem(ZOOM_KEY, String(value)); } catch (e) { /* ignorado */ }
    }

    function stepZoom(delta) {
        if (!getPref('uiZoom')) return;
        var value = delta === 0 ? 100 : readZoom() + delta;
        if (value < ZOOM_MIN) value = ZOOM_MIN;
        if (value > ZOOM_MAX) value = ZOOM_MAX;
        applyZoom(value);
        toast('Zoom de interfaz: ' + value + '%', 'ok');
    }

    function restoreUiPrefs() {
        if (getPref('density')) {
            try {
                if (window.localStorage.getItem(DENSITY_KEY) === '1') {
                    document.documentElement.classList.add('waise-compact');
                }
            } catch (e) { /* ignorado */ }
        }
        if (getPref('uiZoom')) {
            var zoom = readZoom();
            if (zoom !== 100) document.documentElement.style.fontSize = zoom + '%';
        }
    }

    /* ====================================================================
       Servidores recientes
       ==================================================================== */

    var RECENT_KEY = 'waise:recent';
    var RECENT_MAX = 8;

    var recent = (function readRecent() {
        try {
            var raw = window.localStorage.getItem(RECENT_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(parsed)) return [];
            return parsed.filter(function (x) { return x && typeof x.id === 'string'; });
        } catch (e) { return []; }
    })();

    function trackRecent() {
        if (!getPref('recentServers')) return;
        var id = currentServerId();
        if (!id) return;
        var el = document.querySelector('[class*="ServerName"], main h1, h1');
        var name = el ? (el.textContent || '').trim() : '';
        if (!name || name.length > 60) name = id;

        var head = recent[0];
        if (head && head.id === id && head.name === name) return;
        recent = recent.filter(function (x) { return x.id !== id; });
        recent.unshift({ id: id, name: name });
        if (recent.length > RECENT_MAX) recent = recent.slice(0, RECENT_MAX);
        try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); }
        catch (e) { /* cuota llena: la lista vive en memoria */ }
    }

    function jumpToPreviousServer() {
        if (!getPref('recentServers')) return;
        var id = currentServerId();
        var target = null;
        for (var i = 0; i < recent.length; i++) {
            if (recent[i].id !== id) { target = recent[i]; break; }
        }
        if (!target) { toast('Todavia no hay otro servidor reciente', 'error'); return; }
        window.location.assign('/server/' + target.id);
    }

    /* ====================================================================
       Estado de conexion del navegador
       ==================================================================== */

    function setupNetStatus() {
        window.addEventListener('offline', function () {
            if (!getPref('netStatus')) return;
            document.documentElement.classList.add('waise-offline');
            toast('Sin conexion: el panel dejara de actualizarse', 'error');
        });
        window.addEventListener('online', function () {
            if (!getPref('netStatus')) return;
            document.documentElement.classList.remove('waise-offline');
            toast('Conexion restablecida', 'ok');
        });
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

        if (ev.altKey && !ev.ctrlKey && !ev.metaKey) {
            var digit = ev.key >= '1' && ev.key <= '9' ? parseInt(ev.key, 10) : 0;
            if (digit && getPref('macros')) { ev.preventDefault(); runMacro(digit - 1); return; }
            var letter = (ev.key || '').toLowerCase();
            if (letter === 'm' && getPref('macros')) { ev.preventDefault(); storeMacro(); return; }
            if (letter === 'e') { ev.preventDefault(); exportConsole(); return; }
            if (letter === 'f') { ev.preventDefault(); openConsoleFind(); return; }
            if (letter === 'n') { ev.preventDefault(); toggleStatusNotify(); return; }
            if (letter === 'd') { ev.preventDefault(); toggleDensity(); return; }
            if (letter === 'r') { ev.preventDefault(); jumpToPreviousServer(); return; }
        }

        if ((ev.ctrlKey || ev.metaKey) && ev.altKey) {
            if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); stepZoom(5); return; }
            if (ev.key === '-') { ev.preventDefault(); stepZoom(-5); return; }
            if (ev.key === '0') { ev.preventDefault(); stepZoom(0); return; }
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
        for (var r = 0; r < recent.length; r++) {
            if (recent[r].id === id) continue;
            items.push({ label: 'Reciente: ' + recent[r].name, url: '/server/' + recent[r].id });
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

    /* Una sola fila flotante por campo: "Ver" y "Generar" con posiciones
       absolutas independientes se pisaban entre si y con el icono nativo. */
    function passActions(input) {
        var host = input.parentElement;
        if (!host) return null;
        host.classList.add('waise-pass-host');
        input.classList.add('waise-pass-input');
        var row = host.querySelector(':scope > .waise-pass-actions');
        if (!row) {
            row = document.createElement('div');
            row.className = 'waise-pass-actions';
            host.appendChild(row);
        }
        return row;
    }

    function setupPasswordReveal() {
        if (!getPref('passwordReveal')) return;
        var inputs = document.querySelectorAll('input[type="password"], input[data-waise-pass]');
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            if (input.dataset[REVEAL_FLAG]) continue;
            var row = passActions(input);
            if (!row) continue;
            input.dataset[REVEAL_FLAG] = '1';

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

            row.appendChild(btn);
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
        ['Esc', 'Cerrar modal o panel'],
        ['Alt + 1..9', 'Ejecutar macro de comando'],
        ['Alt + M', 'Guardar el comando actual como macro'],
        ['Alt + F', 'Filtrar lineas de la consola'],
        ['Alt + E', 'Exportar la consola a .txt'],
        ['Alt + N', 'Avisos de cambio de estado'],
        ['Alt + D', 'Modo compacto'],
        ['Alt + R', 'Ir al servidor anterior'],
        ['Ctrl + Alt + +/-/0', 'Zoom de la interfaz']
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

    /* ====================================================================
       Carpetas de servidores
       ==================================================================== */

    var GROUPS_KEY = 'waise:groups';
    var GROUP_ACTIVE_KEY = 'waise:group-active';
    var GROUP_FLAG = 'waiseGroup';
    var GROUP_BAR_FLAG = 'waiseGroupBar';

    var groups = (function readGroups() {
        try {
            var raw = window.localStorage.getItem(GROUPS_KEY);
            var parsed = raw ? JSON.parse(raw) : {};
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            var out = {};
            for (var name in parsed) {
                if (!Object.prototype.hasOwnProperty.call(parsed, name)) continue;
                if (!Array.isArray(parsed[name])) continue;
                out[name] = parsed[name].filter(function (x) { return typeof x === 'string' && x.length; });
            }
            return out;
        } catch (e) { return {}; }
    })();

    var activeGroup = (function readActiveGroup() {
        try { return window.localStorage.getItem(GROUP_ACTIVE_KEY) || ''; }
        catch (e) { return ''; }
    })();

    var groupMenu = null;

    function saveGroups() {
        try { window.localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)); }
        catch (e) { /* cuota o modo privado: solo dura la sesion */ }
    }

    function setActiveGroup(name) {
        activeGroup = name || '';
        try { window.localStorage.setItem(GROUP_ACTIVE_KEY, activeGroup); }
        catch (e) { /* ignorado */ }
    }

    function groupNames() {
        var out = [];
        for (var name in groups) {
            if (Object.prototype.hasOwnProperty.call(groups, name)) out.push(name);
        }
        return out.sort();
    }

    function groupOf(id) {
        var names = groupNames();
        for (var i = 0; i < names.length; i++) {
            if (groups[names[i]].indexOf(id) !== -1) return names[i];
        }
        return '';
    }

    /* Un servidor pertenece como mucho a una carpeta: dos carpetas con el
       mismo servidor confundirian los contadores y el filtro. */
    function assignGroup(id, name) {
        var names = groupNames();
        for (var i = 0; i < names.length; i++) {
            var list = groups[names[i]];
            var at = list.indexOf(id);
            if (at !== -1) list.splice(at, 1);
            if (!list.length && names[i] !== name) delete groups[names[i]];
        }
        if (name) {
            if (!groups[name]) groups[name] = [];
            groups[name].push(id);
        }
        saveGroups();
    }

    function closeGroupMenu() {
        if (!groupMenu) return false;
        if (groupMenu.parentNode) groupMenu.parentNode.removeChild(groupMenu);
        groupMenu = null;
        return true;
    }

    function openGroupMenu(anchor, id) {
        closeGroupMenu();
        groupMenu = document.createElement('div');
        groupMenu.className = 'waise-gmenu';
        groupMenu.setAttribute('role', 'menu');

        var title = document.createElement('div');
        title.className = 'waise-gmenu__title';
        title.textContent = 'Mover a carpeta';
        groupMenu.appendChild(title);

        var current = groupOf(id);

        function row(label, handler, active) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'waise-gmenu__item' + (active ? ' waise-gmenu__item--on' : '');
            btn.textContent = label;
            btn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                handler();
                closeGroupMenu();
                schedule();
            });
            groupMenu.appendChild(btn);
        }

        var names = groupNames();
        for (var i = 0; i < names.length; i++) {
            (function (name) {
                row(name, function () {
                    assignGroup(id, name);
                    toast('Movido a "' + name + '"', 'ok');
                }, name === current);
            })(names[i]);
        }

        row('+ Nueva carpeta...', function () {
            var name = window.prompt('Nombre de la carpeta:', '');
            if (name === null) return;
            name = name.trim().slice(0, 32);
            if (!name) { toast('Nombre de carpeta vacio', 'error'); return; }
            assignGroup(id, name);
            toast('Movido a "' + name + '"', 'ok');
        }, false);

        if (current) {
            row('Quitar de "' + current + '"', function () {
                assignGroup(id, '');
                toast('Servidor sin carpeta', 'ok');
            }, false);
        }

        document.body.appendChild(groupMenu);

        var box = anchor.getBoundingClientRect();
        var width = groupMenu.offsetWidth;
        var left = Math.min(box.left, window.innerWidth - width - 8);
        var top = box.bottom + 6;
        if (top + groupMenu.offsetHeight > window.innerHeight - 8) {
            top = Math.max(8, box.top - groupMenu.offsetHeight - 6);
        }
        groupMenu.style.left = Math.max(8, left) + 'px';
        groupMenu.style.top = top + 'px';
    }

    /* Clase propia: el filtro de texto usa .waise-hidden y los dos filtros
       deben poder actuar a la vez sin pisarse. */
    function applyGroupFilter(cards) {
        for (var i = 0; i < cards.length; i++) {
            var id = cards[i].getAttribute('data-waise-server');
            var name = groupOf(id);
            var hit = !activeGroup ||
                      (activeGroup === '\u0000none' ? !name : name === activeGroup);
            cards[i].classList.toggle('waise-ghidden', !hit);
        }
    }

    function renderGroupBar(bar, cards) {
        bar.textContent = '';

        var counts = {};
        var loose = 0;
        for (var i = 0; i < cards.length; i++) {
            var name = groupOf(cards[i].getAttribute('data-waise-server'));
            if (name) counts[name] = (counts[name] || 0) + 1;
            else loose++;
        }

        function chip(label, value, disabled) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'waise-gchip' + (activeGroup === value ? ' waise-gchip--on' : '');
            btn.textContent = label;
            if (disabled) btn.classList.add('waise-gchip--empty');
            btn.addEventListener('click', function () {
                setActiveGroup(activeGroup === value ? '' : value);
                schedule();
            });
            bar.appendChild(btn);
        }

        chip('Todos (' + cards.length + ')', '', false);
        var names = groupNames();
        for (var j = 0; j < names.length; j++) {
            chip(names[j] + ' (' + (counts[names[j]] || 0) + ')', names[j], !counts[names[j]]);
        }
        if (loose && names.length) chip('Sin carpeta (' + loose + ')', '\u0000none', false);
    }

    function setupServerGroups(cards) {
        if (!getPref('serverGroups')) return;
        if (!cards.length) return;

        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            if (card.dataset[GROUP_FLAG]) continue;
            card.dataset[GROUP_FLAG] = '1';
            card.classList.add('waise-server-card');

            var id = card.getAttribute('data-waise-server');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'waise-folder-btn';
            btn.title = 'Mover a una carpeta';
            btn.setAttribute('aria-label', 'Mover a una carpeta');
            btn.setAttribute('data-waise-folder', id || '');
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
                '<path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/>' +
                '</svg>';

            card.appendChild(btn);
        }

        var list = cards[0].parentElement;
        if (list && list.parentElement && !list.dataset[GROUP_BAR_FLAG]) {
            list.dataset[GROUP_BAR_FLAG] = '1';
            var bar = document.createElement('div');
            bar.className = 'waise-groups';
            list.parentElement.insertBefore(bar, list);
        }

        var bars = document.querySelectorAll('.waise-groups');
        for (var k = 0; k < bars.length; k++) renderGroupBar(bars[k], cards);
        applyGroupFilter(cards);
    }

    /* ====================================================================
       Editor de cuenta
       ==================================================================== */

    var ACCOUNT_FLAG = 'waiseAccount';
    var METER_FLAG = 'waiseMeter';
    var ACCOUNT_ID_KEY = 'waise:account-id';

    /* /account/api y /account/ssh no tienen los inputs de perfil: sin cache la
       cabecera desaparecia al cambiar de subruta. */
    var accountId = (function () {
        try {
            var raw = window.localStorage.getItem(ACCOUNT_ID_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            if (!parsed || typeof parsed !== 'object') return null;
            return { email: parsed.email || '', user: parsed.user || '' };
        } catch (e) { return null; }
    })();

    function isAccountRoute() {
        return window.location.pathname.indexOf('/account') === 0;
    }

    function scorePassword(value) {
        if (!value) return 0;
        var score = 0;
        if (value.length >= 8) score++;
        if (value.length >= 12) score++;
        if (value.length >= 16) score++;
        if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
        if (/\d/.test(value)) score++;
        if (/[^A-Za-z0-9]/.test(value)) score++;
        if (/^(.)\1+$/.test(value)) score = 1;
        return Math.min(score, 5);
    }

    var SCORE_LABELS = ['Muy debil', 'Muy debil', 'Debil', 'Aceptable', 'Fuerte', 'Excelente'];

    function genPassword(length) {
        var abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%*?-_';
        var out = '';
        var i;
        if (window.crypto && window.crypto.getRandomValues) {
            var buf = new Uint32Array(length);
            window.crypto.getRandomValues(buf);
            for (i = 0; i < length; i++) out += abc.charAt(buf[i] % abc.length);
        } else {
            for (i = 0; i < length; i++) out += abc.charAt(Math.floor(Math.random() * abc.length));
        }
        return out;
    }

    function fieldName(input) {
        return (input.getAttribute('name') || input.getAttribute('id') || '').toLowerCase();
    }

    function passwordFields() {
        var all = document.querySelectorAll('input[type="password"], input[data-waise-pass]');
        var out = { next: null, confirm: null };
        for (var i = 0; i < all.length; i++) {
            var name = fieldName(all[i]);
            if (name.indexOf('current') !== -1) continue;
            if (name.indexOf('confirm') !== -1) { out.confirm = all[i]; continue; }
            if (name.indexOf('password') !== -1 && !out.next) out.next = all[i];
        }
        /* Builds traducidas o sin atributo name: se cae al orden del DOM. */
        if (!out.next && all.length >= 2) out.next = all[1];
        if (!out.confirm && all.length >= 3) out.confirm = all[2];
        return out;
    }

    function attachMeter(input, confirmInput) {
        if (!input || input.dataset[METER_FLAG]) return;
        input.dataset[METER_FLAG] = '1';
        /* El type cambia con el boton "Ver": se marca para no perder el campo. */
        input.setAttribute('data-waise-pass', '1');

        var host = input.parentElement;
        if (!host) return;

        var meter = document.createElement('div');
        meter.className = 'waise-meter';

        var track = document.createElement('div');
        track.className = 'waise-meter__track';
        var fill = document.createElement('div');
        fill.className = 'waise-meter__fill';
        track.appendChild(fill);

        var label = document.createElement('span');
        label.className = 'waise-meter__label';

        meter.appendChild(track);
        meter.appendChild(label);
        host.appendChild(meter);

        function update() {
            var value = input.value || '';
            var score = scorePassword(value);
            fill.style.width = (score * 20) + '%';
            fill.setAttribute('data-score', String(score));
            label.textContent = value ? SCORE_LABELS[score] + ' - ' + value.length + ' caracteres' : '';
            if (confirmInput && confirmInput.value) {
                var same = confirmInput.value === value;
                confirmInput.classList.toggle('waise-mismatch', !same);
            }
        }

        input.addEventListener('input', update);
        if (confirmInput) confirmInput.addEventListener('input', update);
        update();

        var row = passActions(input);
        if (!row) return;

        var gen = document.createElement('button');
        gen.type = 'button';
        gen.className = 'waise-gen-btn';
        gen.title = 'Generar contrasena segura de 20 caracteres';
        gen.setAttribute('aria-label', 'Generar contrasena segura');
        gen.textContent = 'Generar';
        gen.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var value = genPassword(20);
            setInputValue(input, value);
            if (confirmInput) setInputValue(confirmInput, value);
            copyText(value).then(function () {
                toast('Contrasena generada y copiada al portapapeles', 'ok');
            }).catch(function () {
                toast('Contrasena generada (no se pudo copiar)', 'ok');
            });
            update();
        });
        /* Delante de "Ver" para que el orden sea estable en todos los campos. */
        row.insertBefore(gen, row.firstChild);
    }

    function accountIdentity() {
        var email = '';
        var user = '';
        var inputs = document.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
            var name = fieldName(inputs[i]);
            if (!email && (name.indexOf('email') !== -1 || inputs[i].type === 'email')) email = inputs[i].value || '';
            if (!user && (name.indexOf('username') !== -1 || name === 'user')) user = inputs[i].value || '';
        }
        return { email: email.trim(), user: user.trim() };
    }

    function initials(text) {
        var clean = (text || '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
        if (!clean) return '?';
        var parts = clean.split(' ');
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }

    function buildAccountHeader(mount, id) {
        var card = document.createElement('div');
        card.className = 'waise-account-card';

        var avatar = document.createElement('div');
        avatar.className = 'waise-account-card__avatar';
        avatar.textContent = initials(id.user || id.email);

        var info = document.createElement('div');
        info.className = 'waise-account-card__info';

        var name = document.createElement('div');
        name.className = 'waise-account-card__name';
        name.textContent = id.user || 'Mi cuenta';

        var mail = document.createElement('div');
        mail.className = 'waise-account-card__mail';
        mail.textContent = id.email || 'Sin correo detectado';

        info.appendChild(name);
        info.appendChild(mail);

        var actions = document.createElement('div');
        actions.className = 'waise-account-card__actions';

        if (id.email) {
            var copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'waise-account-btn';
            copyBtn.textContent = 'Copiar correo';
            copyBtn.addEventListener('click', function () {
                copyText(id.email).then(function () {
                    toast('Correo copiado: ' + id.email, 'ok');
                }).catch(function () {
                    toast('No se pudo copiar al portapapeles', 'error');
                });
            });
            actions.appendChild(copyBtn);
        }

        var links = [['Claves API', '/account/api'], ['Claves SSH', '/account/ssh'], ['Actividad', '/account/activity']];
        for (var i = 0; i < links.length; i++) {
            var a = document.createElement('a');
            a.className = 'waise-account-btn';
            a.href = links[i][1];
            a.textContent = links[i][0];
            actions.appendChild(a);
        }

        card.appendChild(avatar);
        card.appendChild(info);
        card.appendChild(actions);
        mount.insertBefore(card, mount.firstChild);
    }

    function setupAccountPage() {
        if (!getPref('accountTools')) {
            document.documentElement.classList.remove('waise-account');
            return;
        }
        if (!isAccountRoute()) {
            document.documentElement.classList.remove('waise-account');
            return;
        }
        document.documentElement.classList.add('waise-account');

        var fields = passwordFields();
        attachMeter(fields.next, fields.confirm);

        var fresh = accountIdentity();
        if (fresh.email || fresh.user) {
            accountId = fresh;
            try { window.localStorage.setItem(ACCOUNT_ID_KEY, JSON.stringify(fresh)); }
            catch (e) { /* solo dura la sesion */ }
        }
        if (!accountId) return;

        var mount = document.querySelector('main') ||
                    document.querySelector('[class*="ContentContainer"]');
        if (!mount) return;

        /* React reemplaza el subarbol al cambiar de subruta y se lleva la
           tarjeta: el dataset solo no basta, hay que comprobar el DOM real. */
        var existing = mount.querySelector('.waise-account-card');
        if (existing) {
            if (existing !== mount.firstChild) mount.insertBefore(existing, mount.firstChild);
            return;
        }
        mount.dataset[ACCOUNT_FLAG] = '1';
        buildAccountHeader(mount, accountId);
    }

    /* En captura y en mousedown: el guardia de navegacion escucha 'click' en
       fase de captura sobre document y se comia el evento del boton. */
    function onFolderPointer(ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('.waise-folder-btn') : null;
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        openGroupMenu(btn, btn.getAttribute('data-waise-folder'));
    }

    function closeOverlays() {
        return closePalette() || closeHelp() || closeConsoleFind() || closeGroupMenu();
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
                setupServerGroups(cards);
                setupServerFilter(cards);
                setupBackToTop();
                setupPasswordReveal();
                setupSessionClock();
                updatePageTitle();
                trackRecent();
                setupAccountPage();
            } catch (e) {
                /* Una feature rota no debe dejar el panel a medias. */
            }
        });
    }

    function onNavigate() {
        hideHint();
        closeOverlays();
        lastStatus = null;
        if (dirty && dirtyPath !== window.location.pathname) { dirty = false; dirtyPath = ''; }
        historyServer = null;
        lastTitle = '';
        schedule();
    }

    function init() {
        restoreFocusMode();
        restoreUiPrefs();
        schedule();

        document.addEventListener('click', onGuardClick, true);
        document.addEventListener('mousedown', onFolderPointer, true);
        document.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.waise-folder-btn') : null;
            if (btn) { ev.preventDefault(); ev.stopPropagation(); }
        }, true);
        document.addEventListener('mousedown', function (ev) {
            if (!groupMenu) return;
            if (groupMenu.contains(ev.target)) return;
            if (ev.target && ev.target.closest && ev.target.closest('.waise-folder-btn')) return;
            closeGroupMenu();
        });
        window.addEventListener('resize', function () { closeGroupMenu(); });
        document.addEventListener('keydown', markDirty, true);
        document.addEventListener('click', clearDirty, true);
        window.addEventListener('beforeunload', onBeforeUnload);
        setupNetStatus();
        statusTimer = window.setInterval(pollStatus, 3000);

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
        toggleFocusMode: toggleFocusMode,
        exportConsole: exportConsole,
        openConsoleFind: openConsoleFind,
        toggleDensity: toggleDensity,
        setZoom: applyZoom,
        recentServers: function () { return recent.slice(); },
        groups: function () { return JSON.parse(JSON.stringify(groups)); },
        groupOf: groupOf,
        assignGroup: assignGroup,
        genPassword: genPassword
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();