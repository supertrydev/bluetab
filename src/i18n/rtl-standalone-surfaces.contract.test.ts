import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8');
}

describe('standalone RTL presentation contract', () => {
  it('keeps New Tab time, dates, user input, and result content direction-safe', () => {
    const newTab = source('newtab/NewTab.tsx');

    expect(newTab).toContain('className="fixed inset-x-0 top-0 z-50"');
    expect(newTab).toContain('dir="ltr"');
    expect(newTab).toContain('className="absolute inset-y-0 start-4');
    expect(newTab).toContain('dir="auto"');
    expect(newTab).toContain('ps-12 pe-4');
    expect(newTab).toContain('text-start');
    expect(newTab).toContain('<bdi dir="auto">{result.title}</bdi>');
    expect(newTab).toContain('<bdi dir="auto">{result.subtitle}</bdi>');
  });

  it('mirrors onboarding navigation only and isolates its keyboard shortcut', () => {
    const onboarding = source('onboarding/OnboardingWizard.tsx');

    expect(onboarding).toMatch(/ChevronRight className="[^"]*rtl:rotate-180/);
    expect(onboarding).toMatch(/ArrowLeft className="[^"]*rtl:rotate-180/);
    expect(onboarding).toMatch(/ArrowRight className="[^"]*rtl:rotate-180/);
    expect(onboarding).toContain('<bdi dir="ltr">Alt+Q</bdi>');
    expect(onboarding).not.toMatch(/<X className="[^"]*rtl:/);
  });

  it('isolates blocked-page domains and timers while mirroring the back arrow', () => {
    const blocked = source('blocked/BlockedPage.tsx');

    expect(blocked).toContain('<bdi dir="auto">{domain}</bdi>');
    expect(blocked).toMatch(/<div dir="ltr" className="text-5xl/);
    expect(blocked).toMatch(/ArrowLeft className="[^"]*rtl:rotate-180/);
    expect(blocked).toContain("domain: isolateBidi(domain, 'auto')");
    expect(blocked).toContain("remaining: isolateBidi(formatRemainingText(remaining), 'ltr')");
    expect(blocked).not.toMatch(/<XCircle className="[^"]*rtl:/);
  });
});
