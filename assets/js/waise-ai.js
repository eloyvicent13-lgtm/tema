/* ---------------------------------------------------------------------------
   Waise Theme - assets/js/waise-ai.js

   Asistente con IA para el panel de cliente. El modelo (lumin-vera-3) se
   consume SIEMPRE a traves de /waise/api/ai.php: la API key vive en el
   servidor y nunca llega al navegador.

   Herramientas: el modelo pide acciones emitiendo un bloque cercado con la
   etiqueta waise-tool que contiene un objeto JSON:

       ~~~waise-tool
       {"tool":"read_file","args":{"path":"/server.properties"}}
       ~~~

   (en la conversacion real la cerca son tres acentos graves, no las tildes de
   este comentario: el fence literal se construye en FENCE mas abajo).

   Este modulo ejecuta esas acciones contra WaiseApi, que usa la sesion del
   usuario. Consecuencia importante: la IA no puede tocar nada que el usuario
   no pueda tocar por si mismo, y solo el servidor que tiene abierto.

   Las acciones destructivas (escribir, borrar, comandos, power) NO se
   ejecutan solas: pintan una tarjeta con "Ejecutar" / "Cancelar". Un modelo
   alucinando un delete sobre la raiz no es hipotetico.
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    var ENDPOINT = '/waise/api/ai.php';
    var MAX_STEPS = 8;              // iteraciones de herramienta por mensaje
    var MAX_TOOL_OUTPUT = 6000;     // caracteres devueltos al modelo
    var MAX_HISTORY = 30;           // mensajes conservados en el hilo

    /* Se compone en runtime a proposito: escrito literal, este archivo no
       sobrevive a ninguna herramienta que trocee por bloques de codigo. */
    var FENCE = '`' + '`' + '`';

    var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 3c0 3.6 2.4 6 6 6-3.6 0-6 2.4-6 6 0-3.6-2.4-6-6-6 3.6 0 6-2.4 6-6Z"/></svg>';

    var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7Z"/></svg>';

    var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

    var ICON_RESET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';

    /* Herramientas que modifican el servidor: exigen confirmacion humana. */
    var DANGEROUS = {
        write_file: true,
        delete_file: true,
        create_folder: true,
        rename_file: true,
        send_command: true,
        power: true
    };

    var LOG_CANDIDATES = [
        '/logs/latest.log',
        '/logs/console.log',
        '/latest.log',
        '/server.log'
    ];

    var state = {
        serverId: null,
        history: [],
        busy: false
    };

    var overlay = null;
    var el = {};

    function api() {
        return window.WaiseApi || null;
    }

    function serverIdFromUrl() {
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    function escapeHtml(text) {
        return String(text === undefined || text === null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function clip(text, max) {
        var value = String(text === undefined || text === null ? '' : text);
        if (value.length <= max) return value;
        return value.slice(0, max) + '\n\n[...recortado, ' + (value.length - max) + ' caracteres mas]';
    }

    /* --- Prompt del sistema ------------------------------------------------ */

    function systemPrompt() {
        return [
            'Eres el asistente tecnico integrado en un panel Pterodactyl (tema Waise).',
            'Ayudas al usuario a administrar UN servidor de juego: leer y corregir',
            'configuraciones, analizar logs, diagnosticar crashes y ejecutar acciones.',
            '',
            'Servidor actual: ' + (state.serverId || 'desconocido') + '.',
            'Solo puedes actuar sobre ese servidor. Las rutas son absolutas dentro de',
            'su carpeta raiz, por ejemplo /server.properties o /logs/latest.log.',
            '',
            'HERRAMIENTAS. Para usar una, responde UNICAMENTE con un bloque:',
            FENCE + 'waise-tool',
            '{"tool":"read_file","args":{"path":"/server.properties"}}',
            FENCE,
            'Nada de texto fuera del bloque cuando pidas una herramienta. Una sola por',
            'mensaje. Recibiras el resultado y podras pedir otra o responder al usuario.',
            '',
            'El objeto SIEMPRE tiene exactamente dos claves: "tool" (texto) y',
            '"args" (objeto). Si la herramienta no lleva argumentos, "args" es un',
            'objeto vacio, pero la clave NO se puede omitir. Ejemplo correcto:',
            '{"tool":"read_log","args":{}}',
            'Ejemplo INCORRECTO (JSON invalido, no lo generes nunca):',
            '{"tool":"read_log",{}}',
            '',
            'Disponibles (se muestra la llamada completa tal cual hay que enviarla):',
            '- {"tool":"list_dir","args":{"path":"/"}}                         lista una carpeta',
            '- {"tool":"read_file","args":{"path":"/server.properties"}}       lee un archivo de texto',
            '- {"tool":"read_log","args":{}}                                   lee el log mas reciente',
            '- {"tool":"server_info","args":{}}                                estado, CPU, RAM, disco',
            '- {"tool":"write_file","args":{"path":"...","contents":"..."}}    escribe (confirmacion)',
            '- {"tool":"create_folder","args":{"path":"/plugins"}}             crea carpeta (confirmacion)',
            '- {"tool":"rename_file","args":{"from":"/a.txt","to":"/b.txt"}}   renombra/mueve (confirmacion)',
            '- {"tool":"delete_file","args":{"path":"/x.jar"}}                 borra (confirmacion)',
            '- {"tool":"send_command","args":{"command":"say hola"}}           consola (confirmacion)',
            '- {"tool":"power","args":{"signal":"restart"}}                    start|stop|restart|kill (confirmacion)',
            '',
            'REGLAS:',
            '1. No inventes el contenido de un archivo ni lineas de un log: leelos antes.',
            '2. En write_file envia SIEMPRE el archivo completo, nunca fragmentos, y',
            '   conserva las lineas que no tengan que cambiar.',
            '3. Antes de escribir o borrar, explica en una frase que vas a hacer y por que.',
            '4. Si el usuario cancela una accion, no insistas ni la reintentes.',
            '5. Nunca uses delete_file sobre "/" ni sobre carpetas completas del servidor.',
            '6. Si algo no se puede saber con las herramientas, dilo claramente.',
            '7. Responde en el idioma del usuario, breve y concreto.'
        ].join('\n');
    }

    /* --- Llamada al proxy -------------------------------------------------- */

    function readCookie(name) {
        var parts = document.cookie ? document.cookie.split(';') : [];
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].trim();
            if (p.indexOf(name + '=') === 0) {
                return decodeURIComponent(p.slice(name.length + 1));
            }
        }
        return null;
    }

    function askModel(messages) {
        var headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
        };
        var xsrf = readCookie('XSRF-TOKEN');
        if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;

        return fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ messages: messages })
        }).then(function (res) {
            return res.text().then(function (text) {
                var data = null;
                try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
                if (!res.ok) {
                    var msg = data && data.error ? data.error : 'Error HTTP ' + res.status;
                    throw new Error(msg);
                }
                if (!data || typeof data.content !== 'string') {
                    throw new Error('Respuesta vacia del asistente.');
                }
                return data.content;
            });
        });
    }

    /* --- Parseo de herramientas -------------------------------------------- */

    var FENCE_RE = new RegExp(FENCE + '(?:waise-tool|json)?\\s*\\n?([\\s\\S]*?)' + FENCE);
    var CODE_BLOCK_RE = new RegExp(FENCE + '[a-zA-Z-]*\\n?([\\s\\S]*?)' + FENCE, 'g');

    /* Se acepta el bloque etiquetado y, como respaldo, un objeto JSON suelto
       con la forma esperada: los modelos olvidan la etiqueta de vez en cuando
       y no compensa perder el turno por eso. */
    /* Reparaciones de los fallos que cometen los modelos al serializar la
       llamada. El caso real observado es {"tool":"read_log",{}}: tras la coma
       va un valor sin clave, asi que JSON.parse revienta y el turno moria en
       silencio. Se reconstruye la clave "args" en vez de perder el turno. */
    function repairToolJson(text) {
        var fixed = text;

        /* {"tool":"x",{...}}  ->  {"tool":"x","args":{...}} */
        fixed = fixed.replace(/("tool"\s*:\s*"[^"]*"\s*,\s*)\{/, '$1"args":{');

        /* Comas colgando antes de cerrar objeto o array. */
        fixed = fixed.replace(/,\s*([}\]])/g, '$1');

        return fixed;
    }

    /* Devuelve la llamada, null si el texto no pretendia ser una herramienta,
       o {malformed:true} si lo pretendia pero no se pudo interpretar. */
    function parseTool(reply) {
        var fence = reply.match(FENCE_RE);
        var candidate = fence ? fence[1] : null;

        if (!candidate) {
            var trimmed = reply.trim();
            if (trimmed.charAt(0) === '{' && trimmed.charAt(trimmed.length - 1) === '}') {
                candidate = trimmed;
            }
        }
        if (!candidate) return null;

        candidate = candidate.trim();

        var parsed = null;
        try { parsed = JSON.parse(candidate); }
        catch (e) {
            try { parsed = JSON.parse(repairToolJson(candidate)); }
            catch (e2) { parsed = null; }
        }

        if (!parsed || typeof parsed.tool !== 'string') {
            /* Si menciona "tool" era un intento de llamada: hay que avisar al
               modelo para que reintente, no tragarselo. */
            if (/"tool"\s*:/.test(candidate)) {
                return { malformed: true, raw: clip(candidate, 400) };
            }
            return null;
        }

        return {
            tool: parsed.tool,
            args: (parsed.args && typeof parsed.args === 'object') ? parsed.args : {}
        };
    }

    function normalizePath(raw) {
        var client = api();
        var value = typeof raw === 'string' ? raw : '';
        if (!client) return value || '/';
        return client.joinPath(value || '/');
    }

    /* --- Ejecucion de herramientas ------------------------------------------ */

    function runTool(call) {
        var client = api();
        if (!client) {
            return Promise.reject(new Error('WaiseApi no esta disponible.'));
        }
        if (!state.serverId) {
            return Promise.reject(new Error('No hay ningun servidor abierto.'));
        }

        var id = state.serverId;
        var args = call.args;
        var folder;
        var from;
        var to;
        var target;
        var signal;

        switch (call.tool) {
            case 'list_dir':
                return client.listFiles(id, normalizePath(args.path)).then(function (entries) {
                    if (!entries.length) return '(carpeta vacia)';
                    return entries.map(function (entry) {
                        return (entry.is_file ? 'archivo' : 'carpeta') + '  ' +
                            entry.name + '  ' + (entry.size || 0) + ' bytes';
                    }).join('\n');
                });

            case 'read_file':
                return client.readFile(id, normalizePath(args.path)).then(function (text) {
                    return text === '' ? '(archivo vacio)' : text;
                });

            case 'read_log':
                return readLatestLog(client, id);

            case 'server_info':
                return Promise.all([
                    client.server(id),
                    client.resources(id)
                ]).then(function (results) {
                    return describeServer(results[0], results[1]);
                });

            case 'write_file':
                if (typeof args.contents !== 'string') {
                    return Promise.reject(new Error('Falta el contenido del archivo.'));
                }
                return client.writeFile(id, normalizePath(args.path), args.contents).then(function () {
                    return 'Archivo escrito: ' + normalizePath(args.path);
                });

            case 'create_folder':
                folder = normalizePath(args.path);
                return client.createFolder(id, client.dirName(folder), client.baseName(folder))
                    .then(function () { return 'Carpeta creada: ' + folder; });

            case 'rename_file':
                from = normalizePath(args.from);
                to = normalizePath(args.to);
                return client.renameFiles(id, '/', [{ from: from, to: to }])
                    .then(function () { return 'Renombrado: ' + from + ' -> ' + to; });

            case 'delete_file':
                target = normalizePath(args.path);
                if (target === '/' || target === '') {
                    return Promise.reject(new Error('Borrar la raiz del servidor no esta permitido.'));
                }
                return client.deleteFiles(id, client.dirName(target), [client.baseName(target)])
                    .then(function () { return 'Borrado: ' + target; });

            case 'send_command':
                if (typeof args.command !== 'string' || args.command.trim() === '') {
                    return Promise.reject(new Error('Comando vacio.'));
                }
                return client.command(id, args.command).then(function () {
                    return 'Comando enviado: ' + args.command +
                        '\n(la salida aparece en la consola del panel)';
                });

            case 'power':
                signal = String(args.signal || '').toLowerCase();
                if (['start', 'stop', 'restart', 'kill'].indexOf(signal) === -1) {
                    return Promise.reject(new Error('Senal de power no valida: ' + signal));
                }
                return client.power(id, signal).then(function () {
                    return 'Senal enviada: ' + signal;
                });

            default:
                return Promise.reject(new Error('Herramienta desconocida: ' + call.tool));
        }
    }

    /* Se prueban las rutas habituales en orden; los eggs no comparten una
       unica convencion para el log. */
    function readLatestLog(client, id) {
        var index = 0;

        function attempt() {
            if (index >= LOG_CANDIDATES.length) {
                return Promise.reject(new Error(
                    'No se encontro ningun log en ' + LOG_CANDIDATES.join(', ') + '.'
                ));
            }
            var path = LOG_CANDIDATES[index++];
            return client.readFile(id, path).then(function (text) {
                if (typeof text !== 'string' || text === '') return attempt();
                /* Solo el final: el principio de un latest.log rara vez ayuda
                   y consume todo el presupuesto de contexto. */
                var lines = text.split('\n');
                var tail = lines.slice(Math.max(0, lines.length - 200)).join('\n');
                return '# ' + path + ' (ultimas ' + Math.min(200, lines.length) + ' lineas)\n' + tail;
            }, function () {
                return attempt();
            });
        }

        return attempt();
    }

    function describeServer(server, resources) {
        var out = [];
        if (server) {
            out.push('Nombre: ' + (server.name || '-'));
            out.push('Identificador: ' + (server.identifier || '-'));
            if (server.description) out.push('Descripcion: ' + server.description);
            if (server.limits) {
                out.push('Limites: RAM ' + server.limits.memory + ' MB, disco ' +
                    server.limits.disk + ' MB, CPU ' + server.limits.cpu + '%');
            }
        }
        if (resources) {
            out.push('Estado: ' + (resources.current_state || '-'));
            var r = resources.resources || {};
            out.push('Uso: RAM ' + Math.round((r.memory_bytes || 0) / 1048576) + ' MB, ' +
                'CPU ' + (Math.round((r.cpu_absolute || 0) * 100) / 100) + '%, ' +
                'disco ' + Math.round((r.disk_bytes || 0) / 1048576) + ' MB');
        }
        return out.length ? out.join('\n') : 'Sin datos del servidor.';
    }

    /* --- Render ------------------------------------------------------------ */

    function scrollDown() {
        if (el.log) el.log.scrollTop = el.log.scrollHeight;
    }

    /* Markdown minimo: negrita, codigo en linea y bloques. Se escapa antes de
       componer, asi que nada de lo que devuelva el modelo puede inyectar HTML. */
    function renderMarkdown(text) {
        var safe = escapeHtml(text);
        var blocks = [];

        CODE_BLOCK_RE.lastIndex = 0;
        safe = safe.replace(CODE_BLOCK_RE, function (match, code) {
            blocks.push('<pre><code>' + code.replace(/\n$/, '') + '</code></pre>');
            return '\u0000' + (blocks.length - 1) + '\u0000';
        });

        safe = safe.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

        var html = safe.split(/\n{2,}/).map(function (para) {
            return '<p>' + para.replace(/\n/g, '<br>') + '</p>';
        }).join('');

        return html.replace(/<p>\u0000(\d+)\u0000<\/p>|\u0000(\d+)\u0000/g, function (m, a, b) {
            return blocks[a !== undefined ? a : b];
        });
    }

    function addMessage(role, text) {
        var node = document.createElement('div');
        node.className = 'waise-ai-msg waise-ai-msg-' + role;
        if (role === 'user') {
            node.textContent = text;
        } else {
            node.innerHTML = renderMarkdown(text);
        }
        el.log.appendChild(node);
        scrollDown();
        return node;
    }

    function describeArgs(call) {
        var a = call.args;
        if (typeof a.path === 'string') return a.path;
        if (typeof a.from === 'string') return a.from + ' -> ' + (a.to || '?');
        if (typeof a.command === 'string') return a.command;
        if (typeof a.signal === 'string') return a.signal;
        return '';
    }

    function addToolCard(call, opts) {
        var options = opts || {};
        var card = document.createElement('div');
        card.className = 'waise-ai-tool' + (options.danger ? ' is-danger' : '');

        var head = document.createElement('div');
        head.className = 'waise-ai-tool-head';

        var label = document.createElement('strong');
        label.textContent = call.tool;
        head.appendChild(label);

        var detail = document.createElement('span');
        detail.className = 'waise-ai-tool-path';
        detail.textContent = describeArgs(call);
        head.appendChild(detail);

        card.appendChild(head);
        el.log.appendChild(card);
        scrollDown();
        return card;
    }

    function setCardBody(card, text) {
        var body = card.querySelector('.waise-ai-tool-body');
        if (!body) {
            body = document.createElement('div');
            body.className = 'waise-ai-tool-body';
            card.appendChild(body);
        }
        body.textContent = text;
        scrollDown();
    }

    function showTyping() {
        hideTyping();
        var node = document.createElement('div');
        node.className = 'waise-ai-typing';
        node.innerHTML = '<span></span><span></span><span></span>';
        node.setAttribute('data-waise-typing', '1');
        el.log.appendChild(node);
        scrollDown();
    }

    function hideTyping() {
        var node = el.log.querySelector('[data-waise-typing]');
        if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    /* --- Confirmacion ------------------------------------------------------- */

    function previewFor(call) {
        if (call.tool === 'write_file' && typeof call.args.contents === 'string') {
            return clip(call.args.contents, 2000);
        }
        if (call.tool === 'delete_file') {
            return 'Se borrara ' + normalizePath(call.args.path) + '. Esta accion no se puede deshacer.';
        }
        if (call.tool === 'power') {
            return 'Se enviara la senal "' + call.args.signal + '" al servidor.';
        }
        if (call.tool === 'send_command') {
            return 'Se ejecutara en la consola: ' + call.args.command;
        }
        return '';
    }

    function confirmTool(call, card) {
        return new Promise(function (resolve) {
            var preview = previewFor(call);
            if (preview) setCardBody(card, preview);

            var actions = document.createElement('div');
            actions.className = 'waise-ai-tool-actions';

            var run = document.createElement('button');
            run.type = 'button';
            run.className = 'waise-ai-btn waise-ai-btn-run';
            run.textContent = 'Ejecutar';

            var cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'waise-ai-btn';
            cancel.textContent = 'Cancelar';

            function finish(accepted) {
                run.disabled = true;
                cancel.disabled = true;
                if (actions.parentNode) actions.parentNode.removeChild(actions);
                resolve(accepted);
            }

            run.addEventListener('click', function () { finish(true); });
            cancel.addEventListener('click', function () { finish(false); });

            actions.appendChild(run);
            actions.appendChild(cancel);
            card.appendChild(actions);
            scrollDown();
        });
    }

    /* --- Bucle principal ---------------------------------------------------- */

    function pushHistory(role, content) {
        state.history.push({ role: role, content: content });
        if (state.history.length > MAX_HISTORY) {
            state.history = state.history.slice(state.history.length - MAX_HISTORY);
        }
    }

    function conversation() {
        return [{ role: 'system', content: systemPrompt() }].concat(state.history);
    }

    function setBusy(value) {
        state.busy = value;
        if (el.send) el.send.disabled = value;
        if (el.input) el.input.disabled = value;
        if (!value && el.input) el.input.focus();
    }

    function handleTurn(step) {
        if (step > MAX_STEPS) {
            addMessage('error', 'El asistente ha encadenado demasiadas acciones seguidas y se ha detenido. Vuelve a preguntar concretando lo que necesitas.');
            setBusy(false);
            return;
        }

        showTyping();

        askModel(conversation()).then(function (reply) {
            hideTyping();
            pushHistory('assistant', reply);

            var call = parseTool(reply);
            if (!call) {
                addMessage('bot', reply);
                setBusy(false);
                return;
            }

            /* Llamada ilegible: se devuelve el error al modelo y se reintenta
               dentro del presupuesto de pasos, en vez de quedarse colgado. */
            if (call.malformed) {
                pushHistory('user', 'ERROR DE FORMATO: tu ultima llamada de herramienta no era ' +
                    'JSON valido y no se ha ejecutado nada. Recibido:\n' + call.raw + '\n\n' +
                    'Vuelve a emitirla con la forma exacta {"tool":"nombre","args":{...}}, ' +
                    'con la clave "args" siempre presente (objeto vacio si no lleva argumentos), ' +
                    'y sin ningun texto fuera del bloque.');
                handleTurn(step + 1);
                return;
            }

            var danger = !!DANGEROUS[call.tool];
            var card = addToolCard(call, { danger: danger });
            var gate = danger ? confirmTool(call, card) : Promise.resolve(true);

            gate.then(function (accepted) {
                if (!accepted) {
                    setCardBody(card, 'Cancelado por el usuario.');
                    pushHistory('user', 'RESULTADO DE ' + call.tool +
                        ': el usuario ha CANCELADO la accion. No la reintentes; ' +
                        'explica alternativas o pregunta que prefiere hacer.');
                    handleTurn(step + 1);
                    return;
                }

                setCardBody(card, 'Ejecutando...');
                runTool(call).then(function (result) {
                    var text = clip(String(result), MAX_TOOL_OUTPUT);
                    setCardBody(card, text);
                    pushHistory('user', 'RESULTADO DE ' + call.tool + ':\n' + text);
                    handleTurn(step + 1);
                }, function (err) {
                    card.classList.add('is-error');
                    var msg = err && err.message ? err.message : String(err);
                    setCardBody(card, 'Error: ' + msg);
                    pushHistory('user', 'ERROR EN ' + call.tool + ': ' + msg);
                    handleTurn(step + 1);
                });
            });
        }, function (err) {
            hideTyping();
            addMessage('error', err && err.message ? err.message : 'No se pudo contactar con el asistente.');
            setBusy(false);
        });
    }

    function submit() {
        if (state.busy) return;
        var text = el.input.value.trim();
        if (!text) return;

        el.input.value = '';
        el.input.style.height = 'auto';
        addMessage('user', text);
        pushHistory('user', text);
        setBusy(true);
        handleTurn(1);
    }

    function welcome() {
        if (!state.serverId) {
            return 'Abre un servidor para que pueda leer sus archivos y logs. Mientras tanto puedo responder dudas generales.';
        }
        return 'Puedo leer los archivos y el log de este servidor, corregir configuraciones y ejecutar acciones. ' +
            'Las acciones que modifican algo te pediran confirmacion.\n\n' +
            'Prueba con: **"revisa el ultimo log y dime por que ha crasheado"**.';
    }

    function resetChat() {
        state.history = [];
        el.log.innerHTML = '';
        addMessage('bot', welcome());
    }

    /* --- Construccion del panel --------------------------------------------- */

    function build() {
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.className = 'waise-ai-overlay';
        overlay.innerHTML =
            '<div class="waise-ai-panel" role="dialog" aria-modal="true" aria-label="Asistente Waise">' +
                '<div class="waise-ai-head">' +
                    '<span class="waise-ai-head-icon">' + ICON + '</span>' +
                    '<h2>Asistente Waise</h2>' +
                    '<span class="waise-ai-scope" data-waise-scope></span>' +
                    '<button type="button" class="waise-ai-btn-icon" data-waise-reset ' +
                        'title="Nueva conversacion" aria-label="Nueva conversacion">' + ICON_RESET + '</button>' +
                    '<button type="button" class="waise-ai-btn-icon" data-waise-close ' +
                        'title="Cerrar" aria-label="Cerrar">' + ICON_CLOSE + '</button>' +
                '</div>' +
                '<div class="waise-ai-log" data-waise-log></div>' +
                '<div class="waise-ai-form">' +
                    '<textarea class="waise-ai-input" data-waise-input rows="1" ' +
                        'placeholder="Pregunta o pide una accion..."></textarea>' +
                    '<button type="button" class="waise-ai-send" data-waise-send ' +
                        'aria-label="Enviar">' + ICON_SEND + '</button>' +
                '</div>' +
                '<div class="waise-ai-hint">Enter envia, Shift+Enter salto de linea. ' +
                    'La IA puede equivocarse: revisa los cambios antes de confirmarlos.</div>' +
            '</div>';

        el.log = overlay.querySelector('[data-waise-log]');
        el.input = overlay.querySelector('[data-waise-input]');
        el.send = overlay.querySelector('[data-waise-send]');
        el.scope = overlay.querySelector('[data-waise-scope]');

        overlay.querySelector('[data-waise-close]').addEventListener('click', close);
        overlay.querySelector('[data-waise-reset]').addEventListener('click', resetChat);
        el.send.addEventListener('click', submit);

        overlay.addEventListener('mousedown', function (event) {
            if (event.target === overlay) close();
        });

        el.input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
            }
        });

        el.input.addEventListener('input', function () {
            el.input.style.height = 'auto';
            el.input.style.height = Math.min(el.input.scrollHeight, 140) + 'px';
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && overlay.classList.contains('is-open')) close();
        });

        document.body.appendChild(overlay);
        addMessage('bot', welcome());
        return overlay;
    }

    function open() {
        build();
        state.serverId = serverIdFromUrl();
        el.scope.textContent = state.serverId ? 'servidor ' + state.serverId : 'sin servidor';
        overlay.classList.add('is-open');
        window.setTimeout(function () { el.input.focus(); }, 60);
    }

    function close() {
        if (overlay) overlay.classList.remove('is-open');
    }

    function toggle() {
        if (overlay && overlay.classList.contains('is-open')) close();
        else open();
    }

    /* --- Entrada en la barra lateral ---------------------------------------- */

    /* Se clona un enlace existente de la subnavegacion del servidor en vez de
       replicar su markup: asi la entrada hereda las clases generadas por el
       panel aunque cambien entre versiones. El clon pierde los manejadores de
       React, por eso se intercepta el click y no se navega a ningun sitio. */
    function injectNavEntry() {
        if (document.querySelector('[data-waise-ai-nav]')) return;

        var reference = null;
        var links = document.querySelectorAll('a[href^="/server/"]');
        for (var i = 0; i < links.length; i++) {
            if (/^\/server\/[^/]+\/(files|startup|settings|network|databases)/.test(links[i].getAttribute('href') || '')) {
                reference = links[i];
                break;
            }
        }
        if (!reference || !reference.parentNode) return;

        var entry = reference.cloneNode(true);
        entry.setAttribute('data-waise-ai-nav', '1');
        entry.setAttribute('href', '#waise-ai');
        entry.classList.add('waise-ai-navlink');
        entry.removeAttribute('aria-current');
        entry.innerHTML = ICON + '<span>Asistente IA</span>';

        entry.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            toggle();
        });

        reference.parentNode.appendChild(entry);
    }

    function watchNav() {
        injectNavEntry();

        var observer = new MutationObserver(function () {
            if (serverIdFromUrl()) injectNavEntry();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        /* El observer no dispara si la navegacion SPA reutiliza los nodos. */
        window.setInterval(function () {
            if (serverIdFromUrl()) injectNavEntry();
        }, 1500);
    }

    function init() {
        watchNav();

        /* Atajo: Ctrl/Cmd + I. */
        document.addEventListener('keydown', function (event) {
            if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey &&
                String(event.key).toLowerCase() === 'i') {
                var tag = document.activeElement ? document.activeElement.tagName : '';
                if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                event.preventDefault();
                toggle();
            }
        });
    }

    window.WaiseAI = {
        open: open,
        close: close,
        toggle: toggle,
        reset: resetChat
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();