import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function loadTransmitterTemplate(page: Page) {
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.locator('#project-template').selectOption('tx-2g4')
  await page.getByRole('button', { name: 'Load template' }).click()
  await expect(
    page.getByRole('dialog', { name: 'RF Network Simulator' }),
  ).toBeHidden()
  await expect(page.locator('.rf-node')).toHaveCount(8)
}

function captureRuntimeErrors(page: Page) {
  const runtimeErrors: string[] = []
  const resizeObserverErrors: string[] = []
  const record = (kind: string, message: string) => {
    const entry = `${kind}: ${message}`
    runtimeErrors.push(entry)
    if (/ResizeObserver/i.test(message)) resizeObserverErrors.push(entry)
  }

  page.on('pageerror', (error) => record('pageerror', error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') record('console.error', message.text())
  })

  return { runtimeErrors, resizeObserverErrors }
}

test('template, simulation and evidence complete without runtime errors', async ({
  page,
}) => {
  const { runtimeErrors, resizeObserverErrors } = captureRuntimeErrors(page)
  await page.goto('/')
  await loadTransmitterTemplate(page)
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByRole('button', { name: 'Simulate' })).toBeEnabled({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: /Review/i }).click()
  await expect(
    page
      .getByText(
        /Single-run checks passed|Solved with warnings|Linear solve evidence passed/,
      )
      .first(),
  ).toBeVisible()
  await expect(page.getByText('Numerically validated')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(runtimeErrors).toEqual([])
  expect(resizeObserverErrors).toEqual([])
})

test('template transition preserves canvas focus, connections, panel and inspector ownership', async ({
  page,
}) => {
  const { runtimeErrors, resizeObserverErrors } = captureRuntimeErrors(page)
  await page.goto('/')
  await loadTransmitterTemplate(page)

  const canvas = page.locator('[aria-label="RF block diagram editor"]')
  await expect(canvas).toBeVisible()
  await expect
    .poll(async () =>
      page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    )
    .toBe('RF block diagram editor')
  await expect
    .poll(async () => page.locator('.react-flow__edge-path').count())
    .toBeGreaterThan(0)
  const renderedEdges = await canvas
    .locator('.react-flow__edge-path')
    .evaluateAll(
      (paths) =>
        paths.filter((path) => {
          const style = getComputedStyle(path)
          return (
            Boolean(path.getAttribute('d')) &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.opacity !== '0' &&
            style.stroke !== 'none'
          )
        }).length,
    )
  expect(renderedEdges).toBeGreaterThan(0)

  const firstNode = page.locator('.react-flow__node').first()
  const firstNodeLabel = await firstNode.getAttribute('aria-label')
  expect(firstNodeLabel).toBeTruthy()
  await firstNode.click()
  await expect(page.locator('#rf-properties')).toBeVisible()

  await page.getByRole('button', { name: /^Build/ }).click()
  await expect(page.locator('#workflow-panel')).toBeVisible()
  await expect(page.locator('#rf-properties')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('#rf-properties')).toHaveCount(0)
  await expect(page.locator('#workflow-panel')).toBeVisible()
  if ((page.viewportSize()?.width ?? 0) < 1056) {
    await expect
      .poll(async () =>
        page.evaluate(() => document.activeElement?.textContent),
      )
      .toContain('Build')
  } else {
    await expect
      .poll(async () =>
        page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
      )
      .toBe(firstNodeLabel)
  }

  await page.waitForTimeout(500)
  expect(runtimeErrors).toEqual([])
  expect(resizeObserverErrors).toEqual([])
})

test('invalid networks surface the error in Results without runtime failures', async ({
  page,
}) => {
  const { runtimeErrors, resizeObserverErrors } = captureRuntimeErrors(page)
  await page.goto('/')
  await loadTransmitterTemplate(page)

  await page.locator('.react-flow__node').nth(3).click()
  await page.keyboard.press('Delete')
  await expect(page.locator('.rf-node')).toHaveCount(7)
  await page.getByRole('button', { name: 'Simulate' }).click()

  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText('Simulation stopped').first()).toBeVisible()
  await page.waitForTimeout(500)
  expect(runtimeErrors).toEqual([])
  expect(resizeObserverErrors).toEqual([])
})

test('all transmitter blocks remain reachable at the configured viewport', async ({
  page,
}) => {
  await page.goto('/')
  await loadTransmitterTemplate(page)
  const geometry = await page.evaluate(() => {
    const viewport = document
      .querySelector('.react-flow')
      ?.getBoundingClientRect()
    const nodes = [...document.querySelectorAll<HTMLElement>('.rf-node')].map(
      (node) => {
        const rect = node.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        }
      },
    )
    return {
      viewport: viewport && {
        left: viewport.left,
        right: viewport.right,
        top: viewport.top,
        bottom: viewport.bottom,
      },
      nodes,
      overflowX:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    }
  })
  expect(geometry.viewport).not.toBeNull()
  expect(geometry.overflowX).toBe(false)
  for (const node of geometry.nodes) {
    expect(node.left).toBeGreaterThanOrEqual(geometry.viewport!.left - 1)
    expect(node.right).toBeLessThanOrEqual(geometry.viewport!.right + 1)
    expect(node.top).toBeGreaterThanOrEqual(geometry.viewport!.top - 1)
    expect(node.bottom).toBeLessThanOrEqual(geometry.viewport!.bottom + 1)
  }
})

test('initial and loaded workbench have no serious accessibility violations', async ({
  page,
}) => {
  await page.goto('/')
  let results = await new AxeBuilder({ page }).analyze()
  expect(
    results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])
  await loadTransmitterTemplate(page)
  results = await new AxeBuilder({ page }).exclude('.cds--modal').analyze()
  expect(
    results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    ),
  ).toEqual([])
})
