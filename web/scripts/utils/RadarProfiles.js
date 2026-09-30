import settingsSync from './SettingsSync.js';

export const RADAR_PROFILES = Object.freeze({
    gathering: {
        label: 'Recolección',
        values: {
            settingShowMap: true,
            settingShowPlayers: true,
            settingResourceCount: true,
            settingResourceDistance: true,
            settingResourceColorBadges: true,
            settingResourceClusters: true,
            settingAutoClusterRadius: true,
            settingTargetFps: 30,
            settingReduceWhenHidden: true,
        },
    },
    pve: {
        label: 'PvE',
        values: {
            settingShowMap: true,
            settingShowPlayers: true,
            settingResourceCount: false,
            settingResourceDistance: false,
            settingResourceClusters: false,
            settingEnemiesName: true,
            settingEnemiesTier: true,
            settingEnemiesHealthBar: true,
            settingTargetFps: 30,
            settingReduceWhenHidden: true,
        },
    },
    exploration: {
        label: 'Exploración',
        values: {
            settingShowMap: true,
            settingShowPlayers: true,
            settingResourceCount: true,
            settingResourceDistance: true,
            settingResourceClusters: true,
            settingAutoClusterRadius: true,
            settingTargetFps: 30,
            settingReduceWhenHidden: true,
        },
    },
    minimal: {
        label: 'Minimalista',
        values: {
            settingShowMap: false,
            settingShowPlayers: true,
            settingResourceCount: false,
            settingResourceDistance: false,
            settingResourceColorBadges: true,
            settingResourceClusters: true,
            settingAutoClusterRadius: true,
            settingTargetFps: 30,
            settingReduceWhenHidden: true,
        },
    },
});

export function applyRadarProfile(profileId) {
    const profile = RADAR_PROFILES[profileId];
    if (!profile) throw new Error(`Perfil desconocido: ${profileId}`);

    for (const [key, value] of Object.entries(profile.values)) {
        if (typeof value === 'boolean') settingsSync.setBool(key, value);
        else if (typeof value === 'number') settingsSync.setNumber(key, value);
        else settingsSync.set(key, String(value));
    }
    settingsSync.set('settingActiveProfile', profileId);
    return profile;
}
