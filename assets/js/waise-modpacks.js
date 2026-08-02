/* -------------------------------------------------------------------------
   Waise Theme - instalador de modpacks (.mrpack de Modrinth)
   Un .mrpack no es un jar que el servidor cargue: es un zip con un manifiesto
   (modrinth.index.json) que lista cada mod y su URL, mas una carpeta
   overrides/ con configs. Este modulo lo resuelve entero desde el panel,
   apoyandose solo en la API de ficheros de Pterodactyl via WaiseApi.
   ------------------------------------------------------------------------- */
(function () {
    'use strict';

    var TMP_DIR = '/.waise-modpack';
    var API_BASE = 'https://api.modrinth.com/v2';
    /* Pterodactyl serializa los pull en el wings; mas de 2 en vuelo solo
       genera 429. Con 3 reintentos y espera creciente aguanta packs grandes. */
    var PARALLEL = 2;
    var RETRIES = 3;
    var RETRY_WAIT = 1500;

    function api() { return window.WaiseApi; }

    function notify(msg, kind) {
        if (window.WaiseNotify) window.WaiseNotify(msg, kind);
        else if (kind === 'err') console.error(msg);
    }

    function wait(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    /* Reintenta cualquier promesa: los 429 del wings son transitorios y
       abortar un pack a medias deja la carpeta /mods inconsistente. */
    function retry(factory, attempts) {
        var left = typeof attempts === 'number' ? attempts : RETRIES;
        return factory().catch(function (err) {
            if (left <= 0) throw err;
            return wait(RETRY_WAIT * (RETRIES - left + 1)).then(function () {
                return retry(factory, left - 1);
            });
        });
    }

    /* Ejecuta tareas con concurrencia limitada, informando del avance. */
    function runPool(tasks, limit, onProgress) {
        var index = 0;
        var done = 0;
        var failed = [];

        function next() {
            if (index >= tasks.length) return Promise.resolve();
            var task = tasks[index++];
            return task().catch(function (err) {
                failed.push({ task: task, error: err });
            }).then(function () {
                done++;
                if (onProgress) onProgress(done, tasks.length);
                return next();
            });
        }

        var workers = [];
        for (var i = 0; i < limit && i < tasks.length; i++) workers.push(next());
        return Promise.all(workers).then(function () { return failed; });
    }

    /* --- Descarga verificada --------------------------------------------- */

    /* pullFile encola la descarga en el wings y responde antes de que el
       fichero exista, asi que se confirma listando el destino. */
    function pullAndVerify(serverId, url, directory, filename) {
        var client = api();
        return retry(function () {
            return client.pullFile(serverId, url, {
                directory: directory,
                filename: filename,
                foreground: true
            }).then(function () {
                return confirmExists(serverId, client.joinPath(directory, filename), 20);
            });
        });
    }

    function confirmExists(serverId, path, tries) {
        return api().exists(serverId, path).then(function (found) {
            if (found && found.is_file !== false) return true;
            if (tries <= 0) throw new Error('No aparecio ' + path + ' tras la descarga');
            return wait(1000).then(function () {
                return confirmExists(serverId, path, tries - 1);
            });
        });
    }

    /* --- Resolucion de la version del pack en Modrinth -------------------- */

    function pickVersion(projectId, loader, gameVersion) {
        var url = API_BASE + '/project/' + encodeURIComponent(projectId) + '/version';
        var query = [];
        if (loader) query.push('loaders=' + encodeURIComponent(JSON.stringify([loader])));
        if (gameVersion) query.push('game_versions=' + encodeURIComponent(JSON.stringify([gameVersion])));
        if (query.length) url += '?' + query.join('&');

        return fetch(url, { headers: { Accept: 'application/json' } }).then(function (res) {
            if (!res.ok) throw new Error('Modrinth respondio ' + res.status);
            return res.json();
        }).then(function (versions) {
            if (!Array.isArray(versions) || !versions.length) return null;
            for (var i = 0; i < versions.length; i++) {
                var file = primaryFile(versions[i]);
                if (file && /\.mrpack$/i.test(file.filename)) {
                    return { version: versions[i], file: file };
                }
            }
            return null;
        });
    }

    function primaryFile(version) {
        var files = version && version.files;
        if (!Array.isArray(files) || !files.length) return null;
        for (var i = 0; i < files.length; i++) {
            if (files[i].primary) return files[i];
        }
        return files[0];
    }

    /* --- Manifiesto ------------------------------------------------------- */

    /* Las rutas del indice son relativas a la raiz del servidor (mods/x.jar,
       config/y.toml) y pueden traer .. si el pack esta mal formado: se
       descartan en vez de escribir fuera del servidor. */
    function safeEntryPath(raw) {
        if (typeof raw !== 'string' || !raw) return null;
        var clean = raw.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!clean || clean.indexOf('../') !== -1 || clean === '..') return null;
        return '/' + clean;
    }

    function entryUrl(entry) {
        var urls = entry && entry.downloads;
        return Array.isArray(urls) && urls.length ? urls[0] : null;
    }

    /* env.server === 'unsupported' marca mods client-side: instalarlos
       revienta el arranque del servidor. */
    function isServerSide(entry) {
        var env = entry && entry.env;
        if (!env || typeof env !== 'object') return true;
        return env.server !== 'unsupported';
    }

    /* --- Instalacion ------------------------------------------------------ */

    function install(opts) {
        var client = api();
        var serverId = opts.serverId;
        var button = opts.button;
        var original = button ? button.textContent : '';

        function step(text) {
            if (button) button.textContent = text;
        }

        function finish(msg, kind) {
            if (button) {
                button.disabled = false;
                button.textContent = original;
            }
            if (msg) notify(msg, kind);
        }

        if (!client || typeof client.pullFile !== 'function' ||
            typeof client.decompress !== 'function') {
            notify('WaiseApi no expone pullFile/decompress; actualiza el tema.', 'err');
            return;
        }

        if (button) button.disabled = true;
        step('Buscando...');

        var packFile = null;

        retry(function () {
            return pickVersion(opts.projectId, opts.loader, opts.version);
        }).then(function (found) {
            if (!found) throw new Error('Sin version .mrpack para ' +
                (opts.loader || 'ese loader') + ' ' + (opts.version || ''));
            packFile = found.file;
            step('Preparando...');
            return client.ensureFolder(serverId, TMP_DIR);
        }).then(function () {
            step('Bajando pack...');
            return pullAndVerify(serverId, packFile.url, TMP_DIR, packFile.filename);
        }).then(function () {
            step('Extrayendo...');
            return retry(function () {
                return client.decompress(serverId, TMP_DIR, packFile.filename);
            });
        }).then(function () {
            return retry(function () {
                return client.readFile(serverId, TMP_DIR + '/modrinth.index.json');
            });
        }).then(function (text) {
            var index = JSON.parse(text);
            var entries = Array.isArray(index.files) ? index.files : [];
            return installEntries(serverId, entries, step);
        }).then(function (failed) {
            step('Copiando configs...');
            return applyOverrides(serverId).then(function () { return failed; });
        }).then(function (failed) {
            step('Limpiando...');
            return cleanup(serverId).then(function () { return failed; });
        }).then(function (failed) {
            if (failed && failed.length) {
                finish('Modpack instalado con ' + failed.length +
                    ' archivo(s) fallidos; revisa /mods', 'err');
            } else {
                finish('Modpack "' + opts.title + '" instalado', 'ok');
            }
        }).catch(function (err) {
            cleanup(serverId).catch(function () { /* la limpieza es best-effort */ });
            finish('No se pudo instalar el modpack: ' + (err && err.message ? err.message : err), 'err');
        });
    }

    function installEntries(serverId, entries, step) {
        var client = api();
        var tasks = [];

        entries.forEach(function (entry) {
            if (!isServerSide(entry)) return;
            var url = entryUrl(entry);
            var path = safeEntryPath(entry.path);
            if (!url || !path) return;
            tasks.push(function () {
                var dir = client.dirName(path);
                var name = client.baseName(path);
                return client.ensureFolder(serverId, dir).then(function () {
                    return pullAndVerify(serverId, url, dir, name);
                });
            });
        });

        if (!tasks.length) {
            step('Sin archivos');
            return Promise.resolve([]);
        }

        step('0/' + tasks.length);
        return runPool(tasks, PARALLEL, function (done, total) {
            step(done + '/' + total);
        });
    }

    /* overrides/ (y server-overrides/, que tiene prioridad) se vuelcan sobre la
       raiz del servidor. Se mueven con rename desde root '/' para no bajar y
       resubir cada config por el navegador. */
    function applyOverrides(serverId) {
        var client = api();
        return moveTree(serverId, TMP_DIR + '/overrides').then(function () {
            return moveTree(serverId, TMP_DIR + '/server-overrides');
        });
    }

    function moveTree(serverId, base) {
        var client = api();
        return client.exists(serverId, base).then(function (found) {
            if (!found || found.is_file !== false) return null;
            return client.listFiles(serverId, base).then(function (items) {
                var moves = [];
                (items || []).forEach(function (item) {
                    if (!item || !item.name) return;
                    moves.push({
                        from: base + '/' + item.name,
                        to: '/' + item.name
                    });
                });
                if (!moves.length) return null;
                /* Si el destino existe el rename falla; se borra antes para que
                   las configs del pack ganen a las que hubiera. */
                return client.deleteFiles(serverId, '/', moves.map(function (m) {
                    return m.to.replace(/^\//, '');
                })).catch(function () {
                    return null;
                }).then(function () {
                    return retry(function () {
                        return client.renameFiles(serverId, '/', moves);
                    });
                });
            });
        });
    }

    function cleanup(serverId) {
        return api().deleteFiles(serverId, '/', [TMP_DIR.replace(/^\//, '')]);
    }

    window.WaiseModpacks = { install: install };
})();