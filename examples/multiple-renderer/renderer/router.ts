
export function routes() {
  const { pathname } = window.location
  const path = pathname.slice(pathname.lastIndexOf('/'))
  const color = (html: string) => path.endsWith(html) ? 'background:cyan; border-color:cyan;' : ''

  return `
  <div>
    <h4>pathname: ${path}</h4>
    <button
      onclick="electron.toWindow('index.html')"
      style="${color('index.html')}"
    >To index.html</button>
    <button
      onclick="electron.toWindow('foo.html')"
      style="${color('foo.html')}"
    >To foo.html</button>
    <button
      onclick="electron.toWindow('bar.html')"
      style="${color('bar.html')}"
    >To bar.html</button>
  </div>
`
}
