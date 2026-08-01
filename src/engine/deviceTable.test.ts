import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  deviceMetricAt,
  devicePowerTransferAt,
  interpolateDeviceOutputPower,
  parseDeviceTableCsv,
} from './deviceTable'

const tableText = `# Typical values under one documented bias condition
frequency_ghz,gain_db,nf_db,oip3_dbm,pin_dbm,pout_dbm
1,20,2,35,,
2,18,4,31,,
1,,,,-20,0
1,,,,-10,9.8
1,,,,0,18
2,,,,-20,-2
2,,,,-10,7.5
2,,,,0,16
`

describe('datasheet device tables', () => {
  it('keeps the downloadable template parseable', () => {
    const template = readFileSync(
      new URL(
        '../../public/examples/device-performance-template.csv',
        import.meta.url,
      ),
      'utf8',
    )
    expect(parseDeviceTableCsv(template).rowCount).toBe(8)
  })

  it('interpolates frequency metrics and measured power curves', () => {
    const table = parseDeviceTableCsv(tableText, 'example.csv')

    expect(table.rowCount).toBe(8)
    expect(deviceMetricAt(table, 'gainDb', 1.5e9)).toBeCloseTo(19)
    expect(deviceMetricAt(table, 'noiseFigureDb', 1.5e9)).toBeCloseTo(3)
    expect(deviceMetricAt(table, 'outputIp3Dbm', 1.5e9)).toBeCloseTo(33)
    expect(deviceMetricAt(table, 'outputP1Dbm', 1.5e9)).toBeCloseTo(
      (13.4444444444 + 10.3333333333) / 2,
    )
    expect(
      interpolateDeviceOutputPower(devicePowerTransferAt(table, 1.5e9)!, -10),
    ).toBeCloseTo(8.65)
  })

  it('rejects frequency extrapolation and incomplete power rows', () => {
    const table = parseDeviceTableCsv(tableText, 'example.csv')
    expect(() => deviceMetricAt(table, 'gainDb', 0.5e9)).toThrow(
      /extrapolation is disabled/,
    )
    expect(() =>
      parseDeviceTableCsv(
        'frequency_hz,input_power_dbm,output_power_dbm\n1e9,-10,',
      ),
    ).toThrow(/must be supplied together/)
  })
})
