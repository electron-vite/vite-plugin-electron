// @ts-expect-error virtual module
import { mainLoadedStatus } from 'virtual:test/main-status'

declare const __TEST_MAIN_STATUS__: string
declare const __TEST_MAIN_ENV_STATUS__: string

export function getMainStatus() {
  return {
    status: __TEST_MAIN_STATUS__,
    environmentStatus: __TEST_MAIN_ENV_STATUS__,
    loadedStatus: mainLoadedStatus,
  }
}