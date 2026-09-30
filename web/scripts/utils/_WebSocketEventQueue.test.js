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

    test('hard caps a burst queue and records drops', () => {
        const q = new WebSocketEventQueue();
        // Prevent scheduled flushes while filling the synthetic queue.
        q.flushScheduled = true;
        for (let i = 0; i < 5005; i++) {
            q.queueEventInternal('event', {252: 200, 0: i});
        }
        expect(q.eventQueue.size).toBe(5000);
        expect(q.droppedEvents).toBe(5);
        expect(window.logger.warn).toHaveBeenCalled();
        q.destroy();
    });
});
