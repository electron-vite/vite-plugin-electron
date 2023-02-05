document.getElementById('app')!.innerHTML = `
<h1>examples/multiple-window/node-false.ts</h1>
<hr>
<pre id="fs-api"></pre>
`

function loadFs() {
  return import('node:fs')
}

loadFs().catch(error => {
  document.getElementById('fs-api')!.innerHTML = `
<strong>fs API:</strong>

${error}
`.trim()
})

export {}
