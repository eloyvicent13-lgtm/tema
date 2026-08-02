<?php
/* ---------------------------------------------------------------------------
   Waise Theme - assets/php/ai.php

   Proxy del asistente IA. El instalador lo copia a
   public/waise/api/ai.php; el navegador lo llama con POST JSON:

       { "messages": [ { "role": "system|user|assistant", "content": "..." } ] }

   y espera 200 con { "content": "..." } o un codigo de error con
   { "error": "mensaje" }. Ese contrato lo fija assets/js/waise-ai.js: no
   cambiar sin tocar tambien askModel() alli.

   La API key NUNCA vive aqui: se lee de storage/waise/ai.key, fuera de
   public/. Si el archivo esta vacio se responde 503 y el resto del tema
   sigue funcionando.
   --------------------------------------------------------------------------- */

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

/* public/waise/api/ai.php -> tres niveles arriba esta la raiz del panel. */
define('WAISE_PANEL_DIR', dirname(__DIR__, 3));
define('WAISE_STORAGE_DIR', WAISE_PANEL_DIR . '/storage/waise');

const WAISE_DEFAULT_BASE  = 'https://api.luminlabs.ai/v1/chat/completions';
const WAISE_DEFAULT_MODEL = 'lumin-vera-3';
const WAISE_MAX_BODY      = 400000;   // bytes del POST entrante
const WAISE_MAX_MESSAGES  = 40;
const WAISE_TIMEOUT       = 120;      // segundos de la llamada upstream

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/**
 * Termina la peticion con un JSON y un codigo HTTP.
 */
function waise_fail(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Lee un archivo de configuracion de storage/waise, o null si no existe/vacio.
 */
function waise_read_setting(string $name): ?string
{
    $path = WAISE_STORAGE_DIR . '/' . $name;
    if (!is_file($path) || !is_readable($path)) {
        return null;
    }
    $value = trim((string) file_get_contents($path));

    return $value === '' ? null : $value;
}

/* --- Metodo y sesion ------------------------------------------------------- */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    waise_fail(405, 'Metodo no permitido.');
}

/* El JS envia siempre esta cabecera; exigirla corta los POST cross-site
   simples, que no pueden establecerla sin pasar por CORS. */
if (strcasecmp($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '', 'XMLHttpRequest') !== 0) {
    waise_fail(403, 'Peticion no valida.');
}

/* Same-origin: si el navegador manda Origin, tiene que coincidir con el host. */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $selfHost   = $_SERVER['HTTP_HOST'] ?? '';
    if (!is_string($originHost) || strcasecmp($originHost, preg_replace('/:\d+$/', '', $selfHost)) !== 0) {
        waise_fail(403, 'Origen no permitido.');
    }
}

/* Autenticacion: solo usuarios con sesion del panel. Se arranca Laravel para
   no reimplementar el manejo de la cookie cifrada. Si el bootstrap falla (una
   version del panel con otra estructura), se deniega en vez de abrir el proxy
   a cualquiera. */
$authenticated = false;
$autoload = WAISE_PANEL_DIR . '/vendor/autoload.php';
$bootstrap = WAISE_PANEL_DIR . '/bootstrap/app.php';

if (is_file($autoload) && is_file($bootstrap)) {
    try {
        require_once $autoload;
        /** @var \Illuminate\Contracts\Foundation\Application $app */
        $app = require $bootstrap;
        $kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);
        $request = \Illuminate\Http\Request::capture();
        $kernel->bootstrap();
        $app->instance('request', $request);

        $app->make(\Illuminate\Session\Middleware\StartSession::class)
            ->handle($request, static function ($req) use (&$authenticated) {
                $authenticated = \Illuminate\Support\Facades\Auth::check();

                return new \Illuminate\Http\Response('');
            });
    } catch (\Throwable $e) {
        $authenticated = false;
    }
}

if (!$authenticated) {
    waise_fail(401, 'Sesion no valida. Vuelve a iniciar sesion en el panel.');
}

/* --- Entrada --------------------------------------------------------------- */

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    waise_fail(400, 'Cuerpo vacio.');
}
if (strlen($raw) > WAISE_MAX_BODY) {
    waise_fail(413, 'La conversacion es demasiado larga. Empieza una nueva.');
}

$payload = json_decode($raw, true);
if (!is_array($payload) || !isset($payload['messages']) || !is_array($payload['messages'])) {
    waise_fail(400, 'Falta el campo "messages".');
}

