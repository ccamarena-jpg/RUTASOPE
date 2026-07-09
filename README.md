# Ruteo TT Audit

Plataforma web (con vista móvil responsive) para asignar choferes a rutas diarias, dar seguimiento en tiempo real y dejar cargo de entrega (guía de remisión). Pensada como una alternativa simplificada a Circuit, adaptada al flujo de TT Audit.

## Que incluye

- **Admin**: crea/edita choferes, cuentas (clientes) y proyectos. Asigna rutas diarias una por una desde un calendario semanal (igual al formato "Control semanal de recorrido") o de forma masiva subiendo un CSV. Cada ruta indica chofer, cuenta y proyecto. Vista "Rutas de hoy" con estado de todas las rutas, actualizada automáticamente.
- **Chofer** (vista móvil): ve sus rutas del día, marca hora de salida y hora de llegada, escribe comentarios y adjunta la guía de remisión (foto o PDF) como cargo de entrega.
- **Cuenta / Cliente**: ve únicamente las rutas de su cuenta y el estado se actualiza solo (cada 15 segundos) conforme el chofer marca avances — sin necesidad de refrescar.

Roles con permisos separados (token firmado): `admin`, `chofer`, `cuenta`.

## Stack

- **Backend: Google Apps Script** publicado como aplicación web. Los datos viven en una hoja de **Google Sheets** (una pestaña por "tabla") y las guías de remisión en **Google Drive**. Sin servidor propio, sin base de datos que administrar y **sin costo**. No requiere proyecto en Google Cloud ni cuenta de servicio.
- **Frontend: React + Vite**, sitio estático responsive (funciona igual en celular, sin instalar una app nativa). Se despliega gratis en Vercel (o cualquier hosting estático).

## Puesta en marcha

### 1. Backend (Google Apps Script)
Sigue la guía paso a paso en [`apps-script/README.md`](apps-script/README.md):
crear la hoja → pegar `apps-script/Code.gs` → ejecutar `setup()` → publicar como
aplicación web → copiar la URL `/exec`.

### 2. Frontend
Necesita saber la URL del Web App mediante la variable `VITE_APPS_SCRIPT_URL`.

```bash
cd client
npm install
cp .env.example .env.local     # y pon dentro tu URL /exec
npm run dev                     # http://localhost:5173
```

> El frontend habla directo con el Web App de Apps Script (mismo comportamiento
> en local y en producción). No hay servidor local que levantar.

### 3. Despliegue en Vercel (gratis)
1. En [Vercel](https://vercel.com) → **Add New → Project**, importa este repo de GitHub.
2. Vercel lee `vercel.json` (construye el cliente y sirve el sitio estático).
3. En **Settings → Environment Variables** agrega `VITE_APPS_SCRIPT_URL` (URL `/exec`) y `VITE_GOOGLE_CLIENT_ID` (para el login con Google).
4. **Deploy**. Tendrás una URL `https://...vercel.app` con HTTPS.

## Usuarios y roles

- **Admin** (acceso total, asigna rutas) — entra con **Google**: `ccamarena@ttaudit.com`, `logistica@palmera.pe`, `epezo@ttaudit.com`, `botero@ttaudit.com`, `rgallo@ttaudit.com`, `operaciones@ttaudit.com`.
- **Responsable de cuenta** (crea proyectos, ve el seguimiento) — entra con **Google**: `rpulido@ttaudit.com`, `dolaguibel@ttaudit.com`, `mcarhuallanqui@ttaudit.com`, `ghidalgo@ttaudit.com`.
- **Chofer** (marca rutas, sube guías) — entra con **correo + contraseña**: `cris@ttaudit.com` / `Cris`.

La lista se administra en `userDirectory()` dentro de `apps-script/Code.gs`: edítala y ejecuta `syncUsers()`. Las contraseñas se guardan con hash SHA-256 + sal en la hoja `users`. El login con Google se configura con un ID de cliente OAuth (ver [`apps-script/README.md`](apps-script/README.md)).

## Carga masiva de rutas (CSV)

Desde el panel de administrador, en "Calendario semanal" > "Carga masiva (CSV)", puedes subir un archivo con estas columnas:

```
date,hour,driver_name,account_name,project_name,destino,motivo
```

También puedes usar `driver_id` / `account_id` / `project_id` en vez de los nombres si ya conoces los IDs. Ver `sample_bulk_routes.csv` como ejemplo.

## Estructura del proyecto

```
ruteo-app/
├── apps-script/       Backend (Google Apps Script)
│   ├── Code.gs        API completa: auth, catálogo, rutas, subida de guías
│   └── README.md      Guía de instalación y publicación del Web App
├── client/            Aplicación web (React + Vite)
│   └── src/
│       ├── pages/       Login, AdminDashboard, DriverView, AccountView
│       ├── components/  Calendario semanal, formularios, carga masiva, resumen
│       ├── utils/       Utilidades de fecha y CSV
│       └── api.js       Cliente que habla con el Web App de Apps Script
├── vercel.json        Configuración de despliegue estático en Vercel
└── sample_bulk_routes.csv
```

> `server/` contiene el backend anterior (Express + SQLite). Quedó como
> referencia/legado; **no se usa** con la arquitectura de Google Apps Script.

## Limitaciones y siguientes pasos sugeridos

- No incluye notificaciones push; el estado se actualiza por sondeo (polling) cada 15 segundos, suficiente para uso diario pero no instantáneo al 100%.
- No es una app nativa de tienda; es una web responsive que los choferes abren desde el navegador del celular y pueden "agregar a inicio" como acceso directo.
- Apps Script tiene cuotas diarias (ejecuciones y tiempo); para el volumen de ruteo diario son más que suficientes.
- Falta una pantalla de cambio de contraseña dentro de la app (por ahora se cambian editando el `password_hash` en la hoja).
