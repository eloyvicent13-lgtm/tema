/* ---------------------------------------------------------------------------
   Waise Theme - assets/js/waise-ops.js

   Centro de operaciones: seis herramientas en un solo panel con pestanas para
   no anadir seis lanzadores mas a la pila de FABs.

     1. Programador visual con presets  -> /api/client/servers/{id}/schedules
     2. Analizador de crash reports     -> lee /crash-reports por la API de ficheros
     3. Plantillas de configuracion     -> copia ficheros de config entre servidores
     4. Registro de actividad           -> /api/client/servers/{id}/activity
     5. Alertas a Discord               -> sondeo de /resources + webhook
     6. Subusuarios con roles           -> /api/client/servers/{id}/users

   Todo se apoya en WaiseApi (sesion del usuario + XSRF), asi que cada cuenta
   solo puede hacer aquello para lo que el panel ya le da permiso.
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    var ALERT_KEY = 'waise.ops.alerts';
    var POLL_MS = 30000;

    var state = {
        serverId: null,
        open: false,
        tab: 'sched',
        alerts: null,
        pollTimer: null,
        lastAlertAt: {}
    };

    var el = {};

    function api() {
        return window.WaiseApi || null;
    }

    function serverIdFromUrl() {
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    function esc(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtDate(value) {
        var d = new Date(value);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleString();
    }

    function body(html) {
        if (el.body) el.body.innerHTML = html;
    }

    function busy(text) {
        body('<p class="wops-msg">' + esc(text || 'Cargando...') + '</p>');
    }

    function fail(err) {
        body('<p class="wops-msg wops-err">' + esc(err && err.message ? err.message : String(err)) + '</p>');
    }

    function toast(text, kind) {
        var node = document.createElement('div');
        node.className = 'wops-toast' + (kind ? ' wops-toast-' + kind : '');
        node.textContent = text;
        document.body.appendChild(node);
        window.setTimeout(function () {
            if (node.parentNode) node.parentNode.removeChild(node);
        }, 4200);
    }

    /* =====================================================================
       1. PROGRAMADOR VISUAL
       ===================================================================== */

    /* cron = [minuto, hora, dia_mes, mes, dia_semana]; tasks se crean despues
       de la propia tarea programada, que es como lo hace el panel oficial. */
    var PRESETS = [
        {
            id: 'restart-daily',
            name: 'Reinicio diario 4:00',
            desc: 'Avisa a los jugadores y reinicia el servidor todas las noches.',
            cron: ['0', '4', '*', '*', '*'],
            tasks: [
                { action: 'command', payload: 'say Reinicio programado en 60 segundos', time_offset: 0 },
                { action: 'command', payload: 'save-all', time_offset: 55 },
                { action: 'power', payload: 'restart', time_offset: 5 }
            ]
        },
        {
            id: 'backup-weekly',
            name: 'Backup semanal (domingo 5:00)',
            desc: 'Guarda el mundo y crea una copia de seguridad completa.',
            cron: ['0', '5', '*', '*', '0'],
            tasks: [
                { action: 'command', payload: 'save-all', time_offset: 0 },
                { action: 'backup', payload: '', time_offset: 10 }
            ]
        },
        {
            id: 'backup-daily',
            name: 'Backup diario 6:00',
            desc: 'Copia de seguridad todos los dias de madrugada.',
            cron: ['0', '6', '*', '*', '*'],
            tasks: [
                { action: 'command', payload: 'save-all', time_offset: 0 },
                { action: 'backup', payload: '', time_offset: 10 }
            ]
        },
        {
            id: 'announce-30',
            name: 'Anuncio cada 30 minutos',
            desc: 'Mensaje recurrente en el chat del servidor.',
            cron: ['*/30', '*', '*', '*', '*'],
            prompt: { label: 'Texto del anuncio', value: 'Bienvenido al servidor! Usa /help para ver los comandos.' },
            tasks: [
                { action: 'command', payload: 'say {{prompt}}', time_offset: 0 }
            ]
        },
        {
            id: 'clear-lag',
            name: 'Limpiar entidades cada hora',
            desc: 'Elimina items tirados en el suelo para bajar el lag.',
            cron: ['0', '*', '*', '*', '*'],
            tasks: [
                { action: 'command', payload: 'say Limpiando objetos del suelo...', time_offset: 0 },
                { action: 'command', payload: 'kill @e[type=item]', time_offset: 5 }
            ]
        },
        {
            id: 'save-15',
            name: 'Guardar mundo cada 15 minutos',
            desc: 'Fuerza el guardado periodico del mundo en disco.',
            cron: ['*/15', '*', '*', '*', '*'],
            tasks: [
                { action: 'command', payload: 'save-all', time_offset: 0 }
            ]
        }
    ];

    function listSchedules() {
        return api().request('GET', '/servers/' + encodeURIComponent(state.serverId) + '/schedules')
            .then(function (data) {
                return (data && data.data ? data.data : []).map(function (item) {
                    return item.attributes;
                });
            });
    }

    function createSchedule(preset, promptValue) {
        var path = '/servers/' + encodeURIComponent(state.serverId) + '/schedules';
        return api().request('POST', path, {
            json: {
                name: preset.name,
                minute: preset.cron[0],
                hour: preset.cron[1],
                day_of_month: preset.cron[2],
                month: preset.cron[3],
                day_of_week: preset.cron[4],
                is_active: true,
                only_when_online: preset.id.indexOf('backup') === -1
            }
        }).then(function (data) {
            var sched = data && data.attributes ? data.attributes : null;
            if (!sched) throw new Error('El panel no devolvio la tarea creada.');

            /* Las tareas se encadenan en serie: crear varias a la vez hace que
               el panel devuelva 429 con facilidad. */
            var seq = Promise.resolve();
            preset.tasks.forEach(function (task) {
                seq = seq.then(function () {
                    var payload = String(task.payload || '')
                        .replace('{{prompt}}', promptValue || '');
                    return api().request('POST', path + '/' + sched.id + '/tasks', {
                        json: {
                            action: task.action,
                            payload: payload,
                            time_offset: task.time_offset,
                            continue_on_failure: false
                        }
                    });
                });
            });
            return seq.then(function () { return sched; });
        });
    }

    function deleteSchedule(id) {
        return api().request('DELETE',
            '/servers/' + encodeURIComponent(state.serverId) + '/schedules/' + encodeURIComponent(id));
    }

    function cronText(s) {
        return [s.cron.minute, s.cron.hour, s.cron.day_of_month, s.cron.month, s.cron.day_of_week].join(' ');
    }

    function renderScheduler() {
        busy('Leyendo tareas programadas...');
        listSchedules().then(function (list) {
            var html = '<div class="wops-section"><h3>Presets</h3><div class="wops-grid">';
            PRESETS.forEach(function (p) {
                html += '<article class="wops-card">' +
                    '<h4>' + esc(p.name) + '</h4>' +
                    '<p>' + esc(p.desc) + '</p>' +
                    '<code class="wops-cron">' + esc(p.cron.join(' ')) + '</code>' +
                    '<button type="button" class="wops-btn wops-primary" data-preset="' + esc(p.id) + '">Crear</button>' +
                    '</article>';
            });
            html += '</div></div>';

            html += '<div class="wops-section"><h3>Tareas existentes (' + list.length + ')</h3>';
            if (!list.length) {
                html += '<p class="wops-msg">Este servidor no tiene tareas programadas.</p>';
            } else {
                html += '<table class="wops-table"><thead><tr>' +
                    '<th>Nombre</th><th>Cron</th><th>Estado</th><th>Siguiente</th><th></th>' +
                    '</tr></thead><tbody>';
                list.forEach(function (s) {
                    html += '<tr>' +
                        '<td>' + esc(s.name) + '</td>' +
                        '<td><code>' + esc(cronText(s)) + '</code></td>' +
                        '<td>' + (s.is_active ? '<span class="wops-ok">activa</span>' : '<span class="wops-off">pausada</span>') + '</td>' +
                        '<td>' + esc(s.next_run_at ? fmtDate(s.next_run_at) : '-') + '</td>' +
                        '<td><button type="button" class="wops-btn wops-danger" data-del-sched="' + esc(s.id) + '">Borrar</button></td>' +
                        '</tr>';
                });
                html += '</tbody></table>';
            }
            html += '</div>';
            body(html);
        }, fail);
    }

    function onSchedulerClick(ev) {
        var add = ev.target.closest('[data-preset]');
        if (add) {
            var preset = null;
            var wanted = add.getAttribute('data-preset');
            for (var i = 0; i < PRESETS.length; i++) {
                if (PRESETS[i].id === wanted) preset = PRESETS[i];
            }
            if (!preset) return;

            var value = '';
            if (preset.prompt) {
                value = window.prompt(preset.prompt.label, preset.prompt.value);
                if (value === null) return;
            }
            add.disabled = true;
            add.textContent = 'Creando...';
            createSchedule(preset, value).then(function () {
                toast('Tarea "' + preset.name + '" creada.', 'ok');
                renderScheduler();
            }, function (err) {
                add.disabled = false;
                add.textContent = 'Crear';
                toast(err.message, 'err');
            });
            return;
        }

        var del = ev.target.closest('[data-del-sched]');
        if (del) {
            if (!window.confirm('Borrar esta tarea programada?')) return;
            del.disabled = true;
            deleteSchedule(del.getAttribute('data-del-sched')).then(function () {
                toast('Tarea borrada.', 'ok');
                renderScheduler();
            }, function (err) {
                del.disabled = false;
                toast(err.message, 'err');
            });
        }
    }

    /* =====================================================================
       2. ANALIZADOR DE CRASH REPORTS
       ===================================================================== */

    /* Paquetes que aparecen siempre en un stack trace y que nunca son "el mod
       culpable", asi que se descartan al buscar el causante. */
    var VANILLA_PKGS = [
        'net.minecraft', 'net.minecraftforge', 'net.fabricmc', 'cpw.mods',
        'java.', 'javax.', 'sun.', 'jdk.', 'org.spongepowered', 'org.objectweb',
        'io.netty', 'com.mojang', 'org.bukkit', 'org.spigotmc', 'net.md_5',
        'org.apache', 'com.google', 'net.neoforged', 'org.slf4j', 'scala.'
    ];

    function isVanilla(pkg) {
        for (var i = 0; i < VANILLA_PKGS.length; i++) {
            if (pkg.indexOf(VANILLA_PKGS[i]) === 0) return true;
        }
        return false;
    }

    function parseCrash(text) {
        var out = {
            description: null,
            exception: null,
            suspects: [],
            frames: [],
            loader: null,
            time: null
        };

        var m = text.match(/---- Minecraft Crash Report ----[\s\S]*?\/\/ ?(.*)/);
        var desc = text.match(/Description:\s*(.+)/);
        if (desc) out.description = desc[1].trim();

        var when = text.match(/Time:\s*(.+)/);
        if (when) out.time = when[1].trim();

        /* La primera linea con forma de excepcion Java es la causa raiz. */
        var exc = text.match(/^\s*((?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error|Throwable))(?::\s*(.*))?$/m);
        if (exc) out.exception = exc[1] + (exc[2] ? ': ' + exc[2] : '');

        /* Forge lista explicitamente los mods sospechosos. */
        var susp = text.match(/Suspected Mods?:\s*(.+(?:\n\t+.+)*)/);
        if (susp) {
            susp[1].split(/[,\n]/).forEach(function (part) {
                var clean = part.trim();
                if (clean && clean.toLowerCase() !== 'none' && clean.toLowerCase() !== 'unknown') {
                    out.suspects.push({ name: clean, why: 'Forge lo marca como sospechoso' });
                }
            });
        }

        if (/fabric/i.test(text)) out.loader = 'Fabric';
        else if (/neoforge/i.test(text)) out.loader = 'NeoForge';
        else if (/forge/i.test(text)) out.loader = 'Forge';
        else if (/paper|spigot|bukkit/i.test(text)) out.loader = 'Bukkit/Paper';

        /* Recorremos el stack de arriba abajo: el primer paquete que no sea
           vanilla ni del cargador es, en la practica, el mod que ha petado. */
        var re = /at\s+((?:[a-zA-Z_$][\w$]*\.)+)[a-zA-Z_$][\w$]*[.$][\w$<>]+\(/g;
        var seen = {};
        var hit;
        while ((hit = re.exec(text)) !== null) {
            var pkg = hit[1].replace(/\.$/, '');
            if (seen[pkg]) continue;
            seen[pkg] = true;
            out.frames.push(pkg);
            if (!isVanilla(pkg) && out.suspects.length < 5) {
                var parts = pkg.split('.');
                var guess = parts.length > 1 ? parts[1] : parts[0];
                var already = false;
                for (var i = 0; i < out.suspects.length; i++) {
                    if (out.suspects[i].name.toLowerCase().indexOf(guess.toLowerCase()) !== -1) already = true;
                }
                if (!already) {
                    out.suspects.push({
                        name: guess,
                        why: 'aparece en el stack trace (' + pkg + ')'
                    });
                }
            }
        }

        /* Errores tipicos que no son culpa de ningun mod. */
        if (/java\.lang\.OutOfMemoryError/.test(text)) {
            out.suspects.unshift({ name: 'Memoria insuficiente', why: 'OutOfMemoryError: sube la RAM asignada al servidor' });
        }
        if (/Mixin (apply|prepare) failed|MixinApplyError|MixinTransformerError/.test(text)) {
            var mix = text.match(/mixins?\.([\w-]+)\.json/);
            if (mix) out.suspects.unshift({ name: mix[1], why: 'fallo al aplicar sus mixins' });
        }
        if (/Missing or unsupported mandatory dependencies|requires .* which is missing/i.test(text)) {
            out.suspects.unshift({ name: 'Dependencias', why: 'faltan mods requeridos por otros mods' });
        }
        if (/Duplicate mod/i.test(text)) {
            out.suspects.unshift({ name: 'Mod duplicado', why: 'el mismo mod esta dos veces en /mods' });
        }
        return out;
    }

    function renderCrashes() {
        busy('Buscando crash reports...');
        api().listFiles(state.serverId, '/crash-reports').then(function (entries) {
            var files = entries.filter(function (e) {
                return e.is_file;
            }).sort(function (a, b) {
                return new Date(b.modified_at) - new Date(a.modified_at);
            });

            if (!files.length) {
                body('<p class="wops-msg wops-ok">No hay ningun crash report. El servidor no ha petado.</p>');
                return;
            }

            var html = '<div class="wops-section"><h3>Crash reports (' + files.length + ')</h3>' +
                '<p class="wops-msg">El mas reciente primero. Pulsa uno para analizarlo.</p><ul class="wops-list">';
            files.slice(0, 25).forEach(function (f) {
                html += '<li><button type="button" class="wops-row" data-crash="' + esc(f.name) + '">' +
                    '<span class="wops-row-name">' + esc(f.name) + '</span>' +
                    '<span class="wops-row-meta">' + esc(fmtDate(f.modified_at)) + '</span>' +
                    '</button></li>';
            });
            html += '</ul></div><div class="wops-crash-out"></div>';
            body(html);
        }, function (err) {
            if (err.status === 404) {
                body('<p class="wops-msg wops-ok">Este servidor no tiene carpeta /crash-reports.</p>');
                return;
            }
            fail(err);
        });
    }

    function showCrash(name) {
        var out = el.body.querySelector('.wops-crash-out');
        if (!out) return;
        out.innerHTML = '<p class="wops-msg">Leyendo ' + esc(name) + '...</p>';

        api().readFile(state.serverId, '/crash-reports/' + name).then(function (text) {
            var r = parseCrash(text);
            var html = '<div class="wops-section"><h3>Analisis de ' + esc(name) + '</h3>';

            if (r.suspects.length) {
                html += '<div class="wops-verdict">' +
                    '<span class="wops-verdict-label">Causa probable</span>' +
                    '<strong>' + esc(r.suspects[0].name) + '</strong>' +
                    '<span class="wops-verdict-why">' + esc(r.suspects[0].why) + '</span>' +
                    '</div>';
            } else {
                html += '<p class="wops-msg">No se ha podido senalar un mod concreto. Revisa el stack completo.</p>';
            }

            html += '<dl class="wops-facts">';
            if (r.description) html += '<dt>Descripcion</dt><dd>' + esc(r.description) + '</dd>';
            if (r.exception) html += '<dt>Excepcion</dt><dd><code>' + esc(r.exception) + '</code></dd>';
            if (r.loader) html += '<dt>Plataforma</dt><dd>' + esc(r.loader) + '</dd>';
            if (r.time) html += '<dt>Fecha</dt><dd>' + esc(r.time) + '</dd>';
            html += '</dl>';

            if (r.suspects.length > 1) {
                html += '<h4>Otros sospechosos</h4><ul class="wops-bullets">';
                r.suspects.slice(1).forEach(function (s) {
                    html += '<li><strong>' + esc(s.name) + '</strong> - ' + esc(s.why) + '</li>';
                });
                html += '</ul>';
            }

            if (r.frames.length) {
                html += '<h4>Paquetes en el stack</h4><ul class="wops-bullets wops-frames">';
                r.frames.slice(0, 12).forEach(function (f) {
                    html += '<li><code class="' + (isVanilla(f) ? 'wops-dim' : '') + '">' + esc(f) + '</code></li>';
                });
                html += '</ul>';
            }

            html += '<details class="wops-raw"><summary>Ver informe completo</summary><pre>' +
                esc(text.slice(0, 40000)) + '</pre></details></div>';
            out.innerHTML = html;
            out.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, function (err) {
            out.innerHTML = '<p class="wops-msg wops-err">' + esc(err.message) + '</p>';
        });
    }

    /* =====================================================================
       3. PLANTILLAS DE CONFIGURACION
       ===================================================================== */

    /* Solo ficheros de configuracion: el mundo y los .jar no caben por la API
       de ficheros sin reventar la memoria del navegador. Para eso estan los
       backups del panel, y el propio panel avisa de ello en la interfaz. */
    var TEMPLATE_FILES = [
        'server.properties', 'bukkit.yml', 'spigot.yml', 'paper.yml',
        'paper-global.yml', 'paper-world-defaults.yml', 'ops.json',
        'whitelist.json', 'banned-players.json', 'banned-ips.json',
        'permissions.yml', 'config/fabric/fabric-loader.properties'
    ];
    var TEMPLATE_DIR = '/.waise/templates';

    function templateName(file) {
        return file.replace(/\.json$/, '');
    }

    function renderTemplates() {
        busy('Leyendo plantillas guardadas...');
        api().listFiles(state.serverId, TEMPLATE_DIR).then(function (entries) {
            return entries.filter(function (e) { return e.is_file && /\.json$/.test(e.name); });
        }, function () {
            return [];
        }).then(function (files) {
            var html = '<div class="wops-section">' +
                '<h3>Guardar la configuracion actual</h3>' +
                '<p class="wops-msg">Copia los ficheros de configuracion del servidor ' +
                '(server.properties, ops, whitelist, yml de Paper/Spigot) en una plantilla ' +
                'reutilizable. El mundo y los .jar no se incluyen: para eso usa un backup.</p>' +
                '<div class="wops-inline">' +
                '<input type="text" class="wops-input wops-tpl-name" placeholder="Nombre de la plantilla" maxlength="48">' +
                '<button type="button" class="wops-btn wops-primary wops-tpl-save">Guardar plantilla</button>' +
                '</div></div>';

            html += '<div class="wops-section"><h3>Plantillas (' + files.length + ')</h3>';
            if (!files.length) {
                html += '<p class="wops-msg">Todavia no has guardado ninguna plantilla en este servidor.</p>';
            } else {
                html += '<ul class="wops-list">';
                files.forEach(function (f) {
                    html += '<li class="wops-row wops-row-static">' +
                        '<span class="wops-row-name">' + esc(templateName(f.name)) + '</span>' +
                        '<span class="wops-row-meta">' + esc(fmtDate(f.modified_at)) + '</span>' +
                        '<span class="wops-row-actions">' +
                        '<button type="button" class="wops-btn" data-tpl-apply="' + esc(f.name) + '">Aplicar</button>' +
                        '<button type="button" class="wops-btn wops-danger" data-tpl-del="' + esc(f.name) + '">Borrar</button>' +
                        '</span></li>';
                });
                html += '</ul>';
            }
            html += '</div>';
            body(html);
        }, fail);
    }

    function saveTemplate(name) {
        var payload = { name: name, created_at: new Date().toISOString(), files: {} };
        var seq = api().ensureFolder(state.serverId, TEMPLATE_DIR);

        TEMPLATE_FILES.forEach(function (file) {
            seq = seq.then(function () {
                return api().readFile(state.serverId, '/' + file).then(function (contents) {
                    payload.files[file] = contents;
                }, function () {
                    /* El fichero no existe en este servidor: se omite y ya. */
                });
            });
        });

        return seq.then(function () {
            var count = Object.keys(payload.files).length;
            if (!count) throw new Error('No se ha encontrado ningun fichero de configuracion conocido.');
            return api().writeFile(
                state.serverId,
                TEMPLATE_DIR + '/' + name.replace(/[^\w .-]/g, '_') + '.json',
                JSON.stringify(payload, null, 2)
            ).then(function () { return count; });
        });
    }

    function applyTemplate(file) {
        return api().readFile(state.serverId, TEMPLATE_DIR + '/' + file).then(function (raw) {
            var data = JSON.parse(raw);
            var names = Object.keys(data.files || {});
            if (!names.length) throw new Error('La plantilla esta vacia.');

            var seq = Promise.resolve();
            var written = 0;
            names.forEach(function (name) {
                seq = seq.then(function () {
                    return api().writeFile(state.serverId, '/' + name, data.files[name]).then(function () {
                        written++;
                    }, function () {
                        /* Sin permiso de escritura sobre ese fichero: seguimos. */
                    });
                });
            });
            return seq.then(function () { return written; });
        });
    }

    function onTemplatesClick(ev) {
        var save = ev.target.closest('.wops-tpl-save');
        if (save) {
            var input = el.body.querySelector('.wops-tpl-name');
            var name = input ? input.value.trim() : '';
            if (!name) {
                toast('Pon un nombre a la plantilla.', 'err');
                if (input) input.focus();
                return;
            }
            save.disabled = true;
            save.textContent = 'Guardando...';
            saveTemplate(name).then(function (count) {
                toast('Plantilla guardada con ' + count + ' ficheros.', 'ok');
                renderTemplates();
            }, function (err) {
                save.disabled = false;
                save.textContent = 'Guardar plantilla';
                toast(err.message, 'err');
            });
            return;
        }

        var apply = ev.target.closest('[data-tpl-apply]');
        if (apply) {
            if (!window.confirm('Esto sobrescribe los ficheros de configuracion actuales del servidor. Continuar?')) return;
            apply.disabled = true;
            apply.textContent = 'Aplicando...';
            applyTemplate(apply.getAttribute('data-tpl-apply')).then(function (n) {
                toast(n + ' ficheros escritos. Reinicia el servidor para aplicarlos.', 'ok');
                renderTemplates();
            }, function (err) {
                apply.disabled = false;
                apply.textContent = 'Aplicar';
                toast(err.message, 'err');
            });
            return;
        }

        var del = ev.target.closest('[data-tpl-del]');
        if (del) {
            if (!window.confirm('Borrar esta plantilla?')) return;
            api().deleteFiles(state.serverId, TEMPLATE_DIR, [del.getAttribute('data-tpl-del')])
                .then(function () {
                    toast('Plantilla borrada.', 'ok');
                    renderTemplates();
                }, function (err) {
                    toast(err.message, 'err');
                });
        }
    }

    /* =====================================================================
       4. REGISTRO DE ACTIVIDAD
       ===================================================================== */

    var EVENT_LABELS = {
        'server:power.start': 'Encendio el servidor',
        'server:power.stop': 'Apago el servidor',
        'server:power.restart': 'Reinicio el servidor',
        'server:power.kill': 'Mato el proceso',
        'server:console.command': 'Ejecuto un comando',
        'server:file.write': 'Escribio un fichero',
        'server:file.delete': 'Borro ficheros',
        'server:file.upload': 'Subio ficheros',
        'server:file.rename': 'Renombro ficheros',
        'server:file.copy': 'Copio un fichero',
        'server:file.compress': 'Comprimio ficheros',
        'server:file.decompress': 'Descomprimio un fichero',
        'server:backup.start': 'Creo un backup',
        'server:backup.delete': 'Borro un backup',
        'server:backup.restore': 'Restauro un backup',
        'server:user.create': 'Anadio un subusuario',
        'server:user.update': 'Cambio permisos de un subusuario',
        'server:user.delete': 'Elimino un subusuario',
        'server:schedule.create': 'Creo una tarea programada',
        'server:schedule.delete': 'Borro una tarea programada',
        'server:settings.rename': 'Renombro el servidor',
        'server:settings.reinstall': 'Reinstalo el servidor',
        'server:startup.edit': 'Cambio variables de arranque'
    };

    /* Acciones que conviene que salten a la vista en un registro de staff. */
    var RISKY = /(delete|reinstall|restore|kill|user\.|startup)/;

    function renderAudit(page) {
        busy('Leyendo registro de actividad...');
        var path = '/servers/' + encodeURIComponent(state.serverId) +
            '/activity?per_page=50&page=' + (page || 1) + '&sort=-timestamp';

        api().request('GET', path).then(function (data) {
            var rows = (data && data.data ? data.data : []).map(function (item) {
                var attr = item.attributes || {};
                var actor = 'sistema';
                if (attr.relationships && attr.relationships.actor &&
                    attr.relationships.actor.attributes) {
                    actor = attr.relationships.actor.attributes.username ||
                        attr.relationships.actor.attributes.email || 'sistema';
                }
                return { attr: attr, actor: actor };
            });

            var meta = data && data.meta && data.meta.pagination ? data.meta.pagination : null;
            var current = meta ? meta.current_page : 1;
            var total = meta ? meta.total_pages : 1;

            var html = '<div class="wops-section"><h3>Quien hizo que</h3>' +
                '<p class="wops-msg">Registro del propio panel. Las acciones destructivas van marcadas.</p>';

            if (!rows.length) {
                html += '<p class="wops-msg">Sin actividad registrada.</p></div>';
                body(html);
                return;
            }

            html += '<table class="wops-table"><thead><tr>' +
                '<th>Cuando</th><th>Quien</th><th>Que</th><th>Detalle</th><th>IP</th>' +
                '</tr></thead><tbody>';

            rows.forEach(function (row) {
                var a = row.attr;
                var label = EVENT_LABELS[a.event] || a.event;
                var detail = '';
                var props = a.properties || {};
                if (props.command) detail = props.command;
                else if (props.files) {
                    detail = (props.directory || '') + ' ' +
                        (Array.isArray(props.files) ? props.files.join(', ') : props.files);
                } else if (props.file) detail = props.file;
                else if (props.name) detail = props.name;

                html += '<tr class="' + (RISKY.test(a.event) ? 'wops-risky' : '') + '">' +
                    '<td>' + esc(fmtDate(a.timestamp)) + '</td>' +
                    '<td><strong>' + esc(row.actor) + '</strong></td>' +
                    '<td>' + esc(label) + (a.is_api ? ' <span class="wops-tag">API</span>' : '') + '</td>' +
                    '<td class="wops-detail">' + esc(String(detail).slice(0, 160)) + '</td>' +
                    '<td><code>' + esc(a.ip || '-') + '</code></td>' +
                    '</tr>';
            });
            html += '</tbody></table>';

            if (total > 1) {
                html += '<div class="wops-pager">' +
                    '<button type="button" class="wops-btn" data-audit-page="' + (current - 1) + '"' +
                    (current <= 1 ? ' disabled' : '') + '>Anterior</button>' +
                    '<span>Pagina ' + current + ' de ' + total + '</span>' +
                    '<button type="button" class="wops-btn" data-audit-page="' + (current + 1) + '"' +
                    (current >= total ? ' disabled' : '') + '>Siguiente</button>' +
                    '</div>';
            }
            html += '</div>';
            body(html);
        }, function (err) {
            if (err.status === 404) {
                body('<p class="wops-msg wops-err">Este panel no expone /activity. ' +
                    'El registro por servidor existe desde Pterodactyl 1.11.</p>');
                return;
            }
            fail(err);
        });
    }

    /* =====================================================================
       5. ALERTAS A DISCORD
       ===================================================================== */

    function defaultAlerts() {
        return {
            webhook: '',
            onOffline: true,
            onMemory: true,
            memoryPct: 90,
            onDisk: false,
            diskPct: 90,
            servers: {}
        };
    }

    function loadAlerts() {
        try {
            var raw = window.localStorage.getItem(ALERT_KEY);
            var parsed = raw ? JSON.parse(raw) : null;
            if (!parsed || typeof parsed !== 'object') return defaultAlerts();
            var base = defaultAlerts();
            Object.keys(base).forEach(function (k) {
                if (parsed[k] !== undefined) base[k] = parsed[k];
            });
            return base;
        } catch (e) {
            return defaultAlerts();
        }
    }

    function saveAlerts() {
        try {
            window.localStorage.setItem(ALERT_KEY, JSON.stringify(state.alerts));
        } catch (e) {
            toast('No se pudo guardar la configuracion de alertas.', 'err');
        }
    }

    /* Los webhooks de Discord no mandan CORS, asi que la respuesta no se puede
       leer desde el navegador: se envia en modo no-cors y se asume entregado.
       Es la unica forma sin backend propio. */
    function sendWebhook(content) {
        if (!state.alerts || !state.alerts.webhook) return Promise.resolve(false);
        return fetch(state.alerts.webhook, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'Waise Panel',
                content: content
            })
        }).then(function () { return true; }, function () { return false; });
    }

    /* Una alerta del mismo tipo como mucho cada 10 minutos. */
    function throttled(key) {
        var now = Date.now();
        if (state.lastAlertAt[key] && now - state.lastAlertAt[key] < 600000) return true;
        state.lastAlertAt[key] = now;
        return false;
    }

    function pollOnce() {
        if (!state.alerts || !state.alerts.webhook || !state.serverId || !api()) return;
        var id = state.serverId;
        if (state.alerts.servers[id] === false) return;

        api().resources(id).then(function (res) {
            if (!res) return;
            var used = res.resources || {};

            if (state.alerts.onOffline && res.current_state === 'offline') {
                if (!throttled(id + ':offline')) {
                    sendWebhook(':red_circle: **' + id + '** esta apagado (estado: offline).');
                }
            }
            if (res.current_state === 'running') {
                state.lastAlertAt[id + ':offline'] = 0;
            }

            if (state.alerts.onMemory && used.memory_bytes) {
                api().server(id).then(function (info) {
                    var limitMb = info && info.limits ? info.limits.memory : 0;
                    if (!limitMb) return;
                    var pct = (used.memory_bytes / (limitMb * 1024 * 1024)) * 100;
                    if (pct >= state.alerts.memoryPct && !throttled(id + ':mem')) {
                        sendWebhook(':warning: **' + id + '** usa el ' + pct.toFixed(0) +
                            '% de la RAM (' + (used.memory_bytes / 1048576).toFixed(0) +
                            ' MB de ' + limitMb + ' MB).');
                    }
                }, function () { });
            }

            if (state.alerts.onDisk && used.disk_bytes) {
                api().server(id).then(function (info) {
                    var limitMb = info && info.limits ? info.limits.disk : 0;
                    if (!limitMb) return;
                    var pct = (used.disk_bytes / (limitMb * 1024 * 1024)) * 100;
                    if (pct >= state.alerts.diskPct && !throttled(id + ':disk')) {
                        sendWebhook(':floppy_disk: **' + id + '** usa el ' + pct.toFixed(0) +
                            '% del disco.');
                    }
                }, function () { });
            }
        }, function () { });
    }

    function startPolling() {
        if (state.pollTimer) return;
        state.pollTimer = window.setInterval(pollOnce, POLL_MS);
    }

    function renderAlerts() {
        var a = state.alerts;
        var on = state.alerts.servers[state.serverId] !== false;
        body(
            '<div class="wops-section"><h3>Avisos a Discord</h3>' +
            '<p class="wops-msg wops-warn">Importante: la vigilancia corre en tu navegador, ' +
            'asi que solo funciona mientras tengas el panel abierto en alguna pestana. ' +
            'Para vigilancia 24/7 hace falta un servicio en el VPS.</p>' +
            '<label class="wops-field"><span>URL del webhook de Discord</span>' +
            '<input type="url" class="wops-input wops-al-hook" placeholder="https://discord.com/api/webhooks/..." ' +
            'value="' + esc(a.webhook) + '"></label>' +
            '<label class="wops-check"><input type="checkbox" class="wops-al-here"' +
            (on ? ' checked' : '') + '> Vigilar este servidor (' + esc(state.serverId) + ')</label>' +
            '<label class="wops-check"><input type="checkbox" class="wops-al-off"' +
            (a.onOffline ? ' checked' : '') + '> Avisar si el servidor se cae</label>' +
            '<label class="wops-check"><input type="checkbox" class="wops-al-mem"' +
            (a.onMemory ? ' checked' : '') + '> Avisar si la RAM supera el ' +
            '<input type="number" class="wops-num wops-al-mempct" min="50" max="100" value="' +
            esc(a.memoryPct) + '">%</label>' +
            '<label class="wops-check"><input type="checkbox" class="wops-al-disk"' +
            (a.onDisk ? ' checked' : '') + '> Avisar si el disco supera el ' +
            '<input type="number" class="wops-num wops-al-diskpct" min="50" max="100" value="' +
            esc(a.diskPct) + '">%</label>' +
            '<div class="wops-inline">' +
            '<button type="button" class="wops-btn wops-primary wops-al-save">Guardar</button>' +
            '<button type="button" class="wops-btn wops-al-test">Enviar prueba</button>' +
            '</div>' +
            '<p class="wops-msg">Se comprueba cada ' + (POLL_MS / 1000) +
            ' segundos y no se repite el mismo aviso antes de 10 minutos.</p>' +
            '</div>'
        );
    }

    function onAlertsClick(ev) {
        var save = ev.target.closest('.wops-al-save');
        var test = ev.target.closest('.wops-al-test');
        if (!save && !test) return;

        var root = el.body;
        state.alerts.webhook = root.querySelector('.wops-al-hook').value.trim();
        state.alerts.onOffline = root.querySelector('.wops-al-off').checked;
        state.alerts.onMemory = root.querySelector('.wops-al-mem').checked;
        state.alerts.onDisk = root.querySelector('.wops-al-disk').checked;
        state.alerts.memoryPct = Math.min(100, Math.max(50,
            parseInt(root.querySelector('.wops-al-mempct').value, 10) || 90));
        state.alerts.diskPct = Math.min(100, Math.max(50,
            parseInt(root.querySelector('.wops-al-diskpct').value, 10) || 90));
        state.alerts.servers[state.serverId] = root.querySelector('.wops-al-here').checked;
        saveAlerts();

        if (test) {
            if (!state.alerts.webhook) {
                toast('Primero pon la URL del webhook.', 'err');
                return;
            }
            sendWebhook(':white_check_mark: Prueba desde el panel Waise (' + state.serverId + ').')
                .then(function () {
                    toast('Mensaje enviado. Mira el canal de Discord.', 'ok');
                });
            return;
        }
        toast('Alertas guardadas.', 'ok');
        startPolling();
    }

    /* =====================================================================
       6. SUBUSUARIOS CON ROLES
       ===================================================================== */

    var ROLES = [
        {
            id: 'builder',
            name: 'Builder',
            desc: 'Entra por SFTP y toca ficheros del mundo, sin apagar nada.',
            perms: [
                'websocket.connect', 'control.console',
                'file.create', 'file.read', 'file.read-content', 'file.update',
                'file.archive', 'file.sftp'
            ]
        },
        {
            id: 'moderator',
            name: 'Moderador',
            desc: 'Consola y comandos para moderar, sin acceso a ficheros.',
            perms: [
                'websocket.connect', 'control.console',
                'control.start', 'control.restart'
            ]
        },
        {
            id: 'developer',
            name: 'Dev',
            desc: 'Todo lo tecnico: ficheros, arranque, bases de datos y backups.',
            perms: [
                'websocket.connect', 'control.console', 'control.start',
                'control.stop', 'control.restart',
                'file.create', 'file.read', 'file.read-content', 'file.update',
                'file.delete', 'file.archive', 'file.sftp',
                'backup.create', 'backup.read', 'backup.download', 'backup.restore',
                'database.create', 'database.read', 'database.update', 'database.view_password',
                'startup.read', 'startup.update',
                'schedule.create', 'schedule.read', 'schedule.update', 'schedule.delete',
                'activity.read'
            ]
        },
        {
            id: 'admin',
            name: 'Administrador',
            desc: 'Casi todo, incluido gestionar otros subusuarios. Sin reinstalar.',
            perms: [
                'websocket.connect', 'control.console', 'control.start',
                'control.stop', 'control.restart',
                'file.create', 'file.read', 'file.read-content', 'file.update',
                'file.delete', 'file.archive', 'file.sftp',
                'backup.create', 'backup.read', 'backup.delete', 'backup.download', 'backup.restore',
                'database.create', 'database.read', 'database.update', 'database.delete', 'database.view_password',
                'allocation.read', 'allocation.update',
                'startup.read', 'startup.update',
                'schedule.create', 'schedule.read', 'schedule.update', 'schedule.delete',
                'user.create', 'user.read', 'user.update', 'user.delete',
                'settings.rename', 'activity.read'
            ]
        },
        {
            id: 'viewer',
            name: 'Solo lectura',
            desc: 'Ve la consola y los ficheros, no puede cambiar nada.',
            perms: [
                'websocket.connect', 'file.read', 'file.read-content',
                'backup.read', 'schedule.read', 'startup.read', 'activity.read'
            ]
        }
    ];

    function roleFor(perms) {
        var set = {};
        (perms || []).forEach(function (p) { set[p] = true; });
        for (var i = 0; i < ROLES.length; i++) {
            var role = ROLES[i];
            var same = role.perms.length === (perms || []).length;
            if (!same) continue;
            var all = true;
            for (var j = 0; j < role.perms.length; j++) {
                if (!set[role.perms[j]]) { all = false; break; }
            }
            if (all) return role.name;
        }
        return 'Personalizado (' + (perms || []).length + ' permisos)';
    }

    function renderRoles() {
        busy('Leyendo subusuarios...');
        api().request('GET', '/servers/' + encodeURIComponent(state.serverId) + '/users')
            .then(function (data) {
                var users = (data && data.data ? data.data : []).map(function (u) {
                    return u.attributes;
                });

                var html = '<div class="wops-section"><h3>Invitar con un rol</h3>' +
                    '<div class="wops-inline">' +
                    '<input type="email" class="wops-input wops-usr-mail" placeholder="correo@ejemplo.com">' +
                    '<select class="wops-input wops-usr-role">';
                ROLES.forEach(function (r) {
                    html += '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
                });
                html += '</select>' +
                    '<button type="button" class="wops-btn wops-primary wops-usr-add">Invitar</button>' +
                    '</div><ul class="wops-bullets">';
                ROLES.forEach(function (r) {
                    html += '<li><strong>' + esc(r.name) + '</strong> - ' + esc(r.desc) +
                        ' <span class="wops-dim">(' + r.perms.length + ' permisos)</span></li>';
                });
                html += '</ul></div>';

                html += '<div class="wops-section"><h3>Subusuarios (' + users.length + ')</h3>';
                if (!users.length) {
                    html += '<p class="wops-msg">Este servidor no tiene subusuarios.</p>';
                } else {
                    html += '<table class="wops-table"><thead><tr>' +
                        '<th>Usuario</th><th>Rol actual</th><th>Cambiar a</th><th></th>' +
                        '</tr></thead><tbody>';
                    users.forEach(function (u) {
                        html += '<tr>' +
                            '<td><strong>' + esc(u.username || u.email) + '</strong>' +
                            '<br><span class="wops-dim">' + esc(u.email) + '</span></td>' +
                            '<td>' + esc(roleFor(u.permissions)) + '</td>' +
                            '<td><select class="wops-input wops-usr-set" data-uuid="' + esc(u.uuid) + '">' +
                            '<option value="">-</option>';
                        ROLES.forEach(function (r) {
                            html += '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
                        });
                        html += '</select></td>' +
                            '<td><button type="button" class="wops-btn wops-danger" data-usr-del="' +
                            esc(u.uuid) + '">Quitar</button></td></tr>';
                    });
                    html += '</tbody></table>';
                }
                html += '</div>';
                body(html);
            }, function (err) {
                if (err.status === 403) {
                    body('<p class="wops-msg wops-err">No tienes permiso para gestionar subusuarios en este servidor.</p>');
                    return;
                }
                fail(err);
            });
    }

    function roleById(id) {
        for (var i = 0; i < ROLES.length; i++) {
            if (ROLES[i].id === id) return ROLES[i];
        }
        return null;
    }

    function onRolesClick(ev) {
        var add = ev.target.closest('.wops-usr-add');
        if (add) {
            var mail = el.body.querySelector('.wops-usr-mail').value.trim();
            var role = roleById(el.body.querySelector('.wops-usr-role').value);
            if (!mail || mail.indexOf('@') === -1) {
                toast('Escribe un correo valido.', 'err');
                return;
            }
            if (!role) return;
            add.disabled = true;
            add.textContent = 'Invitando...';
            api().request('POST', '/servers/' + encodeURIComponent(state.serverId) + '/users', {
                json: { email: mail, permissions: role.perms }
            }).then(function () {
                toast('Invitacion enviada a ' + mail + ' como ' + role.name + '.', 'ok');
                renderRoles();
            }, function (err) {
                add.disabled = false;
                add.textContent = 'Invitar';
                toast(err.message, 'err');
            });
            return;
        }

        var del = ev.target.closest('[data-usr-del]');
        if (del) {
            if (!window.confirm('Quitar a este subusuario del servidor?')) return;
            del.disabled = true;
            api().request('DELETE', '/servers/' + encodeURIComponent(state.serverId) +
                '/users/' + encodeURIComponent(del.getAttribute('data-usr-del')))
                .then(function () {
                    toast('Subusuario eliminado.', 'ok');
                    renderRoles();
                }, function (err) {
                    del.disabled = false;
                    toast(err.message, 'err');
                });
        }
    }

    function onRolesChange(ev) {
        var sel = ev.target.closest ? ev.target.closest('.wops-usr-set') : null;
        if (!sel || !sel.value) return;
        var role = roleById(sel.value);
        if (!role) return;
        if (!window.confirm('Aplicar el rol "' + role.name + '" a este subusuario? ' +
            'Sus permisos actuales se reemplazan.')) {
            sel.value = '';
            return;
        }
        sel.disabled = true;
        api().request('POST', '/servers/' + encodeURIComponent(state.serverId) +
            '/users/' + encodeURIComponent(sel.getAttribute('data-uuid')), {
            json: { permissions: role.perms }
        }).then(function () {
            toast('Rol actualizado a ' + role.name + '.', 'ok');
            renderRoles();
        }, function (err) {
            sel.disabled = false;
            sel.value = '';
            toast(err.message, 'err');
        });
    }

    /* =====================================================================
       PANEL
       ===================================================================== */

    var TABS = [
        { id: 'sched', label: 'Programador', render: renderScheduler },
        { id: 'crash', label: 'Crashes', render: renderCrashes },
        { id: 'tpl', label: 'Plantillas', render: renderTemplates },
        { id: 'audit', label: 'Actividad', render: function () { renderAudit(1); } },
        { id: 'alerts', label: 'Alertas', render: renderAlerts },
        { id: 'roles', label: 'Subusuarios', render: renderRoles }
    ];

    function selectTab(id) {
        state.tab = id;
        var buttons = el.overlay.querySelectorAll('.wops-tab');
        for (var i = 0; i < buttons.length; i++) {
            var on = buttons[i].getAttribute('data-tab') === id;
            buttons[i].className = 'wops-tab' + (on ? ' is-on' : '');
            buttons[i].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        for (var j = 0; j < TABS.length; j++) {
            if (TABS[j].id === id) {
                TABS[j].render();
                return;
            }
        }
    }

    function buildPanel() {
        var overlay = document.createElement('div');
        overlay.className = 'wops-overlay';
        overlay.hidden = true;

        var tabsHtml = '';
        TABS.forEach(function (t) {
            tabsHtml += '<button type="button" class="wops-tab' +
                (t.id === state.tab ? ' is-on' : '') + '" role="tab" data-tab="' +
                t.id + '" aria-selected="' + (t.id === state.tab) + '">' +
                esc(t.label) + '</button>';
        });

        overlay.innerHTML =
            '<div class="wops-panel" role="dialog" aria-modal="true" aria-label="Centro de operaciones">' +
                '<header class="wops-head">' +
                    '<h2 class="wops-title">Centro de operaciones</h2>' +
                    '<span class="wops-server"></span>' +
                    '<button type="button" class="wops-close" aria-label="Cerrar">&times;</button>' +
                '</header>' +
                '<nav class="wops-tabs" role="tablist">' + tabsHtml + '</nav>' +
                '<div class="wops-body" role="tabpanel"></div>' +
            '</div>';
        document.body.appendChild(overlay);

        el.overlay = overlay;
        el.body = overlay.querySelector('.wops-body');
        el.server = overlay.querySelector('.wops-server');

        overlay.querySelector('.wops-close').addEventListener('click', closePanel);
        overlay.addEventListener('mousedown', function (ev) {
            if (ev.target === overlay) closePanel();
        });

        overlay.querySelector('.wops-tabs').addEventListener('click', function (ev) {
            var tab = ev.target.closest('.wops-tab');
            if (tab) selectTab(tab.getAttribute('data-tab'));
        });

        /* Un solo delegado por pestana: los paneles se repintan enteros. */
        el.body.addEventListener('click', function (ev) {
            if (state.tab === 'sched') return onSchedulerClick(ev);
            if (state.tab === 'tpl') return onTemplatesClick(ev);
            if (state.tab === 'alerts') return onAlertsClick(ev);
            if (state.tab === 'roles') return onRolesClick(ev);
            if (state.tab === 'crash') {
                var row = ev.target.closest('[data-crash]');
                if (row) showCrash(row.getAttribute('data-crash'));
                return;
            }
            if (state.tab === 'audit') {
                var pager = ev.target.closest('[data-audit-page]');
                if (pager && !pager.disabled) {
                    renderAudit(parseInt(pager.getAttribute('data-audit-page'), 10));
                }
            }
        });

        el.body.addEventListener('change', function (ev) {
            if (state.tab === 'roles') onRolesChange(ev);
        });

        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && state.open) closePanel();
        });

        return overlay;
    }

    function openPanel(tab) {
        if (!state.serverId || !api()) return;
        if (!el.overlay) buildPanel();
        el.overlay.hidden = false;
        state.open = true;
        document.body.classList.add('wops-lock');
        if (el.server) el.server.textContent = state.serverId;
        selectTab(tab || state.tab);
    }

    function closePanel() {
        if (!el.overlay) return;
        el.overlay.hidden = true;
        state.open = false;
        document.body.classList.remove('wops-lock');
    }

    function buildLauncher() {
        if (document.querySelector('.wops-fab')) return;
        var fab = document.createElement('button');
        fab.type = 'button';
        fab.className = 'wops-fab';
        fab.title = 'Centro de operaciones';
        fab.setAttribute('aria-label', 'Abrir centro de operaciones');
        fab.innerHTML = '<span aria-hidden="true">&#9881;</span>';
        fab.addEventListener('click', function () { openPanel(); });
        document.body.appendChild(fab);
    }

    /* --- Arranque --------------------------------------------------------- */

    function sync() {
        var id = serverIdFromUrl();
        if (!id || !api()) {
            var fab = document.querySelector('.wops-fab');
            if (fab) fab.parentNode.removeChild(fab);
            if (state.open) closePanel();
            state.serverId = null;
            return;
        }
        if (id !== state.serverId) {
            state.serverId = id;
            if (state.open) selectTab(state.tab);
            if (el.server) el.server.textContent = id;
        }
        buildLauncher();
    }

    function start() {
        state.alerts = loadAlerts();
        sync();
        window.setInterval(sync, 1500);
        window.addEventListener('popstate', sync);
        if (state.alerts.webhook) startPolling();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.WaiseOps = {
        open: openPanel,
        close: closePanel,
        parseCrash: parseCrash,
        roles: ROLES,
        presets: PRESETS,
        state: state
    };
})();