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
> versión**. Así la URL **no cambia**.

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

## Usuarios de prueba (creados por `setup`)

| Rol    | Correo                        | Contraseña |
|--------|-------------------------------|------------|
| Admin  | admin@ttaudit.com             | admin123   |
| Chofer | christian.herrera@ttaudit.com | chofer123  |
| Cuenta | cuenta.alicorp@cliente.com    | cuenta123  |

## Notas
- **Seguridad de contraseñas:** se guardan con hash SHA-256 + sal (no en texto
  plano). Para cambiar una contraseña, edita el `password_hash` de la fila del
  usuario ejecutando `hashPassword('nuevaClave')` desde el editor y pegando el
  resultado, o pide que se agregue una pantalla de cambio de contraseña.
- **Cuotas:** Apps Script tiene límites diarios (ejecuciones, tiempo). Para el
  uso diario de ruteo son más que suficientes.
- **Datos:** viven en la propia hoja de cálculo; puedes verlos y editarlos a
  mano cuando quieras. Las guías de remisión quedan en tu Google Drive.
