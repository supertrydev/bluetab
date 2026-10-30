/** @jest-environment jsdom */

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TabGroup, TabItem } from '../types/models';

const localStore: Record<string, unknown> = {};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../utils/storage', () => ({
  Storage: {
    get: jest.fn(async (key: string) => localStore[key] ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      localStore[key] = value;
    }),
    remove: jest.fn(async (key: string) => {
      delete localStore[key];
    }),
    atomicUpdate: jest.fn(async <T,>(
      key: string,
      updater: (current: T | null) => T | Promise<T>,
      fallback: T | null = null,
    ) => {
      const current = (localStore[key] as T | undefined) ?? fallback;
      const next = await updater(current);
      localStore[key] = next;
      return next;
    }),
    getProjects: jest.fn(async () => []),
  },
}));

const toast = {
  success: jest.fn(),
  warning: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
};

jest.mock('../components/Toast', () => ({
  ToastManager: {
    getInstance: () => toast,
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('./brain-dump-service', () => ({
  BrainDumpService: { list: jest.fn(async () => []) },
}));

jest.mock('./smart-group-naming', () => ({
  autoRenameSavedGroupIfUntitled: jest.fn(async () => undefined),
}));

import { TabSelectionProvider, useTabSelectionContext } from '../contexts/TabSelectionContext';
import { useTabSelectionActions } from '../hooks/useTabSelectionActions';
import { useDragDrop } from '../options/components/DragDropOverlay';
import { GroupMemoryStorageService } from '../utils/group-memory-storage';
import { normalizeUrl } from '../utils/normalize';
import { addTabToExistingGroup, restoreSavedTabWithBehavior } from './saved-tab-actions';
import { adapter as slackAdapter } from './integrations/slack/adapter';

const GROUP_ID = 'group-1';
const TARGET_TAB_ID = 'tab-target';
const TARGET_URL = 'https://example.com/target';
const MIRROR_KEY = `slack_mirror:${GROUP_ID}`;
const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

function makeGroups(): TabGroup[] {
  return [{
    id: GROUP_ID,
    name: 'Research',
    tabs: [
      {
        id: TARGET_TAB_ID,
        url: TARGET_URL,
        title: 'Target',
        groupId: GROUP_ID,
        timestamp: 1,
      },
      {
        id: 'tab-keeper',
        url: 'https://example.com/keeper',
        title: 'Keeper',
        groupId: GROUP_ID,
        timestamp: 1,
      },
    ],
    created: 1,
    modified: 1,
  }];
}

function storedGroups(): TabGroup[] {
  return JSON.parse(JSON.stringify(localStore.groups)) as TabGroup[];
}

type SelectionHarnessApi = ReturnType<typeof useTabSelectionActions> & {
  toggleTab: (tab: TabItem, groupId: string) => void;
};

function SelectionHarness({
  groups,
  setGroups,
  onReady,
}: {
  groups: TabGroup[];
  setGroups: (groups: TabGroup[]) => void;
  onReady: (api: SelectionHarnessApi) => void;
}) {
  const selection = useTabSelectionContext();
  const actions = useTabSelectionActions({ groups, setGroups });

  useEffect(() => {
    onReady({ ...actions, toggleTab: selection.toggleTab });
  }, [actions, onReady, selection.toggleTab]);

  return null;
}

type DragHarnessApi = ReturnType<typeof useDragDrop>;

function DragHarness({
  groups,
  setGroups,
  onReady,
}: {
  groups: TabGroup[];
  setGroups: React.Dispatch<React.SetStateAction<TabGroup[]>>;
  onReady: (api: DragHarnessApi) => void;
}) {
  const drag = useDragDrop({ groups, setGroups });

  useEffect(() => {
    onReady(drag);
  }, [drag, onReady]);

  return drag.OverlayElement;
}

async function mountSelectionHarness(groups: TabGroup[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let api: SelectionHarnessApi | undefined;
  const setGroups = jest.fn();
  const onReady = (next: SelectionHarnessApi) => { api = next; };

  await act(async () => {
    root.render(
      <TabSelectionProvider groups={groups}>
        <SelectionHarness groups={groups} setGroups={setGroups} onReady={onReady} />
      </TabSelectionProvider>,
    );
  });

  return { root, container, setGroups, getApi: () => api! };
}

async function mountDragHarness(groups: TabGroup[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let api: DragHarnessApi | undefined;
  const setGroups = jest.fn();
  const onReady = (next: DragHarnessApi) => { api = next; };

  await act(async () => {
    root.render(
      <TabSelectionProvider groups={groups}>
        <DragHarness groups={groups} setGroups={setGroups} onReady={onReady} />
      </TabSelectionProvider>,
    );
  });

  return { root, container, setGroups, getApi: () => api! };
}

async function unmount(root: Root, container: HTMLElement) {
  await act(async () => root.unmount());
  container.remove();
}

function dragStartEvent() {
  return {
    stopPropagation: jest.fn(),
    dataTransfer: {
      effectAllowed: 'none',
      setData: jest.fn(),
      setDragImage: jest.fn(),
    },
  } as unknown as React.DragEvent;
}

async function dropOn(container: HTMLElement, label: string) {
  const target = Array.from(container.querySelectorAll<HTMLElement>('[data-drop-zone] > div'))
    .find((element) => element.textContent?.includes(label));
  expect(target).toBeDefined();

  await act(async () => {
    target!.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function syncSlackMirror() {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  } as Response);
  const result = await slackAdapter.executeVerb(
    'sync_group_mirroring',
    { groupId: GROUP_ID },
    'legacy-slack-token',
    {},
  );
  expect(result).toEqual({ success: true });
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as { channel: string; ts: string; text: string };
}

describe('Slack Group Memory permanent-removal parity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    for (const key of Object.keys(localStore)) delete localStore[key];
    localStore.settings = {
      duplicateHandling: 'reject',
      groupMemoryAutoRemember: true,
      groupMemoryEnabled: true,
      restoreBehavior: 'removeFromList',
    };
    localStore.groups = makeGroups();
    localStore[MIRROR_KEY] = {
      channel: 'C01GROUP',
      ts: '1715000000.000100',
      accountId: 'slack-account-1',
    };
    (chrome.tabs.create as jest.Mock).mockResolvedValue({ id: 101 });
  });

  it('keeps stable membership and the Slack tab after a normal Group Memory click', async () => {
    const result = await restoreSavedTabWithBehavior({
      url: TARGET_URL,
      tabId: TARGET_TAB_ID,
      groupId: GROUP_ID,
      groups: storedGroups(),
      active: false,
    });

    expect(result.updatedGroups[0].tabs.map((tab) => tab.id)).toEqual(['tab-keeper']);
    const memory = await GroupMemoryStorageService.getMemory();
    expect(memory.groups[GROUP_ID].tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalId: TARGET_TAB_ID }),
    ]));
    expect(memory.urlIndex[normalizeUrl(TARGET_URL)]).toBe(GROUP_ID);

    const payload = await syncSlackMirror();
    expect(payload.text).toContain('<https://example.com/target|Target>');
  });

  it('cleans Ctrl-selected delete state and re-adds through one existing-message update', async () => {
    const initialGroups = storedGroups();
    await GroupMemoryStorageService.rememberGroup(initialGroups[0]);
    const harness = await mountSelectionHarness(initialGroups);

    try {
      await act(async () => {
        harness.getApi().toggleTab(initialGroups[0].tabs[0], GROUP_ID);
      });
      await act(async () => {
        await harness.getApi().deleteSelectedTabs();
      });

      const memory = await GroupMemoryStorageService.getMemory();
      expect(memory.groups[GROUP_ID].tabs.map((tab) => tab.originalId)).toEqual(['tab-keeper']);
      expect(memory.urlIndex[normalizeUrl(TARGET_URL)]).toBeUndefined();
      expect(storedGroups()[0].tabs.map((tab) => tab.id)).toEqual(['tab-keeper']);

      const removalPayload = await syncSlackMirror();
      expect(removalPayload.text).not.toContain('Target');

      fetchMock.mockClear();
      const randomUuid = jest.spyOn(globalThis.crypto, 'randomUUID')
        .mockReturnValue('00000000-0000-4000-8000-000000000001');
      await addTabToExistingGroup({
        id: 12,
        title: 'Target re-added',
        url: TARGET_URL,
        pinned: false,
      }, GROUP_ID, 3);
      randomUuid.mockRestore();

      const readdPayload = await syncSlackMirror();
      expect(readdPayload.text).toContain('<https://example.com/target|Target re-added>');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe('https://slack.com/api/chat.update');
    } finally {
      await unmount(harness.root, harness.container);
    }
  });

  it('cleans remembered membership and the Slack summary on drag-to-trash', async () => {
    const initialGroups = storedGroups();
    await GroupMemoryStorageService.rememberGroup(initialGroups[0]);
    const harness = await mountDragHarness(initialGroups);

    try {
      await act(async () => {
        harness.getApi().handleTabDragStart(
          dragStartEvent(),
          initialGroups[0].tabs[0],
          GROUP_ID,
        );
      });
      await dropOn(harness.container, 'common.delete');

      const memory = await GroupMemoryStorageService.getMemory();
      expect(memory.groups[GROUP_ID].tabs.map((tab) => tab.originalId)).toEqual(['tab-keeper']);
      expect(memory.urlIndex[normalizeUrl(TARGET_URL)]).toBeUndefined();
      const payload = await syncSlackMirror();
      expect(payload.text).not.toContain('Target');
    } finally {
      await unmount(harness.root, harness.container);
    }
  });

  it('cleans the old memory membership and keeps the moved tab in a drag-created group', async () => {
    const initialGroups = storedGroups();
    await GroupMemoryStorageService.rememberGroup(initialGroups[0]);
    const harness = await mountDragHarness(initialGroups);
    const randomUuid = jest.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('00000000-0000-4000-8000-000000000002');

    try {
      await act(async () => {
        harness.getApi().handleTabDragStart(
          dragStartEvent(),
          initialGroups[0].tabs[0],
          GROUP_ID,
        );
      });
      await dropOn(harness.container, 'options.dragDrop.overlayNewGroup');

      const memory = await GroupMemoryStorageService.getMemory();
      expect(memory.groups[GROUP_ID].tabs.map((tab) => tab.originalId)).toEqual(['tab-keeper']);
      expect(memory.urlIndex[normalizeUrl(TARGET_URL)]).toBeUndefined();

      const nextGroups = storedGroups();
      const newGroup = nextGroups.find((group) => group.id === '00000000-0000-4000-8000-000000000002');
      expect(newGroup).toBeDefined();
      if (!newGroup) throw new Error('expected the drop target group to be created');
      expect(newGroup.tabs).toEqual([
        expect.objectContaining({ id: TARGET_TAB_ID, groupId: newGroup.id }),
      ]);

      const payload = await syncSlackMirror();
      expect(payload.text).not.toContain('Target');
    } finally {
      randomUuid.mockRestore();
      await unmount(harness.root, harness.container);
    }
  });
});
