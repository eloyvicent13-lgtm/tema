#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Waise Theme - funciones comunes compartidas por install.sh / uninstall.sh
# ---------------------------------------------------------------------------
# Este archivo se carga con `source`, no se ejecuta directamente.

WAISE_NAME="Waise Theme"
WAISE_VERSION="1.3.5"

# Repositorio usado por `waise upgrade`. Se puede sobrescribir exportando
# WAISE_REPO_URL / WAISE_REPO_BRANCH antes de ejecutar el comando.
WAISE_REPO_URL="${WAISE_REPO_URL:-https://github.com/eloyvicent13-lgtm/tema.git}"
WAISE_REPO_BRANCH="${WAISE_REPO_BRANCH:-main}"

WAISE_MARKER_START="WAISE-THEME:START"
WAISE_MARKER_END="WAISE-THEME:END"

WAISE_STATE_DIR="/var/lib/waise-theme"
WAISE_STATE_FILE="${WAISE_STATE_DIR}/state.env"
WAISE_BACKUP_ROOT="${WAISE_STATE_DIR}/backups"
# Caché del repositorio gestionada por el propio tema (la usa `waise upgrade`).
WAISE_SRC_DIR="${WAISE_STATE_DIR}/src"
WAISE_SHARE_DIR="/usr/local/share/waise-theme"
WAISE_BIN_PATH="/usr/local/bin/waise"

# Carpeta pública (dentro de <panel>/public) donde viven los assets del tema.
WAISE_PUBLIC_SUBDIR="waise"

# Vistas Blade en las que se inyecta el tema (relativas a la raíz del panel).
WAISE_CLIENT_VIEW="resources/views/templates/wrapper.blade.php"
WAISE_ADMIN_VIEW="resources/views/layouts/admin.blade.php"

# --- Colores de salida -----------------------------------------------------
if [[ -t 1 ]]; then
    C_RESET=$'\033[0m'
    C_DIM=$'\033[2m'
    C_RED=$'\033[1;31m'
    C_GREEN=$'\033[1;32m'
    C_YELLOW=$'\033[1;33m'
    C_BLUE=$'\033[1;34m'
    C_PURPLE=$'\033[1;35m'
else
    C_RESET=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_PURPLE=""
fi

