import { Plugin } from 'vite';

declare const buildConfig: BuildConfig;
export default buildConfig;

export interface BuildConfig {
  (): Plugin;
}
