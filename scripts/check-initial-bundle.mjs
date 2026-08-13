import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

const html = await readFile('dist/index.html', 'utf8')
const assets = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="[^"]*\/assets\/([^"]+\.js)"/g)].map(
      (match) => match[1],
    ),
  ),
]

if (assets.length === 0)
  throw new Error('No initial JavaScript assets found in dist/index.html.')

const gzipBytes = (
  await Promise.all(
    assets.map(
      async (asset) =>
        gzipSync(await readFile(`dist/assets/${asset}`)).byteLength,
    ),
  )
).reduce((total, bytes) => total + bytes, 0)
// Shared Carbon status and theme controls are part of the initial workbench.
// Keep the measured allowance explicit and tight rather than excluding preloads.
// Session recovery adds a deliberately small amount of startup code.
const maximumKiB = 183.5
const maximumBytes = maximumKiB * 1024
const measuredKiB = (gzipBytes / 1024).toFixed(1)

if (gzipBytes > maximumBytes) {
  throw new Error(
    `Initial JavaScript is ${measuredKiB} KiB gzip; budget is ${maximumKiB.toFixed(1)} KiB.`,
  )
}

globalThis.console.log(
  `Initial JavaScript: ${measuredKiB} KiB gzip (budget ${maximumKiB.toFixed(1)} KiB).`,
)
