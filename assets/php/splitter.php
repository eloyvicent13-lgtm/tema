<?php
/* ---------------------------------------------------------------------------
   Waise Theme - assets/php/splitter.php

   Server Splitter: permite a un usuario NORMAL repartir los recursos de un
   servidor que le pertenece creando servidores hijos en el mismo nodo.

   El instalador lo copia a public/waise/api/splitter.php. Contrato con
   assets/js/waise-splitter.js (POST JSON):

       { "action": "info",  "server": "<uuidShort>" }
       { "action": "split", "server": "<uuidShort>",
         "name": "...", "memory": 1024, "cpu": 50, "disk": 5120 }

   Respuestas: 200 con el objeto pedido, o un codigo de error con
   { "error": "mensaje" }.

   SUMA CERO: lo que recibe el hijo se le resta al padre en la misma
   operacion. El endpoint NUNCA sube limites, solo reparte, asi que un cliente
   no puede fabricarse recursos. Ademas hay techo de particiones y minimos
   para que el padre no quede inarrancable.

   A diferencia de ai.php, aqui SI se usan los servicios internos del panel
   (ServerCreationService / BuildModificationService). Eso ata el modulo a la
   version del panel: si Pterodactyl cambia esas firmas, el splitter deja de
   funcionar (falla en cerrado, nunca a medias).
   --------------------------------------------------------------------------- */

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

/* public/waise/api/splitter.php -> tres niveles arriba esta la raiz del panel. */
define('WAISE_PANEL_DIR', dirname(__DIR__, 3));
define('WAISE_STORAGE_DIR', WAISE_PANEL_DIR . '/storage/waise');

/* Minimos que SIEMPRE conserva el servidor padre. Por debajo de esto un
   servidor de juego no arranca y el usuario se quedaria sin nada usable. */
const WAISE_MIN_PARENT_MEMORY = 1024;   // MiB
const WAISE_MIN_PARENT_CPU    = 20;     // %
const WAISE_MIN_PARENT_DISK   = 2048;   // MiB

/* Minimos que debe recibir el hijo para que tenga sentido crearlo. */
const WAISE_MIN_CHILD_MEMORY  = 512;
const WAISE_MIN_CHILD_DISK    = 1024;

/* Techo de hijos por servidor padre. Evita llenar la base de datos de
   servidores de 128 MB. Sobrescribible con storage/waise/splitter.max */
const WAISE_DEFAULT_MAX_CHILDREN = 3;

const WAISE_MAX_BODY = 8192;

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function waise_fail(int $status, string $message): void
{
    http_response_code($status);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function waise_ok(array $payload): void
{
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function waise_read_setting(string $name): ?string
{
    $path = WAISE_STORAGE_DIR . '/' . $name;
    if (!is_file($path) || !is_readable($path)) {
        return null;
    }
    $value = trim((string) file_get_contents($path));

    return $value === '' ? null : $value;
}

function waise_max_children(): int
{
    $raw = waise_read_setting('splitter.max');
    if ($raw === null || !ctype_digit($raw)) {
        return WAISE_DEFAULT_MAX_CHILDREN;
    }
    $value = (int) $raw;

    return $value >= 1 && $value <= 20 ? $value : WAISE_DEFAULT_MAX_CHILDREN;
}

/* --- Metodo y proteccion cross-site ---------------------------------------- */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    waise_fail(405, 'Metodo no permitido.');
}

if (strcasecmp($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '', 'XMLHttpRequest') !== 0) {
    waise_fail(403, 'Peticion no valida.');
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
    $originHost = parse_url($origin, PHP_URL_HOST);
    $selfHost   = $_SERVER['HTTP_HOST'] ?? '';
    if (!is_string($originHost) || strcasecmp($originHost, preg_replace('/:\d+$/', '', $selfHost)) !== 0) {
        waise_fail(403, 'Origen no permitido.');
    }
}

/* --- Entrada --------------------------------------------------------------- */

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    waise_fail(400, 'Cuerpo vacio.');
}
if (strlen($raw) > WAISE_MAX_BODY) {
    waise_fail(413, 'Peticion demasiado grande.');
}

