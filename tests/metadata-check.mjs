import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

test('publishes complete social and browser metadata', async () => {
  const html = await readFile(
    new globalThis.URL('../index.html', import.meta.url),
    'utf8',
  )
  await access(new globalThis.URL('../public/favicon.svg', import.meta.url))
  for (const metadata of [
    'theme-color',
    'canonical',
    'favicon.svg',
    'og:site_name',
    'og:title',
    'og:description',
    'og:type',
    'og:url',
    'twitter:card',
    'twitter:title',
    'twitter:description',
  ]) {
    assert.match(html, new RegExp(metadata))
  }
})

test('starts with an empty RF workbench and reveals advanced analysis on demand', async () => {
  const store = await readFile(
    new globalThis.URL('../src/app/store.ts', import.meta.url),
    'utf8',
  )
  const app = await readFile(
    new globalThis.URL('../src/app/App.tsx', import.meta.url),
    'utf8',
  )
  const components = await readFile(
    new globalThis.URL('../src/components.tsx', import.meta.url),
    'utf8',
  )
  assert.match(store, /nodes: \[\],[\s\S]*edges: \[\],/)
  assert.match(app, /Start with a block/)
  assert.match(components, /<AccordionItem title="Advanced analysis">/)
  assert.match(components, /<Tabs[\s\S]*className="results-tabs"/)
})

