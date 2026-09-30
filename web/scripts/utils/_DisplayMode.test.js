import {beforeEach, describe, expect, test, vi} from 'vitest';

const {settingsMock, listeners} = vi.hoisted(() => ({
    listeners: new Map(),
    settingsMock: {
        getBool: vi.fn((_key, fallback = false) => fallback),
        setBool: vi.fn(),
        on: vi.fn(),
    },
}));
settingsMock.on.mockImplementation((key, cb) => listeners.set(key, cb));

vi.mock('./SettingsSync.js', () => ({default: settingsMock}));

const {initDisplayMode, toggleCompactMode, isCompactMode} = await import('./DisplayMode.js');

describe('DisplayMode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listeners.clear();
        settingsMock.on.mockImplementation((key, cb) => listeners.set(key, cb));
        document.body.className = '';
        settingsMock.getBool.mockImplementation((_key, fallback = false) => fallback);
    });

    test('initializes compact class from persisted setting', () => {
        settingsMock.getBool.mockReturnValue(true);
        initDisplayMode();
        expect(document.body.classList.contains('compact-mode')).toBe(true);
    });

    test('reacts to settings synchronization changes', () => {
        initDisplayMode();
        listeners.get('settingCompactMode')?.('settingCompactMode', 'true');
        expect(document.body.classList.contains('compact-mode')).toBe(true);
        listeners.get('settingCompactMode')?.('settingCompactMode', 'false');
        expect(document.body.classList.contains('compact-mode')).toBe(false);
    });

    test('toggle persists the opposite state', () => {
        settingsMock.getBool.mockReturnValue(false);
        expect(toggleCompactMode()).toBe(true);
        expect(settingsMock.setBool).toHaveBeenCalledWith('settingCompactMode', true);
    });

    test('isCompactMode reflects settings', () => {
        settingsMock.getBool.mockReturnValue(true);
        expect(isCompactMode()).toBe(true);
    });
});
