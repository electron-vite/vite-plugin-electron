import { loadPackageJSONSync } from 'local-pkg'

document.querySelector<HTMLElement>('#app')!.textContent = typeof loadPackageJSONSync
