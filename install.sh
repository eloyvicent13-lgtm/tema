#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Waise Theme - instalador automático para Pterodactyl Panel 1.14.x
# Uso: sudo bash install.sh [--path DIR] [--accent #RRGGBB] [--accent2 #RRGGBB] [-y]
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

PANEL_DIR_ARG=""
ACCENT="#6f5cff"
ACCENT_2="#17c9c9"
ASSUME_YES=0
SIDEBAR=1

usage() {
    cat <<EOF
${WAISE_NAME} v${WAISE_VERSION} - instalador

Uso: sudo bash install.sh [opciones]

Opciones:
  --path DIR          Ruta de instalación del panel (autodetectada si se omite).
  --accent #RRGGBB    Color de acento principal (por defecto ${ACCENT}).
  --accent2 #RRGGBB   Color de acento secundario (por defecto ${ACCENT_2}).
  --no-sidebar        No inyectar el JS de la sidebar lateral (solo CSS).
  -y, --yes           No pedir confirmación.
  -h, --help          Mostrar esta ayuda.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --path)    PANEL_DIR_ARG="${2:-}"; shift 2 ;;
        --accent)  ACCENT="${2:-}";        shift 2 ;;
        --accent2) ACCENT_2="${2:-}";      shift 2 ;;
        --no-sidebar) SIDEBAR=0;           shift ;;
        -y|--yes)  ASSUME_YES=1;           shift ;;
        -h|--help) usage; exit 0 ;;
        *) waise_die "Opción desconocida: $1 (usa --help)" ;;
    esac
done

