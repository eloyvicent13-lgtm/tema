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

usage() {
    cat <<EOF
${WAISE_NAME} v${WAISE_VERSION} - instalador

Uso: sudo bash install.sh [opciones]

Opciones:
  --path DIR          Ruta de instalación del panel (autodetectada si se omite).
  --accent #RRGGBB    Color de acento principal (por defecto ${ACCENT}).
  --accent2 #RRGGBB   Color de acento secundario (por defecto ${ACCENT_2}).
  -y, --yes           No pedir confirmación.
  -h, --help          Mostrar esta ayuda.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --path)    PANEL_DIR_ARG="${2:-}"; shift 2 ;;
        --accent)  ACCENT="${2:-}";        shift 2 ;;
        --accent2) ACCENT_2="${2:-}";      shift 2 ;;
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
mkdir -p "${PUBLIC_DIR}/css" "${PUBLIC_DIR}/img"
cp -f "${SCRIPT_DIR}/assets/css/waise.css"       "${PUBLIC_DIR}/css/waise.css"
cp -f "${SCRIPT_DIR}/assets/css/waise-admin.css" "${PUBLIC_DIR}/css/waise-admin.css"
cp -f "${SCRIPT_DIR}/assets/img/waise-bg.svg"    "${PUBLIC_DIR}/img/waise-bg.svg"

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

# --- 3. Inyección en las vistas -------------------------------------------
ASSET_VER="${WAISE_VERSION}-${STAMP}"

build_block() {
    local css="$1"
    cat <<EOF
        {{-- ${WAISE_MARKER_START} v${WAISE_VERSION} :: bloque gestionado automáticamente, no editar --}}
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/${css}?v=${ASSET_VER}">
        <link rel="stylesheet" href="/${WAISE_PUBLIC_SUBDIR}/css/waise-overrides.css?v=${ASSET_VER}">
        {{-- ${WAISE_MARKER_END} --}}
EOF
}

BLOCK_TMP="$(mktemp)"
trap 'rm -f "$BLOCK_TMP"' EXIT

build_block "waise.css" > "$BLOCK_TMP"
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
STATE_ASSET_VERSION="${ASSET_VER}"
EOF
chmod 600 "$WAISE_STATE_FILE"

printf '\n%s%s v%s instalado correctamente.%s\n\n' "$C_GREEN" "$WAISE_NAME" "$WAISE_VERSION" "$C_RESET"
printf 'Siguiente paso: recarga el panel con Ctrl+F5 (o vacía la caché del navegador).\n'
printf '  Ver estado    : %ssudo waise status%s\n' "$C_DIM" "$C_RESET"
printf '  Desinstalar   : %ssudo waise uninstall%s\n' "$C_DIM" "$C_RESET"
printf '  Personalizar  : %s%s/css/waise-overrides.css%s\n\n' "$C_DIM" "$PUBLIC_DIR" "$C_RESET"