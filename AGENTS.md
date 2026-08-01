# Instrucciones para agentes en este repo

## REGLA 1 — Todo cambio termina en GitHub

Editar el archivo en local **no sirve de nada** por si solo. El VPS instala el
tema tirando de este repositorio, asi que cualquier cambio debe acabar en
`origin/main` o el usuario no puede aplicarlo.

Flujo obligatorio en CADA tarea que toque archivos del tema:

1. Editar los archivos.
2. Validar lo que se pueda (`node --check assets/js/waise.js` para el JS).
3. `git add -A`
4. `git commit -m "<mensaje descriptivo>"`
5. `git push origin main`
6. Avisar al usuario de que ya puede ejecutar en su VPS:

       sudo waise upgrade

No dar una tarea por terminada sin el `git push`. No pedir permiso para
subir: subir es parte del trabajo.

## Datos del proyecto

- Remoto: `https://github.com/eloyvicent13-lgtm/tema.git`
- Rama de trabajo y despliegue: `main`
- Despliegue en el VPS: `sudo waise upgrade` (lo lanza el usuario, no el agente)

## Notas del codigo

- `assets/js/waise.js` contiene comentarios con caracteres ya corruptos de
  ediciones anteriores. Al editarlo por script, leer y escribir en Latin1
  (codepage 28591) para no alterar esos bytes, y escribir el texto nuevo en
  ASCII puro (sin tildes).
- Los saltos de linea del archivo son LF. Mantenerlos.
- Los `.bak` estan en `.gitignore`; no subirlos.

## Aviso sobre rutas con espacios

La ruta local del proyecto contiene espacios (`Nueva carpeta (15)`). El
parametro `path=` de write_file/edit_file se corta en el primer espacio, asi
que usar SIEMPRE rutas relativas al repo, o aplicar los cambios via shell con
`Set-Location "<ruta entre comillas>"`.