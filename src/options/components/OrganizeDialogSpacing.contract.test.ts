import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/options/main.tsx'), 'utf8')
const start = source.indexOf('<Dialog open={organizeWarningOpen}')
const end = source.indexOf('<Dialog\n                        open={organizeProgressOpen}', start)

describe('Organize groups warning dialog spacing', () => {
    it('uses one balanced spacing system across its visible sections', () => {
        expect(start).toBeGreaterThanOrEqual(0)
        expect(end).toBeGreaterThan(start)

        const dialog = source.slice(start, end)

        expect(dialog).toContain('<DialogContent className="grid gap-4 sm:max-w-xl">')
        expect(dialog).toContain('<DialogHeader>')
        expect(dialog).toContain('<div className="grid gap-3 sm:grid-cols-2">')
        expect(dialog).toContain('<DialogFooter>')
        expect(dialog).not.toMatch(/space-y-3|py-1|pt-2/)
    })
})
