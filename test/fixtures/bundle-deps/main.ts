import { loadPackageJSONSync } from 'local-pkg'
import { version } from 'vite'

console.log(loadPackageJSONSync, version)
