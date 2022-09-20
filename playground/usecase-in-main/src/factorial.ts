export function setupFactorial(element: HTMLButtonElement) {
  let calcing = false
  const factor = 5e9
  element.innerHTML = `sigma 5e9`
  const calc = () => {
    if (!calcing) {
      calcing = true
      element.innerHTML = `calculating ...`
      const start = Date.now()
      window.electronApi.sigma(factor).then(result => {
        element.innerHTML = `sum is ${result}, cost ${((Date.now() - start) / 1000).toFixed(2)}s`
        calcing = false
      })
    }

  }
  element.addEventListener('click', () => calc())
}
