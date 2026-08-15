import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function loadTransmitterTemplate(page: Page) {
  await page.getByRole('button', { name: 'Project actions' }).click()
  await page.locator('#project-template').selectOption('tx-2g4')
  await page.getByRole('button', { name: 'Load template' }).click()
  await expect(page.getByRole('dialog', { name: 'RF Network Simulator' })).toBeHidden()
  await expect(page.locator('.rf-node')).toHaveCount(8)
}

test('template, simulation and evidence complete without runtime errors', async ({
  page,
}) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
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
  expect(runtimeErrors).toEqual([])
})

test('all transmitter blocks remain reachable at the configured viewport', async ({
  page,
}) => {
  await page.goto('/')
  await loadTransmitterTemplate(page)
  const geometry = await page.evaluate(() => {
    const viewport = document.querySelector('.react-flow')?.getBoundingClientRect()
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
      viewport:
        viewport &&
        {
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
