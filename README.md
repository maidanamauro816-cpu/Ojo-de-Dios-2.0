# Ojo de Dios 2.0

Globo terráqueo 3D construido con CesiumJS. Las capas se activan desde el dock inferior.

- 🛰️ Catálogo mundial de satélites activos de CelesTrak en OMM JSON, incluyendo identificadores NORAD modernos de 6+ dígitos. Las posiciones se calculan con SGP4 usando satellite.js; no son detecciones de radar. El catálogo se conserva en IndexedDB y se actualiza respetando la ventana de 2 horas de CelesTrak.
- 🛰️ ISS, Tiangong y Hubble como objetos destacados.
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

## Cámaras públicas

La capa CCTV incorpora tres redes públicas oficiales: Statens vegvesen (Noruega, NLOD 2.0), Transport for London JamCams (Reino Unido, OGL v3.0) y Fintraffic/Digitraffic (Finlandia, CC BY 4.0). Se filtran cámaras que las propias fuentes marcan como no disponibles y cada red conserva su atribución. Las demás fuentes regionales del registro siguen deshabilitadas hasta verificar sus endpoints, formatos y permisos de reutilización.

El proxy Node integrado en Vite limita catálogos e imágenes, exige HTTPS, aplica allowlist de hosts, valida DNS/IP y rechaza redirecciones durante desarrollo. Para Android se incorpora un Cloudflare Worker independiente (`workers/cctv-proxy.js`) con rutas `/api/cctv/catalog` y `/api/cctv-frame/{id}`. El despliegue automático usa los secretos `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` del repositorio; si faltan, el workflow omite el despliegue y la cámara no estará disponible desde el APK hasta configurarlos.

La capa incluye filtros regionales, NEAREST, VIEWSHED geométrico estimado y calibración de orientación. El VIEWSHED no simula oclusión real por edificios o relieve.

## Límites de cobertura

- Satélites: se muestran los activos con elementos orbitales públicos disponibles en CelesTrak; no incluye objetos sin efemérides públicas ni garantiza cada objeto catalogado.
- Aviones: ADS-B público por radio alrededor del centro visible, no un mapa mundial completo.
- Barcos: el botón AIS todavía requiere integrar un proveedor de datos y sus condiciones de acceso; no se presenta como telemetría conectada.

### Cesium ion opcional

Crear un archivo `.env.local`:

```bash
VITE_CESIUM_ION_TOKEN=tu_token_restringido
```

El token es público en el cliente: restringilo en Cesium ion al dominio de la aplicación y al asset necesario. Sin token, se mantiene el globo base actual.