$payload = json_decode($raw, true);
if (!is_array($payload)) {
    waise_fail(400, 'JSON no valido.');
}

$action   = isset($payload['action']) ? (string) $payload['action'] : '';
$serverId = isset($payload['server']) ? (string) $payload['server'] : '';

if (!in_array($action, ['info', 'split'], true)) {
    waise_fail(400, 'Accion desconocida.');
}
if (preg_match('/^[a-zA-Z0-9]{6,16}$/', $serverId) !== 1) {
    waise_fail(400, 'Identificador de servidor no valido.');
}

/* --- Arranque de Laravel y sesion ------------------------------------------ */
/* Mismo procedimiento que ai.php: el request debe estar enlazado ANTES de
   bootstrap(), y EncryptCookies tiene que descifrar la cookie antes de que
   StartSession la lea. Si el bootstrap falla se deniega. */

$app  = null;
$user = null;

$autoload  = WAISE_PANEL_DIR . '/vendor/autoload.php';
$bootstrap = WAISE_PANEL_DIR . '/bootstrap/app.php';

if (is_file($autoload) && is_file($bootstrap)) {
    try {
        require_once $autoload;
        /** @var \Illuminate\Contracts\Foundation\Application $app */
        $app = require $bootstrap;

        $request = \Illuminate\Http\Request::capture();
        $app->instance('request', $request);

        $kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);
        $kernel->bootstrap();

        $encryptCookies = class_exists(\Pterodactyl\Http\Middleware\EncryptCookies::class)
            ? \Pterodactyl\Http\Middleware\EncryptCookies::class
            : \Illuminate\Cookie\Middleware\EncryptCookies::class;

        $pipeline = new \Illuminate\Pipeline\Pipeline($app);
        $pipeline->send($request)
            ->through([
                $encryptCookies,
                \Illuminate\Session\Middleware\StartSession::class,
            ])
            ->then(static function (\Illuminate\Http\Request $req) use ($app, &$user) {
                $app->instance('request', $req);
                $guard = $app->make('auth')->guard('web');
                $user  = $guard->check() ? $guard->user() : null;

                return new \Illuminate\Http\Response('');
            });
    } catch (\Throwable $e) {
        error_log('[waise-splitter] bootstrap sesion: ' . $e->getMessage());
        $user = null;
    }
}

if ($user === null) {
    waise_fail(401, 'Sesion no valida. Vuelve a iniciar sesion en el panel.');
}

/* --- Servidor padre y propiedad -------------------------------------------- */

try {
    $parent = \Pterodactyl\Models\Server::query()
        ->where('uuidShort', $serverId)
        ->first();
} catch (\Throwable $e) {
    error_log('[waise-splitter] consulta servidor: ' . $e->getMessage());
    waise_fail(500, 'No se pudo consultar el servidor.');
}

if ($parent === null) {
    waise_fail(404, 'Servidor no encontrado.');
}

/* Solo el DUEnO. Un subusuario con permisos amplios no puede repartir los
   recursos de un servidor que no es suyo. */
if ((int) $parent->owner_id !== (int) $user->id) {
    waise_fail(403, 'Solo el propietario del servidor puede repartir sus recursos.');
}

if ($parent->isSuspended() || $parent->status !== null) {
    waise_fail(409, 'El servidor esta suspendido o en instalacion. Intentalo mas tarde.');
}

/* --- Registro de particiones ------------------------------------------------
   No se toca el esquema de la base de datos: el arbol padre->hijos vive en
   storage/waise/splits.json. Al leerlo se descartan los hijos que ya no
   existen en la BD (el usuario pudo borrarlos desde el panel). */

$splitsFile = WAISE_STORAGE_DIR . '/splits.json';

function waise_load_splits(string $file): array
{
    if (!is_file($file) || !is_readable($file)) {
        return [];
    }
    $data = json_decode((string) file_get_contents($file), true);

    return is_array($data) ? $data : [];
}

