# Estado de integración GODS-EYE → Ojo de Dios 2.0

Esta rama conserva la interfaz, el globo Cesium, la identidad visual, el identificador Android `com.ojodedios.world`, las capas existentes de cámaras públicas, satélites, ADS-B, AIS y bases de ubicación públicamente documentada.

## Capas añadidas
- Sismos globales: feed diario de USGS.
- Meteorología puntual: condiciones actuales de Open-Meteo en el centro visible del globo.
- Fenómenos naturales: eventos abiertos de NASA EONET (tormentas severas, incendios, volcanes, inundaciones y deslizamientos).

## Alertas Android
- Canales separados para sismos y fenómenos naturales.
- Tareas periódicas mediante Capacitor Background Runner, con intervalo configurado de 15 minutos.
- Sismos: magnitud 5.5 o superior a escala global; magnitud 3 o superior dentro de 1.000 km cuando el dispositivo proporciona ubicación autorizada.
- EONET: eventos dentro de 1.200 km cuando hay ubicación autorizada; sin ubicación se mantienen los avisos globales de la fuente.
- NOAA NHC: sistemas tropicales activos.
- Servicio Meteorológico Nacional de EE. UU.: avisos oficiales de tornado, tormenta severa, inundación repentina y ciclones tropicales.

Android puede retrasar las tareas por ahorro de batería y políticas del sistema; el intervalo de 15 minutos es una solicitud, no una garantía de ejecución exacta ni de entrega instantánea.

## Límites y configuración pendiente
- Los eventos de incendios de EONET son reportes de eventos, no una capa de puntos térmicos FIRMS. FIRMS requiere un proxy seguro y una clave API del servidor.
- Open-Meteo muestra el clima del punto central; todavía no es un mosaico global de nubosidad o precipitación.
- Las alertas de tornado y tormenta severa del NWS cubren Estados Unidos; otros países dependen de los eventos disponibles en EONET y sus servicios oficiales.
- AIS, ADS-B y cámaras dependen de la cobertura de sus proveedores, Workers y secretos ya configurados.
- Las ubicaciones de instalaciones militares se mantienen como referencias estáticas públicamente documentadas; no se muestran movimientos ni actividad operativa.
- El ícono masónico del ojo dentro del triángulo dorado ya existente se conserva y el workflow lo instala en los recursos Android.

