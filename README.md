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
