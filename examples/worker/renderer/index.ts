import fs from 'fs'

document.getElementById('app')!.innerHTML = `
<h1>examples/web-worker</h1>
<button id="worker">Click to load Web Worker</button>
`
document.getElementById('worker')!.addEventListener('click', () => {
  new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
})

console.log(fs)
