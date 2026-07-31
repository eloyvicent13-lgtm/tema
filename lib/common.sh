#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Waise Theme - funciones comunes compartidas por install.sh / uninstall.sh
# ---------------------------------------------------------------------------
# Este archivo se carga con `source`, no se ejecuta directamente.

WAISE_NAME="Waise Theme"

# La versión vive en el archivo VERSION: es la única fuente de verdad (la lee
# `waise upgrade` del repositorio descargado para comparar). Se toma de la copia
# que acompaña a este lib/, que existe tanto en el repositorio como en
# /usr/local/share/waise-theme, porque install.sh copia VERSION junto a lib/.
# El valor de abajo es solo la reserva por si el archivo falta o está corrupto:
# así el banner y `waise status` nunca quedan sin versión.
WAISE_VERSION="1.5.0"

# Sin `|| ...` de reserva, un fallo de la sustitución aborataría el script que
# hace `source` de este archivo (install.sh usa `set -e`).
_waise_lib_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || _waise_lib_dir=""
if [[ -n "$_waise_lib_dir" && -r "${_waise_lib_dir}/../VERSION" ]]; then
    _waise_version_file="$(tr -d ' \t\r\n' < "${_waise_lib_dir}/../VERSION")" || _waise_version_file=""
    if [[ "$_waise_version_file" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.]+)?$ ]]; then
        WAISE_VERSION="$_waise_version_file"
    fi
    unset _waise_version_file
fi

WAISE_REPO="https://github.com/eloyvicent13-lgtm/tema.git"
WAISE_BRANCH="main"
WAISE_BIN_PATH="/usr/local/bin/waise"
WAISE_SHARE_DIR="/usr/local/share/waise-theme"
WAISE_STATE_DIR="/var/lib/waise-theme"
WAISE_STATE_FILE="${WAISE_STATE_DIR}/state"
WAISE_BACKUP_ROOT="${WAISE_STATE_DIR}/backups"
WAISE_PUBLIC_SUBDIR="waise"
WAISE_CLIENT_VIEW="resources/views/templates/wrapper.blade.php"
WAISE_ADMIN_VIEW="resources/views/layouts/admin.blade.php"
WAISE_MARKER_START="waise:start"
WAISE_MARKER_END="waise:end"

# ─── Colores ANSI ────────────────────────────────────────────────────────────
C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'
C_DIM='\033[2m';      C_BOLD='\033[1m';      C_RESET='\033[0m'
C_PURPLE='\033[0;35m'

# ─── waise_log / waise_ok / waise_warn / waise_die ──────────────────────────
waise_log()  { printf '[waise] %s\n'           "$*"; }
waise_ok()   { printf '%b[ ok ]%b %s\n'        "$C_GREEN" "$C_RESET" "$*"; }
waise_warn() { printf '%b[warn]%b %s\n'        "$C_YELLOW" "$C_RESET" "$*" >&2; }
waise_die()  { printf '%b[fail]%b %s\n'        "$C_RED"  "$C_RESET" "$*" >&2; exit 1; }

