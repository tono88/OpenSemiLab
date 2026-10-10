import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { installPortalFixtures, openPhysical, DEMO_RESULT } from './portal-fixtures'

// Opt-in documentation generation: render actual portal screens and add DOM
// callouts before capture. No raster compositing or fabricated UI controls.
test.skip(!process.env.UPDATE_GUIDE_SCREENSHOTS, 'Set UPDATE_GUIDE_SCREENSHOTS=1 to regenerate documentation assets.')

async function capture(page: Page, filename: string, selectors: string[]) {
  await page.evaluate(() => document.querySelector('[data-guide-annotations]')?.remove())
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await page.evaluate(() => window.scrollTo({ top: window.scrollY, behavior: 'instant' }))
  const rectangles = []
  for (const selector of selectors) {
    const element = page.locator(selector).first()
    await expect(element).toBeVisible()
    const box = await element.boundingBox()
    if (!box) throw new Error(`No capture rectangle for ${selector}`)
    rectangles.push(box)
  }
  await page.evaluate(boxes => {
    const overlay = document.createElement('div')
    overlay.dataset.guideAnnotations = 'true'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;'
    boxes.forEach((box, i) => {
      const x = Math.max(5, box.x - 3), y = Math.max(5, box.y - 3)
      const bottom = Math.min(innerHeight - 35, box.y + box.height + 3)
      if (bottom <= y || y >= innerHeight - 35) throw new Error(`Annotation ${i + 1} is outside the viewport`)
      const rectangle = document.createElement('div')
      rectangle.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${Math.min(box.width + 6, innerWidth - x - 5)}px;height:${bottom - y}px;border:2px solid #45e6a6;border-radius:4px;box-sizing:border-box;box-shadow:0 0 0 2px #052518;`
      const number = document.createElement('span')
      number.textContent = String(i + 1)
      number.style.cssText = 'position:absolute;left:-2px;top:-2px;width:27px;height:27px;background:#45e6a6;color:#042017;display:grid;place-items:center;border-radius:0 0 13px 0;font:bold 15px monospace;border:2px solid #042017;'
      rectangle.append(number); overlay.append(rectangle)
    })
    const caption = document.createElement('div')
    caption.textContent = 'OpenSemiLab · Guía del portal · Captura con datos de demostración'
    caption.style.cssText = 'position:absolute;bottom:0;left:0;right:0;padding:8px 18px;background:#102d21;color:#b9e9d2;font:11px monospace;border-top:1px solid #45e6a677;'
    overlay.append(caption); document.body.append(overlay)
  }, rectangles)
  await page.screenshot({ path: resolve('public/guide', filename), type: 'jpeg', quality: 86, animations: 'disabled' })
  await page.evaluate(() => document.querySelector('[data-guide-annotations]')?.remove())
}

test('capture annotated screens for the complete portal manual', async ({ page }) => {
  test.setTimeout(120000)
  await mkdir(resolve('public/guide'), { recursive: true })
  await page.setViewportSize({ width: 1360, height: 900 })
  const fixture = await installPortalFixtures(page)
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  const guest = (route: Route) => route.fulfill({ status: 401, json: { detail: 'Guest' } })
  await page.route('**/api/v1/auth/me', guest)
  await page.goto('/#/login')
  await page.locator('.auth-card').waitFor()
  await capture(page, 'access.jpg', ['.pub-links', '.auth-card form', '.auth-alt'])
  await page.unroute('**/api/v1/auth/me', guest)
  await page.goto('about:blank') // Start a fresh authenticated document after the guest screen.

  await page.setViewportSize({ width: 1360, height: 1250 })
  await page.goto('/#/lab')
  await page.getByRole('button', { name: 'Crear flujo de diseño' }).waitFor()
  await page.locator('.template-grid').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'studio.jpg', ['.template-grid', '.config-panel', '.config-panel .run'])

  await page.setViewportSize({ width: 1360, height: 900 })
  await page.locator('.pdk-importer summary').click()
  await page.locator('.private-pdk-panel').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'pdks.jpg', ['.private-pdk-heading', '.pdk-form', '.pdk-license'])

  await page.getByRole('button', { name: 'Crear flujo de diseño' }).click()
  await page.locator('.project-toolbar').waitFor()
  await page.locator('.file-tree button').filter({ hasText: /^top\.sv$/ }).click()
  await page.locator('.wizard-nav').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'design.jpg', ['.wizard-nav', '.file-tree', '.file-editor', '.result-dock'])

  await page.locator('.wizard-nav button').nth(1).click()
  await page.getByRole('button', { name: /Analizar RTL/ }).click()
  await expect(page.locator('.result-dock-bar')).toContainText('PASS')
  await page.locator('#wizard-verification').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'verification.jpg', ['#wizard-verification .execution-panel', '#wizard-verification .adapter-hub', '.result-dock'])

  await page.locator('.wizard-nav button').nth(2).click()
  await page.locator('#wizard-simulation .project-actions button').filter({ hasText: /Simular/ }).first().click()
  await expect(page.locator('.result-dock-bar')).toContainText('PASS')
  // The waveform evidence is displayed in Results; keep Simulation expanded
  // above it so the execution control and its output are visible together.
  await page.setViewportSize({ width: 1360, height: 1250 })
  await page.locator('.wizard-nav button').nth(4).click()
  if (await page.locator('#wizard-simulation .wizard-step-header').getAttribute('aria-expanded') === 'false') await page.locator('#wizard-simulation .wizard-step-header').click()
  await page.locator('#wizard-simulation').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'simulation.jpg', ['#wizard-simulation .execution-panel', '.result-dock', '.waveform-viewer'])

  await page.setViewportSize({ width: 1360, height: 900 })
  await openPhysical(page)
  await page.getByRole('button', { name: /Ejecutar flujo completo RTL/ }).click()
  await expect(page.getByRole('heading', { name: /En cola/ })).toBeVisible()
  await page.locator('#wizard-physical').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'physical.jpg', ['.physical-steps', '.physical-config', '.physical-queue-metrics', '.physical-job-actions'])

  fixture.update({ status: 'completed', result: DEMO_RESULT })
  await expect(page.getByRole('heading', { name: 'Flujo terminado' })).toBeVisible()
  await page.setViewportSize({ width: 1360, height: 1400 })
  await page.locator('.wizard-nav button').nth(4).click()
  await page.locator('.physical-dashboard').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'results.jpg', ['.physical-metrics', '.layout-workbench', '.signoff-center'])

  await page.setViewportSize({ width: 1360, height: 1000 })
  await page.getByRole('button', { name: 'Laboratorio de dispositivos', exact: true }).click()
  await page.getByTestId('lab-status').filter({ hasText: 'CALCULADO' }).waitFor()
  await page.locator('.dl-workspace').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'devices.jpg', ['.dl-controls .dl-section-title', '.dl-parameters', '.dl-results'])

  await page.getByRole('button', { name: 'Avanzado', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir DEVSIM local y validación de malla' }).click()
  await page.locator('.dl-tcad-toggle').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'tcad.jpg', ['.dl-tcad-toggle', '.dl-tcad .dl-inline-fields', '.dl-tcad .devsim-setup'])

  await page.goto('/#/admin')
  await page.locator('.smtp-form').waitFor()
  await page.locator('.smtp-block').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await capture(page, 'admin.jpg', ['.admin-head', '.smtp-form', '.smtp-actions'])
  expect(pageErrors).toEqual([])
})
