import { routes } from './router'

document.getElementById('app')!.innerHTML = `
<h1>examples/multiple-renderer/index.ts</h1>
<hr>
${routes()}
`