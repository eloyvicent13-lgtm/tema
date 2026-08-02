/* ---------------------------------------------------------------------------
   Waise Theme - assets/js/waise-mods.js

   Instalador de mods y plugins conectado a la API publica de Modrinth.

   Deteccion de Minecraft: existe la carpeta /mods o /plugins en la raiz del
   servidor. No se adivina por el nombre del egg, que cada admin renombra.
   La carpeta encontrada decide ademas el tipo de proyecto que se busca:

     /mods    -> project_type:mod     (Fabric, Forge, NeoForge, Quilt)
     /plugins -> project_type:plugin  (Paper, Spigot, Bukkit, Purpur)

   La instalacion no descarga nada al navegador: se le pasa la URL del .jar a
   POST /files/pull (WaiseApi.pullFile), de modo que es el propio daemon quien
   baja el archivo directamente a la carpeta del servidor.

   Loader y version se pueden ajustar a mano porque la API de cliente no
   expone de forma fiable ninguno de los dos; la heuristica solo los precarga.
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    var MODRINTH = 'https://api.modrinth.com/v2';
    var VERSIONS_KEY = 'waise.mods.gameversions';
    var PREFS_KEY = 'waise.mods.prefs';
    var PAGE_SIZE = 20;
    var SEARCH_DEBOUNCE = 350;

    var MOD_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];
    var PLUGIN_LOADERS = ['paper', 'spigot', 'bukkit', 'purpur', 'folia'];

    var LOADER_LABEL = {
        fabric: 'Fabric',
        forge: 'Forge',
        neoforge: 'NeoForge',
        quilt: 'Quilt',
        paper: 'Paper',
        spigot: 'Spigot',
        bukkit: 'Bukkit',
        purpur: 'Purpur',
        folia: 'Folia'
    };

    var state = {
        serverId: null,
        dir: null,          // '/mods' o '/plugins'
        kind: 'mod',        // 'mod' o 'plugin'
        loader: '',
        version: '',
        query: '',
        offset: 0,
        total: 0,
        hits: [],
        installed: {},      // slug/nombre de fichero ya presente en la carpeta
        loading: false,
        gameVersions: []
    };

    var overlay = null;
    var el = {};
    var detected = {};
    var searchTimer = null;
    var searchSeq = 0;

    function api() {
        return window.WaiseApi || null;
    }

    function enabled() {
        var cfg = window.WaiseConfig;
        if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'featMods')) {
            return cfg.featMods !== false;
        }
        return true;
    }

    function notify(message, kind) {
        if (window.Waise && typeof window.Waise.toast === 'function') {
            window.Waise.toast(message, kind);
        }
    }

    function esc(text) {
        return String(text === null || text === undefined ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtCount(n) {
        var num = Number(n) || 0;
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(num);
    }

    function currentServerId() {
        if (window.Waise && typeof window.Waise.currentServerId === 'function') {
            return window.Waise.currentServerId();
        }
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    /* --- Preferencias por servidor ---------------------------------------- */

    function readStore(key) {
        try {
            var raw = window.localStorage.getItem(key);
            var parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            return {};
        }
    }

    function writeStore(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (err) {
            /* Cuota llena o almacenamiento bloqueado: no es critico. */
        }
    }

    function loadPrefs(serverId) {
        var all = readStore(PREFS_KEY);
        var mine = all[serverId];
        return mine && typeof mine === 'object' ? mine : {};
    }

    function savePrefs(serverId) {
        var all = readStore(PREFS_KEY);
        all[serverId] = { loader: state.loader, version: state.version };
        writeStore(PREFS_KEY, all);
    }

    /* --- Cliente Modrinth -------------------------------------------------- */

    /* Modrinth responde con CORS abierto, asi que se llama desde el navegador
       del usuario y el panel no necesita proxy ni credenciales.
       Solo se envia Accept: cualquier cabecera adicional convertiria esto en
       una peticion con preflight OPTIONS sin ganar nada a cambio. */
    function modrinth(path) {
        return window.fetch(MODRINTH + path, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            credentials: 'omit',
            mode: 'cors'
        }).then(function (res) {
            if (res.status === 429) {
                throw new Error('Modrinth ha limitado las peticiones. Espera unos segundos.');
            }
            if (!res.ok) {
                throw new Error('Modrinth respondio ' + res.status);
            }
            return res.json();
        });
    }

    function facets() {
        var out = [['project_type:' + state.kind]];
        if (state.loader) out.push(['categories:' + state.loader]);
        if (state.version) out.push(['versions:' + state.version]);
        return out;
    }

    function search() {
        var seq = ++searchSeq;
        state.loading = true;
        renderResults();

        var path = '/search?limit=' + PAGE_SIZE +
            '&offset=' + state.offset +
            '&index=relevance' +
            '&query=' + encodeURIComponent(state.query) +
            '&facets=' + encodeURIComponent(JSON.stringify(facets()));

        modrinth(path).then(function (data) {
            if (seq !== searchSeq || !overlay) return;
            state.hits = Array.isArray(data.hits) ? data.hits : [];
            state.total = Number(data.total_hits) || 0;
            state.loading = false;
            renderResults();
        }, function (err) {
            if (seq !== searchSeq || !overlay) return;
            state.loading = false;
            state.hits = [];
            state.total = 0;
            renderError(err.message);
        });
    }

    function loadGameVersions() {
        var cached = readStore(VERSIONS_KEY);
        if (Array.isArray(cached.list) && cached.list.length &&
            Date.now() - (cached.at || 0) < 86400000) {
            state.gameVersions = cached.list;
            return Promise.resolve(state.gameVersions);
        }
        return modrinth('/tag/game_version').then(function (list) {
            var out = [];
            for (var i = 0; i < list.length; i++) {
                if (list[i] && list[i].version_type === 'release') out.push(list[i].version);
            }
            state.gameVersions = out;
            writeStore(VERSIONS_KEY, { at: Date.now(), list: out });
            return out;
        }, function () {
            state.gameVersions = [];
            return [];
        });
    }

    /* Devuelve el fichero primario de la version mas reciente compatible. */
    function bestFile(projectId) {
        var path = '/project/' + encodeURIComponent(projectId) + '/version';
        if (state.loader) path += '?loaders=' + encodeURIComponent(JSON.stringify([state.loader]));
        if (state.version) {
            path += (path.indexOf('?') === -1 ? '?' : '&') +
                'game_versions=' + encodeURIComponent(JSON.stringify([state.version]));
        }
        return modrinth(path).then(function (versions) {
            if (!Array.isArray(versions) || !versions.length) {
                throw new Error('No hay ninguna version compatible con ' +
                    (LOADER_LABEL[state.loader] || 'este loader') +
                    (state.version ? ' ' + state.version : '') + '.');
            }
            /* La API ya las devuelve de mas nueva a mas antigua. */
            var version = versions[0];
            var files = version.files || [];
            var file = null;
            for (var i = 0; i < files.length; i++) {
                if (files[i].primary) { file = files[i]; break; }
            }
            if (!file) file = files[0];
            if (!file || !file.url) {
                throw new Error('La version publicada no tiene ningun archivo descargable.');
            }
            return { file: file, version: version };
        });
    }

    /* --- Carpeta del servidor --------------------------------------------- */

    function refreshInstalled() {
        var client = api();
        if (!client || typeof client.listFiles !== 'function') return Promise.resolve();
        return client.listFiles(state.serverId, state.dir).then(function (list) {
            var map = {};
            var items = Array.isArray(list) ? list : (list && list.data) || [];
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var name = item && (item.name || (item.attributes && item.attributes.name));
                if (name && /\.jar$/i.test(name)) map[name.toLowerCase()] = true;
            }
            state.installed = map;
        }, function () {
            state.installed = {};
        });
    }

    function isInstalled(fileName) {
        return !!state.installed[String(fileName || '').toLowerCase()];
    }

    function install(projectId, projectTitle, button) {
        var client = api();
        if (!client || typeof client.pullFile !== 'function') {
            notify('WaiseApi no expone pullFile; actualiza el tema.', 'err');
            return;
        }
        button.disabled = true;
        button.textContent = 'Buscando version...';

        bestFile(projectId).then(function (found) {
            button.textContent = 'Instalando...';
            /* pullFile normaliza a snake_case internamente: aqui las opciones
               van en camelCase (useHeader), como espera waise-api.js. */
            return client.pullFile(state.serverId, found.file.url, {
                directory: state.dir,
                filename: found.file.filename,
                useHeader: false,
                foreground: true
            }).then(function () {
                return found;
            });
        }).then(function (found) {
            state.installed[String(found.file.filename).toLowerCase()] = true;
            button.textContent = 'Instalado';
            button.classList.add('is-done');
            notify(projectTitle + ' instalado en ' + state.dir +
                '. Reinicia el servidor para cargarlo.', 'ok');
        }, function (err) {
            button.disabled = false;
            button.textContent = 'Instalar';
            notify('No se pudo instalar ' + projectTitle + ': ' + err.message, 'err');
        });
    }

    /* --- Interfaz ---------------------------------------------------------- */

    function renderError(message) {
        if (!el.results) return;
        el.results.innerHTML = '<p class="wmods-msg wmods-err">' + esc(message) + '</p>';
        if (el.pager) el.pager.hidden = true;
    }

    function renderResults() {
        if (!el.results) return;

        if (state.loading) {
            el.results.innerHTML = '<p class="wmods-msg">Buscando en Modrinth...</p>';
            if (el.pager) el.pager.hidden = true;
            return;
        }

        if (!state.hits.length) {
            el.results.innerHTML = '<p class="wmods-msg">Sin resultados para estos filtros. ' +
                'Prueba con otra version del juego u otro loader.</p>';
            if (el.pager) el.pager.hidden = true;
            return;
        }

        var html = '';
        for (var i = 0; i < state.hits.length; i++) {
            var hit = state.hits[i];
            var icon = hit.icon_url
                ? '<img class="wmods-icon" src="' + esc(hit.icon_url) + '" alt="" loading="lazy">'
                : '<span class="wmods-icon wmods-icon--empty" aria-hidden="true"></span>';

            html += '<article class="wmods-card">' +
                icon +
                '<div class="wmods-info">' +
                    '<h3 class="wmods-name">' + esc(hit.title) + '</h3>' +
                    '<p class="wmods-desc">' + esc(hit.description) + '</p>' +
                    '<p class="wmods-meta">' +
                        '<span title="Descargas">&#8681; ' + fmtCount(hit.downloads) + '</span>' +
                        '<span title="Autor">' + esc(hit.author || 'Desconocido') + '</span>' +
                        '<a class="wmods-link" href="https://modrinth.com/' + esc(state.kind) +
                            '/' + esc(hit.slug) + '" target="_blank" rel="noopener noreferrer">Modrinth</a>' +
                    '</p>' +
                '</div>' +
                '<button type="button" class="wmods-install" data-project="' +
                    esc(hit.project_id || hit.slug) + '" data-title="' + esc(hit.title) +
                    '">Instalar</button>' +
            '</article>';
        }
        el.results.innerHTML = html;

        if (el.pager) {
            var from = state.offset + 1;
            var to = Math.min(state.offset + state.hits.length, state.total);
            el.pager.hidden = false;
            el.pageInfo.textContent = from + '-' + to + ' de ' + state.total;
            el.prev.disabled = state.offset <= 0;
            el.next.disabled = state.offset + PAGE_SIZE >= state.total;
        }
    }

    function loaderOptions() {
        var list = state.kind === 'plugin' ? PLUGIN_LOADERS : MOD_LOADERS;
        var html = '<option value="">Cualquier loader</option>';
        for (var i = 0; i < list.length; i++) {
            html += '<option value="' + list[i] + '"' +
                (state.loader === list[i] ? ' selected' : '') + '>' +
                esc(LOADER_LABEL[list[i]]) + '</option>';
        }
        return html;
    }

    function versionOptions() {
        var html = '<option value="">Cualquier version</option>';
        for (var i = 0; i < state.gameVersions.length; i++) {
            var v = state.gameVersions[i];
            html += '<option value="' + esc(v) + '"' +
                (state.version === v ? ' selected' : '') + '>' + esc(v) + '</option>';
        }
        return html;
    }

    function closePanel() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        el = {};
        searchSeq++;
        if (searchTimer) { window.clearTimeout(searchTimer); searchTimer = null; }
        document.body.classList.remove('wmods-lock');
    }

    function scheduleSearch() {
        if (searchTimer) window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(function () {
            searchTimer = null;
            state.offset = 0;
            search();
        }, SEARCH_DEBOUNCE);
    }

    function openPanel() {
        var serverId = currentServerId();
        if (!serverId || !api()) {
            notify('Abre un servidor de Minecraft para instalar mods', 'err');
            return;
        }
        if (!state.dir) {
            notify('Este servidor no tiene carpeta /mods ni /plugins', 'err');
            return;
        }
        closePanel();

        state.serverId = serverId;
        var prefs = loadPrefs(serverId);
        if (prefs.loader) state.loader = prefs.loader;
        if (prefs.version) state.version = prefs.version;
        state.offset = 0;
        state.hits = [];

        overlay = document.createElement('div');
        overlay.className = 'wmods-overlay';
        overlay.innerHTML =
            '<div class="wmods-panel" role="dialog" aria-modal="true" aria-label="Instalador de mods">' +
                '<header class="wmods-head">' +
                    '<h2 class="wmods-title">' +
                        (state.kind === 'plugin' ? 'Instalador de plugins' : 'Instalador de mods') +
                    '</h2>' +
                    '<span class="wmods-target">' + esc(state.dir) + '</span>' +
                    '<button type="button" class="wmods-close" aria-label="Cerrar">&times;</button>' +
                '</header>' +
                '<div class="wmods-filters">' +
                    '<input type="search" class="wmods-search" placeholder="Buscar en Modrinth..." ' +
                        'aria-label="Buscar mods en Modrinth">' +
                    '<select class="wmods-loader" aria-label="Loader">' + loaderOptions() + '</select>' +
                    '<select class="wmods-version" aria-label="Version de Minecraft">' +
                        versionOptions() + '</select>' +
                '</div>' +
                '<div class="wmods-results" role="region" aria-live="polite"></div>' +
                '<footer class="wmods-pager" hidden>' +
                    '<button type="button" class="wmods-prev">Anteriores</button>' +
                    '<span class="wmods-page"></span>' +
                    '<button type="button" class="wmods-next">Siguientes</button>' +
                '</footer>' +
            '</div>';
        document.body.appendChild(overlay);
        document.body.classList.add('wmods-lock');

        el.results = overlay.querySelector('.wmods-results');
        el.pager = overlay.querySelector('.wmods-pager');
        el.pageInfo = overlay.querySelector('.wmods-page');
        el.prev = overlay.querySelector('.wmods-prev');
        el.next = overlay.querySelector('.wmods-next');
        el.searchBox = overlay.querySelector('.wmods-search');
        el.loaderBox = overlay.querySelector('.wmods-loader');
        el.versionBox = overlay.querySelector('.wmods-version');

        overlay.addEventListener('mousedown', function (ev) {
            if (ev.target === overlay) closePanel();
        });
        overlay.querySelector('.wmods-close').addEventListener('click', closePanel);

        el.searchBox.addEventListener('input', function () {
            state.query = el.searchBox.value.trim();
            scheduleSearch();
        });

        el.loaderBox.addEventListener('change', function () {
            state.loader = el.loaderBox.value;
            state.offset = 0;
            savePrefs(state.serverId);
            search();
        });

        el.versionBox.addEventListener('change', function () {
            state.version = el.versionBox.value;
            state.offset = 0;
            savePrefs(state.serverId);
            search();
        });

        el.prev.addEventListener('click', function () {
            if (state.offset <= 0) return;
            state.offset = Math.max(0, state.offset - PAGE_SIZE);
            search();
        });

        el.next.addEventListener('click', function () {
            if (state.offset + PAGE_SIZE >= state.total) return;
            state.offset += PAGE_SIZE;
            search();
        });

        el.results.addEventListener('click', function (ev) {
            var btn = ev.target.closest('.wmods-install');
            if (!btn || btn.disabled) return;
            install(btn.getAttribute('data-project'), btn.getAttribute('data-title'), btn);
        });

        el.results.innerHTML = '<p class="wmods-msg">Cargando versiones de Minecraft...</p>';

        loadGameVersions().then(function () {
            if (!overlay) return;
            el.versionBox.innerHTML = versionOptions();
            return refreshInstalled();
        }).then(function () {
            if (!overlay) return;
            search();
        });
    }

    /* --- Boton de acceso --------------------------------------------------- */

    function isServerRoute() {
        return /^\/server\/[^/]+/.test(window.location.pathname);
    }

    function removeButton() {
        var existing = document.querySelector('.wmods-fab');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function addButton() {
        if (document.querySelector('.wmods-fab')) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wmods-fab';
        btn.title = state.kind === 'plugin' ? 'Instalar plugins' : 'Instalar mods';
        btn.setAttribute('aria-label', 'Abrir el instalador de mods');
        btn.textContent = state.kind === 'plugin' ? 'Plugins' : 'Mods';
        btn.addEventListener('click', openPanel);
        document.body.appendChild(btn);
    }

    /* La deteccion se cachea por servidor: sin esto se consultaria la raiz en
       cada navegacion y el panel devuelve 429 con facilidad. */
    function detect(serverId) {
        var client = api();
        detected[serverId] = 'pending';
        return client.exists(serverId, '/mods').then(function (found) {
            if (found && found.is_file === false) return { dir: '/mods', kind: 'mod' };
            return client.exists(serverId, '/plugins').then(function (plug) {
                if (plug && plug.is_file === false) return { dir: '/plugins', kind: 'plugin' };
                return null;
            });
        }).then(function (result) {
            detected[serverId] = result || false;
            return result;
        }, function () {
            detected[serverId] = false;
            return null;
        });
    }

    function syncButton() {
        if (!enabled() || !isServerRoute()) { removeButton(); return; }
        var serverId = currentServerId();
        if (!serverId || !api()) { removeButton(); return; }

        var cached = detected[serverId];
        if (cached === 'pending') return;
        if (cached === false) { removeButton(); return; }
        if (cached && typeof cached === 'object') {
            state.serverId = serverId;
            state.dir = cached.dir;
            state.kind = cached.kind;
            addButton();
            return;
        }

        removeButton();
        detect(serverId).then(function () { syncButton(); });
    }

    function init() {
        if (!api()) {
            if (window.console) {
                window.console.warn('[waise-mods] WaiseApi no disponible; instalador desactivado.');
            }
            return;
        }

        syncButton();
        window.addEventListener('popstate', syncButton);
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && overlay) {
                ev.stopPropagation();
                closePanel();
            }
        }, true);

        /* React Router navega con pushState, que no emite popstate: mismo
           parche que usan waise-features.js y waise-properties.js. */
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

    window.WaiseMods = {
        open: openPanel,
        close: closePanel,
        search: search,
        state: state
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();