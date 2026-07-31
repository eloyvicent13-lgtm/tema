# Waise Theme

Tema moderno, oscuro y semitransparente (glassmorphism) para **Pterodactyl Panel 1.14.x**,
inspirado en el estilo Arix, con instalación y desinstalación automáticas mediante un comando.

- Panel de cliente (React + Tailwind) y panel de administración (AdminLTE) tematizados.
- **Navegación lateral estilo Arix**: el JS localiza el contenedor real de la barra y la
  convierte en una sidebar fija de 248 px a la izquierda. En tablet y móvil vuelve
  automáticamente al layout apilado nativo del panel.
- **Servidores como tarjetas de cristal (v1.4.0)**: la lista del dashboard pasa a una
  rejilla de tarjetas rectangulares semitransparentes con desenfoque y elevación al pasar
  el ratón.
- **Compatible con addons y plugins**: no modifica componentes React, rutas, controladores
  ni vistas Blade existentes. Solo añade un bloque `<link>` delimitado por marcadores
  dentro del `<head>`.
- Desinstalación quirúrgica: se elimina exactamente el bloque inyectado (o se restaura el
  backup original si lo prefieres).

## Requisitos

- Pterodactyl Panel 1.14.x instalado (por defecto en `/var/www/pterodactyl`).
- Linux con `bash`, `php`, `awk`, `sed` y acceso `root` (o `sudo`).
- `git` (necesario para `waise upgrade`).

## Instalación

    sudo apt install -y git
    git clone https://github.com/eloyvicent13-lgtm/tema.git waise-theme
    cd waise-theme
    sudo bash install.sh

> El instalador necesita el repositorio completo (`lib/`, `assets/` y `bin/` junto a
> `install.sh`), por lo que **no** se puede instalar descargando solo `install.sh` con `curl`.

Modo desatendido, indicando ruta y colores:

    sudo bash install.sh --path /var/www/pterodactyl --accent "#6f5cff" --accent2 "#17c9c9" -y

### Opciones del instalador

| Opción | Descripción |
| --- | --- |
| `--path DIR` | Ruta del panel (por defecto se autodetecta: `/var/www/pterodactyl`, `/var/www/panel`, ...). |
| `--accent #RRGGBB` | Color de acento principal. Por defecto `#6f5cff`. |
| `--accent2 #RRGGBB` | Color de acento secundario (degradados). Por defecto `#17c9c9`. |
| `-y`, `--yes` | No pedir confirmación (modo desatendido). |

## Desinstalación

El instalador registra el comando global `waise`:

    sudo waise uninstall

Opciones:

| Opción | Descripción |
| --- | --- |
| `--restore-backup` | Restaura los `.blade.php` originales desde el backup en vez de borrar solo el bloque. |
| `--purge` | Elimina además el comando `waise`, los archivos en `/usr/local/share/waise-theme` y los backups. |
| `--path DIR` | Ruta del panel si no hay estado guardado. |

También funciona directamente desde el repositorio:

    sudo bash uninstall.sh

## Actualizar el tema

    sudo waise upgrade

Descarga la última versión desde GitHub en `/var/lib/waise-theme/src` y reinstala
automáticamente, conservando la ruta del panel y los colores de acento guardados en el
estado. Acepta las mismas opciones que el instalador para cambiar de colores al vuelo:

    sudo waise upgrade --accent "#ff5c8a" --accent2 "#ffb35c"

Para probar otra rama del repositorio:

    WAISE_REPO_BRANCH=dev sudo -E waise upgrade

> `upgrade` descarga código nuevo y reaplica el tema; `update` solo reaplica la copia local
> ya instalada en `/usr/local/share/waise-theme` (útil tras actualizar el panel).

## Otros comandos

    sudo waise status      # muestra si el tema está activo, versión y rutas
    sudo waise update      # reinstala/actualiza con la copia local (idempotente)
    waise version

Tras cada actualización del panel (`php artisan up` incluido) reaplica el tema con
`sudo waise update`, ya que las vistas Blade se sobrescriben al actualizar.

## Personalización

