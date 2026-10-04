import {afterEach, describe, expect, test, vi} from 'vitest';
import {EventInspector} from './EventInspector.js';

const event = (value = 'private player name') => JSON.stringify({code: 'event', dictionary: {parameters: {252: 40, 0: 17, 1: value}}});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('optional browser event inspector', () => {
    test('retains nothing until enabled and defaults to metadata only', () => {
        const inspector = new EventInspector();
        inspector.receive(event());
        expect(inspector.exportJSONL()).toBe('');
        inspector.setEnabled(true);
        inspector.receive(event());
        const row = JSON.parse(inspector.exportJSONL());
        expect(row.kind).toBe('event');
        expect(row.code).toBe(40);
        expect(row.parameters).toBeUndefined();
        expect(inspector.exportJSONL()).not.toContain('private player name');
        inspector.destroy();
    });

    test('bounds the buffer and retains the newest already received events', () => {
        const inspector = new EventInspector({maxEvents: 3});
        inspector.setEnabled(true);
        for (let code = 1; code <= 5; code++) inspector.receive(JSON.stringify({code: 'event', dictionary: {parameters: {252: code}}}));
        const rows = inspector.exportJSONL().trim().split('\n').map(JSON.parse);
        expect(rows.map(row => row.code)).toEqual([3, 4, 5]);
        expect(inspector.dropped).toBe(2);
        inspector.destroy();
    });

    test('payload requires opt-in and is copied, bounded and sanitized', () => {
        const inspector = new EventInspector();
        inspector.setEnabled(true);
        inspector.setIncludePayload(true);
        inspector.receive(event({password: 'secret', token: 'secret', note: '<img src=x>', big: 'x'.repeat(5000), nested: {a: {b: {c: {d: {e: 'too deep'}}}}}}));
        const row = JSON.parse(inspector.exportJSONL());
        expect(row.parameters[1].password).toBe('[redacted]');
        expect(row.parameters[1].token).toBe('[redacted]');
        expect(row.parameters[1].big.length).toBeLessThan(300);
        expect(inspector.exportJSONL()).not.toContain('too deep');
        inspector.setIncludePayload(false);
        expect(inspector.exportJSONL()).not.toContain('parameters');
        inspector.destroy();
    });

    test('rejects malformed and oversized frames, and caps burst work', () => {
        const inspector = new EventInspector();
        inspector.setEnabled(true);
        inspector.receive('invalid-json');
        inspector.receive(' '.repeat(200000));
        inspector.receive(JSON.stringify({type: 'batch', messages: Array.from({length: 1000}, () => ({code: 'event', dictionary: {parameters: {252: 40}}}))}));
        expect(inspector.exportJSONL().trim().split('\n').length).toBeLessThanOrEqual(100);
        for (let i = 0; i < 1000; i++) inspector.receive(event());
        expect(inspector.exportJSONL().trim().split('\n').length).toBeLessThanOrEqual(200);
        expect(inspector.dropped).toBeGreaterThan(0);
        inspector.destroy();
    });

    test('handles legacy dictionaries without interpreting markup', () => {
        const root = document.createElement('div');
        root.innerHTML = '<input data-inspector-enable type="checkbox"><input data-inspector-payload type="checkbox"><button data-inspector-export></button><button data-inspector-clear></button><p data-inspector-status></p><pre data-inspector-preview></pre>';
        const inspector = new EventInspector({root});
        const enabled = root.querySelector('[data-inspector-enable]');
        enabled.checked = true;
        enabled.dispatchEvent(new Event('change'));
        inspector.setIncludePayload(true);
        inspector.receive(JSON.stringify({code: 'request', dictionary: JSON.stringify({parameters: {253: 22, 1: '<img src=x onerror=evil()>'}})}));
        expect(JSON.parse(inspector.exportJSONL()).code).toBe(22);
        expect(root.querySelector('img')).toBeNull();
        root.querySelector('[data-inspector-clear]').click();
        expect(inspector.exportJSONL()).toBe('');
        inspector.destroy();
        enabled.checked = true;
        enabled.dispatchEvent(new Event('change'));
        inspector.receive(event());
        expect(inspector.exportJSONL()).toBe('');
    });

    test('downloads JSONL only after the export control is clicked', () => {
        vi.useFakeTimers();
        const root = document.createElement('div');
        root.innerHTML = '<input data-inspector-enable type="checkbox"><button data-inspector-export></button>';
        const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:inspection');
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const clicked = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push([this.href, this.download]); });
        const inspector = new EventInspector({root});
        inspector.setEnabled(true);
        inspector.receive(event());
        expect(clicked).toEqual([]);
        vi.advanceTimersByTime(250);
        root.querySelector('[data-inspector-export]').click();
        expect(clicked).toEqual([['blob:inspection', expect.stringMatching(/\.jsonl$/)]]);
        expect(create).toHaveBeenCalledOnce();
        expect(revoke).toHaveBeenCalledOnce();
        inspector.setEnabled(false);
        expect(inspector.exportJSONL()).toBe('');
        inspector.destroy();
    });
});
