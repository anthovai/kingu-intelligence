import type { KinguPushPayload } from './push-payload'

export type NativeDismissal = {
  remember(payload: KinguPushPayload): Promise<void>
  wasDismissed(payload: KinguPushPayload): Promise<boolean>
}
// Android and web use JavaScript storage; iOS requires the native ledger.
export const nativePushDismissal: NativeDismissal | null = null
