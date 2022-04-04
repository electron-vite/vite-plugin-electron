import type { Alias, AliasOptions } from 'vite'

// https://github.com/vitejs/vite/blob/212d4548eeb366289c6c6fa6f86f94b261ed81f4/packages/vite/src/node/config.ts#L720
export function mergeConfigRecursively(
  defaults: Record<string, any>,
  overrides: Record<string, any>,
  rootPath: string = ''
) {
  const merged: Record<string, any> = { ...defaults }
  for (const key in overrides) {
    const value = overrides[key]
    if (value == null) {
      continue
    }

    const existing = merged[key]

    if (existing == null) {
      merged[key] = value
      continue
    }

    // fields that require special handling
    if (key === 'alias' && (rootPath === 'resolve' || rootPath === '')) {
      merged[key] = mergeAlias(existing, value)
      continue
    } else if (key === 'assetsInclude' && rootPath === '') {
      merged[key] = [].concat(existing, value)
      continue
    } else if (key === 'noExternal' && existing === true) {
      continue
    }

    if (Array.isArray(existing) || Array.isArray(value)) {
      merged[key] = [...arraify(existing ?? []), ...arraify(value ?? [])]
      continue
    }
    if (isObject(existing) && isObject(value)) {
      merged[key] = mergeConfigRecursively(
        existing,
        value,
        rootPath ? `${rootPath}.${key}` : key
      )
      continue
    }

    merged[key] = value
  }
  return merged
}


function mergeAlias(
  a?: AliasOptions,
  b?: AliasOptions
): AliasOptions | undefined {
  if (!a) return b
  if (!b) return a
  if (isObject(a) && isObject(b)) {
    return { ...a, ...b }
  }
  // the order is flipped because the alias is resolved from top-down,
  // where the later should have higher priority
  return [...normalizeAlias(b), ...normalizeAlias(a)]
}

function normalizeAlias(o: AliasOptions = []): Alias[] {
  return Array.isArray(o)
    ? o.map(normalizeSingleAlias)
    : Object.keys(o).map((find) =>
      normalizeSingleAlias({
        find,
        replacement: (o as any)[find]
      })
    )
}

// https://github.com/vitejs/vite/issues/1363
// work around https://github.com/rollup/plugins/issues/759
function normalizeSingleAlias({
  find,
  replacement,
  customResolver
}: Alias): Alias {
  if (
    typeof find === 'string' &&
    find.endsWith('/') &&
    replacement.endsWith('/')
  ) {
    find = find.slice(0, find.length - 1)
    replacement = replacement.slice(0, replacement.length - 1)
  }

  const alias: Alias = {
    find,
    replacement
  }
  if (customResolver) {
    alias.customResolver = customResolver
  }
  return alias
}

export function isObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

export function arraify<T>(target: T | T[]): T[] {
  return Array.isArray(target) ? target : [target]
}