function waise_save_splits(string $file, array $data): bool
{
    $dir = dirname($file);
    if (!is_dir($dir)) {
        return false;
    }
    $tmp  = $file . '.tmp';
    $json = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($json === false || file_put_contents($tmp, $json, LOCK_EX) === false) {
        return false;
    }

    return rename($tmp, $file);
}

$splits   = waise_load_splits($splitsFile);
$key      = (string) $parent->uuid;
$recorded = isset($splits[$key]) && is_array($splits[$key]) ? array_values(array_unique(array_map('intval', $splits[$key]))) : [];

$alive = [];
if (count($recorded) > 0) {
    try {
        $alive = \Pterodactyl\Models\Server::query()
            ->whereIn('id', $recorded)
            ->pluck('id')
            ->map('intval')
            ->all();
    } catch (\Throwable $e) {
        $alive = $recorded;
    }
}

$maxChildren = waise_max_children();
$used        = count($alive);

/* --- Recursos disponibles --------------------------------------------------- */
/* Un limite a 0 significa "sin limite" en Pterodactyl. No se puede repartir
   un infinito, asi que ese caso se rechaza en vez de inventar un numero. */

$unlimited = [];
if ((int) $parent->memory === 0) { $unlimited[] = 'RAM'; }
if ((int) $parent->disk === 0)   { $unlimited[] = 'disco'; }

$maxGive = [
    'memory' => max(0, (int) $parent->memory - WAISE_MIN_PARENT_MEMORY),
    'cpu'    => (int) $parent->cpu === 0 ? 0 : max(0, (int) $parent->cpu - WAISE_MIN_PARENT_CPU),
    'disk'   => max(0, (int) $parent->disk - WAISE_MIN_PARENT_DISK),
];

if ($action === 'info') {
    $freeAllocations = 0;
    try {
        $freeAllocations = \Pterodactyl\Models\Allocation::query()
            ->where('node_id', $parent->node_id)
            ->whereNull('server_id')
            ->count();
    } catch (\Throwable $e) {
        $freeAllocations = 0;
    }

    waise_ok([
        'server' => [
            'name'   => (string) $parent->name,
            'memory' => (int) $parent->memory,
            'cpu'    => (int) $parent->cpu,
            'disk'   => (int) $parent->disk,
        ],
        'limits' => [
            'minParent' => [
                'memory' => WAISE_MIN_PARENT_MEMORY,
                'cpu'    => WAISE_MIN_PARENT_CPU,
                'disk'   => WAISE_MIN_PARENT_DISK,
            ],
            'minChild' => [
                'memory' => WAISE_MIN_CHILD_MEMORY,
                'disk'   => WAISE_MIN_CHILD_DISK,
            ],
            'maxGive' => $maxGive,
        ],
        'children'        => ['used' => $used, 'max' => $maxChildren],
        'unlimited'       => $unlimited,
        'freeAllocations' => $freeAllocations,
        'canSplit'        => count($unlimited) === 0
            && $used < $maxChildren
            && $maxGive['memory'] >= WAISE_MIN_CHILD_MEMORY
            && $maxGive['disk'] >= WAISE_MIN_CHILD_DISK
            && $freeAllocations > 0,
    ]);
}

/* --- Accion: split ---------------------------------------------------------- */

if (count($unlimited) > 0) {
    waise_fail(409, 'Este servidor tiene ' . implode(' y ', $unlimited) . ' sin limite: no hay una cantidad concreta que repartir.');
}

if ($used >= $maxChildren) {
    waise_fail(409, 'Este servidor ya esta dividido en el maximo permitido (' . $maxChildren . ').');
}

$name   = isset($payload['name']) ? trim((string) $payload['name']) : '';
$memory = isset($payload['memory']) ? (int) $payload['memory'] : 0;
$cpu    = isset($payload['cpu']) ? (int) $payload['cpu'] : 0;
$disk   = isset($payload['disk']) ? (int) $payload['disk'] : 0;

