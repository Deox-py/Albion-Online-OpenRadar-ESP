import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {normalizeRadarZoom} from './RadarZoomController.js';

const radarTemplate = readFileSync(
    'internal/templates/pages/radar.gohtml',
    'utf8',
);

describe('radar zoom range contract', () => {
    test('allows zooming out to ten percent for a wider view', () => {
        expect(radarTemplate).toContain(
            'id="settingRadarZoom" min="0.1" max="3" step="0.1"',
        );
        const [, minimum, maximum] = radarTemplate.match(
            /id="settingRadarZoom" min="([\d.]+)" max="([\d.]+)"/,
        );
        expect(normalizeRadarZoom(0.01)).toBe(Number(minimum));
        expect(normalizeRadarZoom(100)).toBe(Number(maximum));
    });
});
