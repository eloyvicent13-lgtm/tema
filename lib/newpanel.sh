#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Waise Theme - waise newpanel
# Restaura los archivos originales de Pterodactyl (vistas, assets publicos y
# fuentes del frontend) descargando la release oficial que coincide con la
# version instalada. Elimina asi cualquier rastro de temas de terceros.
#
# NO toca: .env, storage/, database/, la base de datos ni la configuracion.
# ---------------------------------------------------------------------------

WAISE_NEWPANEL_RELEASE_API="https://api.github.com/repos/pterodactyl/panel/releases/latest"
WAISE_NEWPANEL_DL_BASE="https://github.com/pterodactyl/panel/releases/download"

# Rutas que se restauran desde el tarball oficial.
WAISE_NEWPANEL_PATHS=(
    "public"
    "resources/views"
    "resources/scripts"
)

# waise_newpanel_detect_version <panel_dir> -> imprime la version (ej. 1.11.10)
waise_newpanel_detect_version() {
    local dir="$1" version=""
    if [[ -f "${dir}/config/app.php" ]]; then
        version="$(grep -oE "'version'[[:space:]]*=>[[:space:]]*'[^']+'" "${dir}/config/app.php" \
                   | head -n1 | grep -oE "'[^']+'\$" | tr -d "'")"
    fi
    if [[ -z "$version" || "$version" == "canary" ]]; then
        return 1
    fi
    printf '%s\n' "$version"
}

# waise_newpanel_latest_version -> imprime el tag de la ultima release
waise_newpanel_latest_version() {
    local json=""
    if command -v curl >/dev/null 2>&1; then
        json="$(curl -fsSL "$WAISE_NEWPANEL_RELEASE_API" 2>/dev/null || true)"
    elif command -v wget >/dev/null 2>&1; then
        json="$(wget -qO- "$WAISE_NEWPANEL_RELEASE_API" 2>/dev/null || true)"
    fi
    [[ -n "$json" ]] || return 1
    printf '%s\n' "$json" | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' \
        | head -n1 | grep -oE '"[^"]+"$' | tr -d '"' | sed 's/^v//'
}

# waise_newpanel_download <version> <destino_tar>
waise_newpanel_download() {
    local version="$1" dest="$2"
    local url="${WAISE_NEWPANEL_DL_BASE}/v${version}/panel.tar.gz"
    waise_log "Descargando panel.tar.gz v${version}..."
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$dest" || return 1
    elif command -v wget >/dev/null 2>&1; then
        wget -q "$url" -O "$dest" || return 1
    else
        waise_die "Se necesita curl o wget para descargar el panel."
    fi
    [[ -s "$dest" ]] || return 1
    tar -tzf "$dest" >/dev/null 2>&1 || return 1
    return 0
}

waise_newpanel_usage() {
    cat <<EOF
${WAISE_NAME} - newpanel

Uso: sudo waise newpanel [opciones]

Restaura los archivos originales de Pterodactyl y elimina los cambios que
cualquier tema (incluido Waise) haya hecho en las vistas y los assets.

Opciones:
  --path DIR        Ruta del panel (autodetectada si se omite).
  --version X.Y.Z   Version de Pterodactyl a restaurar (por defecto, la instalada).
  --latest          Usa la ultima release publicada en lugar de la instalada.
  --dry-run         Solo muestra que se restauraria; no modifica nada.
  -y, --yes         No pedir confirmacion.
  -h, --help        Muestra esta ayuda.

Se restauran: ${WAISE_NEWPANEL_PATHS[*]}
NO se tocan: .env, storage/, database/, ni la base de datos.
EOF
}