if ($name === '') {
    $name = substr((string) $parent->name, 0, 40) . ' - parte ' . ($used + 2);
}
if (mb_strlen($name) > 191) {
    $name = mb_substr($name, 0, 191);
}
/* Sin caracteres de control: el nombre acaba en la UI y en los logs de wings. */
$name = preg_replace('/[\x00-\x1f\x7f]/u', '', $name);
if ($name === null || trim($name) === '') {
    waise_fail(400, 'Nombre no valido.');
}

if ($memory < WAISE_MIN_CHILD_MEMORY) {
    waise_fail(422, 'El servidor nuevo necesita al menos ' . WAISE_MIN_CHILD_MEMORY . ' MiB de RAM.');
}
if ($disk < WAISE_MIN_CHILD_DISK) {
    waise_fail(422, 'El servidor nuevo necesita al menos ' . WAISE_MIN_CHILD_DISK . ' MiB de disco.');
}
if ($cpu < 0) {
    waise_fail(422, 'Valor de CPU no valido.');
}

if ($memory > $maxGive['memory']) {
    waise_fail(422, 'No puedes ceder mas de ' . $maxGive['memory'] . ' MiB de RAM: el servidor original debe conservar ' . WAISE_MIN_PARENT_MEMORY . ' MiB.');
}
if ($disk > $maxGive['disk']) {
    waise_fail(422, 'No puedes ceder mas de ' . $maxGive['disk'] . ' MiB de disco: el servidor original debe conservar ' . WAISE_MIN_PARENT_DISK . ' MiB.');
}
if ($cpu > $maxGive['cpu']) {
    waise_fail(422, 'No puedes ceder mas de ' . $maxGive['cpu'] . '% de CPU: el servidor original debe conservar ' . WAISE_MIN_PARENT_CPU . '%.');
}

/* Allocation libre en el MISMO nodo que el padre. Sin esto el hijo no tiene
   puerto y wings no puede arrancarlo. */
try {
    $allocation = \Pterodactyl\Models\Allocation::query()
        ->where('node_id', $parent->node_id)
        ->whereNull('server_id')
        ->orderBy('id')
        ->first();
} catch (\Throwable $e) {
    error_log('[waise-splitter] allocations: ' . $e->getMessage());
    waise_fail(500, 'No se pudieron consultar los puertos disponibles.');
}

if ($allocation === null) {
    waise_fail(409, 'No quedan puertos libres en este nodo. Avisa al administrador.');
}

/* Variables del egg: se copian tal cual las tiene el padre, y las que el
   padre no tenga definidas caen al valor por defecto del egg. */
$environment = [];
try {
    foreach ($parent->egg->variables as $variable) {
        $environment[$variable->env_variable] = $variable->default_value;
    }
    foreach ($parent->variables as $serverVariable) {
        if ($serverVariable->variable !== null) {
            $environment[$serverVariable->variable->env_variable] = $serverVariable->variable_value;
        }
    }
} catch (\Throwable $e) {
    error_log('[waise-splitter] variables: ' . $e->getMessage());
    waise_fail(500, 'No se pudo leer la configuracion del huevo del servidor.');
}

$original = [
    'memory' => (int) $parent->memory,
    'cpu'    => (int) $parent->cpu,
    'disk'   => (int) $parent->disk,
];

$build = $app->make(\Pterodactyl\Services\Servers\BuildModificationService::class);

/* Paso 1: restar al padre. Se hace ANTES de crear al hijo para que en ningun
   instante existan los recursos duplicados. */
try {
    $build->handle($parent, [
        'allocation_id'    => (int) $parent->allocation_id,
        'memory'           => $original['memory'] - $memory,
        'swap'             => (int) $parent->swap,
        'disk'             => $original['disk'] - $disk,
        'io'               => (int) $parent->io,
        'cpu'              => $original['cpu'] - $cpu,
        'threads'          => $parent->threads,
        'oom_disabled'     => (bool) $parent->oom_disabled,
        'database_limit'   => $parent->database_limit,
        'allocation_limit' => $parent->allocation_limit,
        'backup_limit'     => $parent->backup_limit,
    ]);
} catch (\Throwable $e) {
    error_log('[waise-splitter] build padre: ' . $e->getMessage());
    waise_fail(500, 'No se pudieron ajustar los recursos del servidor original. No se ha cambiado nada.');
}

