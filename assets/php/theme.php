<?php
/* ==========================================================================
   Waise Theme - public/waise/api/theme.php
   Endpoint autonomo de configuracion del tema.

   NO carga Laravel a proposito: asi una actualizacion de Pterodactyl no puede
   romperlo, y desinstalar es borrar el archivo. Guarda en storage/waise y
   regenera assets ESTATICOS, de modo que el panel nunca ejecuta PHP del tema
   al pintar una pagina.

   Autenticacion: token compartido, inyectado solo en admin.blade.php (vista
   que el panel ya restringe a root_admin).

   Uso CLI (lo llama install.sh): php theme.php --regen
   ========================================================================== */

declare(strict_types=1);

const WAISE_SCHEMA = [
    'accent'        => ['type' => 'color',  'default' => '#6f5cff'],
    'accent2'       => ['type' => 'color',  'default' => '#17c9c9'],
    'bg'            => ['type' => 'color',  'default' => '#0b0e1a'],
    'surface'       => ['type' => 'color',  'default' => '#181c2e'],
    'text'          => ['type' => 'color',  'default' => '#e8eaf6'],
    'muted'         => ['type' => 'color',  'default' => '#9aa3c7'],
    'bgImage'       => ['type' => 'url',    'default' => '/waise/img/waise-bg.svg'],
    'bgOverlay'     => ['type' => 'number', 'default' => 0.55, 'min' => 0,  'max' => 1],
    'radius'        => ['type' => 'number', 'default' => 14,   'min' => 0,  'max' => 40],
    'blur'          => ['type' => 'number', 'default' => 14,   'min' => 0,  'max' => 40],
    'sidebarWidth'  => ['type' => 'number', 'default' => 232,  'min' => 140, 'max' => 400],
    'font'          => ['type' => 'font',   'default' => ''],
    'logoUrl'       => ['type' => 'url',    'default' => ''],
    'brandName'     => ['type' => 'text',   'default' => '',   'max' => 60],
    'copyright'     => ['type' => 'text',   'default' => '',   'max' => 200],
    'faviconUrl'    => ['type' => 'url',    'default' => ''],
];

/* --- Rutas ---------------------------------------------------------------- */

$publicDir  = dirname(__DIR__);                 // <panel>/public/waise
$panelDir   = dirname(dirname($publicDir));     // <panel>
$storageDir = $panelDir . '/storage/waise';
$configFile = $storageDir . '/theme.json';
$tokenFile  = $storageDir . '/token';
$cssFile    = $publicDir . '/css/waise-config.css';
$jsFile     = $publicDir . '/js/waise-config.js';

/* --- Validacion ----------------------------------------------------------- */

function waise_clean_color(string $value, string $fallback): string
{
    $value = trim($value);
    return preg_match('/^#[0-9a-fA-F]{6}$/', $value) === 1 ? strtolower($value) : $fallback;
}

/**
 * Solo rutas relativas o http(s). Se rechazan comillas, parentesis y
 * caracteres de control: son el vector para escaparse del url() del CSS.
 */
function waise_clean_url(string $value, string $fallback): string
{
    $value = trim($value);
    if ($value === '') {
        return '';
    }
    if (strlen($value) > 500) {
        return $fallback;
    }
    if (preg_match('/["\'()\\\\<>\s]|[\x00-\x1f]/', $value) === 1) {
        return $fallback;
    }
    if (str_starts_with($value, '/')) {
        return $value;
    }
    if (preg_match('#^https?://[^/]+#i', $value) === 1) {
        return $value;
    }
    return $fallback;
}

function waise_clean_text(string $value, int $max): string
{
    $value = preg_replace('/[\x00-\x1f\x7f]/', '', trim($value)) ?? '';
    return mb_substr($value, 0, $max);
}

function waise_clean_font(string $value, string $fallback): string
{
    $value = trim($value);
    if ($value === '') {
        return '';
    }
    return preg_match('/^[A-Za-z0-9 ,\'\-]{1,120}$/', $value) === 1 ? $value : $fallback;
}

function waise_defaults(): array
{
    $out = [];
    foreach (WAISE_SCHEMA as $key => $rule) {
        $out[$key] = $rule['default'];
    }
    return $out;
}

function waise_sanitize(array $input): array
{
    $out = [];
    foreach (WAISE_SCHEMA as $key => $rule) {
        $fallback = $rule['default'];
        if (!array_key_exists($key, $input)) {
            $out[$key] = $fallback;
            continue;
        }
        $raw = $input[$key];
        switch ($rule['type']) {
            case 'color':
                $out[$key] = waise_clean_color(is_string($raw) ? $raw : '', $fallback);
                break;
            case 'url':
                $out[$key] = waise_clean_url(is_string($raw) ? $raw : '', $fallback);
                break;
            case 'font':
                $out[$key] = waise_clean_font(is_string($raw) ? $raw : '', $fallback);
                break;
            case 'number':
                if (!is_numeric($raw)) {
                    $out[$key] = $fallback;
                    break;
                }
                $num = (float) $raw;
                $num = max((float) $rule['min'], min((float) $rule['max'], $num));
                $out[$key] = round($num, 3);
                break;
            default:
                $out[$key] = waise_clean_text(is_string($raw) ? $raw : '', $rule['max'] ?? 120);
        }
    }
    return $out;
}

/* --- Persistencia --------------------------------------------------------- */

function waise_read_config(string $file): array
{
    if (!is_readable($file)) {
        return waise_defaults();
    }
    $raw = file_get_contents($file);
    if ($raw === false) {
        return waise_defaults();
    }
    $parsed = json_decode($raw, true);
    return is_array($parsed) ? waise_sanitize($parsed) : waise_defaults();
}

