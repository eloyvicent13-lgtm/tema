/* ==========================================================================
   Waise Theme - assets/js/waise-splitter.js

   Server Splitter (cliente). Registra una entrada en la columna del servidor
   via WaiseNav y abre un panel para repartir RAM/CPU/disco creando un
   servidor hijo.

   Todo el trabajo real lo hace /waise/api/splitter.php: este archivo NO puede
   cambiar limites por su cuenta (la API de cliente de Pterodactyl no expone
   nada de eso), solo pinta la interfaz y valida en local para dar respuesta
   inmediata. La validacion que cuenta es la del servidor.
   ========================================================================== */
(function () {
    'use strict';

    var ENDPOINT = '/waise/api/splitter.php';
    var NAV_ID   = 'waise-splitter';

    var ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3" y="3" width="8" height="8" rx="2"></rect>' +
        '<rect x="13" y="3" width="8" height="8" rx="2"></rect>' +
        '<rect x="3" y="13" width="8" height="8" rx="2"></rect>' +
        '<path d="M17 14v6M14 17h6"></path></svg>';

    var overlay = null;
    var busy    = false;

    function currentServerId() {
        var m = window.location.pathname.match(/^\/server\/([^/]+)/);
        return m ? m[1] : null;
    }

    function api(body) {
        return fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: JSON.stringify(body)
        }).then(function (res) {
            return res.json().catch(function () {
                return { error: 'Respuesta no valida del servidor (HTTP ' + res.status + ').' };
            }).then(function (data) {
                if (!res.ok || (data && data.error)) {
                    throw new Error((data && data.error) || 'Error HTTP ' + res.status + '.');
                }
                return data;
            });
        });
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function fmtMiB(value) {
        if (value >= 1024 && value % 1024 === 0) return (value / 1024) + ' GiB';
        if (value >= 1024) return (value / 1024).toFixed(1) + ' GiB';
        return value + ' MiB';
    }

    function close() {
        if (!overlay) return;
        document.removeEventListener('keydown', onKeydown, true);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        busy = false;
    }

    function onKeydown(ev) {
        if (ev.key === 'Escape' && !busy) {
            ev.preventDefault();
            close();
        }
    }

    /* --- Construccion del panel -------------------------------------------- */

    function buildRow(parent, label, unit, max, min, step) {
        var row = el('div', 'waise-split__row');

        var head = el('div', 'waise-split__rowhead');
        head.appendChild(el('span', 'waise-split__label', label));
        var out = el('span', 'waise-split__value');
        head.appendChild(out);
        row.appendChild(head);

        var range = document.createElement('input');
        range.type = 'range';
        range.className = 'waise-split__range';
        range.min = '0';
        range.max = String(max);
        range.step = String(step);
        range.value = '0';
        range.setAttribute('aria-label', label);
        row.appendChild(range);

        var hint = el('div', 'waise-split__hint');
        row.appendChild(hint);

        function render() {
            var v = parseInt(range.value, 10) || 0;
            /* Un valor entre 0 y el minimo no es aceptable: o no se cede nada
               o se cede lo suficiente para que el hijo arranque. */
            out.textContent = unit === '%' ? v + ' %' : fmtMiB(v);
            hint.textContent = 'Al original le quedan ' +
                (unit === '%' ? (max + min - v) + ' %' : fmtMiB(max + min - v));
            row.classList.toggle('is-zero', v === 0);
        }

        range.addEventListener('input', render);
        render();

        parent.appendChild(row);

        return { range: range, render: render };
    }

    function openPanel(info) {
        close();

        overlay = el('div', 'waise-split');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Dividir recursos del servidor');

        var box = el('div', 'waise-split__box');
        overlay.appendChild(box);

        var header = el('header', 'waise-split__header');
        header.appendChild(el('h2', 'waise-split__title', 'Dividir recursos'));
        var closeBtn = el('button', 'waise-split__close', '\u00d7');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Cerrar');
        closeBtn.addEventListener('click', function () { if (!busy) close(); });
        header.appendChild(closeBtn);
        box.appendChild(header);

        var body = el('div', 'waise-split__body');
        box.appendChild(body);

        body.appendChild(el('p', 'waise-split__intro',
            'Crea un servidor nuevo con parte de los recursos de "' + info.server.name +
            '". Lo que le des al nuevo se le resta a este: el total no cambia.'));

        var counter = el('p', 'waise-split__counter',
            'Divisiones usadas: ' + info.children.used + ' de ' + info.children.max);
        body.appendChild(counter);

        if (!info.canSplit) {
            var reason = 'Este servidor no se puede dividir ahora mismo.';
            if (info.unlimited && info.unlimited.length) {
                reason = 'Este servidor tiene ' + info.unlimited.join(' y ') +
                    ' sin limite, asi que no hay una cantidad concreta que repartir.';
            } else if (info.children.used >= info.children.max) {
                reason = 'Ya has alcanzado el maximo de ' + info.children.max + ' divisiones para este servidor.';
            } else if (!info.freeAllocations) {
                reason = 'No quedan puertos libres en este nodo. Avisa al administrador.';
            } else {
                reason = 'No hay recursos suficientes: el servidor original debe conservar al menos ' +
                    fmtMiB(info.limits.minParent.memory) + ' de RAM y ' +
                    fmtMiB(info.limits.minParent.disk) + ' de disco.';
            }
            body.appendChild(el('p', 'waise-split__error', reason));
            document.body.appendChild(overlay);
            document.addEventListener('keydown', onKeydown, true);
            closeBtn.focus();
            return;
        }

        var nameWrap = el('label', 'waise-split__field');
        nameWrap.appendChild(el('span', 'waise-split__label', 'Nombre del servidor nuevo'));
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'waise-split__input';
        nameInput.maxLength = 60;
        nameInput.value = info.server.name.slice(0, 40) + ' - parte ' + (info.children.used + 2);
        nameWrap.appendChild(nameInput);
        body.appendChild(nameWrap);

        var mem = buildRow(body, 'RAM para el nuevo', 'MiB',
            info.limits.maxGive.memory, info.limits.minParent.memory, 128);
        var cpu = buildRow(body, 'CPU para el nuevo', '%',
            info.limits.maxGive.cpu, info.limits.minParent.cpu, 5);
        var dsk = buildRow(body, 'Disco para el nuevo', 'MiB',
            info.limits.maxGive.disk, info.limits.minParent.disk, 512);

        var status = el('p', 'waise-split__status');
        status.setAttribute('role', 'status');
        body.appendChild(status);

        var footer = el('footer', 'waise-split__footer');
        var cancel = el('button', 'waise-split__btn', 'Cancelar');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { if (!busy) close(); });
        var submit = el('button', 'waise-split__btn waise-split__btn--primary', 'Dividir');
        submit.type = 'button';
        footer.appendChild(cancel);
        footer.appendChild(submit);
        box.appendChild(footer);

        submit.addEventListener('click', function () {
            if (busy) return;

            var payload = {
                action: 'split',
                server: currentServerId(),
                name: nameInput.value.trim(),
                memory: parseInt(mem.range.value, 10) || 0,
                cpu: parseInt(cpu.range.value, 10) || 0,
                disk: parseInt(dsk.range.value, 10) || 0
            };

            if (!payload.name) {
                status.className = 'waise-split__status is-error';
                status.textContent = 'Pon un nombre al servidor nuevo.';
                nameInput.focus();
                return;
            }
            if (payload.memory < info.limits.minChild.memory) {
                status.className = 'waise-split__status is-error';
                status.textContent = 'El servidor nuevo necesita al menos ' + fmtMiB(info.limits.minChild.memory) + ' de RAM.';
                return;
            }
            if (payload.disk < info.limits.minChild.disk) {
                status.className = 'waise-split__status is-error';
                status.textContent = 'El servidor nuevo necesita al menos ' + fmtMiB(info.limits.minChild.disk) + ' de disco.';
                return;
            }

            busy = true;
            submit.disabled = true;
            cancel.disabled = true;
            status.className = 'waise-split__status';
            status.textContent = 'Creando el servidor... esto puede tardar unos segundos.';

            api(payload).then(function (res) {
                busy = false;
                status.className = 'waise-split__status is-ok';
                status.textContent = 'Listo. "' + res.child.name + '" se esta instalando.';
                submit.textContent = 'Abrir servidor nuevo';
                submit.disabled = false;
                cancel.disabled = false;
                cancel.textContent = 'Cerrar';
                submit.onclick = function () { window.location.href = res.child.url; };
            }).catch(function (err) {
                busy = false;
                submit.disabled = false;
                cancel.disabled = false;
                status.className = 'waise-split__status is-error';
                status.textContent = err.message;
            });
        });

        overlay.addEventListener('mousedown', function (ev) {
            if (ev.target === overlay && !busy) close();
        });

        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKeydown, true);
        nameInput.focus();
        nameInput.select();
    }

    function openLoading() {
        close();
        overlay = el('div', 'waise-split');
        var box = el('div', 'waise-split__box waise-split__box--loading');
        box.appendChild(el('p', 'waise-split__status', 'Cargando...'));
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        document.addEventListener('keydown', onKeydown, true);
    }

    function open() {
        var id = currentServerId();
        if (!id) return;

        openLoading();

        api({ action: 'info', server: id }).then(function (info) {
            openPanel(info);
        }).catch(function (err) {
            close();
            overlay = el('div', 'waise-split');
            var box = el('div', 'waise-split__box');
            var header = el('header', 'waise-split__header');
            header.appendChild(el('h2', 'waise-split__title', 'Dividir recursos'));
            var closeBtn = el('button', 'waise-split__close', '\u00d7');
            closeBtn.type = 'button';
            closeBtn.setAttribute('aria-label', 'Cerrar');
            closeBtn.addEventListener('click', close);
            header.appendChild(closeBtn);
            box.appendChild(header);
            var bodyEl = el('div', 'waise-split__body');
            bodyEl.appendChild(el('p', 'waise-split__error', err.message));
            box.appendChild(bodyEl);
            overlay.appendChild(box);
            overlay.addEventListener('mousedown', function (ev) {
                if (ev.target === overlay) close();
            });
            document.body.appendChild(overlay);
            document.addEventListener('keydown', onKeydown, true);
            closeBtn.focus();
        });
    }

    function register() {
        if (!window.WaiseNav || typeof window.WaiseNav.register !== 'function') return false;
        window.WaiseNav.register({
            id: NAV_ID,
            icon: ICON,
            label: 'Dividir',
            title: 'Dividir recursos del servidor',
            visible: function () { return !!currentServerId(); },
            onClick: open
        });
        return true;
    }

    /* waise.js publica WaiseNav de forma sincrona al evaluarse, pero el orden
       de los <script defer> no esta garantizado si el instalador cambia: se
       reintenta una sola vez tras DOMContentLoaded en vez de sondear. */
    if (!register()) {
        document.addEventListener('DOMContentLoaded', register);
    }

    window.addEventListener('popstate', close);
})();