$messages = [];
foreach ($payload['messages'] as $message) {
    if (!is_array($message)) {
        continue;
    }
    $role = isset($message['role']) ? (string) $message['role'] : '';
    $content = isset($message['content']) ? $message['content'] : null;

    if (!in_array($role, ['system', 'user', 'assistant'], true) || !is_string($content)) {
        continue;
    }
    $messages[] = ['role' => $role, 'content' => $content];
}

if (count($messages) === 0) {
    waise_fail(400, 'No hay mensajes validos que enviar.');
}
if (count($messages) > WAISE_MAX_MESSAGES) {
    /* Se conserva el system inicial y la cola mas reciente. */
    $head = $messages[0]['role'] === 'system' ? [array_shift($messages)] : [];
    $messages = array_merge($head, array_slice($messages, -(WAISE_MAX_MESSAGES - count($head))));
}

/* --- Configuracion --------------------------------------------------------- */

$apiKey = waise_read_setting('ai.key');
if ($apiKey === null) {
    waise_fail(503, 'El asistente no esta configurado: falta la API key en storage/waise/ai.key.');
}

$endpoint = waise_read_setting('ai.url') ?? WAISE_DEFAULT_BASE;
$model    = waise_read_setting('ai.model') ?? WAISE_DEFAULT_MODEL;

if (!filter_var($endpoint, FILTER_VALIDATE_URL) || stripos($endpoint, 'https://') !== 0) {
    waise_fail(500, 'El endpoint configurado en storage/waise/ai.url no es una URL https valida.');
}

if (!function_exists('curl_init')) {
    waise_fail(500, 'La extension cURL de PHP no esta disponible.');
}

/* --- Llamada upstream ------------------------------------------------------ */

$body = json_encode([
    'model'       => $model,
    'messages'    => $messages,
    'temperature' => 0.2,
    'stream'      => false,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

if ($body === false) {
    waise_fail(500, 'No se pudo serializar la peticion.');
}

$ch = curl_init($endpoint);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => WAISE_TIMEOUT,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'Accept: application/json',
        'Authorization: Bearer ' . $apiKey,
    ],
]);

$response = curl_exec($ch);
$status   = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($response === false) {
    error_log('[waise-ai] cURL: ' . $curlErr);
    waise_fail(502, 'No se pudo contactar con el proveedor de IA.');
}

$data = json_decode((string) $response, true);

if ($status < 200 || $status >= 300) {
    $upstream = 'El proveedor de IA respondio con codigo ' . $status . '.';
    if (is_array($data)) {
        if (isset($data['error']['message']) && is_string($data['error']['message'])) {
            $upstream = $data['error']['message'];
        } elseif (isset($data['error']) && is_string($data['error'])) {
            $upstream = $data['error'];
        } elseif (isset($data['message']) && is_string($data['message'])) {
            $upstream = $data['message'];
        }
    }
    error_log('[waise-ai] upstream ' . $status . ': ' . substr((string) $response, 0, 500));
    /* Siempre 502 hacia el navegador: un 401 del proveedor es un problema de
       configuracion del servidor, no de la sesion del usuario, y el JS
       mostraria "vuelve a iniciar sesion" por error. */
    waise_fail(502, $upstream);
}

if (!is_array($data)) {
    waise_fail(502, 'Respuesta ilegible del proveedor de IA.');
}

/* Extraccion del texto. El formato estilo OpenAI es el esperado; los otros
   caminos son tolerancia para proveedores que devuelven la forma corta. */
$content = null;

if (isset($data['choices'][0]['message']['content']) && is_string($data['choices'][0]['message']['content'])) {
    $content = $data['choices'][0]['message']['content'];
} elseif (isset($data['choices'][0]['text']) && is_string($data['choices'][0]['text'])) {
    $content = $data['choices'][0]['text'];
} elseif (isset($data['content']) && is_string($data['content'])) {
    $content = $data['content'];
} elseif (isset($data['content'][0]['text']) && is_string($data['content'][0]['text'])) {
    $content = $data['content'][0]['text'];
} elseif (isset($data['message']['content']) && is_string($data['message']['content'])) {
    $content = $data['message']['content'];
} elseif (isset($data['output_text']) && is_string($data['output_text'])) {
    $content = $data['output_text'];
}

if (!is_string($content) || trim($content) === '') {
    error_log('[waise-ai] formato inesperado: ' . substr((string) $response, 0, 500));
    waise_fail(502, 'El proveedor de IA devolvio una respuesta vacia o con un formato no reconocido.');
}

http_response_code(200);
echo json_encode(['content' => $content], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);