/** Keep an installed standalone PWA current when iOS resumes an existing page. */
export function installPwaUpdates(
  serviceWorker: ServiceWorkerContainer,
  reload: () => void = () => window.location.reload(),
): () => void {
  let hadController = Boolean(serviceWorker.controller)
  let lastCheck = 0

  const onControllerChange = () => {
    // The first worker claiming a fresh install does not change the loaded app.
    if (!hadController) {
      hadController = true
      return
    }
    reload()
  }

  const checkForUpdate = () => {
    if (Date.now() - lastCheck < 60_000) return
    lastCheck = Date.now()
    void serviceWorker.ready.then(registration => registration.update()).catch(() => {
      // Offline launches keep using the cached app and retry on the next resume.
      lastCheck = 0
    })
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  }

  serviceWorker.addEventListener('controllerchange', onControllerChange)
  window.addEventListener('pageshow', checkForUpdate)
  document.addEventListener('visibilitychange', onVisible)
  checkForUpdate()

  return () => {
    serviceWorker.removeEventListener('controllerchange', onControllerChange)
    window.removeEventListener('pageshow', checkForUpdate)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
