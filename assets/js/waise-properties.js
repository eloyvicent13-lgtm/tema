/* ---------------------------------------------------------------------------
   Waise Theme - assets/js/waise-properties.js

   Editor visual de server.properties (Minecraft).

   El archivo se reescribe LINEA A LINEA: se conservan comentarios, lineas en
   blanco, el orden original y cualquier clave desconocida. Solo se sustituye
   el valor de las claves que el usuario ha tocado. Nunca se regenera el
   fichero desde cero, porque eso borraria la configuracion de plugins y
   forks (Paper, Purpur) que anaden claves propias.

   Deteccion de Minecraft: existe /server.properties en la raiz. Sin adivinar
   por el nombre del egg, que cada admin renombra a su gusto.
   --------------------------------------------------------------------------- */
(function () {
    'use strict';

    var FILE = '/server.properties';

    /* Icono de la entrada lateral: trazo con currentColor para heredar el
       color de la nav, como los SVG nativos del panel. */
    var NAV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 6h9"/><path d="M19 6h1"/><circle cx="16" cy="6" r="2"/>' +
        '<path d="M4 12h3"/><path d="M13 12h7"/><circle cx="10" cy="12" r="2"/>' +
        '<path d="M4 18h9"/><path d="M19 18h1"/><circle cx="16" cy="18" r="2"/></svg>';

    function api() {
        return window.WaiseApi || null;
    }

    function enabled() {
        var cfg = window.WaiseConfig;
        if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'featProperties')) {
            return cfg.featProperties !== false;
        }
        return true;
    }

    function notify(message, kind) {
        if (window.Waise && typeof window.Waise.toast === 'function') {
            window.Waise.toast(message, kind);
        }
    }

    /* --- Esquema de claves ------------------------------------------------ */

    /* type: bool | int | enum | text. min/max solo para int (los que tienen
       rango real en el juego; el resto se queda como numero libre).
       Los valores de enum son los que acepta el servidor vanilla. */
    var SCHEMA = {
        'motd': {
            group: 'General', type: 'text',
            label: 'Mensaje del servidor (MOTD)',
            help: 'Texto que se ve en la lista de servidores. Admite codigos de color con §.'
        },
        'max-players': {
            group: 'General', type: 'int', min: 1, max: 200,
            label: 'Jugadores maximos',
            help: 'Numero de jugadores simultaneos. Subirlo no aumenta la RAM disponible.'
        },
        'gamemode': {
            group: 'Juego', type: 'enum',
            values: ['survival', 'creative', 'adventure', 'spectator'],
            label: 'Modo de juego',
            help: 'Modo con el que entran los jugadores nuevos.'
        },
        'difficulty': {
            group: 'Juego', type: 'enum',
            values: ['peaceful', 'easy', 'normal', 'hard'],
            label: 'Dificultad',
            help: 'En pacifico no aparecen monstruos hostiles y el hambre no baja.'
        },
        'hardcore': {
            group: 'Juego', type: 'bool',
            label: 'Modo extremo',
            help: 'Al morir, el jugador pasa a espectador de forma permanente.'
        },
        'force-gamemode': {
            group: 'Juego', type: 'bool',
            label: 'Forzar modo de juego',
            help: 'Devuelve a los jugadores al modo por defecto cada vez que entran.'
        },
        'pvp': {
            group: 'Juego', type: 'bool',
            label: 'PvP entre jugadores',
            help: 'Si se desactiva, los jugadores no pueden danarse entre si.'
        },
        'allow-flight': {
            group: 'Juego', type: 'bool',
            label: 'Permitir vuelo',
            help: 'Necesario si usas plugins o mods de vuelo; si no, el servidor expulsa por trampas.'
        },
        'allow-nether': {
            group: 'Juego', type: 'bool',
            label: 'Permitir el Nether',
            help: 'Desactivarlo inutiliza los portales del Nether.'
        },
        'spawn-monsters': {
            group: 'Juego', type: 'bool',
            label: 'Generar monstruos',
            help: 'Independiente de la dificultad; en pacifico no tiene efecto.'
        },
        'spawn-animals': {
            group: 'Juego', type: 'bool',
            label: 'Generar animales',
            help: 'Afecta solo a la generacion natural, no a la cria.'
        },
        'spawn-npcs': {
            group: 'Juego', type: 'bool',
            label: 'Generar aldeanos',
            help: 'Desactivarlo impide que aparezcan aldeanos en las aldeas nuevas.'
        },
        'enable-command-block': {
            group: 'Juego', type: 'bool',
            label: 'Bloques de comandos',
            help: 'Necesario para mapas de aventura y muchos datapacks.'
        },
        'level-name': {
            group: 'Mundo', type: 'text',
            label: 'Carpeta del mundo',
            help: 'Nombre de la carpeta del mundo. Cambiarlo crea un mundo nuevo vacio.'
        },
        'level-seed': {
            group: 'Mundo', type: 'text',
            label: 'Semilla',
            help: 'Solo se aplica al generar un mundo nuevo. Vacio = semilla aleatoria.'
        },
        'level-type': {
            group: 'Mundo', type: 'enum',
            values: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes',
                     'minecraft:amplified', 'minecraft:single_biome_surface'],
            label: 'Tipo de mundo',
            help: 'Solo afecta a los trozos de mundo aun no generados.'
        },
        'generate-structures': {
            group: 'Mundo', type: 'bool',
            label: 'Generar estructuras',
            help: 'Aldeas, fortalezas, templos. No afecta a lo ya generado.'
        },
        'max-world-size': {
            group: 'Mundo', type: 'int', min: 1, max: 29999984,
            label: 'Radio maximo del mundo',
            help: 'Radio en bloques desde el centro. Limita el tamano en disco.'
        },
        'view-distance': {
            group: 'Rendimiento', type: 'int', min: 2, max: 32,
            label: 'Distancia de vision',
            help: 'Chunks enviados a cada jugador. Es el ajuste que mas CPU y RAM consume.'
        },
        'simulation-distance': {
            group: 'Rendimiento', type: 'int', min: 2, max: 32,
            label: 'Distancia de simulacion',
            help: 'Chunks donde corren mobs, cultivos y redstone. Bajarlo alivia mucho el lag.'
        },
        'max-tick-time': {
            group: 'Rendimiento', type: 'int', min: -1, max: 600000,
            label: 'Tiempo maximo por tick (ms)',
            help: 'El watchdog cierra el servidor si un tick tarda mas. -1 lo desactiva.'
        },
        'entity-broadcast-range-percentage': {
            group: 'Rendimiento', type: 'int', min: 10, max: 1000,
            label: 'Alcance de entidades (%)',
            help: 'Distancia a la que se envian las entidades al cliente. Bajarlo reduce ancho de banda.'
        },
        'network-compression-threshold': {
            group: 'Rendimiento', type: 'int', min: -1, max: 1500,
            label: 'Umbral de compresion (bytes)',
            help: 'Paquetes mayores se comprimen. -1 desactiva; 256 es el valor por defecto.'
        },
        'sync-chunk-writes': {
            group: 'Rendimiento', type: 'bool',
            label: 'Escritura sincrona de chunks',
            help: 'Desactivarlo mejora el rendimiento en disco lento, con mas riesgo si el servidor cae de golpe.'
        },
        'server-port': {
            group: 'Red', type: 'int', min: 1, max: 65535,
            label: 'Puerto del servidor',
            help: 'Debe coincidir con la asignacion del panel; cambiarlo a ciegas deja el servidor inaccesible.'
        },
        'server-ip': {
            group: 'Red', type: 'text',
            label: 'IP de escucha',
            help: 'Dejalo vacio salvo que sepas exactamente por que lo cambias.'
        },
        'online-mode': {
            group: 'Red', type: 'bool',
            label: 'Modo online (autenticacion)',
            help: 'Desactivarlo permite entrar sin cuenta de Minecraft y sin verificar identidad: solo detras de un proxy.'
        },
        'enforce-secure-profile': {
            group: 'Red', type: 'bool',
            label: 'Exigir perfil firmado',
            help: 'Rechaza clientes sin firma de chat. Suele desactivarse en servidores con proxy o mods.'
        },
        'prevent-proxy-connections': {
            group: 'Red', type: 'bool',
            label: 'Bloquear conexiones por proxy',
            help: 'Rechaza jugadores cuya IP no coincide con la de su sesion de Mojang.'
        },
        'enable-status': {
            group: 'Red', type: 'bool',
            label: 'Responder al ping',
            help: 'Si se desactiva, el servidor aparece offline en la lista aunque este encendido.'
        },
        'enable-query': {
            group: 'Red', type: 'bool',
            label: 'Protocolo Query',
            help: 'Permite que webs externas lean estadisticas del servidor.'
        },
        'query.port': {
            group: 'Red', type: 'int', min: 1, max: 65535,
            label: 'Puerto de Query',
            help: 'Solo se usa si Query esta activado.'
        },
        'enable-rcon': {
            group: 'Red', type: 'bool',
            label: 'RCON remoto',
            help: 'Consola remota. Actívalo solo con contrasena fuerte: da control total del servidor.'
        },
        'rcon.port': {
            group: 'Red', type: 'int', min: 1, max: 65535,
            label: 'Puerto de RCON',
            help: 'Solo se usa si RCON esta activado.'
        },
        'rcon.password': {
            group: 'Red', type: 'text', secret: true,
            label: 'Contrasena de RCON',
            help: 'Quien la tenga puede ejecutar cualquier comando como consola.'
        },
        'white-list': {
            group: 'Acceso', type: 'bool',
            label: 'Lista blanca',
            help: 'Solo entran los jugadores de whitelist.json.'
        },
        'enforce-whitelist': {
            group: 'Acceso', type: 'bool',
            label: 'Aplicar lista blanca al momento',
            help: 'Expulsa a los jugadores conectados que no esten en la lista.'
        },
        'op-permission-level': {
            group: 'Acceso', type: 'int', min: 1, max: 4,
            label: 'Nivel de permisos de OP',
            help: '1 saltar spawn protegido, 2 comandos de un solo jugador, 3 moderacion, 4 todo.'
        },
        'function-permission-level': {
            group: 'Acceso', type: 'int', min: 1, max: 4,
            label: 'Nivel de permisos de funciones',
            help: 'Nivel con el que se ejecutan las funciones de datapacks.'
        },
        'spawn-protection': {
            group: 'Acceso', type: 'int', min: 0, max: 256,
            label: 'Radio de proteccion del spawn',
            help: 'Bloques alrededor del spawn que solo los OP pueden modificar. 0 lo desactiva.'
        },
        'player-idle-timeout': {
            group: 'Acceso', type: 'int', min: 0, max: 1440,
            label: 'Expulsar por inactividad (min)',
            help: '0 desactiva la expulsion automatica.'
        },
        'max-chained-neighbor-updates': {
            group: 'Rendimiento', type: 'int', min: -1, max: 1000000,
            label: 'Actualizaciones encadenadas maximas',
            help: 'Corta cadenas de redstone descontroladas que congelan el servidor.'
        },
        'broadcast-console-to-ops': {
            group: 'General', type: 'bool',
            label: 'Mostrar comandos de consola a los OP',
            help: 'Los OP conectados ven lo que se ejecuta desde la consola.'
        },
        'broadcast-rcon-to-ops': {
            group: 'General', type: 'bool',
            label: 'Mostrar comandos RCON a los OP',
            help: 'Igual que el anterior, pero para los comandos que llegan por RCON.'
        },
        'hide-online-players': {
            group: 'General', type: 'bool',
            label: 'Ocultar lista de conectados',
            help: 'El ping no revela los nombres de quienes estan jugando.'
        },
        'require-resource-pack': {
            group: 'General', type: 'bool',
            label: 'Exigir paquete de recursos',
            help: 'Expulsa a quien lo rechace. Requiere una URL valida abajo.'
        },
        'resource-pack': {
            group: 'General', type: 'text',
            label: 'URL del paquete de recursos',
            help: 'Enlace directo al .zip. Debe ser accesible publicamente.'
        },
        'resource-pack-prompt': {
            group: 'General', type: 'text',
            label: 'Mensaje del paquete de recursos',
            help: 'Texto que ve el jugador al pedirle que lo descargue.'
        },
        'enable-jmx-monitoring': {
            group: 'Rendimiento', type: 'bool',
            label: 'Monitorizacion JMX',
            help: 'Expone metricas de la JVM. Util solo si tienes herramientas que las lean.'
        },
        'log-ips': {
            group: 'Red', type: 'bool',
            label: 'Registrar IPs en el log',
            help: 'Desactivarlo reduce datos personales en los logs.'
        },
        'use-native-transport': {
            group: 'Rendimiento', type: 'bool',
            label: 'Transporte nativo (Linux)',
            help: 'Optimizacion de red en Linux. Dejalo activado salvo problemas raros de conexion.'
        },
        'text-filtering-config': {
            group: 'General', type: 'text',
            label: 'Configuracion de filtrado de texto',
            help: 'Ruta a la configuracion del filtro de chat. Normalmente vacio.'
        },
        'initial-enabled-packs': {
            group: 'Mundo', type: 'text',
            label: 'Packs activados al crear el mundo',
            help: 'Lista separada por comas. Solo se aplica al generar el mundo.'
        },
        'initial-disabled-packs': {
            group: 'Mundo', type: 'text',
            label: 'Packs desactivados al crear el mundo',
            help: 'Lista separada por comas. Solo se aplica al generar el mundo.'
        }
    };

    var GROUP_ORDER = ['General', 'Juego', 'Mundo', 'Rendimiento', 'Red', 'Acceso', 'Otros'];

    /* Claves que dejan el servidor inaccesible o inseguro si se tocan a ciegas. */
    var RISKY = {
        'server-port': 'Cambiar el puerto sin actualizar la asignacion del panel deja el servidor inaccesible.',
        'server-ip': 'Una IP de escucha incorrecta impide todas las conexiones.',
        'online-mode': 'Desactivar el modo online permite entrar suplantando a cualquier jugador.',
        'level-name': 'Cambiar la carpeta del mundo hace que el servidor arranque con un mundo nuevo y vacio.'
    };

    /* --- Parseo y serializado -------------------------------------------- */

    /* Cada linea se guarda tal cual. Solo las de tipo 'pair' se reescriben, y
       solo si su valor ha cambiado. Asi el diff en disco es minimo. */
    function parse(raw) {
        var lines = String(raw === null || raw === undefined ? '' : raw).split(/\r?\n/);
        var out = [];
        var index = {};
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var trimmed = line.trim();
            if (!trimmed || trimmed.charAt(0) === '#' || trimmed.charAt(0) === '!') {
                out.push({ kind: 'raw', text: line });
                continue;
            }
            var eq = line.indexOf('=');
            if (eq === -1) {
                out.push({ kind: 'raw', text: line });
                continue;
            }
            var key = line.slice(0, eq).trim();
            if (!key) {
                out.push({ kind: 'raw', text: line });
                continue;
            }
            var entry = { kind: 'pair', key: key, value: line.slice(eq + 1) };
            /* Clave repetida: gana la ultima, que es la que lee el servidor. */
            index[key] = entry;
            out.push(entry);
        }
        return { lines: out, index: index };
    }

    function serialize(doc) {
        var out = [];
        for (var i = 0; i < doc.lines.length; i++) {
            var item = doc.lines[i];
            out.push(item.kind === 'pair' ? item.key + '=' + item.value : item.text);
        }
        return out.join('\n');
    }

    /* --- Interfaz --------------------------------------------------------- */

    var overlay = null;

    function closeEditor() {
        if (!overlay) return false;
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        return true;
    }

    function metaFor(key) {
        var meta = SCHEMA[key];
        if (meta) return meta;
        return { group: 'Otros', type: 'text', label: key, help: 'Clave no reconocida; se edita como texto.' };
    }

    function isBoolValue(value) {
        var v = String(value).trim().toLowerCase();
        return v === 'true' || v === 'false';
    }

    function buildField(entry, meta, onChange) {
        var wrap = document.createElement('div');
        wrap.className = 'waise-props__field';

        var type = meta.type;
        /* Si el esquema dice bool pero el fichero trae otra cosa (un fork con
           otro formato), se edita como texto: mejor eso que corromperlo. */
        if (type === 'bool' && !isBoolValue(entry.value)) type = 'text';
        if (type === 'enum' && meta.values.indexOf(entry.value.trim()) === -1) type = 'text';

        if (type === 'bool') {
            var label = document.createElement('label');
            label.className = 'waise-props__switch';

            var box = document.createElement('input');
            box.type = 'checkbox';
            box.className = 'waise-props__checkbox';
            box.checked = entry.value.trim().toLowerCase() === 'true';

            var track = document.createElement('span');
            track.className = 'waise-props__track';
            track.setAttribute('aria-hidden', 'true');

            var state = document.createElement('span');
            state.className = 'waise-props__state';
            state.textContent = box.checked ? 'Activado' : 'Desactivado';

            box.addEventListener('change', function () {
                state.textContent = box.checked ? 'Activado' : 'Desactivado';
                onChange(box.checked ? 'true' : 'false');
            });

            label.appendChild(box);
            label.appendChild(track);
            label.appendChild(state);
            wrap.appendChild(label);
            return wrap;
        }

        if (type === 'enum') {
            var select = document.createElement('select');
            select.className = 'waise-props__select';
            for (var i = 0; i < meta.values.length; i++) {
                var opt = document.createElement('option');
                opt.value = meta.values[i];
                opt.textContent = meta.values[i];
                select.appendChild(opt);
            }
            select.value = entry.value.trim();
            select.addEventListener('change', function () { onChange(select.value); });
            wrap.appendChild(select);
            return wrap;
        }

        if (type === 'int') {
            var current = parseInt(entry.value, 10);
            if (isNaN(current)) current = meta.min !== undefined ? meta.min : 0;

            var row = document.createElement('div');
            row.className = 'waise-props__range';

            var number = document.createElement('input');
            number.type = 'number';
            number.className = 'waise-props__number';
            if (meta.min !== undefined) number.min = String(meta.min);
            if (meta.max !== undefined) number.max = String(meta.max);
            number.value = String(current);

            var slider = null;
            /* Un slider de 0 a 29999984 no sirve para nada: solo se pone
               cuando el rango es manejable a mano. */
            if (meta.min !== undefined && meta.max !== undefined && (meta.max - meta.min) <= 2000) {
                slider = document.createElement('input');
                slider.type = 'range';
                slider.className = 'waise-props__slider';
                slider.min = String(meta.min);
                slider.max = String(meta.max);
                slider.value = String(current);
                slider.setAttribute('aria-label', meta.label);
            }

            function commit(value) {
                var n = parseInt(value, 10);
                if (isNaN(n)) return;
                if (meta.min !== undefined && n < meta.min) n = meta.min;
                if (meta.max !== undefined && n > meta.max) n = meta.max;
                if (number.value !== String(n)) number.value = String(n);
                if (slider && slider.value !== String(n)) slider.value = String(n);
                onChange(String(n));
            }

            number.addEventListener('change', function () { commit(number.value); });
            if (slider) slider.addEventListener('input', function () { commit(slider.value); });

            if (slider) row.appendChild(slider);
            row.appendChild(number);
            wrap.appendChild(row);
            return wrap;
        }

        var input = document.createElement('input');
        input.type = meta.secret ? 'password' : 'text';
        input.className = 'waise-props__input';
        input.value = entry.value;
        input.spellcheck = false;
        input.setAttribute('aria-label', meta.label);
        input.addEventListener('input', function () { onChange(input.value); });
        wrap.appendChild(input);

        if (meta.secret) {
            var reveal = document.createElement('button');
            reveal.type = 'button';
            reveal.className = 'waise-props__reveal';
            reveal.textContent = 'Ver';
            reveal.addEventListener('click', function () {
                var shown = input.getAttribute('type') === 'text';
                input.setAttribute('type', shown ? 'password' : 'text');
                reveal.textContent = shown ? 'Ver' : 'Ocultar';
            });
            wrap.appendChild(reveal);
        }
        return wrap;
    }

    function buildRow(entry, dirty, markDirty) {
        var meta = metaFor(entry.key);
        var original = entry.value;

        var row = document.createElement('div');
        row.className = 'waise-props__row';

        var head = document.createElement('div');
        head.className = 'waise-props__head';

        var name = document.createElement('span');
        name.className = 'waise-props__label';
        name.textContent = meta.label;

        var key = document.createElement('code');
        key.className = 'waise-props__key';
        key.textContent = entry.key;

        head.appendChild(name);
        head.appendChild(key);

        var help = document.createElement('p');
        help.className = 'waise-props__help';
        help.textContent = meta.help;

        var badge = null;
        if (RISKY[entry.key]) {
            badge = document.createElement('p');
            badge.className = 'waise-props__warn';
            badge.textContent = RISKY[entry.key];
        }

        var field = buildField(entry, meta, function (value) {
            entry.value = value;
            var changed = value !== original;
            row.classList.toggle('waise-props__row--dirty', changed);
            markDirty(entry.key, changed);
        });

        var text = document.createElement('div');
        text.className = 'waise-props__text';
        text.appendChild(head);
        text.appendChild(help);
        if (badge) text.appendChild(badge);

        row.appendChild(text);
        row.appendChild(field);
        return row;
    }

    function render(box, doc, serverId) {
        var dirty = {};
        var dirtyCount = 0;

        var body = document.createElement('div');
        body.className = 'waise-props__body';

        var foot = document.createElement('div');
        foot.className = 'waise-props__foot';

        var status = document.createElement('span');
        status.className = 'waise-props__status';
        status.textContent = 'Sin cambios';

        var save = document.createElement('button');
        save.type = 'button';
        save.className = 'waise-props__save';
        save.textContent = 'Guardar';
        save.disabled = true;

        function markDirty(key, changed) {
            if (changed) {
                if (!dirty[key]) { dirty[key] = true; dirtyCount++; }
            } else if (dirty[key]) {
                delete dirty[key];
                dirtyCount--;
            }
            status.textContent = dirtyCount === 0
                ? 'Sin cambios'
                : dirtyCount + (dirtyCount === 1 ? ' cambio sin guardar' : ' cambios sin guardar');
            save.disabled = dirtyCount === 0;
        }

        /* Agrupado por seccion, respetando el orden del fichero dentro de
           cada grupo: asi el usuario reconoce lo que ya conocia. */
        var buckets = {};
        for (var i = 0; i < doc.lines.length; i++) {
            var entry = doc.lines[i];
            if (entry.kind !== 'pair') continue;
            var group = metaFor(entry.key).group;
            if (!buckets[group]) buckets[group] = [];
            buckets[group].push(entry);
        }

        var search = document.createElement('input');
        search.type = 'search';
        search.className = 'waise-props__search';
        search.placeholder = 'Buscar ajuste...';
        search.setAttribute('aria-label', 'Buscar ajuste');

        for (var g = 0; g < GROUP_ORDER.length; g++) {
            var groupName = GROUP_ORDER[g];
            var items = buckets[groupName];
            if (!items || !items.length) continue;

            var section = document.createElement('section');
            section.className = 'waise-props__group';
            section.setAttribute('data-waise-group', groupName);

            var title = document.createElement('h3');
            title.className = 'waise-props__gtitle';
            title.textContent = groupName;
            section.appendChild(title);

            for (var j = 0; j < items.length; j++) {
                section.appendChild(buildRow(items[j], dirty, markDirty));
            }
            body.appendChild(section);
        }

        search.addEventListener('input', function () {
            var needle = search.value.trim().toLowerCase();
            var sections = body.querySelectorAll('.waise-props__group');
            for (var s = 0; s < sections.length; s++) {
                var rows = sections[s].querySelectorAll('.waise-props__row');
                var shown = 0;
                for (var r = 0; r < rows.length; r++) {
                    var hit = !needle || (rows[r].textContent || '').toLowerCase().indexOf(needle) !== -1;
                    rows[r].classList.toggle('waise-hidden', !hit);
                    if (hit) shown++;
                }
                sections[s].classList.toggle('waise-hidden', shown === 0);
            }
        });

        save.addEventListener('click', function () {
            save.disabled = true;
            save.textContent = 'Guardando...';
            api().writeFile(serverId, FILE, serialize(doc)).then(function () {
                save.textContent = 'Guardar';
                notify('server.properties guardado. Reinicia el servidor para aplicarlo.', 'ok');
                /* Los valores guardados pasan a ser el nuevo original. */
                var rows = body.querySelectorAll('.waise-props__row--dirty');
                for (var i = 0; i < rows.length; i++) rows[i].classList.remove('waise-props__row--dirty');
                dirty = {};
                dirtyCount = 0;
                status.textContent = 'Guardado';
                closeEditor();
            }, function (err) {
                save.textContent = 'Guardar';
                save.disabled = false;
                notify('No se pudo guardar: ' + err.message, 'err');
            });
        });

        foot.appendChild(status);
        foot.appendChild(save);

        box.appendChild(search);
        box.appendChild(body);
        box.appendChild(foot);
    }

    function openEditor() {
        var serverId = window.Waise ? window.Waise.currentServerId() : null;
        if (!serverId || !api()) {
            notify('Abre un servidor para editar sus propiedades', 'err');
            return;
        }
        closeEditor();

        overlay = document.createElement('div');
        overlay.className = 'waise-props';
        overlay.addEventListener('mousedown', function (ev) {
            if (ev.target === overlay) closeEditor();
        });

        var box = document.createElement('div');
        box.className = 'waise-props__box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Editor de server.properties');

        var head = document.createElement('div');
        head.className = 'waise-props__title-row';

        var title = document.createElement('h2');
        title.className = 'waise-props__title';
        title.textContent = 'Propiedades del servidor';

        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'waise-props__close';
        close.setAttribute('aria-label', 'Cerrar');
        close.textContent = '\u00d7';
        close.addEventListener('click', closeEditor);

        head.appendChild(title);
        head.appendChild(close);

        var loading = document.createElement('p');
        loading.className = 'waise-props__loading';
        loading.textContent = 'Leyendo server.properties...';

        box.appendChild(head);
        box.appendChild(loading);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        api().readFile(serverId, FILE).then(function (raw) {
            if (!overlay) return;
            box.removeChild(loading);
            var doc = parse(raw);
            var pairs = 0;
            for (var i = 0; i < doc.lines.length; i++) {
                if (doc.lines[i].kind === 'pair') pairs++;
            }
            if (!pairs) {
                var empty = document.createElement('p');
                empty.className = 'waise-props__loading';
                empty.textContent = 'El archivo esta vacio o no contiene claves legibles.';
                box.appendChild(empty);
                return;
            }
            render(box, doc, serverId);
        }, function (err) {
            if (!overlay) return;
            loading.textContent = 'No se pudo leer server.properties: ' + err.message;
        });
    }

    /* --- Boton de acceso -------------------------------------------------- */

    var detected = {};

    function isFilesRoute() {
        return /^\/server\/[^/]+\/files/.test(window.location.pathname);
    }

    /* La entrada vive en la columna lateral (waise.js). Aqui solo se declara
       cuando debe verse: el pintado lo hace WaiseNav. */
    var navVisible = false;

    function registerNav() {
        if (!window.WaiseNav) {
            if (window.console) {
                window.console.warn('[waise-properties] WaiseNav no disponible; entrada lateral desactivada.');
            }
            return;
        }
        window.WaiseNav.register({
            id: 'properties',
            label: 'Propiedades',
            title: 'Editar server.properties',
            icon: NAV_ICON,
            visible: function () { return navVisible; },
            onClick: openEditor
        });
    }

    function setNavVisible(value) {
        navVisible = !!value;
        if (window.WaiseNav) window.WaiseNav.refresh();
    }

    /* La deteccion se cachea por servidor: sin esto se listaria la raiz en
       cada navegacion y el panel devuelve 429 con facilidad. */
    function syncButton() {
        if (!enabled() || !isFilesRoute()) { setNavVisible(false); return; }
        var serverId = window.Waise ? window.Waise.currentServerId() : null;
        if (!serverId) { setNavVisible(false); return; }

        if (detected[serverId] === true) { setNavVisible(true); return; }
        if (detected[serverId] === false) { setNavVisible(false); return; }
        if (detected[serverId] === 'pending') return;

        detected[serverId] = 'pending';
        api().exists(serverId, FILE).then(function (found) {
            detected[serverId] = !!(found && found.is_file !== false);
            syncButton();
        }, function () {
            /* Un fallo de deteccion (429, red, servidor suspendido) NO es un
               "no existe server.properties": cachear false ocultaba la entrada
               para el resto de la sesion. Se borra para que el siguiente
               syncButton reintente. */
            delete detected[serverId];
            setNavVisible(false);
        });
    }

    function init() {
        if (!api()) {
            if (window.console) window.console.warn('[waise-properties] WaiseApi no disponible; editor desactivado.');
            return;
        }

        registerNav();
        syncButton();
        window.addEventListener('popstate', syncButton);
        document.addEventListener('keydown', function (ev) {
            if (ev.key === 'Escape' && overlay) {
                ev.stopPropagation();
                closeEditor();
            }
        }, true);

        /* React Router navega con pushState, que no emite popstate: mismo
           parche que usan waise-features.js y waise-trash.js. */
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

    window.WaiseProperties = {
        open: openEditor,
        close: closeEditor,
        parse: parse,
        serialize: serialize
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();