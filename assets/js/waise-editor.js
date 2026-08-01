/* ==========================================================================
   Waise Theme - assets/js/waise-editor.js
   Theme Editor del panel de administracion.

   Se carga SOLO en admin.blade.php, que Pterodactyl ya restringe a root_admin.
   Anade una entrada "Theme Editor" en el menu lateral del admin y abre un
   editor a pantalla completa.

   Vista previa: NO se usa iframe (el panel envia X-Frame-Options y el
   navegador lo bloquea) ni maquetas. El editor deja un borrador en
   localStorage y se abre el panel de cliente real en otra pestana con
   ?waise-preview=1; waise-brand.js lo detecta y aplica el borrador encima.
   El borrador no se publica: solo lo ve este navegador.
   ========================================================================== */
(function () {
    'use strict';

    var TOKEN = (document.querySelector('meta[name="waise-token"]') || {}).content || '';
    var API = '/waise/api/theme.php';
    var HASH = '#waise-theme-editor';
    var PREVIEW_KEY = 'waise:preview-draft';
    var PREVIEW_URL = '/?waise-preview=1';

    var TABS = [
        { id: 'look', label: 'Aspecto' },
        { id: 'features', label: 'Funciones' }
    ];

    var FIELDS = [
        { key: 'accent',       label: 'Color de acento',          type: 'color',  tab: 'look' },
        { key: 'accent2',      label: 'Acento secundario',        type: 'color',  tab: 'look' },
        { key: 'bg',           label: 'Fondo del panel',          type: 'color',  tab: 'look' },
        { key: 'surface',      label: 'Superficie (tarjetas)',    type: 'color',  tab: 'look' },
        { key: 'text',         label: 'Texto principal',          type: 'color',  tab: 'look' },
        { key: 'muted',        label: 'Texto secundario',         type: 'color',  tab: 'look' },
        { key: 'bgImage',      label: 'Imagen de fondo (URL)',    type: 'text',   tab: 'look',
          hint: 'Ruta interna (/waise/img/...) o https://. Vacio = sin imagen.' },
        { key: 'bgOverlay',    label: 'Oscurecer el fondo',       type: 'range',  tab: 'look', min: 0,   max: 1,   step: 0.05 },
        { key: 'radius',       label: 'Redondeo (px)',            type: 'range',  tab: 'look', min: 0,   max: 40,  step: 1 },
        { key: 'blur',         label: 'Desenfoque (px)',          type: 'range',  tab: 'look', min: 0,   max: 40,  step: 1 },
        { key: 'sidebarWidth', label: 'Ancho de la columna (px)', type: 'range',  tab: 'look', min: 140, max: 400, step: 4 },
        { key: 'font',         label: 'Fuente',                   type: 'text',   tab: 'look',
          hint: 'Nombre de una fuente ya disponible. Vacio = la del panel.' },
        { key: 'logoUrl',      label: 'Logo (URL)',               type: 'text',   tab: 'look' },
        { key: 'faviconUrl',   label: 'Favicon (URL)',            type: 'text',   tab: 'look' },
        { key: 'brandName',    label: 'Nombre de marca',          type: 'text',   tab: 'look' },
        { key: 'copyright',    label: 'Texto de copyright',       type: 'text',   tab: 'look',
          hint: 'Se muestra abajo a la izquierda en el panel de cliente.' },

        { key: 'featCopyAddress', label: 'Boton de copiar direccion', type: 'toggle', tab: 'features',
          hint: 'Anade un boton "Copiar" junto a las direcciones IP:puerto del panel de cliente.' },
        { key: 'featShortcuts', label: 'Atajos de teclado', type: 'toggle', tab: 'features',
          hint: 'Ctrl+K abre el buscador, Ctrl+` enfoca la consola, Esc cierra la ventana emergente activa.' },
        { key: 'featConsoleHistory', label: 'Historial de consola', type: 'toggle', tab: 'features',
          hint: 'Flechas arriba/abajo recorren los comandos anteriores y Tab autocompleta. El historial se guarda por servidor en el navegador de cada usuario.' }
    ];

    var config = null;
    var root = null;
    var inputs = {};
    var dirty = false;
    var activeTab = TABS[0].id;

    /* --- Red ------------------------------------------------------------- */

    function request(method, body) {
        return fetch(API, {
            method: method,
            headers: {
                'X-Waise-Token': TOKEN,
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : undefined,
            credentials: 'same-origin'
        }).then(function (res) {
            return res.text().then(function (raw) {
                var data;
                try {
                    data = JSON.parse(raw);
                } catch (e) {
                    throw new Error('El servidor no devolvio JSON (HTTP ' + res.status + '). Revisa que nginx sirva /waise/api/theme.php');
                }
                if (!res.ok || !data.ok) throw new Error(data.error || 'HTTP ' + res.status);
                return data;
            });
        });
    }

    function notify(message, kind) {
        var el = root.querySelector('.waise-ed__notice');
        el.textContent = message;
        el.className = 'waise-ed__notice waise-ed__notice--' + kind + ' waise-ed__notice--show';
        window.clearTimeout(notify.timer);
        notify.timer = window.setTimeout(function () {
            el.className = 'waise-ed__notice';
        }, 5000);
    }

    /* --- Borrador de previsualizacion ------------------------------------ */

    var previewOk = true;

    function writeDraft() {
        try {
            window.localStorage.setItem(PREVIEW_KEY, JSON.stringify(config));
            previewOk = true;
        } catch (e) {
            /* Modo privado o cuota llena: la pestana de vista previa no se
               enterara de los cambios, y el admin debe saberlo. */
            previewOk = false;
        }
        updatePreviewState();
    }

    function clearDraft() {
        try { window.localStorage.removeItem(PREVIEW_KEY); }
        catch (e) { /* nada que limpiar si localStorage no esta disponible */ }
    }

    function updatePreviewState() {
        if (!root) return;
        var el = root.querySelector('.waise-ed__preview-state');
        if (!previewOk) {
            el.textContent = 'No se pudo guardar el borrador (almacenamiento del navegador bloqueado).';
            return;
        }
        el.textContent = dirty
            ? 'Borrador actualizado. La pestana de vista previa se refresca sola.'
            : 'Borrador al dia con lo publicado.';
    }

    function openPreview() {
        writeDraft();
        window.open(PREVIEW_URL, 'waise-preview');
    }

    /* --- Formulario ------------------------------------------------------ */

    function onFieldChange(key, value) {
        config[key] = value;
        dirty = true;
        root.querySelector('.waise-ed__save').disabled = false;
        writeDraft();
    }

    function buildField(field) {
        var wrap = document.createElement('label');
        wrap.className = 'waise-ed__field waise-ed__field--' + field.type;

        var title = document.createElement('span');
        title.className = 'waise-ed__label';
        title.textContent = field.label;
        wrap.appendChild(title);

        var row = document.createElement('span');
        row.className = 'waise-ed__control';

        var input = document.createElement('input');
        input.className = 'waise-ed__input';

        if (field.type === 'color') {
            input.type = 'color';
            input.value = config[field.key];

            var hex = document.createElement('input');
            hex.type = 'text';
            hex.className = 'waise-ed__hex';
            hex.value = config[field.key];
            hex.maxLength = 7;
            hex.spellcheck = false;

            input.addEventListener('input', function () {
                hex.value = input.value;
                onFieldChange(field.key, input.value);
            });
            hex.addEventListener('input', function () {
                if (!/^#[0-9a-fA-F]{6}$/.test(hex.value)) return;
                input.value = hex.value;
                onFieldChange(field.key, hex.value);
            });

            row.appendChild(input);
            row.appendChild(hex);
            inputs[field.key] = { main: input, extra: hex };
        } else if (field.type === 'range') {
            input.type = 'range';
            input.min = field.min;
            input.max = field.max;
            input.step = field.step;
            input.value = config[field.key];

            var out = document.createElement('span');
            out.className = 'waise-ed__value';
            out.textContent = config[field.key];

            input.addEventListener('input', function () {
                out.textContent = input.value;
                onFieldChange(field.key, parseFloat(input.value));
            });

            row.appendChild(input);
            row.appendChild(out);
            inputs[field.key] = { main: input, extra: out };
        } else if (field.type === 'toggle') {
            input.type = 'checkbox';
            input.checked = config[field.key] !== false;
            input.addEventListener('change', function () {
                onFieldChange(field.key, input.checked);
            });
            row.appendChild(input);
            inputs[field.key] = { main: input, extra: null };
        } else {
            input.type = 'text';
            input.value = config[field.key];
            input.spellcheck = false;
            input.addEventListener('input', function () {
                onFieldChange(field.key, input.value);
            });
            row.appendChild(input);
            inputs[field.key] = { main: input, extra: null };
        }

        wrap.appendChild(row);

        if (field.hint) {
            var hint = document.createElement('small');
            hint.className = 'waise-ed__hint';
            hint.textContent = field.hint;
            wrap.appendChild(hint);
        }
        return wrap;
    }

    function syncInputs() {
        for (var i = 0; i < FIELDS.length; i++) {
            var field = FIELDS[i];
            var pair = inputs[field.key];
            if (!pair) continue;
            if (field.type === 'toggle') {
                pair.main.checked = config[field.key] !== false;
                continue;
            }
            pair.main.value = config[field.key];
            if (field.type === 'color' && pair.extra) pair.extra.value = config[field.key];
            if (field.type === 'range' && pair.extra) pair.extra.textContent = config[field.key];
        }
    }

    function selectTab(id) {
        activeTab = id;
        var tabs = root.querySelectorAll('.waise-ed__tab');
        for (var i = 0; i < tabs.length; i++) {
            var on = tabs[i].dataset.tab === id;
            tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
        }
        var groups = root.querySelectorAll('.waise-ed__group');
        for (var j = 0; j < groups.length; j++) {
            groups[j].hidden = groups[j].dataset.tab !== id;
        }
    }

    /* --- Acciones -------------------------------------------------------- */

    function save() {
        var button = root.querySelector('.waise-ed__save');
        button.disabled = true;
        button.textContent = 'Guardando...';
        request('POST', { action: 'save', config: config }).then(function (data) {
            config = data.config;
            syncInputs();
            dirty = false;
            writeDraft();
            notify('Guardado. Los usuarios lo veran al recargar (Ctrl+F5).', 'ok');
        }).catch(function (err) {
            button.disabled = false;
            notify('No se pudo guardar: ' + err.message, 'error');
        }).then(function () {
            button.textContent = 'Guardar cambios';
        });
    }

    function reset() {
        if (!window.confirm('Se restauraran todos los valores por defecto del tema. Continuar?')) return;
        request('POST', { action: 'reset' }).then(function (data) {
            config = data.config;
            syncInputs();
            dirty = false;
            writeDraft();
            root.querySelector('.waise-ed__save').disabled = true;
            notify('Valores por defecto restaurados.', 'ok');
        }).catch(function (err) {
            notify('No se pudo restaurar: ' + err.message, 'error');
        });
    }

    function close() {
        if (dirty && !window.confirm('Hay cambios sin guardar. Cerrar de todas formas?')) return;
        /* Al salir con cambios sin guardar se borra el borrador: si no, la
           pestana de vista previa seguiria mostrando algo que ya no existe. */
        if (dirty) clearDraft();
        root.classList.remove('waise-ed--open');
        document.body.classList.remove('waise-ed-open');
        if (window.location.hash === HASH) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }

    /* --- Construccion ---------------------------------------------------- */

    function build() {
        root = document.createElement('div');
        root.className = 'waise-ed';
        root.innerHTML =
            '<div class="waise-ed__bar">' +
                '<span class="waise-ed__title">Waise &middot; Theme Editor</span>' +
                '<span class="waise-ed__notice"></span>' +
                '<button type="button" class="waise-ed__btn waise-ed__reset">Restaurar</button>' +
                '<button type="button" class="waise-ed__btn waise-ed__btn--primary waise-ed__save" disabled>Guardar cambios</button>' +
                '<button type="button" class="waise-ed__btn waise-ed__close" aria-label="Cerrar">&times;</button>' +
            '</div>' +
            '<div class="waise-ed__body">' +
                '<div class="waise-ed__panel">' +
                    '<div class="waise-ed__tabs" role="tablist"></div>' +
                    '<form class="waise-ed__form"></form>' +
                '</div>' +
                '<div class="waise-ed__preview">' +
                    '<div class="waise-ed__preview-title">Vista previa sobre tu panel real</div>' +
                    '<p class="waise-ed__preview-text">Abre tu panel de cliente en otra pestana con el tema que estas editando aplicado encima: tus servidores y tus datos de verdad. Cada cambio que hagas aqui se refleja alli al instante.</p>' +
                    '<div class="waise-ed__preview-actions">' +
                        '<button type="button" class="waise-ed__btn waise-ed__btn--primary waise-ed__preview-open">Abrir vista previa</button>' +
                    '</div>' +
                    '<div class="waise-ed__preview-state"></div>' +
                    '<div class="waise-ed__preview-warn">Lo que ves en esa pestana solo existe en este navegador. Hasta que pulses <strong>Guardar cambios</strong>, el resto de usuarios sigue viendo el tema anterior.</div>' +
                '</div>' +
            '</div>';

        var tabBar = root.querySelector('.waise-ed__tabs');
        var form = root.querySelector('.waise-ed__form');

        for (var t = 0; t < TABS.length; t++) {
            (function (tab) {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'waise-ed__tab';
                button.dataset.tab = tab.id;
                button.setAttribute('role', 'tab');
                button.textContent = tab.label;
                button.addEventListener('click', function () { selectTab(tab.id); });
                tabBar.appendChild(button);

                var group = document.createElement('div');
                group.className = 'waise-ed__group';
                group.dataset.tab = tab.id;
                for (var i = 0; i < FIELDS.length; i++) {
                    if (FIELDS[i].tab === tab.id) group.appendChild(buildField(FIELDS[i]));
                }
                form.appendChild(group);
            })(TABS[t]);
        }

        form.addEventListener('submit', function (ev) { ev.preventDefault(); save(); });

        root.querySelector('.waise-ed__save').addEventListener('click', save);
        root.querySelector('.waise-ed__reset').addEventListener('click', reset);
        root.querySelector('.waise-ed__close').addEventListener('click', close);
        root.querySelector('.waise-ed__preview-open').addEventListener('click', openPreview);

        document.body.appendChild(root);
        selectTab(activeTab);

        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && root.classList.contains('waise-ed--open')) close();
        });

        window.addEventListener('beforeunload', function (ev) {
            if (!dirty) return;
            ev.preventDefault();
            ev.returnValue = '';
        });
    }

    function open() {
        if (!root) build();
        root.classList.add('waise-ed--open');
        document.body.classList.add('waise-ed-open');
        writeDraft();
    }

    /* --- Entrada en el menu del admin ------------------------------------ */

    function injectMenuItem() {
        var menu = document.querySelector('.sidebar-menu, ul.sidebar-menu, #sidebar ul');
        if (!menu || menu.querySelector('.waise-ed-link')) return;

        var li = document.createElement('li');
        li.className = 'waise-ed-link';

        var a = document.createElement('a');
        a.href = HASH;
        a.innerHTML = '<i class="fa fa-paint-brush"></i> <span>Theme Editor</span>';
        a.addEventListener('click', function (ev) {
            ev.preventDefault();
            window.history.replaceState(null, '', HASH);
            open();
        });

        li.appendChild(a);
        menu.appendChild(li);
    }

    /* --- Arranque -------------------------------------------------------- */

    function init() {
        if (!TOKEN) return;

        request('GET').then(function (data) {
            config = data.config;
            injectMenuItem();
            if (window.location.hash === HASH) open();
        }).catch(function (err) {
            /* El admin debe enterarse de que el editor no arranca, pero sin
               romper el resto del panel de administracion. */
            var warn = document.createElement('div');
            warn.className = 'waise-ed-error';
            warn.textContent = 'Waise Theme Editor no disponible: ' + err.message;
            document.body.appendChild(warn);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();