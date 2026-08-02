<?php
/* ---------------------------------------------------------------------------
   Waise Theme - assets/php/ai-diag.php

   DIAGNOSTICO TEMPORAL del proxy IA. Reproduce paso a paso lo que hace
   ai.php para autenticar y dice donde se rompe.

   Uso: copiar a public/waise/api/ai-diag.php y abrir en el MISMO navegador
   donde tienes la sesion del panel abierta:

       https://panel.xalfax.online/waise/api/ai-diag.php

   BORRALO en cuanto termines el diagnostico. No expone la API key ni la
   APP_KEY, pero si revela nombres de cookies y driver de sesion.
   --------------------------------------------------------------------------- */

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

define('WAISE_PANEL_DIR', dirname(__DIR__, 3));

$out = [];

function step(string $label, string $value): void
{
    global $out;
    $out[] = str_pad($label, 34, '.') . ' ' . $value;
}

step('PHP', PHP_VERSION);
step('usuario del proceso', function_exists('posix_getpwuid') && function_exists('posix_geteuid')
    ? (posix_getpwuid(posix_geteuid())['name'] ?? '?')
    : (getenv('USER') ?: '?'));
step('WAISE_PANEL_DIR', WAISE_PANEL_DIR);
step('vendor/autoload.php', is_file(WAISE_PANEL_DIR . '/vendor/autoload.php') ? 'existe' : 'NO EXISTE');
step('bootstrap/app.php', is_file(WAISE_PANEL_DIR . '/bootstrap/app.php') ? 'existe' : 'NO EXISTE');
step('.env legible', is_readable(WAISE_PANEL_DIR . '/.env') ? 'si' : 'NO (esto rompe la sesion)');

/* --- Cookies que llegan --------------------------------------------------- */

$cookieNames = array_keys($_COOKIE);
step('cookies recibidas', $cookieNames ? implode(', ', $cookieNames) : 'NINGUNA (<- causa probable)');

/* --- Bootstrap ------------------------------------------------------------ */

$autoload = WAISE_PANEL_DIR . '/vendor/autoload.php';
$bootstrap = WAISE_PANEL_DIR . '/bootstrap/app.php';

if (!is_file($autoload) || !is_file($bootstrap)) {
    $out[] = '';
    $out[] = 'ABORTADO: no se encuentra Laravel en WAISE_PANEL_DIR.';
    echo implode("\n", $out) . "\n";
    exit;
}

try {
    require_once $autoload;
    /** @var \Illuminate\Contracts\Foundation\Application $app */
    $app = require $bootstrap;
    $kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);
    $kernel->bootstrap();
    step('bootstrap Laravel', 'OK');
} catch (\Throwable $e) {
    step('bootstrap Laravel', 'EXCEPCION: ' . $e->getMessage());
    echo implode("\n", $out) . "\n";
    exit;
}

$config = $app->make('config');

step('APP_KEY', $config->get('app.key') ? 'presente' : 'VACIA (<- causa probable)');
step('SESSION_DRIVER', (string) $config->get('session.driver'));
step('nombre cookie sesion', (string) $config->get('session.cookie'));
step('session.domain', (string) ($config->get('session.domain') ?? '(null)'));
step('session.secure', $config->get('session.secure') ? 'true' : 'false');
step('session.path', (string) $config->get('session.path'));

$cookieName = (string) $config->get('session.cookie');
step('cookie de sesion presente', isset($_COOKIE[$cookieName]) ? 'SI' : 'NO (<- causa probable)');

if ((string) $config->get('session.driver') === 'file') {
    $sessionPath = (string) $config->get('session.files');
    step('session.files', $sessionPath);
    step('session.files escribible', is_dir($sessionPath) && is_writable($sessionPath) ? 'si' : 'NO (<- causa probable)');
}

/* --- Pipeline de sesion --------------------------------------------------- */

$encryptCookies = class_exists(\Pterodactyl\Http\Middleware\EncryptCookies::class)
    ? \Pterodactyl\Http\Middleware\EncryptCookies::class
    : \Illuminate\Cookie\Middleware\EncryptCookies::class;

step('clase EncryptCookies', $encryptCookies);

try {
    $request = \Illuminate\Http\Request::capture();
    $app->instance('request', $request);

    $pipeline = new \Illuminate\Pipeline\Pipeline($app);
    $pipeline->send($request)
        ->through([
            $encryptCookies,
            \Illuminate\Session\Middleware\StartSession::class,
        ])
        ->then(static function (\Illuminate\Http\Request $req) use ($app, &$out) {
            $app->instance('request', $req);

            $session = $req->hasSession() ? $req->session() : null;
            $out[] = str_pad('sesion iniciada', 34, '.') . ' ' . ($session ? 'si' : 'NO');
            if ($session) {
                $out[] = str_pad('session id', 34, '.') . ' ' . substr($session->getId(), 0, 8) . '...';
                $out[] = str_pad('claves en la sesion', 34, '.') . ' ' .
                    (count($session->all()) ? implode(', ', array_keys($session->all())) : 'NINGUNA (sesion nueva vacia)');
            }

            $auth = $app->make('auth');
            $out[] = str_pad('guard por defecto', 34, '.') . ' ' . $app->make('config')->get('auth.defaults.guard');
            $out[] = str_pad('auth guard(web)->check()', 34, '.') . ' ' . ($auth->guard('web')->check() ? 'TRUE' : 'FALSE');
            $out[] = str_pad('auth->check() (default)', 34, '.') . ' ' . ($auth->check() ? 'TRUE' : 'FALSE');

            $user = $auth->guard('web')->user();
            $out[] = str_pad('usuario', 34, '.') . ' ' . ($user ? ($user->email ?? ('id ' . $user->id)) : '(ninguno)');

            return new \Illuminate\Http\Response('');
        });
} catch (\Throwable $e) {
    step('pipeline sesion', 'EXCEPCION: ' . get_class($e) . ': ' . $e->getMessage());
    step('en', $e->getFile() . ':' . $e->getLine());
}

echo implode("\n", $out) . "\n";