import type { Plugin } from 'vite'

const environments = new WeakMap<Plugin, object>()

// Match Vite's public per-environment closeBundle context in lightweight fixtures.
export function configureDev(plugin: Plugin, server: any): object {
  const environment = {}
  server.environments = { client: environment }
  environments.set(plugin, environment)
  ;(plugin.configureServer as any).call({}, server)
  return environment
}

export function closeDev(
  plugin: Plugin,
  environment: object | undefined = environments.get(plugin),
): Promise<void> {
  return (plugin.closeBundle as any).call({ environment })
}
