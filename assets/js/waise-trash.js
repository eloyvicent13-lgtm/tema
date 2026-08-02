/* ---------------------------------------------------------------------------
   Waise Theme - assets/js/waise-trash.js

   Papelera de reciclaje para el gestor de archivos.

   El borrado no se intercepta en el DOM (el marcado React del panel cambia
   entre versiones) sino en la capa de red: se envuelve fetch y se captura el
   POST a /api/client/servers/<id>/files/delete. Da igual si el usuario borra
   desde el boton, desde el menu contextual o desde una seleccion multiple.

   FAIL-CLOSED: solo se anuncia "movido a la papelera" si el rename dentro del
   servidor devuelve OK. Si falla por permisos, sesion caducada o rate limit,
   se deja pasar el borrado original del panel y se avisa del error. Nunca se
   promete una red de seguridad que no existe.
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    var TRASH_DIR = '/.waise-trash';
    var RETENTION_DAYS = 7;
    var DELETE_RE = /^\/api\/client\/servers\/([^/]+)\/files\/delete$/;

    function api() {
        return window.WaiseApi || null;
    }

    function enabled() {
        var cfg = window.WaiseConfig;
        if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'featTrash')) {
            return cfg.featTrash !== false;
        }
        return true;
    }

    function notify(message, kind) {
        if (window.Waise && typeof window.Waise.toast === 'function') {
            window.Waise.toast(message, kind);
        }
    }

    /* --- Nombres de la papelera ------------------------------------------ */

    /* '<epoch_ms>__<ruta original url-encoded>'. La ruta se codifica entera
       para poder restaurarla exacta, incluidos subdirectorios y espacios. */
    function encodeEntry(originalPath) {
        return Date.now() + '__' + encodeURIComponent(originalPath);
    }

    function decodeEntry(name) {
        var idx = name.indexOf('__');
        if (idx <= 0) return null;
        var stamp = parseInt(name.slice(0, idx), 10);
        if (isNaN(stamp)) return null;
        var original;
        try {
            original = decodeURIComponent(name.slice(idx + 2));
        } catch (e) {
            return null;
        }
        if (!original) return null;
        return { name: name, deletedAt: stamp, original: original };
    }

    function formatAge(stamp) {
        var mins = Math.floor((Date.now() - stamp) / 60000);
        if (mins < 1) return 'hace unos segundos';
        if (mins < 60) return 'hace ' + mins + ' min';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return 'hace ' + hours + ' h';
        var days = Math.floor(hours / 24);
        return 'hace ' + days + (days === 1 ? ' dia' : ' dias');
    }

    function formatSize(bytes) {
        if (typeof bytes !== 'number' || bytes < 0) return '';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = 0;
        var value = bytes;
        while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
        return (i === 0 ? value : value.toFixed(1)) + ' ' + units[i];
    }

    /* --- Movimiento a la papelera ---------------------------------------- */

    /* Devuelve una promesa que resuelve true solo si TODOS los archivos se
       movieron. Cualquier fallo parcial resuelve false y el llamante deja que
       el panel haga su borrado normal. */
    function moveToTrash(serverId, root, files) {
        var A = api();
        if (!A) return Promise.resolve(false);

        return A.ensureFolder(serverId, TRASH_DIR).then(function () {
            var pairs = files.map(function (name) {
                var from = A.joinPath(root, name);
                return { from: from, to: A.joinPath(TRASH_DIR, encodeEntry(from)) };
            });
            /* root '/' con rutas absolutas en from/to: asi se mueve entre
               directorios distintos con una sola llamada. */
            return A.renameFiles(serverId, '/', pairs).then(function () {
                return true;
            });
        }).then(null, function (err) {
            notify('No se pudo usar la papelera: ' + err.message, 'err');
            return false;
        });
    }

    /* --- Interceptor de red ---------------------------------------------- */

    function parseTarget(input) {
        var url = typeof input === 'string' ? input : (input && input.url);
        if (!url) return null;
        var path;
        try {
            path = new URL(url, window.location.origin).pathname;
        } catch (e) {
            return null;
        }
        var m = DELETE_RE.exec(path);
        return m ? m[1] : null;
    }

    function readBody(init) {
        if (!init || typeof init.body !== 'string') return null;
        try {
            return JSON.parse(init.body);
        } catch (e) {
            return null;
        }
    }

    function isOwnRequest(init) {
        var headers = init && init.headers;
        if (!headers) return false;
        if (typeof headers.get === 'function') return !!headers.get('X-Waise-Client');
        return !!(headers['X-Waise-Client'] || headers['x-waise-client']);
    }

    /* Decide si un POST a /files/delete debe desviarse a la papelera y, en su
       caso, lo hace. Resuelve true solo si TODO se movio. */
    function handleDelete(serverId, payload) {
        if (!payload || !payload.files || !payload.files.length) {
            return Promise.resolve(false);
        }
        /* Borrar desde dentro de la papelera debe borrar de verdad. */
        var root = payload.root || '/';
        if (api().joinPath(root).indexOf(TRASH_DIR) === 0) return Promise.resolve(false);

        return moveToTrash(serverId, root, payload.files).then(function (ok) {
            if (!ok) return false;
            var n = payload.files.length;
            notify(
                n === 1 ? 'Movido a la papelera' : n + ' elementos movidos a la papelera',
                'ok'
            );
            window.dispatchEvent(new CustomEvent('waise:trash-changed'));
            return true;
        });
    }

    function installInterceptor() {
        var original = window.fetch;
        if (typeof original !== 'function') return;

        window.fetch = function (input, init) {
            var args = arguments;
            var self = this;

            function passthrough() {
                return original.apply(self, args);
            }

            if (!enabled() || isOwnRequest(init)) return passthrough();
            if (!init || String(init.method || 'GET').toUpperCase() !== 'POST') return passthrough();

            var serverId = parseTarget(input);
            if (!serverId) return passthrough();

            var payload = readBody(init);
            if (!payload) return passthrough();

            return handleDelete(serverId, payload).then(function (ok) {
                if (!ok) return passthrough();
                /* El panel espera 204 del endpoint de borrado; devolverlo hace
                   que refresque la lista como si el borrado hubiera ocurrido. */
                return new Response(null, { status: 204, statusText: 'No Content' });
            });
        };
    }

    /* El gestor de archivos del panel usa axios, que en el navegador va sobre
       XMLHttpRequest: envolver solo fetch dejaria pasar todos los borrados.
       Aqui no se falsifica la respuesta (reimplementar readyState, eventos y
       responseText de XHR es fragil); se RETRASA el envio real hasta que el
       movimiento acabe. Si se movio, los archivos ya no estan en su ruta y el
       delete del panel queda en no-op; si fallo, el borrado original ocurre
       igual que sin el tema. */
    function installXhrInterceptor() {
        var XHR = window.XMLHttpRequest;
        if (typeof XHR !== 'function' || !XHR.prototype) return;

        var open = XHR.prototype.open;
        var send = XHR.prototype.send;
        var setHeader = XHR.prototype.setRequestHeader;

        XHR.prototype.open = function (method, url) {
            this.__waiseMethod = String(method || 'GET').toUpperCase();
            this.__waiseUrl = url;
            this.__waiseOwn = false;
            return open.apply(this, arguments);
        };

        XHR.prototype.setRequestHeader = function (name, value) {
            if (String(name).toLowerCase() === 'x-waise-client') this.__waiseOwn = true;
            return setHeader.apply(this, arguments);
        };

        XHR.prototype.send = function (body) {
            var self = this;
            var args = arguments;

            function passthrough() {
                return send.apply(self, args);
            }

            if (!enabled() || self.__waiseOwn) return passthrough();
            if (self.__waiseMethod !== 'POST') return passthrough();

            var serverId = parseTarget(self.__waiseUrl);
            if (!serverId) return passthrough();

            var payload = readBody({ body: body });
            if (!payload) return passthrough();

            handleDelete(serverId, payload).then(passthrough, passthrough);
            return undefined;
        };
    }

    /* --- Purga por antiguedad -------------------------------------------- */

    function purgeExpired(serverId, entries) {
        var limit = RETENTION_DAYS * 86400000;
        var old = entries.filter(function (e) { return Date.now() - e.deletedAt > limit; });
        if (!old.length) return Promise.resolve(0);
        return api().deleteFiles(serverId, TRASH_DIR, old.map(function (e) { return e.name; }))
            .then(function () { return old.length; }, function () { return 0; });
    }

    /* --- Interfaz --------------------------------------------------------- */

    var overlay = null;

    function closeTrash() {
        if (!overlay) return false;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        return true;
    }

    function loadEntries(serverId) {
        var A = api();
        /* Wings NO devuelve 404 al listar un directorio inexistente: revienta
           con un 500 generico ("error while communicating with the machine").
           Por eso se comprueba la existencia mirando el directorio padre, que
           siempre existe, en vez de tragarse los 500 (que tambien tapan
           errores reales de permisos o del daemon). */
        return A.exists(serverId, TRASH_DIR).then(function (found) {
            if (!found || found.is_file === true) return [];
            return listEntries(serverId);
        });
    }

    function listEntries(serverId) {
        return api().listFiles(serverId, TRASH_DIR).then(function (files) {
            var out = [];
            files.forEach(function (f) {
                var entry = decodeEntry(f.name);
                if (!entry) return;
                entry.size = f.size;
                entry.isFile = f.is_file !== false;
                out.push(entry);
            });
            out.sort(function (a, b) { return b.deletedAt - a.deletedAt; });
            return out;
        });
    }

    function restore(serverId, entry) {
        var A = api();
        var target = entry.original;

        return A.exists(serverId, target).then(function (found) {
            if (found) {
                var dir = A.dirName(target);
                var base = A.baseName(target);
                var dot = base.lastIndexOf('.');
                var stem = dot > 0 ? base.slice(0, dot) : base;
                var ext = dot > 0 ? base.slice(dot) : '';
                target = A.joinPath(dir, stem + '-restaurado-' + Date.now() + ext);
            }
            return A.ensureFolder(serverId, A.dirName(target));
        }).then(function () {
            return A.renameFiles(serverId, '/', [
                { from: A.joinPath(TRASH_DIR, entry.name), to: target }
            ]);
        }).then(function () {
            return target;
        });
    }

    function buildRow(serverId, entry, refresh) {
        var row = document.createElement('div');
        row.className = 'waise-trash__row';

        var info = document.createElement('div');
        info.className = 'waise-trash__info';

        var name = document.createElement('span');
        name.className = 'waise-trash__name';
        name.textContent = api().baseName(entry.original);
        name.title = entry.original;

        var meta = document.createElement('span');
        meta.className = 'waise-trash__meta';
        var size = entry.isFile ? formatSize(entry.size) : 'carpeta';
        meta.textContent = api().dirName(entry.original) + ' - ' + formatAge(entry.deletedAt) +
                           (size ? ' - ' + size : '');

        info.appendChild(name);
        info.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'waise-trash__actions';

        var restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'waise-trash__btn waise-trash__btn--restore';
        restoreBtn.textContent = 'Restaurar';
        restoreBtn.addEventListener('click', function () {
            restoreBtn.disabled = true;
            restore(serverId, entry).then(function (target) {
                notify('Restaurado en ' + target, 'ok');
                refresh();
            }, function (err) {
                restoreBtn.disabled = false;
                notify('No se pudo restaurar: ' + err.message, 'err');
            });
        });

        var purgeBtn = document.createElement('button');
        purgeBtn.type = 'button';
        purgeBtn.className = 'waise-trash__btn waise-trash__btn--purge';
        purgeBtn.textContent = 'Borrar';
        purgeBtn.addEventListener('click', function () {
            if (!window.confirm('Borrar definitivamente "' + api().baseName(entry.original) + '"?')) return;
            purgeBtn.disabled = true;
            api().deleteFiles(serverId, TRASH_DIR, [entry.name]).then(function () {
                notify('Borrado definitivamente', 'ok');
                refresh();
            }, function (err) {
                purgeBtn.disabled = false;
                notify('No se pudo borrar: ' + err.message, 'err');
            });
        });

        actions.appendChild(restoreBtn);
        actions.appendChild(purgeBtn);
        row.appendChild(info);
        row.appendChild(actions);
        return row;
    }

    function openTrash() {
        var serverId = api() && window.Waise ? window.Waise.currentServerId() : null;
        if (!serverId) {
            notify('Abre un servidor para ver su papelera', 'err');
            return;
        }
        closeTrash();

        overlay = document.createElement('div');
        overlay.className = 'waise-trash';
        overlay.addEventListener('mousedown', function (ev) {
            if (ev.target === overlay) closeTrash();
        });

        var box = document.createElement('div');
        box.className = 'waise-trash__box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Papelera de reciclaje');

        var head = document.createElement('div');
        head.className = 'waise-trash__head';

        var title = document.createElement('h2');
        title.className = 'waise-trash__title';
        title.textContent = 'Papelera';

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'waise-trash__close';
        close.setAttribute('aria-label', 'Cerrar');
        close.textContent = '\u00d7';
        close.addEventListener('click', closeTrash);

        head.appendChild(title);
        head.appendChild(close);

        var list = document.createElement('div');
        list.className = 'waise-trash__list';
        list.textContent = 'Cargando...';

        var foot = document.createElement('div');
        foot.className = 'waise-trash__foot';
        foot.textContent = 'Los elementos se borran solos tras ' + RETENTION_DAYS + ' dias.';

        box.appendChild(head);
        box.appendChild(list);
        box.appendChild(foot);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function refresh() {
            list.textContent = 'Cargando...';
            loadEntries(serverId).then(function (entries) {
                return purgeExpired(serverId, entries).then(function (removed) {
                    return removed ? loadEntries(serverId) : entries;
                });
            }).then(function (entries) {
                list.textContent = '';
                if (!entries.length) {
                    var empty = document.createElement('p');
                    empty.className = 'waise-trash__empty';
                    empty.textContent = 'La papelera esta vacia.';
                    list.appendChild(empty);
                    return;
                }
                entries.forEach(function (entry) {
                    list.appendChild(buildRow(serverId, entry, refresh));
                });
            }, function (err) {
                list.textContent = 'No se pudo leer la papelera: ' + err.message;
            });
        }

        refresh();
    }

    /* --- Boton de acceso -------------------------------------------------- */

    function isFilesRoute() {
        return /^\/server\/[^/]+\/files/.test(window.location.pathname);
    }

    function syncButton() {
        var existing = document.querySelector('.waise-trash-fab');
        if (!enabled() || !isFilesRoute()) {
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
            return;
        }
        if (existing) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'waise-trash-fab';
        btn.title = 'Papelera de reciclaje';
        btn.setAttribute('aria-label', 'Abrir la papelera de reciclaje');
        btn.textContent = 'Papelera';
        btn.addEventListener('click', openTrash);
        document.body.appendChild(btn);
    }

    /* --- Arranque --------------------------------------------------------- */

    function init() {
        if (!api()) {
            /* waise-api.js carga con defer en el mismo bloque; si falta, el
               tema esta a medio instalar y es mejor no tocar nada. */
            if (window.console) window.console.warn('[waise-trash] WaiseApi no disponible; papelera desactivada.');
            return;
        }

        installInterceptor();
        installXhrInterceptor();
        syncButton();

        window.addEventListener('popstate', syncButton);
        window.addEventListener('waise:trash-changed', function () {
            if (overlay) window.setTimeout(syncButton, 0);
        });
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && overlay) {
                ev.stopPropagation();
                closeTrash();
            }
        }, true);

        /* React Router navega con pushState, que no emite popstate: mismo
           parche que usa waise-features.js. */
        ['pushState', 'replaceState'].forEach(function (name) {
            var original = window.history[name];
            if (typeof original !== 'function') return;
            window.history[name] = function () {
                var result = original.apply(this, arguments);
                window.setTimeout(syncButton, 0);
                return result;
            };
        });
    }

    window.WaiseTrash = {
        open: openTrash,
        close: closeTrash,
        moveToTrash: moveToTrash
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();