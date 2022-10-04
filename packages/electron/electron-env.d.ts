
declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'test' | 'production'
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