El instalador genera `public/waise/css/waise-overrides.css` con las variables de acento.
Puedes editar ese archivo para ajustar colores, radios o intensidad del desenfoque:

    :root {
      --waise-accent: #6f5cff;
      --waise-accent-2: #17c9c9;
      --waise-blur: 14px;
      --waise-radius: 14px;
    }

Ese archivo se **sobrescribe** al reinstalar; si quieres cambios permanentes, edita
`assets/css/waise.css` en el repositorio y vuelve a ejecutar el instalador.

## Cómo funciona la sidebar (técnico)

El CSS nunca mueve nodos del DOM ni usa `:has()`. En su lugar, `waise.js` localiza el
contenedor real de la barra por los enlaces que contiene y añade clases a `<html>`:

- `waise-sidebar-ready` → el menú del servidor ocupa la columna lateral.
- `waise-mainnav-ready` → la barra principal (Inicio, Cuenta, Admin…) ocupa la columna.

Nunca las dos a la vez. Si el JS no encuentra ningún contenedor, el panel conserva su
layout nativo sin ningún estado intermedio roto.

Antes de fijar la columna, el JS neutraliza los ancestros que romperían `position: fixed`
(los que tienen `transform`, `filter` o `backdrop-filter` activos). Si la columna no puede
colocarse correctamente, el layout nativo se restaura automáticamente.

## Cómo funciona la rejilla de tarjetas (v1.4.0)

La lista de servidores del dashboard pasa de filas estiradas a una rejilla de tarjetas
rectangulares con superficie liquid glass.

El JS detecta el listado comparando el recuento total y único de enlaces a `/server/…`:
si `total === unique` cada enlace apunta a un servidor distinto → es el dashboard, no el
menú de un servidor.

Cuando lo confirma, añade:

- `waise-cards-ready` a `<html>` (gate que activa todas las reglas CSS de la rejilla).
- `waise-server-grid` al contenedor del listado.
- `waise-server-card` a cada enlace de servidor.
- `waise-grid-full` a los hijos que no son tarjetas (título, buscador, paginación).

El CSS activa `display: grid` con `repeat(auto-fill, minmax(min(100%, 288px), 1fr))`,
`backdrop-filter: blur()`, reflejo de color en `::before`, hover con elevación y franja
de estado en el borde derecho. Sin el gate, la lista nativa del panel se conserva intacta.

## Qué toca exactamente el instalador

| Ruta | Acción |
| --- | --- |
| `public/waise/**` | Se crea (CSS, JS e imagen de fondo). |
| `resources/views/templates/wrapper.blade.php` | Se inyecta el bloque `WAISE-THEME` antes de `</head>`. |
| `resources/views/layouts/admin.blade.php` | Igual que el anterior. |
| `/var/lib/waise-theme/backups/<fecha>/` | Copia de seguridad de las vistas modificadas. |
| `/var/lib/waise-theme/src/` | Caché del repositorio que usa `waise upgrade`. |
| `/usr/local/share/waise-theme/` | Copia del tema para poder desinstalar/actualizar. |
| `/usr/local/bin/waise` | Comando CLI. |

Tras instalar o desinstalar se ejecuta `php artisan view:clear` y `php artisan cache:clear`.

## Notas de compatibilidad

- Probado contra la estructura de vistas de Pterodactyl 1.14.x.
- La sidebar **no** usa `:has()`: la detección del contenedor la hace íntegramente el JS,
  lo que garantiza compatibilidad con navegadores que no soportan esa pseudo-clase.
- El desenfoque de la sidebar se aplica en la propia columna fija, no en `#navigation`,
  para evitar que `backdrop-filter` cree un bloque contenedor que atrape los modales.
- Los scripts usan finales de línea LF (ver `.gitattributes`). Si editas en Windows,
  no los conviertas a CRLF o `bash` fallará.
- Algunos selectores apuntan a clases utilitarias de Tailwind y a AdminLTE; si una versión
  del panel cambia el markup, el tema degrada de forma segura (el panel sigue usable).
- Se usa `!important` únicamente donde `styled-components` inyecta estilos en tiempo de
  ejecución después de nuestra hoja (misma especificidad), que es la única forma de ganar
  la cascada sin tocar el código fuente del panel.

## Licencia

MIT.