# ─── waise_banner ────────────────────────────────────────────────────────────
waise_banner() {
    printf '%b' "$C_BOLD"
    cat <<'ASCIIEOF'
 __        __    _          _____ _
 \ \      / /_ _(_)___  ___|_   _| |__   ___ _ __ ___   ___
  \ \ /\ / / _` | / __|/ _ \ | | | '_ \ / _ \ '_ ` _ \ / _ \
   \ V  V / (_| | \__ \  __/ | | | | | |  __/ | | | | |  __/
    \_/\_/ \__,_|_|___/\___| |_| |_| |_|\___|_| |_| |_|\___|
ASCIIEOF
    printf '%s              Pterodactyl theme v%s%s\n\n' "$C_DIM" "$WAISE_VERSION" "$C_RESET"
    printf '%s%s v%s%s\n' "$C_PURPLE" "$WAISE_NAME" "$WAISE_VERSION" "$C_RESET"
}

# ─── waise_require_root ──────────────────────────────────────────────────────
waise_require_root() {
    [[ "$(id -u)" -eq 0 ]] || waise_die "Este script debe ejecutarse como root (usa sudo)."
}

# ─── waise_require_cmds ──────────────────────────────────────────────────────
waise_require_cmds() {
    local cmd
    for cmd in "$@"; do
        command -v "$cmd" &>/dev/null || waise_die "Comando requerido no encontrado: $cmd"
    done
}

# ─── waise_detect_panel_dir ──────────────────────────────────────────────────
waise_detect_panel_dir() {
    local hint="${1:-}"
    local candidates=("/var/www/pterodactyl" "/var/www/panel" "/srv/pterodactyl")
    if [[ -n "$hint" ]]; then
        [[ -d "$hint" ]] || waise_die "La ruta indicada no existe: $hint"
        echo "$hint"; return
    fi
    local d
    for d in "${candidates[@]}"; do
        [[ -f "${d}/artisan" ]] && { echo "$d"; return; }
    done
    return 1
}

# ─── waise_detect_web_user ───────────────────────────────────────────────────
waise_detect_web_user() {
    local panel_dir="$1"
    local user group
    user="$(stat -c '%U' "${panel_dir}/public" 2>/dev/null)" || user="www-data"
    group="$(stat -c '%G' "${panel_dir}/public" 2>/dev/null)" || group="www-data"
    [[ "$user"  == "UNKNOWN" ]] && user="www-data"
    [[ "$group" == "UNKNOWN" ]] && group="www-data"
    printf '%s %s\n' "$user" "$group"
}

# ─── waise_backup_file ───────────────────────────────────────────────────────
waise_backup_file() {
    local panel_dir="$1" rel_path="$2" backup_dir="$3"
    local src="${panel_dir}/${rel_path}"
    local dest="${backup_dir}/$(basename "$rel_path")"
    [[ -f "$src" ]] && cp -f "$src" "$dest"
}

# ─── waise_inject_block ──────────────────────────────────────────────────────
waise_inject_block() {
    local view_file="$1"
    local block_file="$2"

    local block_content
    block_content="$(cat "$block_file")"

    if grep -qF "waise:start" "$view_file" 2>/dev/null; then
        awk -v block="$block_content" '
            /waise:start/ { in_block=1 }
            in_block && /waise:end/ { print block; in_block=0; next }
            in_block { next }
            { print }
        ' "$view_file" > "${view_file}.tmp" && mv "${view_file}.tmp" "$view_file"
    else
        awk -v block="$block_content" '
            /<\/head>/ { print block }
            { print }
        ' "$view_file" > "${view_file}.tmp" && mv "${view_file}.tmp" "$view_file"
    fi
    grep -qF "waise:start" "$view_file"
}

# ─── waise_clear_caches ──────────────────────────────────────────────────────
waise_clear_caches() {
    local panel_dir="$1"
    local web_user="$2"
    waise_log "Limpiando cachés del panel..."
    local cmds=(
        "php artisan cache:clear"
        "php artisan config:clear"
        "php artisan view:clear"
        "php artisan route:clear"
    )
    local cmd
    for cmd in "${cmds[@]}"; do
        sudo -u "$web_user" bash -c "cd \"${panel_dir}\" && ${cmd}" &>/dev/null || true
    done
    waise_ok "Cachés limpiadas."
}

# ─── waise_confirm ───────────────────────────────────────────────────────────
waise_confirm() {
    local msg="${1:-¿Continuar?}"
    local resp
    printf '%s [s/N] ' "$msg"
    read -r resp
    [[ "$resp" =~ ^[sS]$ ]]
}

# ─── waise_installed_version ─────────────────────────────────────────────────
waise_installed_version() {
    [[ -f "$WAISE_STATE_FILE" ]] || { echo "none"; return; }
    local ver
    ver="$(grep '^STATE_VERSION=' "$WAISE_STATE_FILE" | cut -d'"' -f2)" || true
    echo "${ver:-none}"
}