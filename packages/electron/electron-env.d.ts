
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production'
    readonly VITE_DEV_SERVER_HOSTNAME: string
    readonly VITE_DEV_SERVER_PORT: string
    readonly VITE_DEV_SERVER_URL: string
  }

  interface Process {
    electronApp: import('child_process').ChildProcessWithoutNullStreams
  }
}

interface ImportMeta {
  /** shims Vite */
  env: Record<string, any>
}
