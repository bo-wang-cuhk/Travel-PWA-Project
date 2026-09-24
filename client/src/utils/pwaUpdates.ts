/** Keep an installed standalone PWA current when iOS resumes an existing page. */
const RESUME_CHECK_DELAY_MS = 5_000
const RESUME_CHECK_INTERVAL_MS = 60 * 60_000

export function installPwaUpdates(
  serviceWorker: ServiceWorkerContainer,
  reload: () => void = () => window.location.reload(),
): () => void {
  let hadController = Boolean(serviceWorker.controller)
  let lastCheck = 0
  let pendingCheck: ReturnType<typeof setTimeout> | null = null

  const onControllerChange = () => {
    // The first worker claiming a fresh install does not change the loaded app.
    if (!hadController) {
      hadController = true
      return
    }
    reload()
  }

  const checkForUpdate = () => {
    if (Date.now() - lastCheck < RESUME_CHECK_INTERVAL_MS) return
    lastCheck = Date.now()
    void serviceWorker.ready.then(registration => registration.update()).catch(() => {
      // Offline launches keep using the cached app and retry on the next resume.
      lastCheck = 0
    })
  }

  const scheduleResumeCheck = () => {
    if (document.visibilityState !== 'visible' || pendingCheck) return
    if (Date.now() - lastCheck < RESUME_CHECK_INTERVAL_MS) return
    pendingCheck = setTimeout(() => {
      pendingCheck = null
      if (document.visibilityState === 'visible') checkForUpdate()
    }, RESUME_CHECK_DELAY_MS)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') scheduleResumeCheck()
    else if (pendingCheck) { clearTimeout(pendingCheck); pendingCheck = null }
  }
  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) scheduleResumeCheck() }

  serviceWorker.addEventListener('controllerchange', onControllerChange)
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('visibilitychange', onVisibilityChange)
  // registerSW.js handles a fresh page load. This extra check is only for a
  // PWA page that iOS kept alive in the background.

  return () => {
    serviceWorker.removeEventListener('controllerchange', onControllerChange)
    window.removeEventListener('pageshow', onPageShow)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (pendingCheck) clearTimeout(pendingCheck)
  }
}
