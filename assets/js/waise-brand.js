/* ==========================================================================
   Waise Theme - assets/js/waise-brand.js
   Aplica la configuracion de marca generada por el Theme Editor.
   Lee window.WaiseConfig (waise-config.js, estatico). Si no existe, no hace
   nada: el tema sigue funcionando con sus valores por defecto.

   Modo previsualizacion: si la URL trae ?waise-preview=1, se lee el borrador
   que el Theme Editor deja en localStorage y se aplica ENCIMA de la config
   publicada. Asi el admin ve el tema sobre su panel real (sus servidores, sus
   datos) sin publicar nada para el resto de usuarios. El borrador es local al
   navegador: ningun otro usuario lo ve.
   ========================================================================== */
(function () {
    'use strict';

    var PREVIEW_KEY = 'waise:preview-draft';
    var LOGO_FLAG = 'waiseLogo';

    var published = (window.WaiseConfig && typeof window.WaiseConfig === 'object')
        ? window.WaiseConfig
        : null;

    var isPreview = /[?&]waise-preview=1(?:&|$)/.test(window.location.search);

    var cfg = published;
    var previewStyle = null;
    var previewBadge = null;

    /* --- Borrador de previsualizacion ------------------------------------ */

    function readDraft() {
        try {
            var raw = window.localStorage.getItem(PREVIEW_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    function merge(base, extra) {
        var out = {};
        var key;
        for (key in base) {
            if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key];
        }
        for (key in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, key)) out[key] = extra[key];
        }
        return out;
    }

    /* Espejo en JS de waise_build_css() de theme.php: mismas variables, mismo
       orden. Si alli se anade una variable, hay que anadirla aqui tambien o la
       vista previa mentira sobre ese valor. */
    function previewCss(c) {
        var bgImage = c.bgImage
            ? 'linear-gradient(rgba(0,0,0,' + c.bgOverlay + '),rgba(0,0,0,' + c.bgOverlay + ')),url(' + c.bgImage + ')'
            : 'none';

        var css = ':root{' +
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
            '--waise-fx-surface:' + c.surface + ';' +
            '--waise-fx-text:' + c.text + ';' +
            '--waise-fx-muted:' + c.muted + ';' +
            (c.font ? "--waise-font:'" + c.font + "',system-ui,sans-serif;" : '') +
            '}' +
            'body{background-color:var(--waise-bg);background-image:var(--waise-bg-image);' +
            'background-size:cover;background-position:center;background-attachment:fixed;}';

        if (c.font) {
            css += 'body,.waise-server-nav,.waise-main-nav{font-family:var(--waise-font);}';
        }
        return css;
    }

    function ensureBadge() {
        if (previewBadge && previewBadge.isConnected) return;
        previewBadge = document.createElement('div');
        previewBadge.className = 'waise-preview-badge';
        previewBadge.textContent = 'Vista previa - cambios sin publicar';
        document.body.appendChild(previewBadge);
    }

    function applyPreview() {
        var draft = readDraft();
        if (!draft) return;

        cfg = published ? merge(published, draft) : draft;

        if (!previewStyle || !previewStyle.isConnected) {
            previewStyle = document.createElement('style');
            previewStyle.id = 'waise-preview-style';
            document.head.appendChild(previewStyle);
        }
        previewStyle.textContent = previewCss(cfg);

        /* La marca ya inyectada corresponde al borrador anterior: se retira
           para volver a pintarla con los valores nuevos. */
        var anchor = document.querySelector('.waise-brand');
        if (anchor) {
            var logo = anchor.querySelector('.waise-brand__logo');
            var name = anchor.querySelector('.waise-brand__name');
            if (logo) anchor.removeChild(logo);
            if (name) anchor.removeChild(name);
            anchor.classList.remove('waise-brand--has-logo', 'waise-brand--has-name');
            delete anchor.dataset[LOGO_FLAG];
        }
        if (footerEl && footerEl.parentNode) {
            footerEl.parentNode.removeChild(footerEl);
            footerEl = null;
        }

        applyFavicon();
        apply();
        ensureBadge();
    }

    /* --- Marca ------------------------------------------------------------ */

    function applyFavicon() {
        if (!cfg || !cfg.faviconUrl) return;
        var links = document.querySelectorAll('link[rel~="icon"]');
        if (links.length) {
            for (var i = 0; i < links.length; i++) links[i].href = cfg.faviconUrl;
            return;
        }
        var link = document.createElement('link');
        link.rel = 'icon';
        link.href = cfg.faviconUrl;
        document.head.appendChild(link);
    }

    function findBrandAnchor() {
        var nav = document.querySelector('[class*="NavigationBar"], #navigation, body > nav');
        if (!nav) return null;
        var links = nav.querySelectorAll('a[href="/"], a[href="/index"]');
        for (var i = 0; i < links.length; i++) {
            /* El primero a la izquierda es el logotipo; los de la derecha son
               navegacion y no deben tocarse. */
            if (links[i].getBoundingClientRect().left < 320) return links[i];
        }
        return links.length ? links[0] : null;
    }

    function applyLogo() {
        if (!cfg.logoUrl && !cfg.brandName) return;
        var anchor = findBrandAnchor();
        if (!anchor || anchor.dataset[LOGO_FLAG]) return;
        anchor.dataset[LOGO_FLAG] = '1';
        anchor.classList.add('waise-brand');

        if (cfg.logoUrl) {
            var img = document.createElement('img');
            img.className = 'waise-brand__logo';
            img.src = cfg.logoUrl;
            img.alt = cfg.brandName || 'Logo';
            /* Si la URL esta rota se retira: mejor el texto original que un
               icono de imagen partida en la barra superior. */
            img.addEventListener('error', function () {
                if (img.parentNode) img.parentNode.removeChild(img);
                anchor.classList.remove('waise-brand--has-logo');
            });
            anchor.insertBefore(img, anchor.firstChild);
            anchor.classList.add('waise-brand--has-logo');
        }

        if (cfg.brandName) {
            var label = document.createElement('span');
            label.className = 'waise-brand__name';
            label.textContent = cfg.brandName;
            anchor.appendChild(label);
            anchor.classList.add('waise-brand--has-name');
        }
    }

    var footerEl = null;

    function applyCopyright() {
        if (!cfg.copyright) return;
        if (footerEl && footerEl.isConnected) return;
        footerEl = document.createElement('div');
        footerEl.className = 'waise-copyright';
        footerEl.textContent = cfg.copyright;
        document.body.appendChild(footerEl);
    }

    function apply() {
        if (!cfg) return;
        try {
            applyLogo();
            applyCopyright();
        } catch (e) { /* nunca bloquear el render del panel */ }
    }

    function init() {
        if (isPreview) applyPreview();

        applyFavicon();
        apply();

        /* El editor escribe el borrador en otra pestana: 'storage' solo se
           emite en las pestanas distintas de la que escribio, que es
           exactamente lo que queremos aqui. */
        if (isPreview) {
            window.addEventListener('storage', function (ev) {
                if (ev.key === PREVIEW_KEY) applyPreview();
            });
        }

        /* React re-monta la barra de navegacion al cambiar de seccion y se
           lleva por delante el logo inyectado. */
        var pending = false;
        var observer = new MutationObserver(function () {
            if (pending) return;
            pending = true;
            window.requestAnimationFrame(function () {
                pending = false;
                apply();
                if (isPreview) ensureBadge();
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();