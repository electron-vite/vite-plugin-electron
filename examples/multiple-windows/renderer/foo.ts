import { routes } from './router'

document.getElementById('app')!.innerHTML = `
<h1>examples/multiple-windows/foo.ts</h1>
<hr>
${routes()}
`