/** Escritura atomica: un fallo a media escritura dejaria el panel sin CSS. */
function waise_write_atomic(string $path, string $contents): bool
{
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        return false;
    }
    $tmp = $path . '.tmp' . getmypid();
    if (@file_put_contents($tmp, $contents, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0644);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/* --- Generacion de assets ------------------------------------------------- */

function waise_build_css(array $c): string
{
    $bgLayer = $c['bgImage'] !== ''
        ? sprintf(
            "    --waise-bg-image: linear-gradient(rgba(0,0,0,%1\$s), rgba(0,0,0,%1\$s)), url(%2\$s);\n",
            (string) $c['bgOverlay'],
            $c['bgImage']
        )
        : "    --waise-bg-image: none;\n";

    $font = $c['font'] !== ''
        ? sprintf("    --waise-font: '%s', system-ui, sans-serif;\n", $c['font'])
        : '';

    $fontRule = $c['font'] !== ''
        ? "\nbody, .waise-server-nav, .waise-main-nav {\n    font-family: var(--waise-font);\n}\n"
        : '';

    return "/* -------------------------------------------------------------------------\n"
        . "   Waise Theme - generado por el Theme Editor. NO editar a mano:\n"
        . "   se sobrescribe cada vez que guardas en /admin -> Theme Editor.\n"
        . "   ------------------------------------------------------------------------- */\n"
        . ":root {\n"
        . sprintf("    --waise-accent: %s;\n", $c['accent'])
        . sprintf("    --waise-accent-2: %s;\n", $c['accent2'])
        . sprintf("    --waise-bg: %s;\n", $c['bg'])
        . sprintf("    --waise-surface: %s;\n", $c['surface'])
        . sprintf("    --waise-text: %s;\n", $c['text'])
        . sprintf("    --waise-muted: %s;\n", $c['muted'])
        . sprintf("    --waise-radius: %spx;\n", $c['radius'])
        . sprintf("    --waise-blur: %spx;\n", $c['blur'])
        . sprintf("    --waise-sidebar-width: %spx;\n", $c['sidebarWidth'])
        . $bgLayer
        . $font
        . "\n    /* Variables del modulo de funcionalidades */\n"
        . sprintf("    --waise-fx-surface: %s;\n", $c['surface'])
        . sprintf("    --waise-fx-text: %s;\n", $c['text'])
        . sprintf("    --waise-fx-muted: %s;\n", $c['muted'])
        . "}\n"
        . "\nbody {\n"
        . "    background-color: var(--waise-bg);\n"
        . "    background-image: var(--waise-bg-image);\n"
        . "    background-size: cover;\n"
        . "    background-position: center;\n"
        . "    background-attachment: fixed;\n"
        . "}\n"
        . $fontRule;
}

function waise_build_js(array $c): string
{
    $json = json_encode($c, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    return "/* Waise Theme - configuracion generada. No editar a mano. */\n"
        . "window.WaiseConfig = " . $json . ";\n";
}

function waise_regenerate(array $config, string $cssFile, string $jsFile): bool
{
    return waise_write_atomic($cssFile, waise_build_css($config))
        && waise_write_atomic($jsFile, waise_build_js($config));
}

/* --- Modo CLI (install.sh) ------------------------------------------------ */

if (PHP_SAPI === 'cli') {
    $config = waise_read_config($configFile);
    if (!is_dir($storageDir)) {
        @mkdir($storageDir, 0755, true);
    }
    if (!file_exists($configFile)) {
        waise_write_atomic($configFile, json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }
    if (waise_regenerate($config, $cssFile, $jsFile)) {
        fwrite(STDOUT, "waise: assets de configuracion regenerados\n");
        exit(0);
    }
    fwrite(STDERR, "waise: no se pudieron escribir los assets de configuracion\n");
    exit(1);
}

/* --- Modo HTTP ------------------------------------------------------------ */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function waise_fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

$expected = is_readable($tokenFile) ? trim((string) file_get_contents($tokenFile)) : '';
if ($expected === '') {
    waise_fail(500, 'El tema no tiene token configurado. Ejecuta: sudo waise install');
}

$provided = $_SERVER['HTTP_X_WAISE_TOKEN'] ?? '';
if (!is_string($provided) || !hash_equals($expected, trim($provided))) {
    waise_fail(403, 'Token invalido. Recarga el panel de administracion.');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    echo json_encode([
        'ok'       => true,
        'config'   => waise_read_config($configFile),
        'defaults' => waise_defaults(),
    ], JSON_UNESCAPED_SLASHES);
    exit;
}

if ($method !== 'POST') {
    waise_fail(405, 'Metodo no permitido');
}

$body = file_get_contents('php://input');
if ($body === false || strlen($body) > 20000) {
    waise_fail(400, 'Cuerpo de peticion invalido');
}

$payload = json_decode($body, true);
if (!is_array($payload)) {
    waise_fail(400, 'JSON invalido');
}

$config = ($payload['action'] ?? '') === 'reset'
    ? waise_defaults()
    : waise_sanitize(is_array($payload['config'] ?? null) ? $payload['config'] : []);

if (!is_dir($storageDir) && !@mkdir($storageDir, 0755, true) && !is_dir($storageDir)) {
    waise_fail(500, 'No se pudo crear storage/waise. Revisa permisos.');
}

$saved = waise_write_atomic(
    $configFile,
    json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
);

if (!$saved) {
    waise_fail(500, 'No se pudo escribir storage/waise/theme.json. Revisa permisos.');
}

if (!waise_regenerate($config, $cssFile, $jsFile)) {
    waise_fail(500, 'Config guardada, pero no se pudieron regenerar los assets. Revisa permisos de public/waise.');
}

echo json_encode(['ok' => true, 'config' => $config], JSON_UNESCAPED_SLASHES);