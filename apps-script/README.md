# Backend en Google Apps Script

Este backend reemplaza a la API serverless. **No requiere** proyecto en Google
Cloud, ni cuenta de servicio, ni llave JSON, ni activar APIs. Solo pegas el
código en el editor de Apps Script del propio Google Sheet y lo publicas como
aplicación web. Es gratis.

## Paso a paso (una sola vez, ~10 minutos)

### 1. Crear la hoja de cálculo
1. Entra a https://sheets.google.com y crea una hoja nueva.
2. Ponle un nombre, por ejemplo **Ruteo TT Audit**.

### 2. Pegar el código
1. En la hoja, menú **Extensiones → Apps Script**.
2. Borra el contenido de `Código.gs` y pega **todo** el contenido de
   [`Code.gs`](Code.gs) de esta carpeta.
3. En la parte de arriba del archivo, en `CONFIG`, cambia:
   - `JWT_SECRET`: pon una cadena larga y aleatoria (invéntala, mientras más
     larga mejor). Es la llave que firma las sesiones.
   - `DRIVE_FOLDER_ID` (opcional): si quieres que las guías de remisión se
     guarden en una carpeta específica de Drive, crea la carpeta, ábrela y copia
     el ID de la URL (`/drive/folders/ESTE_ID`). Si lo dejas vacío, se guardan
     en la raíz de tu Drive.
4. Guarda (icono de disquete o `Ctrl+S`).

### 3. Crear las pestañas y datos de ejemplo
1. Arriba, en el selector de funciones, elige **`setup`** y presiona
   **Ejecutar** (▶).
2. La primera vez Google pedirá **autorizar** los permisos (para leer/escribir
   la hoja y Drive). Acepta con tu cuenta.
3. Al terminar, la hoja tendrá las pestañas `users`, `drivers`, `accounts`,
   `projects`, `routes` con los datos de ejemplo.

### 4. Publicar como aplicación web
1. Arriba a la derecha: **Implementar → Nueva implementación**.
2. Tipo (engranaje): **Aplicación web**.
3. Configura:
   - **Descripción**: `Ruteo API` (lo que quieras).
   - **Ejecutar como**: **Yo** (tu cuenta).
   - **Quién tiene acceso**: **Cualquier persona**.
4. **Implementar** → copia la **URL de la aplicación web** (termina en `/exec`).

