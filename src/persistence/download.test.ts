import { expect, it } from 'vitest'
import { safeFileName } from './download'

it('makes portable non-empty download names', () => {
  expect(safeFileName('  RF:LNA\nchain?  ', 'csv')).toBe('RF-LNA-chain-.csv')
  expect(safeFileName('   ', 'json')).toBe('rf-project.json')
})
