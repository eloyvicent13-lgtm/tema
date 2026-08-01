/* ==========================================================================
   Waise Theme - assets/js/waise-editor.js
   Theme Editor del panel de administracion.

   Se carga SOLO en admin.blade.php, que Pterodactyl ya restringe a root_admin.
   Anade una entrada "Theme Editor" en el menu lateral del admin y abre un
   editor a pantalla completa con vista previa en vivo del panel de cliente.
   ========================================================================== */
(function () {
    'use strict';

    var TOKEN = (document.querySelector('meta[name="waise-token"]') || {}).content || '';
    var API = '/waise/api/theme.php';
    var HASH = '#waise-theme-editor';

    var FIELDS = [
        { key: 'accent',       label: 'Color de acento',        type: 'color' },
        { key: 'accent2',      label: 'Acento secundario',      type: 'color' },
        { key: 'bg',           label: 'Fondo del panel',        type: 'color' },
        { key: 'surface',      label: 'Superficie (tarjetas)',  type: 'color' },
        { key: 'text',         label: 'Texto principal',        type: 'color' },
        { key: 'muted',        label: 'Texto secundario',       type: 'color' },
        { key: 'bgImage',      label: 'Imagen de fondo (URL)',  type: 'text', hint: 'Ruta interna (/waise/img/...) o https://. Vacio = sin imagen.' },
        { key: 'bgOverlay',    label: 'Oscurecer el fondo',     type: 'range', min: 0, max: 1, step: 0.05 },
        { key: 'radius',       label: 'Redondeo (px)',          type: 'range', min: 0, max: 40, step: 1 },
        { key: 'blur',         label: 'Desenfoque (px)',        type: 'range', min: 0, max: 40, step: 1 },
        { key: 'sidebarWidth', label: 'Ancho de la columna (px)', type: 'range', min: 140, max: 400, step: 4 },
        { key: 'font',         label: 'Fuente',                 type: 'text', hint: 'Nombre de una fuente ya disponible. Vacio = la del panel.' },
        { key: 'logoUrl',      label: 'Logo (URL)',             type: 'text' },
        { key: 'faviconUrl',   label: 'Favicon (URL)',          type: 'text' },
        { key: 'brandName',    label: 'Nombre de marca',        type: 'text' },
        { key: 'copyright',    label: 'Texto de copyright',     type: 'text', hint: 'Se muestra abajo a la izquierda en el panel de cliente.' }
    ];

    var config = null;
    var defaults = null;
    var root = null;
    var previewFrame = null;
    var inputs = {};
    var dirty = false;

    /* ------------------------------------------------------------------ */

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
            return res.json().catch(function () {
                throw new Error('El servidor respondio algo que no es JSON (HTTP ' + res.status + ')');
            }).then(function (data) {
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
        }, 4000);
    }

    /* --- Vista previa --------------------------------------------------- */

    function buildPreviewCss(c) {
        var bgImage = c.bgImage
            ? 'linear-gradient(rgba(0,0,0,' + c.bgOverlay + '),rgba(0,0,0,' + c.bgOverlay + ')), url(' + c.bgImage + ')'
            : 'none';
        return ':root{' +
            '--waise-accent:' + c.accent + ';' +
            '--waise-accent-2:' + c.accent2 + ';' +
            '--waise-bg:' + c.bg + ';' +
            '--waise-surface:' + c.surface + ';' +
            '--waise-text:' + c.text + ';' +
            '--waise-muted:' + c.muted + ';' +
            '--waise-radius:' + c.radius + 'px;' +
            '--waise-blur:' + c.blur + 'px;' +
            '--waise-sidebar-width:' + c.sidebarWidth + 'px;' +
            '--waise-fx-surface:' + c.surface + ';' +
            '--waise-fx-text:' + c.text + ';' +
            '--waise-fx-muted:' + c.muted + ';' +
            '}' +
            'body{background-color:var(--waise-bg);background-image:' + bgImage + ';' +
            'background-size:cover;background-position:center;background-attachment:fixed;}';
    }

    function updatePreview() {
        if (!previewFrame) return;
        var doc;
        try { doc = previewFrame.contentDocument; } catch (e) { return; }
        /* Mismo origen, asi que se puede inyectar. Si el iframe aun no cargo,
           el listener 'load' vuelve a llamar aqui. */
        if (!doc || !doc.head) return;

        var style = doc.getElementById('waise-preview-style');
        if (!style) {
            style = doc.createElement('style');
            style.id = 'waise-preview-style';
            doc.head.appendChild(style);
        }
        style.textContent = buildPreviewCss(config);

        var brand = doc.querySelector('.waise-brand__name');
        if (brand) brand.textContent = config.brandName;
        var copy = doc.querySelector('.waise-copyright');
        if (copy) copy.textContent = config.copyright;
    }

    /* --- Formulario ------------------------------------------------------ */

    function onFieldChange(key, value) {
        config[key] = value;
        dirty = true;
        root.querySelector('.waise-ed__save').disabled = false;
        updatePreview();
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
            pair.main.value = config[field.key];
            if (field.type === 'color' && pair.extra) pair.extra.value = config[field.key];
            if (field.type === 'range' && pair.extra) pair.extra.textContent = config[field.key];
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
            updatePreview();
            dirty = false;
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
            updatePreview();
            dirty = false;
            root.querySelector('.waise-ed__save').disabled = true;
            notify('Valores por defecto restaurados.', 'ok');
        }).catch(function (err) {
            notify('No se pudo restaurar: ' + err.message, 'error');
        });
    }

    function close() {
        if (dirty && !window.confirm('Hay cambios sin guardar. Cerrar de todas formas?')) return;
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
                '<form class="waise-ed__form"></form>' +
                '<div class="waise-ed__preview">' +
                    '<div class="waise-ed__preview-bar">Vista previa en vivo &middot; panel de cliente</div>' +
                    '<iframe class="waise-ed__frame" src="/" title="Vista previa del panel"></iframe>' +
                '</div>' +
            '</div>';

        var form = root.querySelector('.waise-ed__form');
        for (var i = 0; i < FIELDS.length; i++) {
            form.appendChild(buildField(FIELDS[i]));
        }
        form.addEventListener('submit', function (ev) { ev.preventDefault(); save(); });

        root.querySelector('.waise-ed__save').addEventListener('click', save);
        root.querySelector('.waise-ed__reset').addEventListener('click', reset);
        root.querySelector('.waise-ed__close').addEventListener('click', close);

        previewFrame = root.querySelector('.waise-ed__frame');
        previewFrame.addEventListener('load', updatePreview);

        document.body.appendChild(root);

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
        updatePreview();
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
            defaults = data.defaults;
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