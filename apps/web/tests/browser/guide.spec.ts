import { test, expect } from '@playwright/test'
import { GUIDE } from '../../src/pages/guideContent'
import { installPortalFixtures, openDemoProject } from './portal-fixtures'

test('the public manual covers every chapter and serves its actual annotated screenshots', async ({ page }) => {
  await installPortalFixtures(page)
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 401, json: { detail: 'Guest' } }))
  await page.goto('/#/guia')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('De su primera prueba')
  await expect(page.locator('.guide-index nav button')).toHaveCount(12)
  for (const chapter of GUIDE) {
    await page.locator('.guide-index').getByRole('button', { name: chapter.title.es, exact: false }).click()
    await expect(page.getByRole('heading', { level: 2, name: chapter.title.es, exact: true })).toBeVisible()
    if (chapter.image) {
      const image = page.locator('.guide-article figure img')
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1360)
      await expect(page.locator('.guide-article figcaption li')).toHaveCount(chapter.callouts!.length)
    }
  }
})

test('chapter links, search and ES/EN work without losing the current chapter', async ({ page }) => {
  await installPortalFixtures(page)
  await page.goto('/#/guia?seccion=physical')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Generar GDSII y gestionar su turno')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Generate GDSII and manage your turn')
  await page.getByRole('button', { name: 'ES', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Buscar en la guía' }).fill('SMTP')
  await expect(page.locator('.guide-index').getByRole('button', { name: /Administración, correo/ })).toBeVisible()
  await page.locator('.guide-index').getByRole('button', { name: /Administración, correo/ }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Administración, correo y comunidad')
  await page.getByRole('searchbox', { name: 'Buscar en la guía' }).fill('zz-no-chapter')
  await expect(page.getByText('No hay capítulos que coincidan. Pruebe otro término.')).toBeVisible()
})

test('the guide remains readable on mobile with complete chapter access', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installPortalFixtures(page)
  await page.goto('/#/guia?seccion=flow')
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Por qué trabajar en un flujo continuo')
  await expect(page.locator('.guide-flow button')).toHaveCount(5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('.guide-flow button').filter({ hasText: 'GDSII' }).click()
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Generar GDSII y gestionar su turno')
})

test('project help opens the full manual in another tab and preserves the workspace', async ({ page }) => {
  await installPortalFixtures(page)
  await openDemoProject(page)
  const help = page.locator('.project-toolbar a.workspace-help')
  await expect(help).toHaveAttribute('target', '_blank')
  await expect(help).toHaveAttribute('href', '#/guia?seccion=design')
  await expect(page.locator('.primary-nav .app-guide-link')).toHaveAttribute('href', '#/guia')
  await expect(page.locator('.project-toolbar')).toBeVisible()
})