> Cada vez que edites el código, entra a **Implementar → Gestionar
> implementaciones**, edita la existente (lápiz) y sube la versión a **Nueva
> versión**. Así la URL **no cambia**. (O usa clasp: `npm run gas:redeploy`, ver
> [Despliegue automatizado con clasp](#despliegue-automatizado-con-clasp-recomendado).)

### 4b. Iniciar sesión con Google (para el personal TT Audit)

El personal (admins y responsables de cuenta) entra con **"Continuar con
Google"**. Para eso necesitas crear **una vez** un ID de cliente OAuth (gratis,
sin llaves, sin costo):

1. Entra a https://console.cloud.google.com y crea (o elige) un proyecto.
2. Menú **APIs y servicios → Pantalla de consentimiento OAuth**: configúrala
   (tipo *Interno* si todos son de tu Workspace, o *Externo*). Pon el nombre de
   la app y tu correo de soporte.
3. **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de
   OAuth → Aplicación web**.
4. En **Orígenes autorizados de JavaScript** agrega las URLs desde donde se abre
   la app (sin barra final), por ejemplo:
   - `http://localhost:5173` (desarrollo)
   - `https://tu-app.vercel.app` (producción)
5. Crea y copia el **ID de cliente** (`....apps.googleusercontent.com`).
6. Pégalo en **dos** lugares con el MISMO valor:
   - Backend: `CONFIG.GOOGLE_CLIENT_ID` en `Code.gs` (y vuelve a publicar una
     nueva versión).
   - Frontend: variable `VITE_GOOGLE_CLIENT_ID` (en Vercel o en `.env.local`).

> Los choferes no usan Google: entran con correo y contraseña.

### 5. Conectar el frontend
Pon esa URL `/exec` en el frontend, de una de estas dos formas:

- **Recomendado (Vercel):** en tu proyecto de Vercel, *Settings → Environment
  Variables*, agrega `VITE_APPS_SCRIPT_URL` con la URL, y vuelve a desplegar.
- **Rápido:** ábrela directo en el código, en `client/src/api.js`, y reemplaza
  `PEGA_AQUI_LA_URL_DEL_WEB_APP` por tu URL.

Para desarrollo local, crea `client/.env.local` con:

```
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/XXXX/exec
```

## Despliegue automatizado con clasp (recomendado)

En vez de copiar/pegar el `Code.gs` a mano cada vez, puedes publicar desde la
terminal con [clasp](https://github.com/google/clasp). Los comandos ya están en
el `package.json` de la raíz (usan `npx`, no hace falta instalar nada global).

### Configuración (una sola vez)

1. **Activa la Apps Script API** para tu cuenta en
   https://script.google.com/home/usersettings (interruptor **On**).
2. **Inicia sesión** con tu cuenta de Google (abre el navegador):
   ```bash
   npm run gas:login
   ```
   Esto guarda tus credenciales en `~/.clasprc.json` (fuera del repo, ya está en
   `.gitignore`). Este paso es **tuyo**: Claude no puede hacer el login por ti.
3. **Pega el Script ID** en [`.clasp.json`](../.clasp.json) (raíz del repo),
   reemplazando `PEGA_AQUI_EL_SCRIPT_ID`. Lo encuentras en el editor de Apps
   Script: **Configuración del proyecto (⚙) → ID de la secuencia de comandos**.
   > Ojo: el *Script ID* NO es el mismo que el *Deployment ID* (el `AKfycb...` de
   > la URL `/exec`). El Deployment ID ya está fijado en el script `gas:deploy`
   > para que la URL **nunca cambie**.

### Día a día

```bash
npm run gas:redeploy
```

Eso hace `gas:push` (sube `Code.gs` + `appsscript.json`) y luego `gas:deploy`,
que actualiza **la misma implementación** (mismo Deployment ID → **misma URL
`/exec`**, sin invalidar sesiones). Reemplaza todo el flujo manual de "pegar +
Gestionar implementaciones → Versión nueva".

Otros comandos: `npm run gas:push` (solo subir, sin publicar), `npm run
gas:deployments` (listar implementaciones/IDs), `npm run gas:open` (abrir el
editor).

### Qué NO cubre clasp
- **Correr funciones** como `setup()` o `migrateLocations()` sigue siendo manual
  desde el editor (solo hace falta al **agregar pestañas nuevas** al `SCHEMA`,
  algo poco frecuente). `clasp run` existe pero requiere un proyecto de Google
  Cloud propio; no vale la pena para este uso.
- Si cambiaste el manifiesto (`appsscript.json`) y difiere del remoto, el primer
  `gas:push` te preguntará si sobrescribir. El de este repo ya refleja la config
  actual (zona Lima, V8, Web App: *Cualquier persona* / *Ejecutar como yo*).

### Verificar que quedó bien
Tras desplegar, confirma que el `/exec` responde JSON (no HTML):
```bash
curl -sL -X POST "https://script.google.com/macros/s/AKfycbwiCJ3CIMNpXWEAA8eIzbH4gjBKIKSDif-55NkBK0t2yiDq245m4J3YbLEiLuJg25mE/exec" -H "Content-Type: text/plain" --data '{"path":"/drivers","method":"GET","token":"","query":{},"body":{}}'
```
Debe devolver `{"ok":false,"status":401,"error":"No autenticado"}` = backend sano.

## Usuarios (creados por `setup` / `syncUsers`)

Los usuarios reales viven en la función `userDirectory()` dentro de `Code.gs`.
Para **agregar o cambiar** usuarios: edita esa lista y ejecuta la función
**`syncUsers`** desde el editor (agrega los que falten y actualiza rol/chofer,
sin borrar los existentes).

| Rol    | Entra con        | Correos |
|--------|------------------|---------|
| Admin  | Google           | ccamarena@ttaudit.com, logistica@palmera.pe, epezo@ttaudit.com, botero@ttaudit.com, rgallo@ttaudit.com, operaciones@ttaudit.com |
| Cuenta | Google           | rpulido@ttaudit.com, dolaguibel@ttaudit.com, mcarhuallanqui@ttaudit.com, ghidalgo@ttaudit.com |
| Chofer | Correo + clave   | cris@ttaudit.com / `Cris` |

- **Admin**: acceso total; asigna rutas.
- **Cuenta** (responsable): crea proyectos para cualquier cuenta y ve el
  seguimiento en tiempo real.
- **Chofer**: ve sus rutas, marca salida/llegada y sube la guía de remisión.

## Notas
- **Seguridad de contraseñas:** se guardan con hash SHA-256 + sal (no en texto
  plano). Para cambiar una contraseña, edita el `password_hash` de la fila del
  usuario ejecutando `hashPassword('nuevaClave')` desde el editor y pegando el
  resultado, o pide que se agregue una pantalla de cambio de contraseña.
- **Cuotas:** Apps Script tiene límites diarios (ejecuciones, tiempo). Para el
  uso diario de ruteo son más que suficientes.
- **Datos:** viven en la propia hoja de cálculo; puedes verlos y editarlos a
  mano cuando quieras. Las guías de remisión quedan en tu Google Drive.
