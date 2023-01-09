import { routes } from './router'

document.getElementById('app')!.innerHTML = `
<h1>examples/multiple-windows/index.ts</h1>
<hr>
${routes()}
`