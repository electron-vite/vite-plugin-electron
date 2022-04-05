import { Plugin } from 'vite';

declare const electronRenderer: VitePluginElectronRenderer;
export default electronRenderer;

export interface VitePluginElectronRenderer {
  (): Plugin[];
}
