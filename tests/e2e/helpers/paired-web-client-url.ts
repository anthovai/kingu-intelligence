export type PairedWebClientOptions = {
  disableRemoteTerminalStallRecovery?: boolean
  terminalParkingDelayMs?: number
  terminalRetentionLimit?: number
  waitForWorkspace?: boolean
}

export function createPairedWebClientUrl(
  offerUrl: string,
  options: PairedWebClientOptions
): string {
  const clientUrl = new URL(offerUrl)
  if (options.disableRemoteTerminalStallRecovery) {
    clientUrl.searchParams.set('kinguE2EDisableRemoteTerminalStallRecovery', '1')
  }
  if (options.terminalParkingDelayMs !== undefined) {
    clientUrl.searchParams.set(
      'kinguE2ETerminalParkingDelayMs',
      `${options.terminalParkingDelayMs}`
    )
  }
  if (options.terminalRetentionLimit !== undefined) {
    clientUrl.searchParams.set(
      'kinguE2ETerminalRetentionLimit',
      `${options.terminalRetentionLimit}`
    )
  }
  return clientUrl.href
}
