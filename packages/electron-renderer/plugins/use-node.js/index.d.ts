import { Plugin } from 'vite';

declare const useNodeJs: UseNodeJs;
declare const resolveModules: ResolveModules;
export {
  useNodeJs as default,
  resolveModules,
}

export interface Options {
  /**
   * Explicitly include/exclude some CJS modules  
   * `modules` includes `dependencies` of package.json  
   */
  resolve?: (modules: string[]) => typeof modules | undefined
}

export interface UseNodeJs {
  (options?: Options): Plugin;
}

export interface ResolveModules {
  (root: string, options?: Options): {
    /** Node.js builtin modules */
    builtins: string[];
    /** dependencies of package.json */
    dependencies: string[];
    /** dependencies(ESM) of package.json */
    ESM_deps: string[];
  }
}
