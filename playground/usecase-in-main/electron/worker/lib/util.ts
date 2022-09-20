import { join } from 'node:path'

export function getPath(relative: string) {
  return join(__dirname, relative)
}

export function factorial(factor: number) {
  let result = 1
  for (let i = 1; i <= factor; i++) {
    result += i
  }
  return result
}