waise_newpanel() {
    local panel_arg="" version="" use_latest=0 dry_run=0 assume_yes=0

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --path)    panel_arg="${2:-}"; shift 2 ;;
            --version) version="${2:-}";   shift 2 ;;
            --latest)  use_latest=1;       shift ;;
            --dry-run) dry_run=1;          shift ;;
            -y|--yes)  assume_yes=1;       shift ;;
            -h|--help) waise_newpanel_usage; return 0 ;;
            *) waise_die "Opcion desconocida: $1 (usa 'waise newpanel --help')" ;;
        esac
    done

    waise_require_root
    waise_require_cmds tar find cp mkdir

    local panel_dir
    panel_dir="$(waise_detect_panel_dir "$panel_arg" || true)"
    [[ -n "$panel_dir" ]] || waise_die "No se encontro el panel. Indicalo con --path /ruta/al/panel"
    waise_ok "Panel detectado en: ${panel_dir}"

    local web_user web_group
    read -r web_user web_group <<<"$(waise_detect_web_user "$panel_dir")"
    waise_ok "Usuario del servidor web: ${web_user}:${web_group}"

    if [[ -z "$version" ]]; then
        if [[ $use_latest -eq 1 ]]; then
            version="$(waise_newpanel_latest_version || true)"
            [[ -n "$version" ]] || waise_die "No se pudo consultar la ultima version. Usa --version X.Y.Z"
        else
            version="$(waise_newpanel_detect_version "$panel_dir" || true)"
            if [[ -z "$version" ]]; then
                version="$(waise_newpanel_latest_version || true)"
                [[ -n "$version" ]] || waise_die "No se pudo determinar la version del panel. Usa --version X.Y.Z"
                waise_warn "Version instalada no detectada; se usara la ultima publicada: ${version}"
            fi
        fi
    fi
    version="${version#v}"
    [[ "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || waise_die "Version invalida: ${version}"
    waise_ok "Version a restaurar: ${version}"

    if [[ $dry_run -eq 1 ]]; then
        printf '\n%sDRY RUN%s - se restaurarian estas rutas desde panel.tar.gz v%s:\n' \
            "$C_YELLOW" "$C_RESET" "$version"
        local p
        for p in "${WAISE_NEWPANEL_PATHS[@]}"; do
            printf '  %s/%s\n' "$panel_dir" "$p"
        done
        printf '\nNo se tocarian: .env, storage/, database/, ni la base de datos.\n'
        printf 'Ejecuta sin --dry-run para aplicarlo.\n\n'
        return 0
    fi

    printf '\n%sATENCION%s: se sobrescribiran estas rutas de %s:\n' "$C_YELLOW" "$C_RESET" "$panel_dir"
    local p
    for p in "${WAISE_NEWPANEL_PATHS[@]}"; do
        printf '  - %s\n' "$p"
    done
    printf 'Se hara una copia de seguridad antes de tocar nada.\n'
    printf 'Si compilaste assets propios del panel, se perderan.\n\n'

    if [[ $assume_yes -eq 0 ]]; then
        waise_confirm "Continuar?" || { waise_warn "Cancelado."; return 1; }
    fi

    local tmp_dir tarball
    tmp_dir="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '${tmp_dir}'" RETURN
    tarball="${tmp_dir}/panel.tar.gz"

    waise_newpanel_download "$version" "$tarball" \
        || waise_die "No se pudo descargar o validar panel.tar.gz v${version}."
    waise_ok "Descarga verificada."

    local extract_dir="${tmp_dir}/panel"
    mkdir -p "$extract_dir"
    tar -xzf "$tarball" -C "$extract_dir" || waise_die "No se pudo extraer panel.tar.gz."

    # Comprobacion previa: el tarball debe traer todas las rutas esperadas.
    for p in "${WAISE_NEWPANEL_PATHS[@]}"; do
        [[ -d "${extract_dir}/${p}" ]] \
            || waise_die "El tarball v${version} no contiene '${p}'. Abortado sin tocar el panel."
    done

    local backup_dir="${WAISE_BACKUP_ROOT}/newpanel-$(date -u '+%Y%m%d-%H%M%S')"
    mkdir -p "$backup_dir"
    waise_log "Copia de seguridad en ${backup_dir}..."
    for p in "${WAISE_NEWPANEL_PATHS[@]}"; do
        if [[ -e "${panel_dir}/${p}" ]]; then
            mkdir -p "${backup_dir}/$(dirname "$p")"
            cp -a "${panel_dir}/${p}" "${backup_dir}/${p}"
        fi
    done
    waise_ok "Copia de seguridad creada."

    # public/ contiene rutas generadas que NO vienen en el tarball y que
    # perderlas romperia el panel: se preservan aparte y se devuelven despues.
    local preserve_dir="${tmp_dir}/preserve"
    mkdir -p "$preserve_dir"
    local keep
    for keep in ".htaccess" "storage"; do
        if [[ -e "${panel_dir}/public/${keep}" ]]; then
            cp -a "${panel_dir}/public/${keep}" "${preserve_dir}/"
        fi
    done

    waise_log "Restaurando archivos originales..."
    for p in "${WAISE_NEWPANEL_PATHS[@]}"; do
        rm -rf "${panel_dir:?}/${p}"
        mkdir -p "$(dirname "${panel_dir}/${p}")"
        cp -a "${extract_dir}/${p}" "${panel_dir}/${p}"
        waise_ok "Restaurado: ${p}"
    done

    for keep in ".htaccess" "storage"; do
        if [[ -e "${preserve_dir}/${keep}" && ! -e "${panel_dir}/public/${keep}" ]]; then
            cp -a "${preserve_dir}/${keep}" "${panel_dir}/public/${keep}"
            waise_ok "Conservado: public/${keep}"
        fi
    done

    chown -R "${web_user}:${web_group}" "${panel_dir}/public" "${panel_dir}/resources" 2>/dev/null || \
        waise_warn "No se pudieron ajustar los permisos; revisalos con chown -R ${web_user}:${web_group}"

    waise_clear_caches "$panel_dir" "$web_user"

    printf '\n%sPanel restaurado a Pterodactyl v%s.%s\n\n' "$C_GREEN" "$version" "$C_RESET"
    printf '  Copia de seguridad : %s\n' "$backup_dir"
    printf '  Waise Theme        : desinstalado de las vistas (reinstalalo con %ssudo waise install%s)\n' \
        "$C_DIM" "$C_RESET"
    printf '  Siguiente paso     : recarga con Ctrl+F5.\n\n'
}