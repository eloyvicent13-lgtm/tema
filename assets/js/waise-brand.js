/* ==========================================================================
   Waise Theme - assets/js/waise-brand.js
   Aplica la configuracion de marca generada por el Theme Editor.
   Lee window.WaiseConfig (waise-config.js, estatico). Si no existe, no hace
   nada: el tema sigue funcionando con sus valores por defecto.
   ========================================================================== */
(function () {
    'use strict';

    var cfg = window.WaiseConfig;
    if (!cfg || typeof cfg !== 'object') return;

    var LOGO_FLAG = 'waiseLogo';

    function applyFavicon() {
        if (!cfg.faviconUrl) return;
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
        try {
            applyLogo();
            applyCopyright();
        } catch (e) { /* nunca bloquear el render del panel */ }
    }

    function init() {
        applyFavicon();
        apply();

        /* React re-monta la barra de navegacion al cambiar de seccion y se
           lleva por delante el logo inyectado. */
        var pending = false;
        var observer = new MutationObserver(function () {
            if (pending) return;
            pending = true;
            window.requestAnimationFrame(function () {
                pending = false;
                apply();
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