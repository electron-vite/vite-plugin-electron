document.getElementById('app')!.innerHTML = `
<h1>examples/multiple-window/node-true.ts</h1>
<hr>
<pre id="fs-api"></pre>
`

function loadFs() {
  return import('node:fs') // node <= 13
}

loadFs().then(fs => {
  document.getElementById('fs-api')!.innerHTML = `
<strong>fs API:</strong>

${Object.keys(fs).join('\n')}
`.trim()
})

export {}