/* Paso 2: crear el hijo con lo restado. */
$data = [
    'name'             => $name,
    'owner_id'         => (int) $parent->owner_id,
    'node_id'          => (int) $parent->node_id,
    'egg_id'           => (int) $parent->egg_id,
    'allocation_id'    => (int) $allocation->id,
    'memory'           => $memory,
    'swap'             => 0,
    'disk'             => $disk,
    'io'               => (int) $parent->io,
    'cpu'              => $cpu,
    'threads'          => $parent->threads,
    'oom_disabled'     => (bool) $parent->oom_disabled,
    'startup'          => (string) $parent->startup,
    'image'            => (string) $parent->image,
    'environment'      => $environment,
    'database_limit'   => 0,
    'allocation_limit' => 0,
    'backup_limit'     => 0,
    'start_on_completion' => false,
];

/* nest_id solo si la instalacion todavia tiene esa columna: se elimino en las
   versiones recientes y pasarla haria fallar el fill del modelo. */
try {
    if (\Illuminate\Support\Facades\Schema::hasColumn('servers', 'nest_id')) {
        $data['nest_id'] = (int) $parent->nest_id;
    }
} catch (\Throwable $e) {
    /* Si no se puede comprobar, no se manda: es el caso seguro. */
}

$child = null;
$error = null;

try {
    $creation = $app->make(\Pterodactyl\Services\Servers\ServerCreationService::class);
    $child    = $creation->handle($data);
} catch (\Throwable $e) {
    $error = $e->getMessage();
    error_log('[waise-splitter] creacion hijo: ' . $error);
}

if ($child === null) {
    /* Deshacer el paso 1: el usuario no debe perder recursos por un fallo. */
    try {
        $build->handle($parent, [
            'allocation_id'    => (int) $parent->allocation_id,
            'memory'           => $original['memory'],
            'swap'             => (int) $parent->swap,
            'disk'             => $original['disk'],
            'io'               => (int) $parent->io,
            'cpu'              => $original['cpu'],
            'threads'          => $parent->threads,
            'oom_disabled'     => (bool) $parent->oom_disabled,
            'database_limit'   => $parent->database_limit,
            'allocation_limit' => $parent->allocation_limit,
            'backup_limit'     => $parent->backup_limit,
        ]);
        waise_fail(500, 'No se pudo crear el servidor nuevo. Los recursos del original se han restaurado.');
    } catch (\Throwable $e) {
        error_log('[waise-splitter] rollback padre: ' . $e->getMessage());
        waise_fail(500, 'No se pudo crear el servidor nuevo y ademas fallo la restauracion del original. Avisa al administrador.');
    }
}

/* Paso 3: registrar la particion. Si esto falla el reparto ya es valido, asi
   que no se aborta: solo se pierde el contador y se avisa en el log. */
$splits[$key] = array_values(array_unique(array_merge($alive, [(int) $child->id])));
if (!waise_save_splits($splitsFile, $splits)) {
    error_log('[waise-splitter] no se pudo escribir ' . $splitsFile);
}

waise_ok([
    'ok'     => true,
    'child'  => [
        'id'        => (string) $child->uuidShort,
        'name'      => (string) $child->name,
        'url'       => '/server/' . $child->uuidShort,
        'memory'    => $memory,
        'cpu'       => $cpu,
        'disk'      => $disk,
    ],
    'parent' => [
        'memory' => $original['memory'] - $memory,
        'cpu'    => $original['cpu'] - $cpu,
        'disk'   => $original['disk'] - $disk,
    ],
    'children' => ['used' => count($splits[$key]), 'max' => $maxChildren],
]);