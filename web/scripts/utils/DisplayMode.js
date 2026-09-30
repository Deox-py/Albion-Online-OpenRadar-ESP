import settingsSync from './SettingsSync.js';

const KEY = 'settingCompactMode';

function applyCompactMode(enabled) {
    document.body.classList.toggle('compact-mode', Boolean(enabled));
    document.dispatchEvent(new CustomEvent('compactModeChange', {detail: {enabled: Boolean(enabled)}}));
}

export function initDisplayMode() {
    applyCompactMode(settingsSync.getBool(KEY, false));
    const listener = (_key, value) => applyCompactMode(value === 'true');
    settingsSync.on(KEY, listener);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && settingsSync.getBool(KEY, false)) {
            settingsSync.setBool(KEY, false);
        }
    });
}

export function toggleCompactMode() {
    const next = !settingsSync.getBool(KEY, false);
    settingsSync.setBool(KEY, next);
    return next;
}

export function isCompactMode() {
    return settingsSync.getBool(KEY, false);
}
