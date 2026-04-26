// Test stub: electron-log/main routes to console so unit tests don't boot Electron.

const log = {
  info: (...args: unknown[]) => console.info('[log:info]', ...args),
  warn: (...args: unknown[]) => console.warn('[log:warn]', ...args),
  error: (...args: unknown[]) => console.error('[log:error]', ...args),
  debug: (...args: unknown[]) => console.debug('[log:debug]', ...args),
  verbose: (...args: unknown[]) => console.log('[log:verbose]', ...args),
}

export default log
