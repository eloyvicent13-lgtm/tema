/* ---------------------------------------------------------------------------
   Waise Theme - assets/js/waise-api.js

   Cliente de la API de cliente de Pterodactyl (/api/client) para los modulos
   del tema: papelera, mods, jugadores, scheduler, etc.

   No usa API keys: reutiliza la sesion del usuario que ya tiene el navegador
   (cookie same-origin) mas el token XSRF que Laravel deja en la cookie
   XSRF-TOKEN. Consecuencia importante: cada usuario ve exactamente los
   servidores y permisos que le corresponden, igual que el panel oficial.
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    var BASE = '/api/client';

    /* Pterodactyl responde 429 con bastante alegria al listar directorios en
       bucle. Serializamos las peticiones y reintentamos respetando Retry-After
       en vez de dejar que el panel corte la sesion de golpe. */
    var MAX_RETRIES = 3;
    var MIN_GAP_MS = 60;

    var chain = Promise.resolve();
    var lastSent = 0;

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

    function csrfToken() {
        /* Laravel: cookie XSRF-TOKEN (url-encoded). Fallback al <meta> que
           algunas versiones del panel incluyen en la vista Blade. */
        var fromCookie = readCookie('XSRF-TOKEN');
        if (fromCookie) return fromCookie;
        var meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.getAttribute('content') : null;
    }

    function ApiError(message, status, body) {
        var err = new Error(message);
        err.name = 'WaiseApiError';
        err.status = status;
        err.body = body;
        return err;
    }

    function describe(status, data) {
        /* El panel devuelve { errors: [ { code, detail } ] }. */
        if (data && data.errors && data.errors.length) {
            var first = data.errors[0];
            if (first.detail) return first.detail;
            if (first.code) return first.code;
        }
        if (status === 401 || status === 419) return 'Tu sesion ha caducado. Recarga la pagina.';
        if (status === 403) return 'No tienes permiso para esta accion en este servidor.';
        if (status === 404) return 'El recurso no existe.';
        if (status === 429) return 'Demasiadas peticiones al panel. Prueba en unos segundos.';
        return 'Error HTTP ' + status;
    }

    function delay(ms) {
        return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
    }

    function send(method, path, options, attempt) {
        var opts = options || {};
        var headers = {
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            /* Marca para que waise-trash.js no intercepte nuestras propias
               llamadas y se meta en una recursion infinita. */
            'X-Waise-Client': '1'
        };
        var token = csrfToken();
        if (token) headers['X-XSRF-TOKEN'] = token;

        var body;
        if (opts.raw !== undefined) {
            headers['Content-Type'] = 'text/plain';
            body = opts.raw;
        } else if (opts.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(opts.json);
        }

        return fetch(BASE + path, {
            method: method,
            headers: headers,
            body: body,
            credentials: 'same-origin'
        }).then(function (res) {
            if (res.status === 429 && attempt < MAX_RETRIES) {
                var after = parseInt(res.headers.get('Retry-After') || '', 10);
                var wait = isNaN(after) ? Math.pow(2, attempt) * 500 : after * 1000;
                return delay(wait).then(function () {
                    return send(method, path, options, attempt + 1);
                });
            }

            if (opts.text) {
                return res.text().then(function (raw) {
                    if (!res.ok) throw ApiError(describe(res.status, null), res.status, raw);
                    return raw;
                });
            }

            if (res.status === 204) {
                if (!res.ok) throw ApiError(describe(res.status, null), res.status, null);
                return null;
            }

            return res.text().then(function (raw) {
                var data = null;
                if (raw) {
                    try {
                        data = JSON.parse(raw);
                    } catch (e) {
                        /* Una redireccion al login devuelve HTML, no JSON: el
                           mensaje util aqui es "vuelve a iniciar sesion". */
                        if (!res.ok) throw ApiError(describe(res.status, null), res.status, raw);
                        throw ApiError('El panel no devolvio JSON (HTTP ' + res.status + ').', res.status, raw);
                    }
                }
                if (!res.ok) throw ApiError(describe(res.status, data), res.status, data);
                return data;
            });
        });
    }

    /* Cola: una peticion a la vez, con una separacion minima entre ellas. */
    function request(method, path, options) {
        var result = chain.then(function () {
            var gap = Math.max(0, MIN_GAP_MS - (Date.now() - lastSent));
            return delay(gap).then(function () {
                lastSent = Date.now();
                return send(method, path, options, 0);
            });
        });
        /* La cadena no debe romperse porque una peticion falle. */
        chain = result.then(function () { }, function () { });
        return result;
    }

    function enc(value) {
        return encodeURIComponent(value);
    }

    /* --- Servidores ------------------------------------------------------- */

    function listServers() {
        return request('GET', '/?per_page=100').then(function (data) {
            return (data && data.data ? data.data : []).map(function (item) {
                return item.attributes;
            });
        });
    }

    function server(id) {
        return request('GET', '/servers/' + enc(id)).then(function (data) {
            return data ? data.attributes : null;
        });
    }

    function resources(id) {
        return request('GET', '/servers/' + enc(id) + '/resources').then(function (data) {
            return data ? data.attributes : null;
        });
    }

    function power(id, signal) {
        return request('POST', '/servers/' + enc(id) + '/power', { json: { signal: signal } });
    }

    function command(id, cmd) {
        return request('POST', '/servers/' + enc(id) + '/command', { json: { command: cmd } });
    }

    /* --- Archivos --------------------------------------------------------- */

    function listFiles(id, dir) {
        var path = '/servers/' + enc(id) + '/files/list?directory=' + enc(dir || '/');
        return request('GET', path).then(function (data) {
            return (data && data.data ? data.data : []).map(function (item) {
                return item.attributes;
            });
        });
    }

    function readFile(id, file) {
        var path = '/servers/' + enc(id) + '/files/contents?file=' + enc(file);
        return request('GET', path, { text: true });
    }

    function writeFile(id, file, contents) {
        var path = '/servers/' + enc(id) + '/files/write?file=' + enc(file);
        return request('POST', path, { raw: contents });
    }

    /* root es el directorio comun; files es [{ from, to }] con nombres
       relativos a ese root. Mover entre carpetas distintas se hace poniendo
       root='/' y rutas completas en from/to. */
    function renameFiles(id, root, files) {
        return request('PUT', '/servers/' + enc(id) + '/files/rename', {
            json: { root: root, files: files }
        });
    }

    function copyFile(id, location) {
        return request('POST', '/servers/' + enc(id) + '/files/copy', {
            json: { location: location }
        });
    }

    function deleteFiles(id, root, files) {
        return request('POST', '/servers/' + enc(id) + '/files/delete', {
            json: { root: root, files: files }
        });
    }

    function createFolder(id, root, name) {
        return request('POST', '/servers/' + enc(id) + '/files/create-folder', {
            json: { root: root, name: name }
        });
    }

    function compress(id, root, files) {
        return request('POST', '/servers/' + enc(id) + '/files/compress', {
            json: { root: root, files: files }
        }).then(function (data) {
            return data ? data.attributes : null;
        });
    }

    function decompress(id, root, file) {
        return request('POST', '/servers/' + enc(id) + '/files/decompress', {
            json: { root: root, file: file }
        });
    }

    function chmodFiles(id, root, files) {
        return request('POST', '/servers/' + enc(id) + '/files/chmod', {
            json: { root: root, files: files }
        });
    }

    /* Descarga en el servidor desde una URL externa: la usa el instalador de
       mods para no pasar el .jar por el navegador del usuario. */
    function pullFile(id, url, options) {
        var opts = options || {};
        var payload = { url: url };
        if (opts.directory) payload.directory = opts.directory;
        if (opts.filename) payload.filename = opts.filename;
        if (opts.useHeader !== undefined) payload.use_header = opts.useHeader;
        if (opts.foreground !== undefined) payload.foreground = opts.foreground;
        return request('POST', '/servers/' + enc(id) + '/files/pull', { json: payload });
    }

    function downloadUrl(id, file) {
        var path = '/servers/' + enc(id) + '/files/download?file=' + enc(file);
        return request('GET', path).then(function (data) {
            return data && data.attributes ? data.attributes.url : null;
        });
    }

    function uploadUrl(id) {
        return request('GET', '/servers/' + enc(id) + '/files/upload').then(function (data) {
            return data && data.attributes ? data.attributes.url : null;
        });
    }

    /* --- Utilidades de rutas --------------------------------------------- */

    function joinPath() {
        var out = [];
        for (var i = 0; i < arguments.length; i++) {
            var part = String(arguments[i] === undefined ? '' : arguments[i]);
            part.split('/').forEach(function (seg) {
                if (seg && seg !== '.') out.push(seg);
            });
        }
        return '/' + out.join('/');
    }

    function dirName(path) {
        var clean = joinPath(path);
        var idx = clean.lastIndexOf('/');
        return idx <= 0 ? '/' : clean.slice(0, idx);
    }

    function baseName(path) {
        var clean = joinPath(path);
        return clean.slice(clean.lastIndexOf('/') + 1);
    }

    function exists(id, path) {
        return listFiles(id, dirName(path)).then(function (entries) {
            var target = baseName(path);
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].name === target) return entries[i];
            }
            return null;
        }, function () {
            return null;
        });
    }

    /* Crea la carpeta solo si falta: create-folder es idempotente en el panel,
       pero evitamos una escritura por cada operacion de papelera. */
    function ensureFolder(id, path) {
        return exists(id, path).then(function (found) {
            if (found && found.is_file === false) return true;
            return createFolder(id, dirName(path), baseName(path)).then(function () {
                return true;
            });
        });
    }

    /* --- Autodiagnostico -------------------------------------------------- */

    /* Comprueba que la sesion y el CSRF sirven para hablar con /api/client
       ANTES de que un modulo mueva o borre archivos del usuario. */
    function selftest() {
        var report = {
            csrf: !!csrfToken(),
            servers: null,
            server: null,
            files: null,
            errors: []
        };

        return listServers().then(function (list) {
            report.servers = list.length;
            var id = null;
            var m = window.location.pathname.match(/^\/server\/([^/]+)/);
            if (m) id = m[1];
            else if (list.length) id = list[0].identifier;

            if (!id) {
                report.errors.push('No hay ningun servidor accesible con esta cuenta.');
                return report;
            }
            report.server = id;

            return listFiles(id, '/').then(function (entries) {
                report.files = entries.length;
                return report;
            }, function (err) {
                report.errors.push('listFiles: ' + err.message);
                return report;
            });
        }, function (err) {
            report.errors.push('listServers: ' + err.message);
            return report;
        }).then(function (final) {
            final.ok = final.errors.length === 0 && final.files !== null;
            /* Visible en la consola del navegador sin desplegar objetos. */
            if (window.console) {
                window.console.log(
                    '[waise-api] ' + (final.ok ? 'OK' : 'FALLO') +
                    ' | csrf=' + final.csrf +
                    ' | servidores=' + final.servers +
                    ' | servidor=' + final.server +
                    ' | archivos raiz=' + final.files +
                    (final.errors.length ? ' | ' + final.errors.join(' ; ') : '')
                );
            }
            return final;
        });
    }

    window.WaiseApi = {
        request: request,
        listServers: listServers,
        server: server,
        resources: resources,
        power: power,
        command: command,
        listFiles: listFiles,
        readFile: readFile,
        writeFile: writeFile,
        renameFiles: renameFiles,
        copyFile: copyFile,
        deleteFiles: deleteFiles,
        createFolder: createFolder,
        compress: compress,
        decompress: decompress,
        chmodFiles: chmodFiles,
        pullFile: pullFile,
        downloadUrl: downloadUrl,
        uploadUrl: uploadUrl,
        joinPath: joinPath,
        dirName: dirName,
        baseName: baseName,
        exists: exists,
        ensureFolder: ensureFolder,
        selftest: selftest
    };
})();