import { routes } from './router'

document.getElementById('app')!.innerHTML = `
<h1>examples/multiple-renderer/foo.ts</h1>
<hr>
${routes()}
`