import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type FlatResource = Record<string, string>

function loadResource(fileName: 'en.json' | 'tr.json'): Record<string, unknown> {
    return JSON.parse(
        readFileSync(resolve(process.cwd(), 'src/i18n/locales', fileName), 'utf8'),
    ) as Record<string, unknown>
}

function flattenResource(
    value: Record<string, unknown>,
    prefix = '',
    target: FlatResource = {},
): FlatResource {
    for (const [key, nested] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (typeof nested === 'string') {
            target[path] = nested
        } else if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
            flattenResource(nested as Record<string, unknown>, path, target)
        }
    }
    return target
}

function matches(value: string, pattern: RegExp): string[] {
    return [...value.matchAll(pattern)].map((match) => match[0]).sort()
}

const english = flattenResource(loadResource('en.json'))
const turkish = flattenResource(loadResource('tr.json'))

const MIGRATED_HARDCODED_COPY = Object.fromEntries(
    Object.keys(english)
        .filter((key) => key.startsWith('components.')
            || key === 'sidepanel.teamsSession.noGroupsSharedYet'
            || key.startsWith('sidepanel.teamsPreSession.') && [
                'signInToHost',
                'upgradeToHost',
                'connectToHost',
                'premiumHost',
            ].some((suffix) => key.endsWith(suffix)))
        .sort()
        .map((key) => [key, { english: english[key], turkish: turkish[key] }]),
)

const INTENTIONAL_IDENTICAL_COPY = new Set([
    'common.extensionName',
    'common.indonesian',
    'common.english',
    'common.turkish',
    'common.brazilianPortuguese',
    'common.sounds.ping',
    'common.sounds.drop',
    'common.sounds.blip',
    'document.flowTitle',
    'document.newTabTitle',
    'document.popupTitle',
    'auth.login.emailPlaceholder',
    'auth.account.proPlan',
    'settingsTabs.pomodoro',
    'settingsTabs.brainDump',
    'settingsTabs.adhd',
    'settingsTabs.mcp',
    'settings.about.copyright', // Copyright symbol, year, and company name are language-neutral.
    'settings.brainDump.title',
    'settings.mcp.bearerToken',
    'settings.mcp.connectedClient.toolsets.brainDump',
    'settings.focus.domainPlaceholder',
    'settings.focus.blockedPhrasesPlaceholder',
    'settings.focus.presets.socialMedia.examples',
    'settings.focus.presets.newsMedia.examples',
    'settings.focus.presets.entertainment.examples',
    'settings.focus.presets.shopping.examples',
    'settings.adhd.title',
    'settings.adhd.subToggles.visualTime.label',
    'settings.adhd.subToggles.flowtimeTimer.label',
    'settings.adhd.subToggles.autoSuspend.label',
    'settings.adhd.subToggles.visibleTabLimit.label',
    'settings.adhd.subToggles.simplify.label',
    'settings.adhd.subToggles.hardFocus.label',
    'settings.adhd.whitelistPlaceholder',
    'settings.adhd.flowtimeOnboardingTitle',
    'settings.adhd.visibleTabLimitOnboardingTitle',
    'settings.adhd.hardFocusOnboardingTitle',
    'settings.autoSuspendOnboarding.title',
    'onboarding.extended.sync.badge',
    'contextMenu.root',
    'notifications.appTitle',
    'notifications.pomodoroTitle',
    'options.stats.sessionCount.pomodoro_one',
    'options.stats.sessionCount.flowtime_one',
    'options.addFeedDialog.urlPlaceholder',
    'flow.conditionTypes.url_matches_regex',
    'flow.ruleCard.not',
    'flow.page.title',
    'managerWelcome.tabs.bluetab', // Product name stays unchanged in every locale.
    'sidepanel.brainDump',
    'sidepanel.teams',
    'sidepanel.hardFocus.label',
    'sidepanel.hardFocus.idleTitle',
    'sidepanel.teamsPreSession.codePlaceholder',
    'brainDumpModal.title',
    'components.navigation.wrapped',
])

