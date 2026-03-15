import { normalizeTabConfig } from './types';
import type { Tab } from './types';

const STORAGE_KEY = 'llm-playground';

interface StoredState {
    tabs: Tab[];
    activeTabId: string | null;
}

export function saveState(tabs: Tab[], activeTabId: string | null) {
    const state: StoredState = {
        tabs: tabs.map(t => ({ ...t, streaming: false, abortController: undefined, debugInfo: undefined })),
        activeTabId,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // storage full - silently fail
    }
}

export function loadState(): StoredState | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw) as StoredState;
        for (const tab of state.tabs) {
            tab.streaming = false;
            tab.abortController = undefined;
            tab.debugInfo = undefined;
            tab.config = normalizeTabConfig(tab.config);
        }
        return state;
    } catch {
        return null;
    }
}
