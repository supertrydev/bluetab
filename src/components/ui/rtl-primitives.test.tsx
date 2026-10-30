/** @jest-environment jsdom */

import * as fs from 'fs'
import * as path from 'path'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DirectionProvider } from '@radix-ui/react-direction'

import { BreadcrumbSeparator } from './breadcrumb'
import { DropdownMenuShortcut } from './dropdown-menu'
import { Switch } from './switch'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const readPrimitive = (fileName: string) =>
  fs.readFileSync(path.resolve(__dirname, fileName), 'utf8')

const primitiveSources = {
  breadcrumb: readPrimitive('breadcrumb.tsx'),
  dialog: readPrimitive('dialog.tsx'),
  dropdown: readPrimitive('dropdown-menu.tsx'),
  inputGroup: readPrimitive('input-group.tsx'),
  modalTemplate: readPrimitive('modal-template.tsx'),
  scrollArea: readPrimitive('scroll-area.tsx'),
  select: readPrimitive('select.tsx'),
  sheet: readPrimitive('sheet.tsx'),
  switch: readPrimitive('switch.tsx'),
}

async function renderWithDirection(
  direction: 'ltr' | 'rtl',
  element: ReactElement,
): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  await act(async () => {
    root.render(
      <DirectionProvider dir={direction}>{element}</DirectionProvider>,
    )
  })

  return { container, root }
}

async function dispose(root: Root, container: HTMLDivElement) {
  await act(async () => root.unmount())
  container.remove()
}

describe('RTL-safe shared UI primitives', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  it('mirrors only directional breadcrumb chevrons', async () => {
    const ltr = await renderWithDirection('ltr', <BreadcrumbSeparator />)
    expect(ltr.container.querySelector('svg')?.classList.contains('lucide-chevron-right')).toBe(true)
    await dispose(ltr.root, ltr.container)

    const rtl = await renderWithDirection('rtl', <BreadcrumbSeparator />)
    expect(rtl.container.querySelector('svg')?.classList.contains('lucide-chevron-left')).toBe(true)
    await dispose(rtl.root, rtl.container)
  })

  it('selects the submenu chevron from the Radix direction context', () => {
    expect(primitiveSources.dropdown).toContain(
      'const direction = useDirection()',
    )
    expect(primitiveSources.dropdown).toContain(
      'direction === "rtl" ? ChevronLeft : ChevronRight',
    )
    expect(primitiveSources.dropdown).toContain(
      '<SubmenuChevron className="ms-auto" />',
    )
  })

  it('keeps technical shortcut text left-to-right and bidi isolated', async () => {
    const rtl = await renderWithDirection(
      'rtl',
      <DropdownMenuShortcut>Ctrl+Shift+B</DropdownMenuShortcut>,
    )

    const shortcut = rtl.container.querySelector('span')
    expect(shortcut?.getAttribute('dir')).toBe('ltr')
    expect(shortcut?.className).toContain('ms-auto')
    await dispose(rtl.root, rtl.container)
  })

  it('moves the switch thumb toward the checked side in each direction', async () => {
    const ltr = await renderWithDirection('ltr', <Switch checked aria-label="LTR" />)
    expect(
      ltr.container
        .querySelector('[role="switch"] > span')
        ?.classList.contains('data-[state=checked]:translate-x-4'),
    ).toBe(true)
    await dispose(ltr.root, ltr.container)

    const rtl = await renderWithDirection('rtl', <Switch checked aria-label="RTL" />)
    const rtlThumb = rtl.container.querySelector('[role="switch"] > span')
    expect(rtlThumb?.classList.contains('data-[state=checked]:-translate-x-4')).toBe(true)
    expect(rtlThumb?.classList.contains('data-[state=checked]:translate-x-4')).toBe(false)
    await dispose(rtl.root, rtl.container)
  })

  it('uses logical inline spacing and positioning for direction-neutral primitives', () => {
    expect(primitiveSources.dropdown).toContain('inset && "ps-8"')
    expect(primitiveSources.dropdown).toContain('py-1.5 ps-8 pe-2')
    expect(primitiveSources.dropdown).toContain('absolute start-2')
    expect(primitiveSources.dropdown).toContain('ms-auto text-xs')

    expect(primitiveSources.select).toContain('py-1.5 ps-2 pe-8')
    expect(primitiveSources.select).toContain('absolute end-2')

    expect(primitiveSources.inputGroup).toContain('[&>input]:ps-2')
    expect(primitiveSources.inputGroup).toContain('[&>input]:pe-2')
    expect(primitiveSources.inputGroup).toContain('ps-3 has-[>button]:ms-[-0.45rem]')
    expect(primitiveSources.inputGroup).toContain('pe-3 has-[>button]:me-[-0.4rem]')

    expect(primitiveSources.dialog).toContain('absolute end-4 top-4')
    expect(primitiveSources.dialog).toContain('sm:text-start')
    expect(primitiveSources.sheet).toContain('absolute end-3 top-3 sm:end-4 sm:top-4')
    expect(primitiveSources.sheet).toContain('sm:text-start')
    expect(primitiveSources.modalTemplate).toContain('pe-12')
    expect(primitiveSources.scrollArea).toContain('border-s border-s-transparent')
  })

  it('keeps physical collision geometry and the Sheet side API unchanged', () => {
    expect(primitiveSources.dialog).toContain('fixed left-1/2 top-1/2')
    expect(primitiveSources.dialog).toContain('-translate-x-1/2 -translate-y-1/2')

    for (const source of [primitiveSources.dropdown, primitiveSources.select]) {
      expect(source).toContain('data-[side=left]:slide-in-from-right-2')
      expect(source).toContain('data-[side=right]:slide-in-from-left-2')
    }

    expect(primitiveSources.sheet).toContain(
      'left: "inset-y-0 left-0 h-full',
    )
    expect(primitiveSources.sheet).toContain(
      'right:\n          "inset-y-0 right-0 h-full',
    )
    expect(primitiveSources.sheet).toContain('side = "right"')
  })

  it('does not reverse row order or mirror close icons', () => {
    for (const source of Object.values(primitiveSources)) {
      expect(source).not.toContain('row-reverse')
    }

    expect(primitiveSources.dialog).toContain('<X className="h-4 w-4" />')
    expect(primitiveSources.sheet).toContain('<X className="h-5 w-5 sm:h-4 sm:w-4" />')
    expect(primitiveSources.dialog).not.toMatch(/<X[^>]+(?:rotate|scale-x)/)
    expect(primitiveSources.sheet).not.toMatch(/<X[^>]+(?:rotate|scale-x)/)
  })
})