[[ "$ACCENT"   =~ ^#[0-9a-fA-F]{6}$ ]] || waise_die "--accent debe ser un color hex tipo #6f5cff"
[[ "$ACCENT_2" =~ ^#[0-9a-fA-F]{6}$ ]] || waise_die "--accent2 debe ser un color hex tipo #17c9c9"

waise_banner
waise_require_root
waise_require_cmds bash awk sed grep stat mktemp find

PANEL_DIR="$(waise_detect_panel_dir "$PANEL_DIR_ARG" || true)"
if [[ -z "$PANEL_DIR" ]]; then
    waise_die "No se encontró una instalación de Pterodactyl. Indícala con --path /ruta/al/panel"
fi
waise_ok "Panel detectado en: ${PANEL_DIR}"

read -r WEB_USER WEB_GROUP <<<"$(waise_detect_web_user "$PANEL_DIR")"
waise_ok "Usuario del servidor web: ${WEB_USER}:${WEB_GROUP}"

CLIENT_VIEW="${PANEL_DIR}/${WAISE_CLIENT_VIEW}"
ADMIN_VIEW="${PANEL_DIR}/${WAISE_ADMIN_VIEW}"
PUBLIC_DIR="${PANEL_DIR}/public/${WAISE_PUBLIC_SUBDIR}"

[[ -f "$CLIENT_VIEW" ]] || waise_die "No existe ${CLIENT_VIEW}. ¿Es una instalación válida del panel?"
[[ -f "$ADMIN_VIEW" ]]  || waise_warn "No existe ${WAISE_ADMIN_VIEW}; se omitirá el tema del panel admin."

if [[ $ASSUME_YES -eq 0 ]]; then
    printf '\nSe instalará %s en %s\n' "$WAISE_NAME" "$PANEL_DIR"
    printf '  - Assets      -> public/%s\n' "$WAISE_PUBLIC_SUBDIR"
    printf '  - Inyección   -> %s\n' "$WAISE_CLIENT_VIEW"
    if [[ -f "$ADMIN_VIEW" ]]; then
        printf '                -> %s\n' "$WAISE_ADMIN_VIEW"
    fi
    if [[ $SIDEBAR -eq 1 ]]; then
        printf '  - Sidebar     -> sí (js/waise.js)\n'
    else
        printf '  - Sidebar     -> no (--no-sidebar)\n'
    fi
    printf '  - Backup      -> %s/<fecha>\n\n' "$WAISE_BACKUP_ROOT"
    waise_confirm "¿Continuar?" || waise_die "Instalación cancelada por el usuario."
fi

# --- 1. Backup -------------------------------------------------------------
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${WAISE_BACKUP_ROOT}/${STAMP}"
mkdir -p "$BACKUP_DIR" "$WAISE_STATE_DIR"
waise_backup_file "$PANEL_DIR" "$WAISE_CLIENT_VIEW" "$BACKUP_DIR"
if [[ -f "$ADMIN_VIEW" ]]; then
    waise_backup_file "$PANEL_DIR" "$WAISE_ADMIN_VIEW" "$BACKUP_DIR"
fi
waise_ok "Backup creado en ${BACKUP_DIR}"

# --- 2. Assets -------------------------------------------------------------
waise_log "Copiando assets del tema..."
mkdir -p "${PUBLIC_DIR}/css" "${PUBLIC_DIR}/img" "${PUBLIC_DIR}/js"
cp -f "${SCRIPT_DIR}/assets/css/waise.css"       "${PUBLIC_DIR}/css/waise.css"
cp -f "${SCRIPT_DIR}/assets/css/waise-admin.css" "${PUBLIC_DIR}/css/waise-admin.css"
cp -f "${SCRIPT_DIR}/assets/img/waise-bg.svg"    "${PUBLIC_DIR}/img/waise-bg.svg"
cp -f "${SCRIPT_DIR}/assets/js/waise.js"         "${PUBLIC_DIR}/js/waise.js"
cp -f "${SCRIPT_DIR}/assets/css/waise-features.css" "${PUBLIC_DIR}/css/waise-features.css"
cp -f "${SCRIPT_DIR}/assets/js/waise-api.js"        "${PUBLIC_DIR}/js/waise-api.js"
cp -f "${SCRIPT_DIR}/assets/css/waise-trash.css"    "${PUBLIC_DIR}/css/waise-trash.css"
cp -f "${SCRIPT_DIR}/assets/js/waise-trash.js"      "${PUBLIC_DIR}/js/waise-trash.js"
cp -f "${SCRIPT_DIR}/assets/js/waise-features.js"   "${PUBLIC_DIR}/js/waise-features.js"
cp -f "${SCRIPT_DIR}/assets/css/waise-properties.css" "${PUBLIC_DIR}/css/waise-properties.css"
cp -f "${SCRIPT_DIR}/assets/js/waise-properties.js"   "${PUBLIC_DIR}/js/waise-properties.js"
cp -f "${SCRIPT_DIR}/assets/css/waise-console.css"    "${PUBLIC_DIR}/css/waise-console.css"
cp -f "${SCRIPT_DIR}/assets/js/waise-console.js"      "${PUBLIC_DIR}/js/waise-console.js"
cp -f "${SCRIPT_DIR}/assets/css/waise-ops.css"       "${PUBLIC_DIR}/css/waise-ops.css"
cp -f "${SCRIPT_DIR}/assets/js/waise-ops.js"         "${PUBLIC_DIR}/js/waise-ops.js"
cp -f "${SCRIPT_DIR}/assets/css/waise-mods.css"      "${PUBLIC_DIR}/css/waise-mods.css"
cp -f "${SCRIPT_DIR}/assets/js/waise-modpacks.js"    "${PUBLIC_DIR}/js/waise-modpacks.js"
cp -f "${SCRIPT_DIR}/assets/js/waise-mods.js"        "${PUBLIC_DIR}/js/waise-mods.js"
cp -f "${SCRIPT_DIR}/assets/css/waise-editor.css"   "${PUBLIC_DIR}/css/waise-editor.css"
cp -f "${SCRIPT_DIR}/assets/js/waise-editor.js"     "${PUBLIC_DIR}/js/waise-editor.js"
cp -f "${SCRIPT_DIR}/assets/js/waise-brand.js"      "${PUBLIC_DIR}/js/waise-brand.js"
mkdir -p "${PUBLIC_DIR}/api"
cp -f "${SCRIPT_DIR}/assets/php/theme.php"          "${PUBLIC_DIR}/api/theme.php"

cat > "${PUBLIC_DIR}/css/waise-overrides.css" <<EOF
/* -------------------------------------------------------------------------
   Waise Theme - overrides generados por el instalador (v${WAISE_VERSION})
   Este archivo se SOBRESCRIBE en cada instalación/actualización.
   ------------------------------------------------------------------------- */
:root {
    --waise-accent: ${ACCENT};
    --waise-accent-2: ${ACCENT_2};
}
EOF
waise_ok "Assets instalados en public/${WAISE_PUBLIC_SUBDIR}"

# --- 2b. Theme Editor: token y configuracion persistente -------------------
# La config vive en storage/waise, FUERA de public y FUERA de lo que se
# sobrescribe: sobrevive a `waise upgrade` y a las updates del panel.
STORAGE_DIR="${PANEL_DIR}/storage/waise"
TOKEN_FILE="${STORAGE_DIR}/token"
mkdir -p "$STORAGE_DIR"

if [[ -s "$TOKEN_FILE" ]]; then
    WAISE_TOKEN="$(tr -d ' \t\r\n' < "$TOKEN_FILE")"
    waise_log "Token del Theme Editor conservado."
else
    if command -v openssl >/dev/null 2>&1; then
        WAISE_TOKEN="$(openssl rand -hex 32)"
    else
        WAISE_TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    printf '%s\n' "$WAISE_TOKEN" > "$TOKEN_FILE"
    waise_ok "Token del Theme Editor generado."
fi
chmod 640 "$TOKEN_FILE"

if [[ -z "$WAISE_TOKEN" ]]; then
    waise_die "No se pudo generar el token del Theme Editor."
fi

# Genera theme.json (si falta) y los assets estaticos waise-config.css/js.
if command -v php >/dev/null 2>&1; then
    if php "${PUBLIC_DIR}/api/theme.php" --regen >/dev/null 2>&1; then
        waise_ok "Configuracion del tema aplicada."
    else
        waise_warn "No se pudieron generar los assets de configuracion; se usaran los valores por defecto."
    fi
else
    waise_warn "PHP no esta en el PATH; el Theme Editor generara la configuracion en el primer guardado."
fi

# Sin estos archivos las vistas cargarian un 404 hasta el primer guardado.
[[ -f "${PUBLIC_DIR}/css/waise-config.css" ]] || : > "${PUBLIC_DIR}/css/waise-config.css"
[[ -f "${PUBLIC_DIR}/js/waise-config.js" ]]   || : > "${PUBLIC_DIR}/js/waise-config.js"

# --- 3. Inyección en las vistas -------------------------------------------
ASSET_VER="${WAISE_VERSION}-${STAMP}"

# build_block <archivo_css> [archivo_js]
# El <script> va DENTRO de los marcadores para que uninstall.sh lo elimine con
# el mismo sed de rango que ya usa; nada queda huérfano en la vista Blade.
build_block() {
    local css="$1"
    local js="${2:-}"
    cat <<EOF
        {{-- ${WAISE_MARKER_START} v${WAISE_VERSION} :: bloque gestionado automáticamente, no editar --}}
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/${css}?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-overrides.css?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-editor.css?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-config.css?v=${ASSET_VER}">
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-config.js?v=${ASSET_VER}"></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-brand.js?v=${ASSET_VER}" defer></script>
EOF
    # El modulo de funcionalidades es solo del panel de cliente y NO depende
    # de --no-sidebar: son cosas distintas (una es navegacion, otra utilidades).
    if [[ "$css" == "waise.css" ]]; then
        cat <<EOF
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-features.css?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-trash.css?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-properties.css?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-console.css?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-ops.css?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-mods.css?v=${ASSET_VER}">
EOF
    fi
    if [[ -n "$js" ]]; then
        cat <<EOF
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/${js}?v=${ASSET_VER}" defer></script>
EOF
    fi
    if [[ "$css" == "waise.css" ]]; then
        cat <<EOF
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-api.js?v=${ASSET_VER}" defer></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-features.js?v=${ASSET_VER}" defer></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-trash.js?v=${ASSET_VER}" defer></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-properties.js?v=${ASSET_VER}" defer></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-console.js?v=${ASSET_VER}" defer></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-ops.js?v=${ASSET_VER}" defer></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-modpacks.js?v=${ASSET_VER}" defer></script>
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-mods.js?v=${ASSET_VER}" defer></script>
EOF
    else
        # El token solo se expone en la vista de administracion, que el panel
        # ya sirve unicamente a root_admin.
        cat <<EOF
        <meta name="waise-token" content="${WAISE_TOKEN}">
        <script src="/${WAISE_PUBLIC_SUBDIR}/js/waise-editor.js?v=${ASSET_VER}" defer></script>
EOF
    fi
    cat <<EOF
        {{-- ${WAISE_MARKER_END} --}}
EOF
}

BLOCK_TMP="$(mktemp)"
trap 'rm -f "$BLOCK_TMP"' EXIT

CLIENT_JS=""
if [[ $SIDEBAR -eq 1 ]]; then
    CLIENT_JS="waise.js"
fi

build_block "waise.css" "$CLIENT_JS" > "$BLOCK_TMP"
if waise_inject_block "$CLIENT_VIEW" "$BLOCK_TMP"; then
    waise_ok "Tema inyectado en ${WAISE_CLIENT_VIEW}"
else
    waise_die "No se pudo inyectar el tema en ${CLIENT_VIEW}"
fi

if [[ -f "$ADMIN_VIEW" ]]; then
    build_block "waise-admin.css" > "$BLOCK_TMP"
    if waise_inject_block "$ADMIN_VIEW" "$BLOCK_TMP"; then
        waise_ok "Tema inyectado en ${WAISE_ADMIN_VIEW}"
    else
        waise_warn "No se pudo inyectar el tema en ${ADMIN_VIEW} (el panel de cliente sí quedó tematizado)."
    fi
fi

# --- 4. Permisos -----------------------------------------------------------
waise_log "Ajustando permisos..."
chown -R "${WEB_USER}:${WEB_GROUP}" "$PUBLIC_DIR" 2>/dev/null || \
    waise_warn "No se pudo cambiar el propietario de ${PUBLIC_DIR}"
# El servidor web escribe theme.json al guardar desde el Theme Editor.
chown -R "${WEB_USER}:${WEB_GROUP}" "$STORAGE_DIR" 2>/dev/null || \
    waise_warn "No se pudo cambiar el propietario de ${STORAGE_DIR}"
chmod 750 "$STORAGE_DIR" 2>/dev/null || true
chmod 640 "$TOKEN_FILE" 2>/dev/null || true
find "$PUBLIC_DIR" -type d -exec chmod 755 {} + 2>/dev/null || true
find "$PUBLIC_DIR" -type f -exec chmod 644 {} + 2>/dev/null || true
waise_ok "Permisos aplicados."

# --- 5. Cachés -------------------------------------------------------------
waise_clear_caches "$PANEL_DIR" "$WEB_USER"

# --- 6. CLI global ---------------------------------------------------------
waise_log "Instalando comando 'waise'..."
mkdir -p "$WAISE_SHARE_DIR"
# Se copia el tema completo para poder desinstalar/actualizar sin el repositorio.
rm -rf "${WAISE_SHARE_DIR:?}/assets" "${WAISE_SHARE_DIR:?}/lib" "${WAISE_SHARE_DIR:?}/bin"
cp -a "${SCRIPT_DIR}/assets" "${SCRIPT_DIR}/lib" "${SCRIPT_DIR}/bin" "$WAISE_SHARE_DIR/"
cp -f "${SCRIPT_DIR}/install.sh" "${SCRIPT_DIR}/uninstall.sh" "$WAISE_SHARE_DIR/"
if [[ -f "${SCRIPT_DIR}/VERSION" ]]; then
    cp -f "${SCRIPT_DIR}/VERSION" "$WAISE_SHARE_DIR/"
fi
chmod 755 "${WAISE_SHARE_DIR}/install.sh" "${WAISE_SHARE_DIR}/uninstall.sh" "${WAISE_SHARE_DIR}/bin/waise"
install -m 755 "${SCRIPT_DIR}/bin/waise" "$WAISE_BIN_PATH"
waise_ok "Comando disponible: waise (instalado en ${WAISE_BIN_PATH})"

# --- 7. Estado -------------------------------------------------------------
cat > "$WAISE_STATE_FILE" <<EOF
# Estado de ${WAISE_NAME} - generado automáticamente, no editar a mano.
STATE_VERSION="${WAISE_VERSION}"
STATE_PANEL_DIR="${PANEL_DIR}"
STATE_WEB_USER="${WEB_USER}"
STATE_WEB_GROUP="${WEB_GROUP}"
STATE_BACKUP_DIR="${BACKUP_DIR}"
STATE_INSTALLED_AT="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
STATE_ACCENT="${ACCENT}"
STATE_ACCENT_2="${ACCENT_2}"
STATE_SIDEBAR="${SIDEBAR}"
STATE_ASSET_VERSION="${ASSET_VER}"
EOF
chmod 600 "$WAISE_STATE_FILE"

printf '\n%s%s v%s instalado correctamente.%s\n\n' "$C_GREEN" "$WAISE_NAME" "$WAISE_VERSION" "$C_RESET"
printf 'Siguiente paso: recarga el panel con Ctrl+F5 (o vacía la caché del navegador).\n'
printf '  Ver estado    : %ssudo waise status%s\n' "$C_DIM" "$C_RESET"
printf '  Actualizar    : %ssudo waise upgrade%s\n' "$C_DIM" "$C_RESET"
printf '  Desinstalar   : %ssudo waise uninstall%s\n' "$C_DIM" "$C_RESET"
printf '  Sin sidebar   : %ssudo waise install --no-sidebar%s\n' "$C_DIM" "$C_RESET"
printf '  Personalizar  : %s%s/css/waise-overrides.css%s\n' "$C_DIM" "$PUBLIC_DIR" "$C_RESET"
printf '  Theme Editor  : %s/admin -> menu lateral -> Theme Editor%s\n\n' "$C_DIM" "$C_RESET"