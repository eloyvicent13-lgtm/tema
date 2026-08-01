#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Waise Theme - desinstalador
# Uso: sudo bash uninstall.sh [--path DIR] [--restore-backup] [--purge] [-y]
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

ORIG_ARGS=("$@")

PANEL_DIR_ARG=""
RESTORE_BACKUP=0
PURGE=0
ASSUME_YES=0

usage() {
    cat <<EOF
${WAISE_NAME} v${WAISE_VERSION} - desinstalador

Uso: sudo bash uninstall.sh [opciones]

Opciones:
  --path DIR         Ruta del panel (se usa el estado guardado o autodetección si se omite).
  --restore-backup   Restaura las vistas Blade originales desde el backup.
  --purge            Elimina también el comando 'waise', /usr/local/share/waise-theme y los backups.
  -y, --yes          No pedir confirmación.
  -h, --help         Mostrar esta ayuda.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --path)            PANEL_DIR_ARG="${2:-}"; shift 2 ;;
        --restore-backup)  RESTORE_BACKUP=1;       shift ;;
        --purge)           PURGE=1;                shift ;;
        -y|--yes)          ASSUME_YES=1;           shift ;;
        -h|--help)         usage; exit 0 ;;
        *) waise_die "Opción desconocida: $1 (usa --help)" ;;
    esac
done

waise_require_root

# Si vamos a purgar y estamos ejecutando desde el directorio que hay que borrar,
# nos relanzamos desde una copia temporal para no borrar el script en ejecución.
if [[ $PURGE -eq 1 && "$SCRIPT_DIR" == "$WAISE_SHARE_DIR" && "${WAISE_REEXEC:-0}" != "1" ]]; then
    REEXEC_DIR="$(mktemp -d)"
    cp -a "${WAISE_SHARE_DIR}/." "${REEXEC_DIR}/"
    export WAISE_REEXEC=1
    exec bash "${REEXEC_DIR}/uninstall.sh" "${ORIG_ARGS[@]}"
fi
if [[ "${WAISE_REEXEC:-0}" == "1" ]]; then
    trap 'rm -rf -- "$SCRIPT_DIR"' EXIT
fi

waise_banner
waise_require_cmds bash sed grep

PANEL_DIR=""
WEB_USER=""
WEB_GROUP=""
BACKUP_DIR=""

if waise_load_state; then
    PANEL_DIR="${STATE_PANEL_DIR:-}"
    WEB_USER="${STATE_WEB_USER:-}"
    WEB_GROUP="${STATE_WEB_GROUP:-}"
    BACKUP_DIR="${STATE_BACKUP_DIR:-}"
fi

if [[ -n "$PANEL_DIR_ARG" ]]; then
    PANEL_DIR="$PANEL_DIR_ARG"
fi
if ! waise_is_panel_dir "$PANEL_DIR"; then
    PANEL_DIR="$(waise_detect_panel_dir "$PANEL_DIR_ARG" || true)"
fi
[[ -n "$PANEL_DIR" ]] || waise_die "No se encontró la instalación del panel. Indícala con --path /ruta/al/panel"

if [[ -z "$WEB_USER" ]]; then
    read -r WEB_USER WEB_GROUP <<<"$(waise_detect_web_user "$PANEL_DIR")"
fi
[[ -n "$WEB_GROUP" ]] || WEB_GROUP="$WEB_USER"

waise_ok "Panel: ${PANEL_DIR}"

if [[ $ASSUME_YES -eq 0 ]]; then
    printf '\nSe eliminará %s de %s\n' "$WAISE_NAME" "$PANEL_DIR"
    if [[ $RESTORE_BACKUP -eq 1 ]]; then
        printf '  - Se restaurarán las vistas desde: %s\n' "${BACKUP_DIR:-<no disponible>}"
    else
        printf '  - Se borrará el bloque inyectado en las vistas (sin tocar nada más)\n'
    fi
    printf '  - Se borrará public/%s\n' "$WAISE_PUBLIC_SUBDIR"
    if [[ $PURGE -eq 1 ]]; then
        printf '  - PURGE: se borrará el comando waise, %s y los backups\n' "$WAISE_SHARE_DIR"
    fi
    printf '\n'
    waise_confirm "¿Continuar?" || waise_die "Desinstalación cancelada por el usuario."
fi

CLIENT_VIEW="${PANEL_DIR}/${WAISE_CLIENT_VIEW}"
ADMIN_VIEW="${PANEL_DIR}/${WAISE_ADMIN_VIEW}"

# --- 1. Vistas -------------------------------------------------------------
restore_from_backup() {
    local rel="$1"
    local src="${BACKUP_DIR}/${rel}"
    local dest="${PANEL_DIR}/${rel}"
    if [[ -f "$src" && -f "$dest" ]]; then
        cat "$src" > "$dest"
        chown "${WEB_USER}:${WEB_GROUP}" "$dest" 2>/dev/null || true
        waise_ok "Restaurado desde backup: ${rel}"
        return 0
    fi
    return 1
}

for rel in "$WAISE_CLIENT_VIEW" "$WAISE_ADMIN_VIEW"; do
    target="${PANEL_DIR}/${rel}"
    [[ -f "$target" ]] || continue

    if [[ $RESTORE_BACKUP -eq 1 && -n "$BACKUP_DIR" ]]; then
        if restore_from_backup "$rel"; then
            continue
        fi
        waise_warn "Sin backup para ${rel}; se elimina solo el bloque inyectado."
    fi

    if waise_has_block "$target"; then
        waise_remove_block "$target"
        if waise_has_block "$target"; then
            waise_warn "Quedan marcadores de Waise en ${rel}; revísalo manualmente."
        else
            waise_ok "Bloque eliminado de ${rel}"
        fi
    else
        waise_log "Sin bloque de Waise en ${rel} (nada que hacer)."
    fi
done

# --- 2. Assets -------------------------------------------------------------
PUBLIC_DIR="${PANEL_DIR}/public/${WAISE_PUBLIC_SUBDIR}"
if [[ -d "$PUBLIC_DIR" ]]; then
    rm -rf -- "$PUBLIC_DIR"
    waise_ok "Assets eliminados (public/${WAISE_PUBLIC_SUBDIR})."
fi

# --- 3. Cachés -------------------------------------------------------------
waise_clear_caches "$PANEL_DIR" "$WEB_USER"

# --- 4. Estado -------------------------------------------------------------
rm -f -- "$WAISE_STATE_FILE"

if [[ $PURGE -eq 1 ]]; then
    rm -f -- "$WAISE_BIN_PATH"
    rm -rf -- "$WAISE_SHARE_DIR"
    rm -rf -- "$WAISE_BACKUP_ROOT"
    rmdir "$WAISE_STATE_DIR" 2>/dev/null || true
    waise_ok "Purga completada (comando, archivos compartidos y backups eliminados)."
else
    waise_log "Backups conservados en ${WAISE_BACKUP_ROOT} (usa --purge para borrarlos)."
fi

printf '\n%s%s desinstalado. El panel volvió a su aspecto original.%s\n' \
    "$C_GREEN" "$WAISE_NAME" "$C_RESET"
printf 'Recarga con Ctrl+F5 para limpiar el CSS cacheado en el navegador.\n\n'