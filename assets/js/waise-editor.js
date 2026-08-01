/* ==========================================================================
   Waise Theme - assets/js/waise-editor.js
   Theme Editor del panel de administracion.

   Se carga SOLO en admin.blade.php, que Pterodactyl ya restringe a root_admin.
   Anade una entrada "Theme Editor" en el menu lateral del admin y abre un
   editor a pantalla completa con vista previa en vivo.

   La vista previa NO usa un iframe: el panel envia X-Frame-Options y el
   navegador la bloquea (ERR_BLOCKED_BY_RESPONSE). En su lugar se dibuja una
   maqueta del panel de cliente dentro de un shadow root, de modo que ni el
   CSS del admin afecta a la maqueta ni la maqueta afecta al admin.
   ========================================================================== */
(function () {
    'use strict';

    var TOKEN = (document.querySelector('meta[name="waise-token"]') || {}).content || '';
    var API = '/waise/api/theme.php';
    var HASH = '#waise-theme-editor';

    var FIELDS = [
        { key: 'accent',       label: 'Color de acento',          type: 'color' },
        { key: 'accent2',      label: 'Acento secundario',        type: 'color' },
        { key: 'bg',           label: 'Fondo del panel',          type: 'color' },
        { key: 'surface',      label: 'Superficie (tarjetas)',    type: 'color' },
        { key: 'text',         label: 'Texto principal',          type: 'color' },
        { key: 'muted',        label: 'Texto secundario',         type: 'color' },
        { key: 'bgImage',      label: 'Imagen de fondo (URL)',    type: 'text',  hint: 'Ruta interna (/waise/img/...) o https://. Vacio = sin imagen.' },
        { key: 'bgOverlay',    label: 'Oscurecer el fondo',       type: 'range', min: 0,   max: 1,   step: 0.05 },
        { key: 'radius',       label: 'Redondeo (px)',            type: 'range', min: 0,   max: 40,  step: 1 },
        { key: 'blur',         label: 'Desenfoque (px)',          type: 'range', min: 0,   max: 40,  step: 1 },
        { key: 'sidebarWidth', label: 'Ancho de la columna (px)', type: 'range', min: 140, max: 400, step: 4 },
        { key: 'font',         label: 'Fuente',                   type: 'text',  hint: 'Nombre de una fuente ya disponible. Vacio = la del panel.' },
        { key: 'logoUrl',      label: 'Logo (URL)',               type: 'text' },
        { key: 'faviconUrl',   label: 'Favicon (URL)',            type: 'text' },
        { key: 'brandName',    label: 'Nombre de marca',          type: 'text' },
        { key: 'copyright',    label: 'Texto de copyright',       type: 'text',  hint: 'Se muestra abajo a la izquierda en el panel de cliente.' }
    ];

    var config = null;
    var root = null;
    var shadow = null;
    var previewStyle = null;
    var inputs = {};
    var dirty = false;

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

    /* --- Maqueta de la vista previa -------------------------------------- */

    var PREVIEW_MARKUP =
        '<div class="pv">' +
            '<header class="pv__top">' +
                '<span class="pv__brand"><img class="pv__logo" alt="" hidden><span class="pv__brandname"></span></span>' +
                '<nav class="pv__nav"><span>Cuenta</span><span>API</span><span>Salir</span></nav>' +
            '</header>' +
            '<div class="pv__main">' +
                '<aside class="pv__side">' +
                    '<span class="pv__item pv__item--active">Consola</span>' +
                    '<span class="pv__item">Archivos</span>' +
                    '<span class="pv__item">Bases de datos</span>' +
                    '<span class="pv__item">Copias de seguridad</span>' +
                    '<span class="pv__item">Ajustes</span>' +
                '</aside>' +
                '<section class="pv__content">' +
                    '<div class="pv__stats">' +
                        '<div class="pv__stat"><b>CPU</b><span>34%</span></div>' +
                        '<div class="pv__stat"><b>Memoria</b><span>1.2 GB</span></div>' +
                        '<div class="pv__stat"><b>Disco</b><span>8.4 GB</span></div>' +
                    '</div>' +
                    '<div class="pv__card">' +
                        '<div class="pv__console">' +
                            '<div>[Waise] Servidor iniciado correctamente.</div>' +
                            '<div>[Waise] Escuchando en 0.0.0.0:25565</div>' +
                            '<div class="pv__dim">Vista previa - datos de ejemplo</div>' +
                        '</div>' +
                        '<div class="pv__actions">' +
                            '<button class="pv__btn pv__btn--primary" type="button">Iniciar</button>' +
                            '<button class="pv__btn" type="button">Reiniciar</button>' +
                        '</div>' +
                    '</div>' +
                '</section>' +
            '</div>' +
            '<div class="pv__copy"></div>' +
        '</div>';

    var PREVIEW_BASE_CSS =
        ':host{all:initial;display:block;height:100%;}' +
        '*{box-sizing:border-box;margin:0;padding:0;}' +
        '.pv{min-height:100%;display:flex;flex-direction:column;font-size:13px;' +
            'font-family:var(--waise-font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);' +
            'color:var(--waise-text);background-color:var(--waise-bg);' +
            'background-image:var(--waise-bg-image);background-size:cover;background-position:center;}' +
        '.pv__top{display:flex;align-items:center;gap:12px;padding:12px 16px;' +
            'background:var(--waise-surface);border-bottom:1px solid rgba(255,255,255,.08);}' +
        '.pv__brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;margin-right:auto;}' +
        '.pv__logo{height:24px;max-width:140px;object-fit:contain;display:block;}' +
        '.pv__nav{display:flex;gap:14px;color:var(--waise-muted);font-size:12px;}' +
        '.pv__main{flex:1 1 auto;display:flex;min-height:0;gap:14px;padding:14px;}' +
        '.pv__side{flex:0 0 auto;width:var(--waise-sidebar-width);display:flex;flex-direction:column;gap:4px;' +
            'padding:10px;border-radius:var(--waise-radius);background:var(--waise-surface);' +
            'backdrop-filter:blur(var(--waise-blur));}' +
        '.pv__item{padding:8px 10px;border-radius:calc(var(--waise-radius) * .6);color:var(--waise-muted);}' +
        '.pv__item--active{background:var(--waise-accent);color:#fff;font-weight:600;}' +
        '.pv__content{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:12px;}' +
        '.pv__stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}' +
        '.pv__stat{padding:12px;border-radius:var(--waise-radius);background:var(--waise-surface);' +
            'display:flex;flex-direction:column;gap:4px;border-top:2px solid var(--waise-accent-2);}' +
        '.pv__stat b{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--waise-muted);}' +
        '.pv__stat span{font-size:17px;font-weight:700;}' +
        '.pv__card{flex:1 1 auto;padding:14px;border-radius:var(--waise-radius);background:var(--waise-surface);' +
            'backdrop-filter:blur(var(--waise-blur));display:flex;flex-direction:column;gap:12px;}' +
        '.pv__console{flex:1 1 auto;min-height:110px;padding:10px;border-radius:calc(var(--waise-radius) * .6);' +
            'background:rgba(0,0,0,.45);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.7;}' +
        '.pv__dim{color:var(--waise-muted);}' +
        '.pv__actions{display:flex;gap:8px;}' +
        '.pv__btn{padding:8px 16px;border-radius:calc(var(--waise-radius) * .6);border:1px solid var(--waise-muted);' +
            'background:transparent;color:var(--waise-text);font:inherit;font-weight:600;cursor:default;}' +
        '.pv__btn--primary{background:var(--waise-accent);border-color:transparent;color:#fff;}' +
        '.pv__copy{padding:8px 16px;font-size:11px;color:var(--waise-muted);opacity:.75;}' +
        '@media (max-width:700px){.pv__main{flex-direction:column;}.pv__side{width:auto;}' +
            '.pv__stats{grid-template-columns:1fr;}}';

    function previewVars(c) {
        var bgImage = c.bgImage
            ? 'linear-gradient(rgba(0,0,0,' + c.bgOverlay + '),rgba(0,0,0,' + c.bgOverlay + ')),url("' + c.bgImage + '")'
            : 'none';
        return ':host{' +
            '--waise-accent:' + c.accent + ';' +
            '--waise-accent-2:' + c.accent2 + ';' +
            '--waise-bg:' + c.bg + ';' +
            '--waise-surface:' + c.surface + ';' +
            '--waise-text:' + c.text + ';' +
            '--waise-muted:' + c.muted + ';' +
            '--waise-radius:' + c.radius + 'px;' +
            '--waise-blur:' + c.blur + 'px;' +
            '--waise-sidebar-width:' + c.sidebarWidth + 'px;' +
            '--waise-bg-image:' + bgImage + ';' +
            (c.font ? '--waise-font:"' + c.font + '",system-ui,sans-serif;' : '') +
            '}';
    }

    function updatePreview() {
        if (!shadow) return;
        previewStyle.textContent = previewVars(config) + PREVIEW_BASE_CSS;

        var logo = shadow.querySelector('.pv__logo');
        if (config.logoUrl) {
            logo.src = config.logoUrl;
            logo.hidden = false;
        } else {
            logo.hidden = true;
            logo.removeAttribute('src');
        }
        logo.onerror = function () { logo.hidden = true; };

        shadow.querySelector('.pv__brandname').textContent = config.brandName || 'Tu Panel';
        shadow.querySelector('.pv__copy').textContent = config.copyright || '';
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
                    '<div class="waise-ed__stage"></div>' +
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

        document.body.appendChild(root);

        var stage = root.querySelector('.waise-ed__stage');
        shadow = stage.attachShadow({ mode: 'open' });
        previewStyle = document.createElement('style');
        shadow.appendChild(previewStyle);
        var holder = document.createElement('div');
        holder.innerHTML = PREVIEW_MARKUP;
        shadow.appendChild(holder.firstChild);

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