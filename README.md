# Ruteo TT Audit

Plataforma web (con vista móvil responsive) para asignar choferes a rutas diarias, dar seguimiento en tiempo real y dejar cargo de entrega (guía de remisión). Pensada como una alternativa simplificada a Circuit, adaptada al flujo de TT Audit.

## Que incluye

- **Admin**: crea/edita choferes, cuentas (clientes) y proyectos. Asigna rutas diarias una por una desde un calendario semanal (igual al formato "Control semanal de recorrido") o de forma masiva subiendo un CSV. Cada ruta indica chofer, cuenta y proyecto. Vista "Rutas de hoy" con estado de todas las rutas, actualizada automáticamente.
- **Chofer** (vista móvil): ve sus rutas del día, marca hora de salida y hora de llegada, escribe comentarios y adjunta la guía de remisión (foto o PDF) como cargo de entrega.
- **Cuenta / Cliente**: ve únicamente las rutas de su cuenta y el estado se actualiza solo (cada 15 segundos) conforme el chofer marca avances — sin necesidad de refrescar.

Roles con permisos separados (JWT): `admin`, `chofer`, `cuenta`.

## Stack

- Backend: Node.js + Express, base de datos SQLite (usa el módulo nativo `node:sqlite` de Node 22+, sin dependencias de compilación), autenticación JWT, subida de archivos con Multer, carga masiva de rutas vía CSV.
- Frontend: React + Vite, responsive (funciona igual en celular, sin necesidad de instalar una app nativa).

## Requisitos

- Node.js **22.5 o superior** (usa `node:sqlite`, revisa con `node -v`).

## Instalación y ejecución (modo desarrollo)

```bash
# 1. Backend
cd server
npm install
npm start          # http://localhost:4000

# 2. Frontend (en otra terminal)
cd client
npm install
npm run dev         # http://localhost:5173 (con proxy automático a la API)
```

Abre `http://localhost:5173` en tu navegador (o desde el celular usando la IP de tu compu en la misma red).

## Ejecución en producción (un solo servidor)

```bash
cd client
npm install
npm run build        # genera client/dist

cd ../server
npm install
npm start             # sirve la API y la app web en un solo puerto (4000)
```

Con esto, `http://localhost:4000` (o el dominio donde lo despliegues) sirve tanto la API como la aplicación web y móvil desde un único servidor. Para producción real, corre este servidor detrás de HTTPS (por ejemplo con un reverse proxy como Nginx o un hosting tipo Render/Railway/VPS) y cambia `JWT_SECRET` (ver abajo).

## Despliegue en Render

El repo incluye `render.yaml` (Blueprint) que crea un único servicio web: construye el cliente y arranca el servidor, que sirve la API y la app web en el mismo puerto.

1. En [Render](https://render.com) → **New** → **Blueprint**, conecta este repositorio de GitHub.
2. Render lee `render.yaml` automáticamente. `JWT_SECRET` se genera solo y `PORT` lo asigna Render.
3. Deploy. Al terminar tendrás una URL `https://ruteo-tt-audit.onrender.com` (o similar) con HTTPS.

La base de datos SQLite y las guías de remisión se guardan en un **disco persistente** montado en `/var/data` (variable `DATA_DIR`), así **no se borran** en cada despliegue. El disco requiere un plan de pago (Starter). Si prefieres el plan gratuito para probar, elimina del `render.yaml` la sección `disk` y la variable `DATA_DIR`: la app funciona igual, pero los datos se reinician cuando el servicio se reinicia.

> Nota: Vercel **no** sirve para esta app tal como está, porque usa un servidor de larga duración con SQLite en archivo y archivos subidos a disco (Vercel es serverless, sin disco persistente). Usa Render, Railway o un VPS.

## Variables de entorno

- `PORT`: puerto del servidor (lo asigna Render automáticamente; default local 4000).
- `JWT_SECRET`: clave para firmar tokens de sesión. **Cambiar en producción.**
- `DATA_DIR`: carpeta de datos persistentes (base de datos + uploads). Si no se define, se usa la carpeta del servidor (comportamiento local de siempre).

## Usuarios de prueba (datos semilla)

| Rol     | Correo                          | Contraseña  |
|---------|----------------------------------|-------------|
| Admin   | admin@ttaudit.com                | admin123    |
| Chofer  | christian.herrera@ttaudit.com    | chofer123   |
| Chofer  | luis.ramirez@ttaudit.com         | chofer123   |
| Cuenta  | cuenta.alicorp@cliente.com       | cuenta123   |
| Cuenta  | cuenta.backus@cliente.com        | cuenta123   |

La base de datos (`server/ruteo.db`) se crea y llena automáticamente con datos de ejemplo (choferes, cuentas, proyectos y algunas rutas) la primera vez que corres el servidor. Para reiniciar los datos, borra ese archivo y vuelve a correr `npm start`.

## Carga masiva de rutas (CSV)

Desde el panel de administrador, en "Calendario semanal" > "Carga masiva (CSV)", puedes descargar la plantilla y subir un archivo con estas columnas:

```
date,hour,driver_name,account_name,project_name,destino,motivo
```

También puedes usar `driver_id` / `account_id` / `project_id` en vez de los nombres si ya conoces los IDs. Ver `sample_bulk_routes.csv` en la raíz del proyecto como ejemplo.

## Estructura del proyecto

```
ruteo-app/
├── server/            API (Express + SQLite)
│   ├── db.js          Esquema y datos semilla
│   ├── index.js        Punto de entrada del servidor
│   ├── middleware/      Autenticación JWT y control de roles
│   ├── routes/          Endpoints: auth, catálogo (choferes/cuentas/proyectos), rutas
│   └── uploads/         Archivos de guías de remisión subidos por choferes
├── client/            Aplicación web (React + Vite)
│   └── src/
│       ├── pages/        Login, AdminDashboard, DriverView, AccountView
│       ├── components/   Calendario semanal, formularios, carga masiva
│       └── utils/        Utilidades de fecha
└── sample_bulk_routes.csv
```

## Limitaciones y siguientes pasos sugeridos

- No incluye notificaciones push; el estado se actualiza por sondeo (polling) cada 15 segundos, suficiente para uso diario pero no instantáneo al 100%.
- No es una app nativa de tienda (App Store / Play Store); es una web responsive que los choferes pueden abrir desde el navegador del celular y, si quieren, "agregar a inicio" como acceso directo.
- Para producción real conviene: usar HTTPS, mover `JWT_SECRET` a variable de entorno segura, agregar respaldo/backup de la base de datos y considerar un almacenamiento externo (S3 o similar) para las guías de remisión si el volumen crece.
