import { RuntimeClientError } from '../../runtime-client'

export function resolveCompatibilityCliCommand(): 'kingu' | 'kingu-ide' | 'kingu-dev' {
  const configured = process.env.KINGU_CLI_COMMAND
  if (configured === 'kingu' || configured === 'kingu-ide' || configured === 'kingu-dev') {
    return configured
  }
  return process.platform === 'linux' ? 'kingu-ide' : 'kingu'
}

export function resolvePackagedWindowsCompatibilityCommand(): 'kingu' | 'kingu-ide' | undefined {
  if (process.env.KINGU_WINDOWS_PACKAGED_CLI_LAUNCHER !== '1') {
    return undefined
  }
  const command = process.env.KINGU_CLI_COMMAND
  if (command === 'kingu' || command === 'kingu-ide') {
    return command
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'The packaged Kingu launcher did not provide a valid resume command. No question was created.'
  )
}

export async function flushOrchestrationStdout(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write('', (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export function isDevCliInvocation(): boolean {
  return (
    process.env.KINGU_DEV_CLI_INVOCATION === '1' ||
    (process.env.KINGU_USER_DATA_PATH?.includes('kingu-dev') ?? false)
  )
}
