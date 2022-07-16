import { Plugin } from 'vite';

declare const polyfillExports: PolyfillExports;
export default polyfillExports;

export interface PolyfillExports {
  (): Plugin;
}
