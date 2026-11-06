// Agrega al AndroidManifest generado por `cap add android` los permisos que la app necesita.
// Idempotente: si un permiso ya está declarado no se repite.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const manifestPath = join(process.cwd(), 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const permissions = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION'
];

let xml = await readFile(manifestPath, 'utf8');
const missing = permissions.filter((name) => !xml.includes(`android:name="${name}"`));
if (missing.length) {
  const lines = missing.map((name) => `    <uses-permission android:name="${name}" />`).join('\n');
  xml = xml.replace('</manifest>', `${lines}\n</manifest>`);
  await writeFile(manifestPath, xml);
}
console.log(missing.length ? `Permisos agregados: ${missing.join(', ')}` : 'Permisos ya declarados');
