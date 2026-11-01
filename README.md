# Ojo de Dios 2.0

Globo terráqueo 3D educativo construido con CesiumJS. Muestra, en tiempo real sobre un mapa interactivo:

- 🛰️ La Estación Espacial Internacional (ISS), Tiangong y el telescopio Hubble, con propagación orbital real (SGP4/TLE públicos de CelesTrak).
- ✈️ Tráfico aéreo comercial en vivo (ADS-B público, vía adsb.lol) con ficha de cada vuelo.
- 🪖 Bases militares, navales y aéreas de ubicación públicamente documentada (solo nombre y posición; sin feeds en vivo).
- 🔬 Instalaciones científicas estratégicas (CERN, Kennedy Space Center, Svalbard, ALMA) y HAARP.

## Desarrollo

```bash
npm install
npm run dev
```

## Compilar la app web

```bash
npm run build
```

## Compilar el APK de Android

El workflow `.github/workflows/android.yml` compila un APK de depuración en cada push a `main` y lo deja como artefacto y como versión (release) del repositorio.

## Qué se dejó fuera

Esta versión no incluye un directorio de cámaras públicas: agregar y transmitir cámaras de todo el mundo, incluso cuando se las llame "de acceso abierto", termina incluyendo cámaras privadas mal configuradas y expuestas por error, sin el consentimiento de quien está detrás. Si necesitás ver tus propias cámaras de seguridad, se puede construir un visor aparte con tus credenciales.


## CCTV Mesh (rama `feature/cctv-mesh`)

Se añadió una capa de cámaras públicas de tránsito con adaptadores regionales, proxy Node integrado en Vite y geometría Cesium 3D. El servidor limita catálogos a 2–4 MiB, imágenes a 4 MiB, no sigue redirecciones, exige HTTPS, aplica allowlist por autoridad y valida DNS/IP antes de abrir la conexión.

**Importante:** los adaptadores regionales se incorporan como pendientes de verificación. Un endpoint sugerido o una etiqueta de licencia en un comentario no demuestra que la API exista ni que autorice reutilizar sus imágenes. Para evitar tráfico a rutas inventadas y atribuciones incorrectas, una fuente solo se activa cuando su módulo se marca `verified: true` después de comprobar endpoint, formato, imagen y licencia. Delaware y Austria no traían una URL de catálogo verificable y permanecen desactivadas.

### Desarrollo

```bash
npm install
npm run dev
```

La capa se abre desde **Cámaras públicas de tránsito**. Incluye filtros regionales, NEAREST, VIEWSHED estimado y un gizmo arrastrable para ajustar la orientación. Las imágenes se proyectan sobre un plano Cesium 3D de la cámara seleccionada; no se incrustan como webcam externa.

### Cesium ion opcional

Crear un archivo `.env.local`:

```bash
VITE_CESIUM_ION_TOKEN=tu_token_restringido
```

El token es público en el cliente: restringilo en Cesium ion al dominio de la aplicación y al asset necesario. Sin token, se mantiene el globo base actual.
