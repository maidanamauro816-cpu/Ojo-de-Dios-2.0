import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const res = join(process.cwd(), 'android', 'app', 'src', 'main', 'res');
const gold = '#F2C85B';
const dark = '#070A12';

const foreground = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#00000000" android:strokeColor="${gold}" android:strokeWidth="3.2" android:strokeLineJoin="round"
        android:pathData="M54,10 L96,88 L12,88 Z"/>
    <path android:fillColor="#101522" android:strokeColor="${gold}" android:strokeWidth="2.8"
        android:pathData="M28,50 Q54,26 80,50 Q54,74 28,50 Z"/>
    <path android:fillColor="${gold}" android:pathData="M54,38 A12,12 0 1,0 54,62 A12,12 0 1,0 54,38"/>
    <path android:fillColor="${dark}" android:pathData="M54,43 A7,7 0 1,0 54,57 A7,7 0 1,0 54,43"/>
    <path android:fillColor="#FFF3C4" android:pathData="M58,44 A2.5,2.5 0 1,0 58,49 A2.5,2.5 0 1,0 58,44"/>
    <path android:fillColor="#00000000" android:strokeColor="${gold}" android:strokeWidth="1.8"
        android:pathData="M54,17 L54,23 M34,22 L37,28 M74,22 L71,28"/>
</vector>`;

const legacy = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="${dark}" android:pathData="M0,0h108v108h-108z"/>
    <path android:fillColor="#00000000" android:strokeColor="${gold}" android:strokeWidth="3.2" android:strokeLineJoin="round"
        android:pathData="M54,10 L96,88 L12,88 Z"/>
    <path android:fillColor="#101522" android:strokeColor="${gold}" android:strokeWidth="2.8"
        android:pathData="M28,50 Q54,26 80,50 Q54,74 28,50 Z"/>
    <path android:fillColor="${gold}" android:pathData="M54,38 A12,12 0 1,0 54,62 A12,12 0 1,0 54,38"/>
    <path android:fillColor="${dark}" android:pathData="M54,43 A7,7 0 1,0 54,57 A7,7 0 1,0 54,43"/>
</vector>`;

const adaptive = `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>`;

async function put(path, content) {
  await mkdir(join(res, path, '..'), { recursive: true });
  await writeFile(join(res, path), content, 'utf8');
}

await put('drawable/ic_launcher_foreground.xml', foreground);
await put('mipmap-anydpi/ic_launcher.xml', legacy);
await put('mipmap-anydpi/ic_launcher_round.xml', legacy);
await put('mipmap-anydpi-v26/ic_launcher.xml', adaptive);
await put('mipmap-anydpi-v26/ic_launcher_round.xml', adaptive);
await put('values/ic_launcher_background.xml', `<resources><color name="ic_launcher_background">${dark}</color></resources>`);
console.log('Ojo de Dios: icono masónico dorado instalado en recursos Android.');
