import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';
import {RadarZoomController, normalizeRadarZoom} from './RadarZoomController.js';

describe('radar zoom controls', () => {
    let settings, value, listeners, controller;
    beforeEach(() => {
        value = 1;
        listeners = new Set();
        settings = {
            getFloat: () => value,
            setFloat: vi.fn((key, next) => { value = next; listeners.forEach(fn => fn(key, String(next))); }),
            on: (key, fn) => listeners.add(fn), off: (key, fn) => listeners.delete(fn),
        };
        document.body.innerHTML = '<div id="canvasContainer"></div>' +
            '<input id="settingRadarZoom" type="range" min="0.1" max="3" step="0.1">' +
            '<button id="zoomOut"></button><button id="zoomIn"></button>' +
            '<button id="zoomReset"></button><span id="zoomValue"></span>';
        controller = new RadarZoomController(document, settings);
    });
    afterEach(() => controller?.destroy());
    const wheel = (deltaY, options = {}) => {
        const event = new WheelEvent('wheel', {deltaY, cancelable: true, ...options});
        // happy-dom's WheelEvent does not initialize inherited mouse modifiers.
        Object.defineProperty(event, 'ctrlKey', {value: options.ctrlKey || false});
        document.getElementById('canvasContainer').dispatchEvent(event);
        return event;
    };
    test('buttons, slider and reset share a persisted scale', () => {
        document.getElementById('zoomIn').click();
        expect(value).toBe(1.1);
        expect(document.getElementById('zoomValue').textContent).toBe('110%');
        const slider = document.getElementById('settingRadarZoom');
        slider.value = '0.4'; slider.dispatchEvent(new Event('input'));
        expect(value).toBe(0.4);
        document.getElementById('zoomOut').click(); expect(value).toBe(0.3);
        document.getElementById('zoomReset').click(); expect(value).toBe(1);
    });
    test('wheel zooms and captures scrolling only over the radar', () => {
        expect(wheel(-40).defaultPrevented).toBe(true); expect(value).toBe(1.1);
        wheel(40); expect(value).toBe(1);
        const outside = new WheelEvent('wheel', {deltaY: -40, cancelable: true});
        document.body.dispatchEvent(outside);
        expect(outside.defaultPrevented).toBe(false); expect(value).toBe(1);
        expect(wheel(-40, {ctrlKey: true}).defaultPrevented).toBe(false);
        expect(value).toBe(1);
    });
    test('small trackpad deltas accumulate and line/page deltas work', () => {
        wheel(-10); wheel(-10); wheel(-10); expect(value).toBe(1);
        wheel(-10); expect(value).toBe(1.1);
        wheel(-3, {deltaMode: 1}); expect(value).toBe(1.2);
        wheel(-1, {deltaMode: 2}); expect(value).toBe(1.7);
    });
    test('limits prevent overflow and invalid stored zoom uses a safe default', () => {
        value = 3; wheel(-120); expect(value).toBe(3);
        value = 0.1; wheel(120); expect(value).toBe(0.1);
        expect(normalizeRadarZoom(Infinity)).toBe(1);
        expect(normalizeRadarZoom(NaN)).toBe(1);
        expect(normalizeRadarZoom(0)).toBe(1);
        expect(normalizeRadarZoom(9)).toBe(3);
        expect(normalizeRadarZoom(0.01)).toBe(0.1);
    });
    test('an extreme wheel delta cannot poison subsequent input', () => {
        wheel(-Number.MAX_VALUE, {deltaMode: 2}); expect(value).toBe(1.5);
        wheel(40); expect(value).toBe(1.4);
        wheel(NaN); expect(value).toBe(1.4);
    });
    test('external setting changes update controls; destroyed controls are inert', () => {
        value = 2; listeners.forEach(fn => fn('settingRadarZoom', '2'));
        expect(document.getElementById('zoomValue').textContent).toBe('200%');
        controller.destroy();
        expect(listeners.size).toBe(0);
        document.getElementById('zoomIn').click(); wheel(-40);
        expect(value).toBe(2);
        const next = new RadarZoomController(document, settings);
        document.getElementById('zoomIn').click(); expect(value).toBe(2.1);
        next.destroy();
    });
});
