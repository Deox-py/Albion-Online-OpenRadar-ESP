import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {WebSocketEventQueue} from './WebSocketEventQueue.js';

describe('WebSocketEventQueue 2.3ESP_Deox', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        window.settingsSync = {getBool: vi.fn((_key, fallback = true) => fallback)};
        window.logger = {warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn()};
        Object.defineProperty(document, 'hidden', {value: false, configurable: true});
        globalThis.requestAnimationFrame = vi.fn(cb => setTimeout(() => cb(performance.now()), 16));
        globalThis.cancelAnimationFrame = vi.fn(id => clearTimeout(id));
    });

    afterEach(() => {
        vi.useRealTimers();
        delete window.settingsSync;
        delete window.logger;
    });

    test('coalesces repeated movement events for the same entity', () => {
        const q = new WebSocketEventQueue();
        q.queueEventInternal('event', {252: 3, 0: 42, 1: 'first'});
        q.queueEventInternal('event', {252: 3, 0: 42, 1: 'latest'});
        expect(q.eventQueue.size).toBe(1);
        expect([...q.eventQueue.values()][0].params[1]).toBe('latest');
        q.destroy();
    });

    test('preserves movement ordering across leave and respawn barriers', () => {
        const q = new WebSocketEventQueue();
        const delivered = [];
        q.setFlushCallback((_kind, params) => delivered.push([params[252], params[1]]));
        q.queueEventInternal('event', {252: 3, 0: 17, 1: 'old-move'});
        q.queueEventInternal('event', {252: 1, 0: 17, 1: 'leave'});
        q.queueEventInternal('event', {252: 123, 0: 17, 1: 'spawn'});
        q.queueEventInternal('event', {252: 3, 0: 17, 1: 'new-move'});
        q.flush();
        expect(delivered).toEqual([[3, 'old-move'], [1, 'leave'], [123, 'spawn'], [3, 'new-move']]);
        q.destroy();
    });

    test('does not throttle the first health update of a respawned entity', () => {
        vi.spyOn(performance, 'now').mockReturnValue(100);
        const q = new WebSocketEventQueue();
        const delivered = [];
        q.setFlushCallback((_kind, params) => delivered.push(params[1]));
        q.queueEventInternal('event', {252: 6, 0: 17, 1: 'old-health'});
        q.queueEventInternal('event', {252: 1, 0: 17, 1: 'leave'});
        q.queueEventInternal('event', {252: 123, 0: 17, 1: 'spawn'});
        q.queueEventInternal('event', {252: 6, 0: 17, 1: 'new-health'});
        q.flush();
        expect(delivered).toEqual(['old-health', 'leave', 'spawn', 'new-health']);
        q.destroy();
        vi.restoreAllMocks();
    });

    test('accepts the first throttled event even at the initial clock origin', () => {
        vi.spyOn(performance, 'now').mockReturnValue(0);
        const q = new WebSocketEventQueue();
        const delivered = [];
        q.setFlushCallback((_kind, params) => delivered.push(params[1]));
        q.queueEventInternal('event', {252: 6, 0: 17, 1: 'initial-health'});
        q.flush();
        expect(delivered).toEqual(['initial-health']);
        q.destroy();
        vi.restoreAllMocks();
    });

    test('uses timer flush while document is hidden', () => {
        Object.defineProperty(document, 'hidden', {value: true, configurable: true});
        const q = new WebSocketEventQueue();
        const cb = vi.fn();
        q.setFlushCallback(cb);
        q.queueEventInternal('event', {252: 200, 0: 1});
        expect(q.flushTimerId).not.toBeNull();
        vi.advanceTimersByTime(80);
        expect(cb).toHaveBeenCalledTimes(1);
        q.destroy();
    });

    test('reschedules a suspended visible-tab frame when the tab becomes hidden', () => {
        globalThis.requestAnimationFrame = vi.fn(() => 123);
        const q = new WebSocketEventQueue(); const seen = vi.fn();
        q.setFlushCallback(seen);
        q.queueEventInternal('event', {252: 200, 0: 1});
        Object.defineProperty(document, 'hidden', {value: true, configurable: true});
        document.dispatchEvent(new Event('visibilitychange'));
        q.queueEventInternal('event', {252: 200, 0: 2});
        vi.advanceTimersByTime(80);
        expect(seen).toHaveBeenCalledTimes(2);
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(123);
        q.destroy();
    });

    test('invalidates an incomplete burst instead of replaying stale entity events', () => {
        const q = new WebSocketEventQueue();
        const reset = vi.fn();
        q.setResetCallback(reset);
        // Prevent scheduled flushes while filling the synthetic queue.
        q.flushScheduled = true;
        for (let i = 0; i < 5005; i++) {
            q.queueEventInternal('event', {252: 200, 0: i});
        }
        expect(q.eventQueue.size).toBe(5);
        expect(q.droppedEvents).toBe(5000);
        expect(reset).toHaveBeenCalledExactlyOnceWith('frontend-overflow');
        expect(window.logger.warn).toHaveBeenCalled();
        q.destroy();
    });

    test('preserves event order before a map-changing response', () => {
        const q = new WebSocketEventQueue();
        const seen = [];
        q.setFlushCallback((kind, params) => seen.push([kind, params[0]]));
        q.queueEventInternal('event', {252: 40, 0: 1});
        q.queueEventInternal('response', {253: 2, 0: 'next-map'});
        vi.advanceTimersByTime(20);
        expect(seen).toEqual([['event', 1], ['response', 'next-map']]);
        q.destroy();
    });

    test('validates and delivers observed map context before later entity traffic', () => {
        const q = new WebSocketEventQueue();
        const order = [];
        q.setFlushCallback(() => order.push('entity'));
        q.setMapContextCallback(ctx => order.push(ctx.mapId));
        q.queueEventInternal('event', {252: 40, 0: 1});
        q.queueRawMessage(JSON.stringify({type: 'map-context', mapId: '1000', observedAt: 1000, source: 'join'}));
        q.queueEventInternal('event', {252: 40, 0: 2});
        q.flush();
        expect(order).toEqual(['entity', '1000', 'entity']);
        q.destroy();
    });

    test.each([
        {mapId: '', observedAt: 1000, source: 'join'},
        {mapId: '1000', observedAt: '1000', source: 'join'},
        {mapId: '1000', observedAt: 1000, source: 'guessed'},
        {mapId: '1000', observedAt: 1000, source: 'join', mistLethal: 'true'},
        {mapId: '1000', observedAt: 1000, source: 'join', originCluster: {}},
    ])('invalid map context resets the stream: %j', fields => {
        const q = new WebSocketEventQueue();
        const context = vi.fn(); const reset = vi.fn();
        q.setMapContextCallback(context); q.setResetCallback(reset);
        q.queueRawMessage(JSON.stringify({type: 'map-context', ...fields}));
        expect(context).not.toHaveBeenCalled();
        expect(reset).toHaveBeenCalledExactlyOnceWith('malformed-stream');
        q.destroy();
    });

    test('map context subscription is released on destroy', () => {
        const q = new WebSocketEventQueue();
        q.setMapContextCallback(vi.fn()); q.destroy();
        expect(q.mapContextCallback).toBeNull();
    });

    test.each([2, 41])('a failed zone response %s cannot confirm a map', code => {
        const q = new WebSocketEventQueue(); const delivered = vi.fn();
        q.setFlushCallback(delivered);
        q.queueRawMessage(JSON.stringify({code: 'response', dictionary: {
            returnCode: -1, parameters: {253: code, 0: '9999', 8: '9999'},
        }}));
        expect(delivered).not.toHaveBeenCalled();
        q.queueRawMessage(JSON.stringify({code: 'response', dictionary: {
            returnCode: 0, parameters: {253: code, 0: '1000', 8: '1000'},
        }}));
        expect(delivered).toHaveBeenCalledExactlyOnceWith('response', {253: code, 0: '1000', 8: '1000'});
        q.destroy();
    });

    test('a backend stream reset discards queued events and permits fresh updates', () => {
        const q = new WebSocketEventQueue();
        const seen = vi.fn();
        const reset = vi.fn();
        q.setFlushCallback(seen);
        q.setResetCallback(reset);
        q.queueEventInternal('event', {252: 40, 0: 1});
        q.queueRawMessage(JSON.stringify({type: 'stream-reset', reason: 'queue-overflow'}));
        q.queueEventInternal('event', {252: 40, 0: 2});
        vi.advanceTimersByTime(20);
        expect(reset).toHaveBeenCalledExactlyOnceWith('queue-overflow');
        expect(seen).toHaveBeenCalledExactlyOnceWith('event', {252: 40, 0: 2});
        q.destroy();
    });

    test('malformed batch input invalidates partial state rather than leaving queued events', () => {
        const q = new WebSocketEventQueue();
        const reset = vi.fn();
        const seen = vi.fn();
        q.setResetCallback(reset);
        q.setFlushCallback(seen);
        q.queueRawMessage(JSON.stringify({type: 'batch', messages: [
            {code: 'event', dictionary: {parameters: {252: 40, 0: 1}}},
            {code: 'event', dictionary: 'invalid-json'}
        ]}));
        vi.advanceTimersByTime(20);
        expect(seen).not.toHaveBeenCalled();
        expect(reset).toHaveBeenCalledExactlyOnceWith('malformed-stream');
        q.destroy();
    });

    test.each([
        ['missing code', {dictionary: {parameters: {}}}],
        ['null code', {code: null, dictionary: {parameters: {}}}],
        ['unknown code', {code: 'unknown', dictionary: {parameters: {}}}],
        ['missing parameters', {code: 'event', dictionary: {}}],
        ['null parameters', {code: 'event', dictionary: {parameters: null}}],
        ['array parameters', {code: 'event', dictionary: {parameters: []}}],
        ['string parameters', {code: 'event', dictionary: {parameters: 'broken'}}],
        ['null dictionary', {code: 'event', dictionary: null}],
        ['array dictionary', {code: 'event', dictionary: []}],
        ['number dictionary', {code: 'event', dictionary: 2}],
        ['stringified primitive dictionary', {code: 'event', dictionary: 'true'}],
    ])('invalidates the complete batch before applying its map response when it has %s', (_label, invalid) => {
        const q = new WebSocketEventQueue();
        const delivered = [];
        const resets = [];
        q.setFlushCallback((kind, params) => delivered.push({kind, params}));
        q.setResetCallback(reason => resets.push(reason));
        q.queueRawMessage(JSON.stringify({type: 'batch', messages: [
            {code: 'response', dictionary: {parameters: {253: 41, 0: 'next-map'}}},
            invalid,
        ]}));
        q.flush();
        expect(delivered).toEqual([]);
        expect(resets).toEqual(['malformed-stream']);
        q.destroy();
    });

    test('accepts legacy string dictionaries and unknown numeric inner event IDs', () => {
        const q = new WebSocketEventQueue();
        const delivered = [];
        const resets = [];
        q.setFlushCallback((kind, params) => delivered.push({kind, params}));
        q.setResetCallback(reason => resets.push(reason));
        q.queueRawMessage(JSON.stringify({code: 'event', dictionary: JSON.stringify({parameters: {252: 65534, 0: 17}})}));
        q.flush();
        expect(delivered).toEqual([{kind: 'event', params: {252: 65534, 0: 17}}]);
        expect(resets).toEqual([]);
        q.destroy();
    });

    test.each(['event', 'request', 'response'])('accepts an empty %s parameters object', kind => {
        const q = new WebSocketEventQueue();
        const delivered = [];
        const resets = [];
        q.setFlushCallback((messageKind, params) => delivered.push({kind: messageKind, params}));
        q.setResetCallback(reason => resets.push(reason));
        q.queueRawMessage(JSON.stringify({code: kind, dictionary: {parameters: {}}}));
        q.flush();
        expect(delivered).toEqual([{kind, params: {}}]);
        expect(resets).toEqual([]);
        q.destroy();
    });
});
