/* ---------------------------------------------------------------------------
   Waise Theme - assets/js/waise-console.js

   Consola mejorada. No toca el xterm del panel (con el renderizador de canvas
   no hay nodos por linea, ver waise-features.js): abre su propio websocket
   contra Wings usando las credenciales de /api/client/servers/{id}/websocket
   y mantiene su propio buffer de lineas.

   Aporta sobre la consola oficial: busqueda incremental, filtro por nivel,
   pausa del autoscroll, historial de comandos, autocompletado y descarga del
   log visible.
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    var MAX_LINES = 5000;          /* lineas guardadas en memoria */
    var MAX_RENDER = 1500;         /* nodos pintados como maximo */
    var HISTORY_KEY = 'waise.console.history';
    var MAX_HISTORY = 60;

    var SUGGESTIONS = [
        'help', 'list', 'say ', 'tell ', 'me ', 'kick ', 'ban ', 'ban-ip ',
        'pardon ', 'pardon-ip ', 'banlist', 'op ', 'deop ', 'whitelist add ',
        'whitelist remove ', 'whitelist list', 'whitelist on', 'whitelist off',
        'whitelist reload', 'save-all', 'save-on', 'save-off', 'stop', 'reload',
        'seed', 'difficulty ', 'gamemode ', 'gamerule ', 'time set ',
        'weather clear', 'weather rain', 'weather thunder', 'tp ', 'give ',
        'effect give ', 'effect clear ', 'xp add ', 'kill ', 'setworldspawn',
        'spawnpoint ', 'defaultgamemode ', 'datapack list', 'forceload query',
        'plugins', 'version'
    ];

    var state = {
        serverId: null,
        socket: null,
        creds: null,
        open: false,
        connected: false,
        authed: false,
        retries: 0,
        closing: false,
        lines: [],
        seq: 0,
        query: '',
        levels: { info: true, warn: true, error: true, other: true },
        follow: true,
        history: [],
        historyIdx: -1,
        status: 'desconocido'
    };

    var el = {};

    /* --- Utilidades ------------------------------------------------------- */

    function api() {
        return window.WaiseApi || null;
    }

    function serverIdFromUrl() {
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* Wings manda las lineas con secuencias ANSI de color. Las quitamos para
       poder buscar y filtrar sobre texto plano. */
    function stripAnsi(text) {
        /* eslint-disable no-control-regex */
        return String(text).replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, '');
        /* eslint-enable no-control-regex */
    }

    function detectLevel(text) {
        if (/\b(ERROR|SEVERE|FATAL)\b/i.test(text)) return 'error';
        if (/\bWARN(ING)?\b/i.test(text)) return 'warn';
        if (/\bINFO\b/i.test(text)) return 'info';
        return 'other';
    }

    function loadHistory() {
        try {
            var raw = window.localStorage.getItem(HISTORY_KEY);
            var parsed = raw ? JSON.parse(raw) : [];
            return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    function saveHistory() {
        try {
            window.localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, MAX_HISTORY)));
        } catch (e) {
            /* Modo privado o cuota llena: el historial es opcional. */
        }
    }

    /* --- Buffer ----------------------------------------------------------- */

    function pushLine(raw) {
        var text = stripAnsi(raw).replace(/\r/g, '');
        if (text === '' && raw === '') return null;
        var line = {
            id: ++state.seq,
            text: text,
            level: detectLevel(text),
            at: new Date()
        };
        state.lines.push(line);
        if (state.lines.length > MAX_LINES) {
            state.lines.splice(0, state.lines.length - MAX_LINES);
        }
        return line;
    }

    function matches(line) {
        if (!state.levels[line.level]) return false;
        if (!state.query) return true;
        return line.text.toLowerCase().indexOf(state.query) !== -1;
    }

    function visibleLines() {
        var out = [];
        for (var i = state.lines.length - 1; i >= 0 && out.length < MAX_RENDER; i--) {
            if (matches(state.lines[i])) out.push(state.lines[i]);
        }
        return out.reverse();
    }

    /* --- Render ----------------------------------------------------------- */

    function highlight(text) {
        var safe = escapeHtml(text);
        if (!state.query) return safe;
        var needle = escapeHtml(state.query);
        var lower = safe.toLowerCase();
        var target = needle.toLowerCase();
        var out = '';
        var from = 0;
        var idx = lower.indexOf(target, from);
        while (idx !== -1) {
            out += safe.slice(from, idx) + '<mark>' + safe.slice(idx, idx + needle.length) + '</mark>';
            from = idx + needle.length;
            idx = lower.indexOf(target, from);
        }
        return out + safe.slice(from);
    }

    function renderLines() {
        if (!el.output) return;
        var list = visibleLines();
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var line = list[i];
            html += '<div class="wcon-line wcon-' + line.level + '">' +
                '<span class="wcon-time">' + escapeHtml(
                    ('0' + line.at.getHours()).slice(-2) + ':' +
                    ('0' + line.at.getMinutes()).slice(-2) + ':' +
                    ('0' + line.at.getSeconds()).slice(-2)
                ) + '</span>' +
                '<span class="wcon-text">' + highlight(line.text) + '</span>' +
                '</div>';
        }
        el.output.innerHTML = html ||
            '<div class="wcon-empty">Sin lineas que coincidan con el filtro.</div>';
        if (state.follow) scrollToEnd();
        renderCounters(list.length);
    }

    function renderCounters(shown) {
        if (!el.counter) return;
        el.counter.textContent = shown + ' / ' + state.lines.length + ' lineas';
    }

    function appendLine(line) {
        if (!el.output || !line) return;
        if (!matches(line)) {
            renderCounters(el.output.querySelectorAll('.wcon-line').length);
            return;
        }
        var empty = el.output.querySelector('.wcon-empty');
        if (empty) empty.parentNode.removeChild(empty);

        var node = document.createElement('div');
        node.className = 'wcon-line wcon-' + line.level;
        node.innerHTML =
            '<span class="wcon-time">' + escapeHtml(
                ('0' + line.at.getHours()).slice(-2) + ':' +
                ('0' + line.at.getMinutes()).slice(-2) + ':' +
                ('0' + line.at.getSeconds()).slice(-2)
            ) + '</span>' +
            '<span class="wcon-text">' + highlight(line.text) + '</span>';
        el.output.appendChild(node);

        while (el.output.childNodes.length > MAX_RENDER) {
            el.output.removeChild(el.output.firstChild);
        }
        if (state.follow) scrollToEnd();
        renderCounters(el.output.querySelectorAll('.wcon-line').length);
    }

    function scrollToEnd() {
        if (el.output) el.output.scrollTop = el.output.scrollHeight;
    }

    function setStatus(text, kind) {
        state.status = text;
        if (!el.status) return;
        el.status.textContent = text;
        el.status.className = 'wcon-status wcon-status-' + (kind || 'idle');
    }

    /* --- Websocket -------------------------------------------------------- */

    function sendEvent(event, args) {
        if (!state.socket || state.socket.readyState !== 1) return false;
        state.socket.send(JSON.stringify({ event: event, args: args || [] }));
        return true;
    }

    function connect() {
        if (!api() || !state.serverId) return;
        if (state.socket && (state.socket.readyState === 0 || state.socket.readyState === 1)) return;

        state.closing = false;
        setStatus('conectando...', 'idle');

        api().websocketDetails(state.serverId).then(function (creds) {
            if (!creds || !creds.socket || !creds.token) {
                setStatus('el panel no devolvio credenciales de websocket', 'error');
                return;
            }
            state.creds = creds;
            openSocket(creds);
        }, function (err) {
            setStatus('no se pudo obtener el websocket: ' + err.message, 'error');
            scheduleRetry();
        });
    }

    function openSocket(creds) {
        var socket;
        try {
            socket = new WebSocket(creds.socket);
        } catch (e) {
            setStatus('URL de websocket invalida', 'error');
            return;
        }
        state.socket = socket;

        socket.onopen = function () {
            state.connected = true;
            state.retries = 0;
            sendEvent('auth', [creds.token]);
        };

        socket.onmessage = function (ev) {
            var payload;
            try {
                payload = JSON.parse(ev.data);
            } catch (e) {
                return;
            }
            handleEvent(payload.event, payload.args || []);
        };

        socket.onerror = function () {
            setStatus('error de websocket', 'error');
        };

        socket.onclose = function () {
            state.connected = false;
            state.authed = false;
            state.socket = null;
            if (state.closing) {
                setStatus('desconectado', 'idle');
                return;
            }
            setStatus('conexion perdida', 'warn');
            scheduleRetry();
        };
    }

    function scheduleRetry() {
        if (state.closing || !state.open) return;
        state.retries++;
        if (state.retries > 8) {
            setStatus('sin conexion tras varios intentos', 'error');
            return;
        }
        var wait = Math.min(15000, Math.pow(2, state.retries) * 400);
        setStatus('reintentando en ' + Math.round(wait / 1000) + ' s', 'warn');
        window.setTimeout(function () {
            if (state.open) connect();
        }, wait);
    }

    function refreshToken() {
        if (!api() || !state.serverId) return;
        api().websocketDetails(state.serverId).then(function (creds) {
            if (creds && creds.token) {
                state.creds = creds;
                sendEvent('auth', [creds.token]);
            }
        }, function () {
            /* Si falla, el socket se cerrara y entrara el reintento normal. */
        });
    }

    function handleEvent(event, args) {
        switch (event) {
            case 'auth success':
                state.authed = true;
                setStatus('conectado', 'ok');
                sendEvent('send logs', [null]);
                break;
            case 'console output':
            case 'install output':
            case 'daemon message':
                for (var i = 0; i < args.length; i++) {
                    var chunk = String(args[i] === null || args[i] === undefined ? '' : args[i]);
                    var parts = chunk.split('\n');
                    for (var j = 0; j < parts.length; j++) {
                        if (parts[j] !== '' || parts.length === 1) {
                            appendLine(pushLine(parts[j]));
                        }
                    }
                }
                break;
            case 'status':
                if (args.length) setStatus('servidor: ' + args[0], args[0] === 'running' ? 'ok' : 'warn');
                break;
            case 'token expiring':
            case 'token expired':
                refreshToken();
                break;
            case 'jwt error':
                setStatus('token rechazado por Wings', 'error');
                break;
            default:
                break;
        }
    }

    function disconnect() {
        state.closing = true;
        if (state.socket) {
            try { state.socket.close(); } catch (e) { /* ya cerrado */ }
        }
        state.socket = null;
        state.connected = false;
        state.authed = false;
    }

    /* --- Comandos --------------------------------------------------------- */

    function runCommand(raw) {
        var cmd = String(raw || '').trim();
        if (!cmd) return;

        if (state.history[0] !== cmd) {
            state.history.unshift(cmd);
            if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
            saveHistory();
        }
        state.historyIdx = -1;

        appendLine(pushLine('> ' + cmd));

        /* Preferimos el propio websocket (respuesta inmediata); si no esta
           autenticado usamos el endpoint REST como respaldo. */
        if (state.authed && sendEvent('send command', [cmd])) return;

        if (!api()) return;
        api().command(state.serverId, cmd).then(null, function (err) {
            appendLine(pushLine('[waise] no se pudo enviar el comando: ' + err.message));
        });
    }

    function suggestFor(value) {
        var v = value.toLowerCase();
        if (!v) return [];
        var out = [];
        var i;
        for (i = 0; i < state.history.length && out.length < 6; i++) {
            if (state.history[i].toLowerCase().indexOf(v) === 0 && out.indexOf(state.history[i]) === -1) {
                out.push(state.history[i]);
            }
        }
        for (i = 0; i < SUGGESTIONS.length && out.length < 8; i++) {
            if (SUGGESTIONS[i].toLowerCase().indexOf(v) === 0 && out.indexOf(SUGGESTIONS[i]) === -1) {
                out.push(SUGGESTIONS[i]);
            }
        }
        return out;
    }

    function renderSuggestions(list) {
        if (!el.suggest) return;
        if (!list.length) {
            el.suggest.innerHTML = '';
            el.suggest.hidden = true;
            return;
        }
        var html = '';
        for (var i = 0; i < list.length; i++) {
            html += '<button type="button" class="wcon-suggest-item" data-value="' +
                escapeHtml(list[i]) + '">' + escapeHtml(list[i]) + '</button>';
        }
        el.suggest.innerHTML = html;
        el.suggest.hidden = false;
    }

    /* --- Descarga --------------------------------------------------------- */

    function downloadLog() {
        var list = visibleLines();
        var text = '';
        for (var i = 0; i < list.length; i++) {
            text += list[i].at.toISOString() + '  ' + list[i].text + '\n';
        }
        var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'consola-' + state.serverId + '-' + Date.now() + '.log';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /* --- UI --------------------------------------------------------------- */

    function buildPanel() {
        var overlay = document.createElement('div');
        overlay.className = 'wcon-overlay';
        overlay.hidden = true;
        overlay.innerHTML =
            '<div class="wcon-panel" role="dialog" aria-modal="true" aria-label="Consola avanzada">' +
                '<header class="wcon-head">' +
                    '<h2 class="wcon-title">Consola avanzada</h2>' +
                    '<span class="wcon-status wcon-status-idle">sin conectar</span>' +
                    '<button type="button" class="wcon-close" aria-label="Cerrar">&times;</button>' +
                '</header>' +
                '<div class="wcon-tools">' +
                    '<input type="search" class="wcon-search" placeholder="Buscar en la consola..." aria-label="Buscar">' +
                    '<div class="wcon-chips" role="group" aria-label="Filtrar por nivel">' +
                        '<button type="button" class="wcon-chip is-on" data-level="info">Info</button>' +
                        '<button type="button" class="wcon-chip is-on" data-level="warn">Avisos</button>' +
                        '<button type="button" class="wcon-chip is-on" data-level="error">Errores</button>' +
                        '<button type="button" class="wcon-chip is-on" data-level="other">Otros</button>' +
                    '</div>' +
                    '<button type="button" class="wcon-btn wcon-follow is-on">Autoscroll</button>' +
                    '<button type="button" class="wcon-btn wcon-clear">Limpiar</button>' +
                    '<button type="button" class="wcon-btn wcon-download">Descargar</button>' +
                '</div>' +
                '<div class="wcon-output" tabindex="0" role="log" aria-live="polite"></div>' +
                '<footer class="wcon-foot">' +
                    '<span class="wcon-counter">0 / 0 lineas</span>' +
                    '<div class="wcon-input-wrap">' +
                        '<div class="wcon-suggest" hidden></div>' +
                        '<input type="text" class="wcon-input" placeholder="Escribe un comando y pulsa Enter" ' +
                            'autocomplete="off" spellcheck="false" aria-label="Comando">' +
                    '</div>' +
                    '<button type="button" class="wcon-btn wcon-send">Enviar</button>' +
                '</footer>' +
            '</div>';
        document.body.appendChild(overlay);

        el.overlay = overlay;
        el.panel = overlay.querySelector('.wcon-panel');
        el.status = overlay.querySelector('.wcon-status');
        el.output = overlay.querySelector('.wcon-output');
        el.search = overlay.querySelector('.wcon-search');
        el.counter = overlay.querySelector('.wcon-counter');
        el.input = overlay.querySelector('.wcon-input');
        el.suggest = overlay.querySelector('.wcon-suggest');

        wirePanel(overlay);
        return overlay;
    }

    function wirePanel(overlay) {
        overlay.querySelector('.wcon-close').addEventListener('click', closePanel);
        overlay.addEventListener('mousedown', function (ev) {
            if (ev.target === overlay) closePanel();
        });

        el.search.addEventListener('input', function () {
            state.query = el.search.value.trim().toLowerCase();
            renderLines();
        });

        var chips = overlay.querySelectorAll('.wcon-chip');
        for (var i = 0; i < chips.length; i++) {
            chips[i].addEventListener('click', function () {
                var level = this.getAttribute('data-level');
                state.levels[level] = !state.levels[level];
                this.className = 'wcon-chip' + (state.levels[level] ? ' is-on' : '');
                renderLines();
            });
        }

        var follow = overlay.querySelector('.wcon-follow');
        follow.addEventListener('click', function () {
            state.follow = !state.follow;
            follow.className = 'wcon-btn wcon-follow' + (state.follow ? ' is-on' : '');
            if (state.follow) scrollToEnd();
        });

        /* Si el usuario sube a leer, se pausa solo el autoscroll. */
        el.output.addEventListener('scroll', function () {
            var atEnd = el.output.scrollHeight - el.output.scrollTop - el.output.clientHeight < 24;
            if (!atEnd && state.follow) {
                state.follow = false;
                follow.className = 'wcon-btn wcon-follow';
            }
        });

        overlay.querySelector('.wcon-clear').addEventListener('click', function () {
            state.lines = [];
            renderLines();
        });

        overlay.querySelector('.wcon-download').addEventListener('click', downloadLog);
        overlay.querySelector('.wcon-send').addEventListener('click', function () {
            runCommand(el.input.value);
            el.input.value = '';
            renderSuggestions([]);
        });

        el.input.addEventListener('input', function () {
            renderSuggestions(suggestFor(el.input.value));
        });

        el.input.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                runCommand(el.input.value);
                el.input.value = '';
                renderSuggestions([]);
                return;
            }
            if (ev.key === 'Tab') {
                var list = suggestFor(el.input.value);
                if (list.length) {
                    ev.preventDefault();
                    el.input.value = list[0];
                    renderSuggestions([]);
                }
                return;
            }
            if (ev.key === 'ArrowUp') {
                if (state.historyIdx + 1 < state.history.length) {
                    state.historyIdx++;
                    el.input.value = state.history[state.historyIdx];
                    ev.preventDefault();
                }
                return;
            }
            if (ev.key === 'ArrowDown') {
                if (state.historyIdx > 0) {
                    state.historyIdx--;
                    el.input.value = state.history[state.historyIdx];
                } else {
                    state.historyIdx = -1;
                    el.input.value = '';
                }
                ev.preventDefault();
            }
        });

        el.suggest.addEventListener('click', function (ev) {
            var btn = ev.target.closest ? ev.target.closest('.wcon-suggest-item') : null;
            if (!btn) return;
            el.input.value = btn.getAttribute('data-value');
            el.input.focus();
            renderSuggestions([]);
        });

        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && state.open) closePanel();
        });
    }

    function openPanel() {
        if (!el.overlay) buildPanel();
        el.overlay.hidden = false;
        state.open = true;
        document.body.classList.add('wcon-lock');
        renderLines();
        connect();
        el.input.focus();
    }

    function closePanel() {
        if (!el.overlay) return;
        el.overlay.hidden = true;
        state.open = false;
        document.body.classList.remove('wcon-lock');
        disconnect();
    }

    function buildLauncher() {
        if (document.querySelector('.wcon-fab')) return;
        var fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'wcon-fab';
        fab.title = 'Consola avanzada';
        fab.setAttribute('aria-label', 'Abrir consola avanzada');
        fab.innerHTML = '<span aria-hidden="true">&gt;_</span>';
        fab.addEventListener('click', openPanel);
        document.body.appendChild(fab);
    }

    /* --- Arranque --------------------------------------------------------- */

    function sync() {
        var id = serverIdFromUrl();
        if (!id || !api()) {
            var fab = document.querySelector('.wcon-fab');
            if (fab) fab.parentNode.removeChild(fab);
            if (state.open) closePanel();
            state.serverId = null;
            return;
        }
        if (id !== state.serverId) {
            state.serverId = id;
            state.lines = [];
            disconnect();
            if (state.open) {
                renderLines();
                connect();
            }
        }
        buildLauncher();
    }

    function start() {
        state.history = loadHistory();
        sync();
        /* El panel es una SPA: la URL cambia sin recargar. */
        window.setInterval(sync, 1500);
        window.addEventListener('popstate', sync);
        window.addEventListener('beforeunload', disconnect);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.WaiseConsole = {
        open: openPanel,
        close: closePanel,
        state: state
    };
})();