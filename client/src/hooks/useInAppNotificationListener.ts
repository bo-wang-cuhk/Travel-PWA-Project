import { useEffect } from 'react'
import { addListener, removeListener } from '../api/websocket'
import { useInAppNotificationStore } from '../store/inAppNotificationStore.ts'
import { STANDALONE_MODE } from '../config/runtimeMode'

export function useInAppNotificationListener(): void {
  const handleNew = useInAppNotificationStore(s => s.handleNewNotification)
  const handleUpdated = useInAppNotificationStore(s => s.handleUpdatedNotification)

  useEffect(() => {
    if (STANDALONE_MODE) return
    const listener = (event: Record<string, unknown>) => {
      if (event.type === 'notification:new') {
        handleNew(event.notification as any)
      } else if (event.type === 'notification:updated') {
        handleUpdated(event.notification as any)
      }
    }
    addListener(listener)
    return () => removeListener(listener)
  }, [handleNew, handleUpdated])
}
