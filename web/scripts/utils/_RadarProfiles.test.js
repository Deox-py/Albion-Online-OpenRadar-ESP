import {beforeEach, describe, expect, test, vi} from 'vitest';

const {settingsMock} = vi.hoisted(() => ({
    settingsMock: {
        setBool: vi.fn(),
        setNumber: vi.fn(),
        set: vi.fn(),
    },
}));

vi.mock('./SettingsSync.js', () => ({default: settingsMock}));

const {applyRadarProfile, RADAR_PROFILES} = await import('./RadarProfiles.js');

describe('RadarProfiles', () => {
    beforeEach(() => vi.clearAllMocks());

    test('applies gathering profile with typed setters', () => {
        const profile = applyRadarProfile('gathering');
        expect(profile.label).toBe('Recolección');
        expect(settingsMock.setBool).toHaveBeenCalledWith('settingShowMap', true);
        expect(settingsMock.setNumber).toHaveBeenCalledWith('settingTargetFps', 30);
        expect(settingsMock.set).toHaveBeenCalledWith('settingActiveProfile', 'gathering');
    });

    test('every declared profile has a label and values', () => {
        for (const profile of Object.values(RADAR_PROFILES)) {
            expect(typeof profile.label).toBe('string');
            expect(profile.label.length).toBeGreaterThan(0);
            expect(profile.values && typeof profile.values).toBe('object');
        }
    });

    test('rejects unknown profile id', () => {
        expect(() => applyRadarProfile('does-not-exist')).toThrow(/Perfil desconocido/);
    });
});
