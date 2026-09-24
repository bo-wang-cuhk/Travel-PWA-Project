/** Remove the pre-React launch screen after the first route is ready to paint. */
export function finishStartupSplash(): void {
  const splash = document.getElementById('startup-splash')
  if (!splash || splash.classList.contains('is-leaving')) return
  requestAnimationFrame(() => {
    splash.classList.add('is-leaving')
    window.setTimeout(() => splash.remove(), 240)
  })
}