test('uses the Carbon UI contract', async () => {
  const styles = await readFile(
    new globalThis.URL('../src/index.css', import.meta.url),
    'utf8',
  )
  const app = await readFile(
    new globalThis.URL('../src/app/App.tsx', import.meta.url),
    'utf8',
  )
  const components = await readFile(
    new globalThis.URL('../src/components.tsx', import.meta.url),
    'utf8',
  )
  const carbon = await readFile(
    new globalThis.URL('../src/carbon.scss', import.meta.url),
    'utf8',
  )
  const packageJson = await readFile(
    new globalThis.URL('../package.json', import.meta.url),
    'utf8',
  )
  const html = await readFile(
    new globalThis.URL('../index.html', import.meta.url),
    'utf8',
  )
  const plot = await readFile(
    new globalThis.URL('../src/plots/RFPlot.tsx', import.meta.url),
    'utf8',
  )
  assert.match(carbon, /@use ["']@carbon\/react["']/)
  for (const [rfToken, carbonToken] of [
    ['background', 'background'],
    ['focus', 'focus'],
    ['interactive', 'interactive'],
    ['layer-01', 'layer-01'],
    ['layer-accent-01', 'layer-accent-01'],
    ['layer-selected-01', 'layer-selected-01'],
    ['link-primary', 'link-primary'],
    ['support-error', 'support-error'],
    ['text-primary', 'text-primary'],
    ['text-secondary', 'text-secondary'],
  ]) {
    assert.match(
      carbon,
      new RegExp(`--rf-${rfToken}:\\s*var\\(--cds-${carbonToken}\\);`),
    )
  }
  assert.doesNotMatch(plot, /prepareScientificPlotlyToolbar/)
  assert.match(plot, /aria-describedby=\{descriptionId\}/)
  assert.match(plot, /scientific-visually-hidden/)
  assert.match(plot, /function plotSummary\(/)
  assert.doesNotMatch(styles, /tailwindcss|@theme inline/)
  assert.doesNotMatch(
    styles,
    /@import|var\(--(?:font|space|text|rule|ease|dur|z)-/,
  )
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/)
  assert.doesNotMatch(packageJson, /storybook/i)
  assert.doesNotMatch(styles, /\.cds--/)
  assert.doesNotMatch(
    styles,
    /--(?:ink|muted|line|panel|canvas|page|teal|orange|danger|good|bad|radius|shadow):/,
  )
  assert.doesNotMatch(
    carbon,
    /oklch\(|Space Grotesk|--color-|--radius-|--shadow-/,
  )
  assert.match(
    styles,
    /\.rf-header-product-short\s*\{[\s\S]*display:\s*inline;/,
  )
  assert.doesNotMatch(
    styles,
    /(?:button|input|select|a):focus-visible|results-empty__trace|\.(?:warning-list|budget-warnings)\b/,
  )
  assert.match(app, /<ScientificAppShell\b/)
  assert.match(app, /<ScientificHeader\b/)
  assert.match(app, /product=\{strings\.appName\}/)
  assert.match(app, /rf-header-product-full/)
  assert.match(app, /rf-header-product-short/)
  assert.match(app, /<ScientificStatusBar\b/)
  for (const component of ['SkipToContent', 'Link', 'IconIndicator']) {
    assert.match(app, new RegExp(`<${component}`))
  }
  assert.match(app, /help=\{\{/)
  assert.doesNotMatch(app, /<(?:a|button|details|summary|header|main)\b/)
  for (const component of [
    'Button',
    'TextInput',
    'NumberInput',
    'Select',
    'Checkbox',
    'Tabs',
    'Accordion',
    'InlineNotification',
    'Tile',
  ]) {
    assert.match(components, new RegExp(`<${component}`))
  }
})

test('keeps React as the sole owner of the application surface', async () => {
  const html = await readFile(
    new globalThis.URL('../index.html', import.meta.url),
    'utf8',
  )
  const main = await readFile(
    new globalThis.URL('../src/main.tsx', import.meta.url),
    'utf8',
  )
  const surfaces = await Promise.all(
    [
      '../src/app/App.tsx',
      '../src/components.tsx',
      '../src/diagram/RFCanvas.tsx',
    ].map((path) =>
      readFile(new globalThis.URL(path, import.meta.url), 'utf8'),
    ),
  )

  assert.equal(
    (html.match(/<div\s+id=["']root["']\s*><\/div>/g) ?? []).length,
    1,
  )
  assert.equal((main.match(/\bcreateRoot\s*\(/g) ?? []).length, 1)
  assert.doesNotMatch(main, /ReactDOM\.render|hydrateRoot/)

  for (const surface of surfaces) {
    assert.doesNotMatch(surface, /document\s*\.\s*querySelector(?:All)?\s*\(/)
    assert.doesNotMatch(surface, /document\s*\.\s*addEventListener\s*\(/)
    assert.doesNotMatch(surface, /\b(?:innerHTML|outerHTML)\b/)
    assert.doesNotMatch(surface, /dangerouslySetInnerHTML/)
    assert.doesNotMatch(
      surface,
      /<(?:a|button|details|dialog|input|select|summary|textarea)\b/,
    )
  }
})

test('implements the result-first scientific workbench contract', async () => {
  const app = await readFile(
    new globalThis.URL('../src/app/App.tsx', import.meta.url),
    'utf8',
  )
  const components = await readFile(
    new globalThis.URL('../src/components.tsx', import.meta.url),
    'utf8',
  )
  for (const task of ['components', 'canvas', 'experiment', 'review']) {
    assert.match(app, new RegExp(`id: '${task}'`))
  }
  assert.match(app, /<ScientificToolRail/)
  assert.match(app, /activeId=\{activeTool \?\? 'components'\}/)
  assert.match(app, /expandedId=\{activeTool\}/)
  assert.match(
    app,
    /onChange=\{\(id\)\s*=>\s*id === null\s*\?\s*closeActiveTool\(\)\s*:\s*toggleTool/,
  )
  assert.match(app, /items=\{WORKFLOW_TOOLS\.map/)
  assert.match(app, /controlsId: ["']workflow-panel["']/)
  assert.match(app, /if \(activeTool === tool\)/)
  assert.match(app, /workflowTriggerRefs\.current\[activeTool\]/)
  assert.match(app, /<RFCanvas\b[\s\S]*ref=\{rfCanvasRef\}/)
  assert.match(app, /<Tab>Schematic<\/Tab>[\s\S]*<Tab>Results<\/Tab>/)
  assert.match(
    app,
    /selectedNodeId[\s\S]*<PropertiesPanel onClose=\{closeSelectedNode\} \/>/,
  )
  assert.match(components, /createPortal\([\s\S]*analysisControlsHost/)
})
