import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from 'react';
import type { TabItem, TabGroup } from '../types/models';

// ===== TYPES =====

export interface SelectedTabInfo {
  tab: TabItem;
  groupId: string;
}

export interface TabSelectionState {
  selectedTabs: Map<string, SelectedTabInfo>;
  isSelectionMode: boolean;
  isDragging: boolean;
  draggedItems: Map<string, SelectedTabInfo> | null;
}

export type TabSelectionAction =
  | { type: 'SELECT_TAB'; payload: { tab: TabItem; groupId: string } }
  | { type: 'DESELECT_TAB'; payload: { tabId: string } }
  | { type: 'TOGGLE_TAB'; payload: { tab: TabItem; groupId: string } }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'ENABLE_SELECTION_MODE' }
  | { type: 'DISABLE_SELECTION_MODE' }
  | { type: 'START_DRAG'; payload: { items: Map<string, SelectedTabInfo> } }
  | { type: 'END_DRAG' }
  | { type: 'CLEANUP_DELETED_TABS'; payload: { validTabIds: Set<string> } }
  | { type: 'SELECT_MULTIPLE'; payload: { tabs: Array<{ tab: TabItem; groupId: string }> } };

export interface TabSelectionContextValue {
  state: TabSelectionState;
  dispatch: React.Dispatch<TabSelectionAction>;

  // Computed values (memoized)
  selectedTabIds: Set<string>;
  selectedCount: number;
  hasSelection: boolean;

  // Actions
  toggleTab: (tab: TabItem, groupId: string) => void;
  selectTab: (tab: TabItem, groupId: string) => void;
  deselectTab: (tabId: string) => void;
  clearSelection: () => void;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  startDrag: () => void;
  endDrag: () => void;

  // Query helpers
  isTabSelected: (tabId: string) => boolean;
  getSelectedTabsInGroup: (groupId: string) => TabItem[];
  getSelectedTabsArray: () => SelectedTabInfo[];
}

// ===== INITIAL STATE =====

const initialState: TabSelectionState = {
  selectedTabs: new Map(),
  isSelectionMode: false,
  isDragging: false,
  draggedItems: null,
};

// ===== REDUCER =====

function tabSelectionReducer(
  state: TabSelectionState,
  action: TabSelectionAction
): TabSelectionState {
  switch (action.type) {
    case 'SELECT_TAB': {
      const newSelectedTabs = new Map(state.selectedTabs);
      newSelectedTabs.set(action.payload.tab.id, {
        tab: action.payload.tab,
        groupId: action.payload.groupId,
      });
      return {
        ...state,
        selectedTabs: newSelectedTabs,
        isSelectionMode: true,
      };
    }

    case 'DESELECT_TAB': {
      const newSelectedTabs = new Map(state.selectedTabs);
      newSelectedTabs.delete(action.payload.tabId);
      const shouldExitMode = newSelectedTabs.size === 0;
      return {
        ...state,
        selectedTabs: newSelectedTabs,
        isSelectionMode: shouldExitMode ? false : state.isSelectionMode,
      };
    }

    case 'TOGGLE_TAB': {
      const newSelectedTabs = new Map(state.selectedTabs);
      const tabId = action.payload.tab.id;

      if (newSelectedTabs.has(tabId)) {
        newSelectedTabs.delete(tabId);
      } else {
        newSelectedTabs.set(tabId, {
          tab: action.payload.tab,
          groupId: action.payload.groupId,
        });
      }

      return {
        ...state,
        selectedTabs: newSelectedTabs,
        isSelectionMode: newSelectedTabs.size > 0,
      };
    }

    case 'CLEAR_SELECTION':
      return {
        ...state,
        selectedTabs: new Map(),
        isSelectionMode: false,
        isDragging: false,
        draggedItems: null,
      };

    case 'ENABLE_SELECTION_MODE':
      return { ...state, isSelectionMode: true };

    case 'DISABLE_SELECTION_MODE':
      return { ...state, isSelectionMode: false };

    case 'START_DRAG':
      return {
        ...state,
        isDragging: true,
        draggedItems: action.payload.items,
      };

    case 'END_DRAG':
      return {
        ...state,
        isDragging: false,
        draggedItems: null,
      };

    case 'CLEANUP_DELETED_TABS': {
      const newSelectedTabs = new Map(state.selectedTabs);
      let hasChanges = false;

      for (const tabId of newSelectedTabs.keys()) {
        if (!action.payload.validTabIds.has(tabId)) {
          newSelectedTabs.delete(tabId);
          hasChanges = true;
        }
      }

      if (!hasChanges) return state;

      return {
        ...state,
        selectedTabs: newSelectedTabs,
        isSelectionMode: newSelectedTabs.size > 0 ? state.isSelectionMode : false,
      };
    }

    case 'SELECT_MULTIPLE': {
      const newSelectedTabs = new Map(state.selectedTabs);
      for (const { tab, groupId } of action.payload.tabs) {
        newSelectedTabs.set(tab.id, { tab, groupId });
      }
      return {
        ...state,
        selectedTabs: newSelectedTabs,
        isSelectionMode: true,
      };
    }

    default:
      return state;
  }
}

