import { Plugin } from 'vite';
import { Options as UseNodeJsOptions } from './plugins/use-node.js';

declare const electronRenderer: VitePluginElectronRenderer;
export default electronRenderer;

export interface Options extends UseNodeJsOptions { }

export interface VitePluginElectronRenderer {
  (options?: Options): Plugin[];
}