waise_log()  { printf '%s[waise]%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
waise_ok()   { printf '%s[ ok ]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
waise_warn() { printf '%s[warn]%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
waise_err()  { printf '%s[fail]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
waise_die()  { waise_err "$*"; exit 1; }

waise_banner() {
    printf '%s' "$C_PURPLE"
    cat <<'BANNER'
 __        __    _          _____ _
 \ \      / /_ _(_)___  ___|_   _| |__   ___ _ __ ___   ___
  \ \ /\ / / _` | / __|/ _ \ | | | '_ \ / _ \ '_ ` _ \ / _ \
   \ V  V / (_| | \__ \  __/ | | | | | |  __/ | | | | |  __/
    \_/\_/ \__,_|_|___/\___| |_| |_| |_|\___|_| |_| |_|\___|
BANNER
    printf '%s' "$C_RESET"
    printf '%s              Pterodactyl theme v%s%s\n\n' "$C_DIM" "$WAISE_VERSION" "$C_RESET"
}

waise_require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        waise_die "Este comando necesita privilegios de root. Usa: sudo $0 $*"
    fi
}

waise_require_cmds() {
    local missing=()
    local cmd
    for cmd in "$@"; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        waise_die "Faltan dependencias necesarias: ${missing[*]}"
    fi
}

# waise_is_panel_dir <dir>
waise_is_panel_dir() {
    local dir="${1:-}"
    [[ -n "$dir" ]] || return 1
    [[ -f "${dir}/artisan" ]] || return 1
    [[ -f "${dir}/${WAISE_CLIENT_VIEW}" ]] || return 1
    return 0
}

# waise_detect_panel_dir [ruta_sugerida] -> imprime la ruta encontrada
waise_detect_panel_dir() {
    local hint="${1:-}"
    local candidates=(
        "$hint"
        "${PTERODACTYL_DIR:-}"
        "/var/www/pterodactyl"
        "/var/www/panel"
        "/var/www/html/pterodactyl"
        "/var/www/pterodactyl/panel"
        "/srv/pterodactyl"
    )
    local dir
    for dir in "${candidates[@]}"; do
        [[ -n "$dir" ]] || continue
        if waise_is_panel_dir "$dir"; then
            printf '%s\n' "${dir%/}"
            return 0
        fi
    done
    return 1
}

# waise_detect_web_user <panel_dir> -> imprime "usuario grupo"
waise_detect_web_user() {
    local dir="$1"
    local owner group
    owner="$(stat -c '%U' "${dir}/public" 2>/dev/null || true)"
    group="$(stat -c '%G' "${dir}/public" 2>/dev/null || true)"

    if [[ -z "$owner" || "$owner" == "UNKNOWN" || "$owner" == "root" ]]; then
        local candidate
        for candidate in www-data nginx apache http; do
            if id "$candidate" >/dev/null 2>&1; then
                owner="$candidate"
                group="$candidate"
                break
            fi
        done
    fi
    [[ -n "$owner" ]] || owner="root"
    if [[ -z "$group" || "$group" == "UNKNOWN" ]]; then
        group="$owner"
    fi
    printf '%s %s\n' "$owner" "$group"
}

# waise_artisan <panel_dir> <web_user> <args...>
waise_artisan() {
    local dir="$1"; shift
    local user="$1"; shift
    if ! command -v php >/dev/null 2>&1; then
        waise_warn "No se encontró PHP en el PATH; omitiendo 'artisan $*'."
        return 0
    fi
    if [[ -n "$user" && "$user" != "root" ]] && command -v sudo >/dev/null 2>&1; then
        ( cd "$dir" && sudo -u "$user" php artisan "$@" >/dev/null 2>&1 ) && return 0
    fi
    ( cd "$dir" && php artisan "$@" >/dev/null 2>&1 ) && return 0
    waise_warn "No se pudo ejecutar 'php artisan $*'. Ejecútalo manualmente en ${dir}."
    return 0
}

waise_clear_caches() {
    local dir="$1" user="$2"
    waise_log "Limpiando cachés del panel..."
    waise_artisan "$dir" "$user" view:clear
    waise_artisan "$dir" "$user" cache:clear
    waise_ok "Cachés limpiadas."
}

# waise_backup_file <panel_dir> <ruta_relativa> <backup_dir>
waise_backup_file() {
    local panel="$1" rel="$2" backup="$3"
    local src="${panel}/${rel}"
    [[ -f "$src" ]] || return 0
    local dest="${backup}/${rel}"
    mkdir -p "$(dirname "$dest")"
    cp -a "$src" "$dest"
}

# waise_has_block <archivo>
waise_has_block() {
    local file="${1:-}"
    [[ -f "$file" ]] || return 1
    grep -q "$WAISE_MARKER_START" "$file"
}

# waise_remove_block <archivo>
waise_remove_block() {
    local file="${1:-}"
    [[ -f "$file" ]] || return 0
    waise_has_block "$file" || return 0
    local tmp
    tmp="$(mktemp)"
    sed "/${WAISE_MARKER_START}/,/${WAISE_MARKER_END}/d" "$file" > "$tmp"
    # `cat >` en lugar de `mv` para conservar propietario y permisos originales.
    cat "$tmp" > "$file"
    rm -f "$tmp"
}

# waise_inject_block <archivo> <archivo_con_el_bloque>
# Inserta el bloque justo antes de la primera etiqueta </head>. Idempotente.
waise_inject_block() {
    local file="${1:-}" block_file="${2:-}"
    [[ -f "$file" ]] || return 1
    [[ -f "$block_file" ]] || return 1

    waise_remove_block "$file"

    local tmp
    tmp="$(mktemp)"
    if grep -qi '</head>' "$file"; then
        awk -v bf="$block_file" '
            !inserted && tolower($0) ~ /<\/head>/ {
                while ((getline line < bf) > 0) print line
                close(bf)
                inserted = 1
            }
            { print }
            END {
                if (!inserted) {
                    while ((getline line < bf) > 0) print line
                    close(bf)
                }
            }
        ' "$file" > "$tmp"
    else
        # Sin </head> (vista atípica o modificada por un addon): se añade al final.
        cat "$file" "$block_file" > "$tmp"
    fi
    cat "$tmp" > "$file"
    rm -f "$tmp"

    waise_has_block "$file"
}

# waise_upgrade_from_git [args extra para install.sh]
# Descarga la última versión del repositorio en WAISE_SRC_DIR y reinstala el
# tema conservando la ruta del panel y los colores guardados en el estado.
waise_upgrade_from_git() {
    waise_require_cmds git bash

    local prev_version="" panel_dir="" accent="" accent2=""
    if waise_load_state; then
        prev_version="${STATE_VERSION:-}"
        panel_dir="${STATE_PANEL_DIR:-}"
        accent="${STATE_ACCENT:-}"
        accent2="${STATE_ACCENT_2:-}"
    fi

    mkdir -p "$WAISE_STATE_DIR"

    if [[ -d "${WAISE_SRC_DIR}/.git" ]]; then
        waise_log "Descargando cambios de ${WAISE_REPO_URL} (${WAISE_REPO_BRANCH})..."
        git -C "$WAISE_SRC_DIR" remote set-url origin "$WAISE_REPO_URL" >/dev/null 2>&1 || true
        if ! git -C "$WAISE_SRC_DIR" fetch --depth 1 origin "$WAISE_REPO_BRANCH"; then
            waise_die "No se pudo contactar con ${WAISE_REPO_URL}. Revisa la conexión o la URL."
        fi
        # WAISE_SRC_DIR es una caché interna del tema, nunca un repo del usuario.
        git -C "$WAISE_SRC_DIR" reset --hard "origin/${WAISE_REPO_BRANCH}" >/dev/null
        git -C "$WAISE_SRC_DIR" clean -qfd
    else
        waise_log "Clonando ${WAISE_REPO_URL} en ${WAISE_SRC_DIR}..."
        rm -rf "${WAISE_SRC_DIR:?}"
        if ! git clone --depth 1 --branch "$WAISE_REPO_BRANCH" "$WAISE_REPO_URL" "$WAISE_SRC_DIR"; then
            waise_die "No se pudo clonar ${WAISE_REPO_URL} (rama ${WAISE_REPO_BRANCH})."
        fi
    fi

    [[ -f "${WAISE_SRC_DIR}/install.sh" ]] || \
        waise_die "El repositorio descargado no contiene install.sh."

    local new_version="desconocida"
    if [[ -f "${WAISE_SRC_DIR}/VERSION" ]]; then
        new_version="$(tr -d ' \t\r\n' < "${WAISE_SRC_DIR}/VERSION")"
    fi
    waise_log "Instalada: ${prev_version:-ninguna}  ->  disponible: ${new_version}"

    local args=(-y)
    if [[ -n "$panel_dir" ]]; then
        args+=(--path "$panel_dir")
    fi
    if [[ "$accent" =~ ^#[0-9a-fA-F]{6}$ ]]; then
        args+=(--accent "$accent")
    fi
    if [[ "$accent2" =~ ^#[0-9a-fA-F]{6}$ ]]; then
        args+=(--accent2 "$accent2")
    fi
    if [[ $# -gt 0 ]]; then
        args+=("$@")
    fi

    bash "${WAISE_SRC_DIR}/install.sh" "${args[@]}"
}

waise_load_state() {
    if [[ -f "$WAISE_STATE_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$WAISE_STATE_FILE"
        return 0
    fi
    return 1
}

waise_status() {
    local panel="${1:-}"
    printf '%s%s v%s%s\n' "$C_PURPLE" "$WAISE_NAME" "$WAISE_VERSION" "$C_RESET"

    if [[ -f "$WAISE_STATE_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$WAISE_STATE_FILE"
        printf '  Estado          : %sinstalado%s\n' "$C_GREEN" "$C_RESET"
        printf '  Versión activa  : %s\n' "${STATE_VERSION:-desconocida}"
        printf '  Instalado el    : %s\n' "${STATE_INSTALLED_AT:-desconocido}"
        printf '  Acento          : %s / %s\n' "${STATE_ACCENT:-?}" "${STATE_ACCENT_2:-?}"
        printf '  Backup          : %s\n' "${STATE_BACKUP_DIR:-ninguno}"
        panel="${STATE_PANEL_DIR:-$panel}"
    else
        printf '  Estado          : %sno instalado%s (sin estado en %s)\n' \
            "$C_YELLOW" "$C_RESET" "$WAISE_STATE_FILE"
    fi

    if [[ -z "$panel" ]]; then
        panel="$(waise_detect_panel_dir || true)"
    fi

    if [[ -z "$panel" ]]; then
        printf '  Panel           : no detectado\n'
        return 0
    fi

    printf '  Panel           : %s\n' "$panel"

    local view
    for view in "$WAISE_CLIENT_VIEW" "$WAISE_ADMIN_VIEW"; do
        if waise_has_block "${panel}/${view}"; then
            printf '  Inyección       : %sOK%s  %s\n' "$C_GREEN" "$C_RESET" "$view"
        else
            printf '  Inyección       : %sausente%s  %s\n' "$C_YELLOW" "$C_RESET" "$view"
        fi
    done

    if [[ -d "${panel}/public/${WAISE_PUBLIC_SUBDIR}" ]]; then
        printf '  Assets          : %sOK%s  public/%s\n' "$C_GREEN" "$C_RESET" "$WAISE_PUBLIC_SUBDIR"
    else
        printf '  Assets          : %sausentes%s  public/%s\n' "$C_YELLOW" "$C_RESET" "$WAISE_PUBLIC_SUBDIR"
    fi
}

waise_confirm() {
    local prompt="$1"
    local answer=""
    if [[ ! -t 0 ]]; then
        return 0
    fi
    read -r -p "${prompt} [s/N] " answer
    case "$answer" in
        s|S|y|Y|si|SI|Si|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}