// ===== CONTEXT =====

const TabSelectionContext = createContext<TabSelectionContextValue | null>(null);

// ===== PROVIDER =====

interface TabSelectionProviderProps {
  children: ReactNode;
  groups: TabGroup[];
}

export function TabSelectionProvider({ children, groups }: TabSelectionProviderProps) {
  const [state, dispatch] = useReducer(tabSelectionReducer, initialState);

  // Memoized computed values - prevents Map->Set on every render
  const selectedTabIds = useMemo(
    () => new Set(state.selectedTabs.keys()),
    [state.selectedTabs]
  );

  const selectedCount = useMemo(() => state.selectedTabs.size, [state.selectedTabs]);

  const hasSelection = selectedCount > 0;

  // Cleanup when tabs are deleted from groups
  useEffect(() => {
    const validTabIds = new Set<string>();
    for (const group of groups) {
      for (const tab of group.tabs) {
        validTabIds.add(tab.id);
      }
    }
    dispatch({ type: 'CLEANUP_DELETED_TABS', payload: { validTabIds } });
  }, [groups]);

  // Memoized actions
  const toggleTab = useCallback((tab: TabItem, groupId: string) => {
    dispatch({ type: 'TOGGLE_TAB', payload: { tab, groupId } });
  }, []);

  const selectTab = useCallback((tab: TabItem, groupId: string) => {
    dispatch({ type: 'SELECT_TAB', payload: { tab, groupId } });
  }, []);

  const deselectTab = useCallback((tabId: string) => {
    dispatch({ type: 'DESELECT_TAB', payload: { tabId } });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  const enterSelectionMode = useCallback(() => {
    dispatch({ type: 'ENABLE_SELECTION_MODE' });
  }, []);

  const exitSelectionMode = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  const startDrag = useCallback(() => {
    if (state.selectedTabs.size > 0) {
      dispatch({ type: 'START_DRAG', payload: { items: new Map(state.selectedTabs) } });
    }
  }, [state.selectedTabs]);

  const endDrag = useCallback(() => {
    dispatch({ type: 'END_DRAG' });
  }, []);

  // Query helpers
  const isTabSelected = useCallback(
    (tabId: string) => {
      return state.selectedTabs.has(tabId);
    },
    [state.selectedTabs]
  );

  const getSelectedTabsInGroup = useCallback(
    (groupId: string) => {
      const tabs: TabItem[] = [];
      state.selectedTabs.forEach(({ tab, groupId: gId }) => {
        if (gId === groupId) tabs.push(tab);
      });
      return tabs;
    },
    [state.selectedTabs]
  );

  const getSelectedTabsArray = useCallback(() => {
    return Array.from(state.selectedTabs.values());
  }, [state.selectedTabs]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<TabSelectionContextValue>(
    () => ({
      state,
      dispatch,
      selectedTabIds,
      selectedCount,
      hasSelection,
      toggleTab,
      selectTab,
      deselectTab,
      clearSelection,
      enterSelectionMode,
      exitSelectionMode,
      startDrag,
      endDrag,
      isTabSelected,
      getSelectedTabsInGroup,
      getSelectedTabsArray,
    }),
    [
      state,
      selectedTabIds,
      selectedCount,
      hasSelection,
      toggleTab,
      selectTab,
      deselectTab,
      clearSelection,
      enterSelectionMode,
      exitSelectionMode,
      startDrag,
      endDrag,
      isTabSelected,
      getSelectedTabsInGroup,
      getSelectedTabsArray,
    ]
  );

  return (
    <TabSelectionContext.Provider value={contextValue}>
      {children}
    </TabSelectionContext.Provider>
  );
}

// ===== HOOK =====

export function useTabSelectionContext(): TabSelectionContextValue {
  const context = useContext(TabSelectionContext);
  if (!context) {
    throw new Error('useTabSelectionContext must be used within TabSelectionProvider');
  }
  return context;
}
