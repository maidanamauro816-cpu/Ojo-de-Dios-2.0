/// <reference types="@capacitor/background-runner" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ojodedios.world',
  appName: 'Ojo de Dios 2.0',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false
  },
  plugins: {
    BackgroundRunner: {
      label: 'com.ojodedios.world.disasterwatch',
      src: 'runners/disaster-runner.js',
      event: 'checkDisasters',
      repeat: true,
      interval: 15,
      autoStart: true
    }
  }
};

export default config;
