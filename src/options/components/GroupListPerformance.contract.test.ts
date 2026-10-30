import * as fs from 'fs';
import * as path from 'path';

const GROUP_LIST_FILE = path.resolve(__dirname, './GroupListView.tsx');
const PERFORMANCE_FILE = path.resolve(__dirname, './group-list-performance.ts');
const CARD_FILE = path.resolve(__dirname, '../../components/MasonryGroupCard.tsx');
const HEAVY_CARD_FILE = path.resolve(__dirname, '../../components/group-card-heavy-list.ts');
const BACKUP_SETTINGS_FILE = path.resolve(__dirname, '../../settings/components/BackupSettings.tsx');
const OPTIONS_MAIN_FILE = path.resolve(__dirname, '../main.tsx');
const OPTIONS_LAYOUT_CSS_FILE = path.resolve(__dirname, '../../styles/options-layout.css');

describe('options group list heavy rendering contract', () => {
  it('enables heavy card previews for large grid lists only', () => {
    const {
      HEAVY_GROUP_VISIBLE_TAB_THRESHOLD,
      shouldUseHeavyGroupCards,
      shouldUseSequentialMasonry,
    } = require(PERFORMANCE_FILE);

    expect(HEAVY_GROUP_VISIBLE_TAB_THRESHOLD).toBe(200);
    expect(shouldUseHeavyGroupCards({ layoutMode: 'grid', visibleTabRows: 199 })).toBe(false);
    expect(shouldUseHeavyGroupCards({ layoutMode: 'grid', visibleTabRows: 200 })).toBe(true);
    expect(shouldUseHeavyGroupCards({ layoutMode: 'masonry', visibleTabRows: 1000 })).toBe(false);
    expect(shouldUseHeavyGroupCards({ layoutMode: 'dashboard', visibleTabRows: 1000 })).toBe(false);

    expect(shouldUseSequentialMasonry({ layoutMode: 'masonry', visibleTabRows: 199 })).toBe(false);
    expect(shouldUseSequentialMasonry({ layoutMode: 'masonry', visibleTabRows: 200 })).toBe(true);
    expect(shouldUseSequentialMasonry({ layoutMode: 'grid', visibleTabRows: 1000 })).toBe(false);
  });

  it('limits heavy card tab rows until the card is hovered', () => {
    const {
      HEAVY_GROUP_TAB_PREVIEW_LIMIT,
      getHeavyListDisplayTabs,
      getHiddenTabCount,
    } = require(HEAVY_CARD_FILE);
    const tabs = Array.from({ length: 8 }, (_, index) => ({ id: `tab-${index}` }));

    expect(HEAVY_GROUP_TAB_PREVIEW_LIMIT).toBe(3);
    expect(getHeavyListDisplayTabs(tabs, { enabled: true, isHovered: false })).toHaveLength(3);
    expect(getHiddenTabCount(tabs.length, 3)).toBe(5);
    expect(getHeavyListDisplayTabs(tabs, { enabled: true, isHovered: true })).toHaveLength(8);
    expect(getHeavyListDisplayTabs(tabs, { enabled: false, isHovered: false })).toHaveLength(8);
  });

  it('wires heavy preview mode into the options grid list', () => {
    const source = fs.readFileSync(GROUP_LIST_FILE, 'utf-8');
    const cssSource = fs.readFileSync(OPTIONS_LAYOUT_CSS_FILE, 'utf-8');

    expect(source).toContain('countVisibleTabRowsForGroupList');
    expect(source).toContain('shouldUseHeavyGroupCards');
    expect(source).toContain('heavyTabPreview: tabLayout ===');
    expect(source).toContain('shouldUseSequentialMasonry');
    expect(source).toContain('sequential={useSequentialMasonry}');
    expect(source).not.toContain('shouldUseNativeCardContainment');
    expect(source).not.toContain('data-native-card-containment');
    expect(cssSource).not.toContain('content-visibility: auto');
    expect(cssSource).not.toContain('contain-intrinsic-size: auto');
  });

  it('makes in-shell options navigation non-urgent', () => {
    const source = fs.readFileSync(OPTIONS_MAIN_FILE, 'utf-8');

    expect(source).toContain('useTransition');
    expect(source).toContain('startPageTransition(() => {');
    expect(source).toContain('navigateToPage');
  });

  it('uses masonry as the default group layout when no preference is stored', () => {
    const groupListSource = fs.readFileSync(GROUP_LIST_FILE, 'utf-8');
    const backupSettingsSource = fs.readFileSync(BACKUP_SETTINGS_FILE, 'utf-8');

    expect(groupListSource).toContain("useState<'grid' | 'masonry' | 'dashboard'>('masonry')");
    expect(backupSettingsSource).toContain("Storage.get<string>('layoutMode') || 'masonry'");
  });

  it('restores the natural full tab list while the group card is hovered', () => {
    const source = fs.readFileSync(CARD_FILE, 'utf-8');

    expect(source).toContain('heavyTabPreview');
    expect(source).toContain('getHeavyListDisplayTabs(displayTabs');
    expect(source).toContain('isHovered');
    expect(source).toContain('visibleTabs.map');
    expect(source).toContain('data-heavy-tab-preview-more');
    expect(source).not.toContain('hover to show all');
  });
});
