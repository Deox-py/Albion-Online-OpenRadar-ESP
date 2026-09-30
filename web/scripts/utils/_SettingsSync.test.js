import {beforeEach, describe, expect, test, vi} from 'vitest';

// Force the storage-event fallback so the test covers browsers where BroadcastChannel
// is unavailable or blocked.
vi.stubGlobal('BroadcastChannel', undefined);

const {SettingsSync} = await import('./SettingsSync.js');

describe('SettingsSync storage fallback', () => {
    beforeEach(() => {
        localStorage.clear();
        window.logger = {info: vi.fn(), error: vi.fn()};
    });

    test('propagates removals from another tab', () => {
        localStorage.setItem('settingExample', 'true');
        const sync = new SettingsSync();
        const listener = vi.fn();
        sync.on('settingExample', listener);

        window.dispatchEvent(new StorageEvent('storage', {
            key: 'settingExample',
            oldValue: 'true',
            newValue: null,
            storageArea: localStorage
        }));

        expect(sync.get('settingExample')).toBeNull();
        expect(listener).toHaveBeenCalledWith('settingExample', null);
        sync.destroy();
    });

    test('propagates changes from another tab', () => {
        const sync = new SettingsSync();
        const listener = vi.fn();
        sync.on('settingExample', listener);

        window.dispatchEvent(new StorageEvent('storage', {
            key: 'settingExample',
            oldValue: null,
            newValue: 'false',
            storageArea: localStorage
        }));

        expect(sync.get('settingExample')).toBe('false');
        expect(listener).toHaveBeenCalledWith('settingExample', 'false');
        sync.destroy();
    });
});
