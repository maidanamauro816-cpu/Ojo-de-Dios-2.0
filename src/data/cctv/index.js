import { DelawareSource } from './delaware.js';
import { ArgentinaCabaSource } from './argentina-caba.js';
import { SpainDgtSource } from './spain-dgt.js';
import { BrasilArtespSource } from './brasil-artesp.js';
import { AustriaAsfinagSource } from './austria-asfinag.js';
import { JapanNexcoSource } from './japan-nexco.js';
import { ChileMopSource } from './chile-mop.js';
import { MexicoCapufeSource } from './mexico-capufe.js';
import { ItaliaAutostradeSource } from './italia-autostrade.js';
import { ColombiaInviasSource } from './colombia-invias.js';
import { FranciaVinciSource } from './francia-vinci.js';
import { PeruMtcSource } from './peru-mtc.js';
import { AlemaniaAutobahnSource } from './alemania-autobahn.js';

export const CCTV_REGISTRY = [
  DelawareSource, ArgentinaCabaSource, SpainDgtSource, BrasilArtespSource,
  AustriaAsfinagSource, JapanNexcoSource, ChileMopSource, MexicoCapufeSource,
  ItaliaAutostradeSource, ColombiaInviasSource, FranciaVinciSource,
  PeruMtcSource, AlemaniaAutobahnSource
];

/**
 * Load every configured public-road camera catalog independently.
 * A failed/disabled authority never prevents the other regions from loading.
 */
export async function loadAllCameras({ fetchWithCap, sources = CCTV_REGISTRY, perSourceLimit = 2000 } = {}) {
  const settled = await Promise.allSettled(sources.map(async (source) => {
    if (!source.enabled || !source.catalogUrl) {
      return { source, cameras: [], status: 'disabled', message: source.catalogUrl ? '' : 'Endpoint oficial pendiente de confirmar' };
    }
    const rawList = await source.fetchCatalog({ fetchWithCap });
    const cameras = [];
    for (const raw of rawList.slice(0, perSourceLimit)) {
      try {
        const camera = source.parseCamera(raw);
        if (!camera.id || !source.isValid(camera) || !camera.pose.imageUrl) continue;
        cameras.push({
          ...camera,
          sourceId: source.id,
          sourceName: source.name,
          region: source.meta?.region || source.region,
          pose: { ...camera.pose, isEstimated: true, videoUrl: null }
        });
      } catch {
        // One malformed row must not discard the provider's remaining cameras.
      }
    }
    return { source, cameras, status: cameras.length ? 'ok' : 'empty', message: '' };
  }));

  const results = settled.map((entry, index) => {
    const source = sources[index];
    if (entry.status === 'fulfilled') return entry.value;
    return { source, cameras: [], status: 'error', message: String(entry.reason?.message || entry.reason || 'Error de fuente') };
  });
  return {
    cameras: results.flatMap((result) => result.cameras),
    sources: results.map(({ source, cameras, status, message }) => ({
      id: source.id, name: source.name, region: source.region,
      status, count: cameras.length, message,
      license: source.license
    }))
  };
}

export { DelawareSource, ArgentinaCabaSource, SpainDgtSource, BrasilArtespSource,
  AustriaAsfinagSource, JapanNexcoSource, ChileMopSource, MexicoCapufeSource,
  ItaliaAutostradeSource, ColombiaInviasSource, FranciaVinciSource, PeruMtcSource,
  AlemaniaAutobahnSource };