describe('Turkish product copy quality', () => {
    it('keeps every migrated English literal unchanged and records its Turkish counterpart', () => {
        expect(MIGRATED_HARDCODED_COPY).toMatchSnapshot()
    })

    it('provides a non-empty Turkish value for every migrated hardcoded English string', () => {
        for (const [key, copy] of Object.entries(MIGRATED_HARDCODED_COPY)) {
            expect(copy.english).toBeTruthy()
            expect(copy.turkish).toBeTruthy()
            expect(turkish[key]).toBe(copy.turkish)
        }
    })

    it.each([
        ['document.optionsTitle', 'Bluetab Yöneticisi'],
        ['language.description', "Bluetab'in hangi dili kullanacağını seç."],
        ['auth.account.manage', 'Yönet'],
        ['sidepanel.header.openManager', 'Yöneticiyi Aç'],
        ['sidepanel.teamsPreSession.hostTitle', 'Oturum Başlat'],
        ['sidepanel.teamsPreSession.startSession', 'Oturum Başlat'],
        ['sidepanel.teamsPreSession.joinTitle', 'Oturuma Katıl'],
        ['sidepanel.teamsPreSession.join', 'Oturuma Katıl'],
        ['sidepanel.teamsSession.participants', 'Katılımcılar'],
        ['sidepanel.teamsSession.shareAllTabs', 'Tüm sekmeleri paylaş'],
        ['sidepanel.aiUpgradePrompt.upgrade', "Pro'ya Yükselt"],
        ['flow.page.upgrade', "Pro'ya Yükselt"],
        ['settings.integrationsSection.upgradeCta', "Pro'ya Yükselt"],
        ['navigation.menu', 'Menü'],
        ['sidepanel.groupsPanel.noGroups', 'Henüz kaydedilmiş grup yok'],
        ['sidepanel.teamsChat.notConnected', 'Bağlı değil'],
        ['components.notionPagePicker.loadingPages', 'Sayfalar yükleniyor...'],
    ])('uses reviewed Turkish copy for %s', (key, expected) => {
        expect(turkish[key]).toBe(expected)
    })

    it('preserves interpolation, markup, URL, and keyboard-shortcut tokens for every key', () => {
        const tokenPatterns = [
            /\{\{[^{}]+\}\}/g,
            /<\/?[A-Za-z][^>]*>/g,
            /https?:\/\/[^\s)"']+/g,
            /\b(?:Alt|Ctrl|Shift|Cmd)(?:\+[A-Za-z0-9]+)+\b/g,
            /chrome:\/\/[^\s)"']+/g,
        ]

        for (const [key, englishValue] of Object.entries(english)) {
            for (const pattern of tokenPatterns) {
                expect(matches(turkish[key], pattern)).toEqual(matches(englishValue, pattern))
            }
        }
    })

    it('keeps identical English copy only for reviewed product and technical terms', () => {
        const unexpected = Object.keys(turkish).filter((key) => (
            turkish[key] === english[key]
            && /[A-Za-z]{2}/.test(turkish[key])
            && !INTENTIONAL_IDENTICAL_COPY.has(key)
        ))

        expect(unexpected).toEqual([])
    })

    it('does not regress common ASCII transliterations in natural Turkish copy', () => {
        const forbiddenWords = /\b(?:Acik|Baglan|Basarisiz|Baslat|Cikis|Degisiklik|Duzenle|Erisim|Gecici|Giris|Gonder|Gorunum|Goster|Guvenli|Henuz|Icerik|Icin|Katil|Katilimci|Kullanici|Olustur|Once|Ozel|Ozet|Paylas|Secili|Sifre|Tumunu|Yonet|Yonetici|Yukleniyor)\b/i
        const offenders = Object.entries(turkish)
            .filter(([, value]) => forbiddenWords.test(value))
            .map(([key]) => key)

        expect(offenders).toEqual([])
    })
})
