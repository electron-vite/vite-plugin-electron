import path from 'node:path'

export function getAppPath(): string {
  return path.join('app', 'resources')
}
