import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';

class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.listeners = new Map();
        FakeWebSocket.instances.push(this);
    }

    addEventListener(type, cb) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(cb);
    }

    removeEventListener(type, cb) {
        this.listeners.get(type)?.delete(cb);
    }

    close() {
        this.readyState = FakeWebSocket.CLOSED;
    }

    emit(type, payload = {}) {
        if (type === 'open') this.readyState = FakeWebSocket.OPEN;
        if (type === 'close') this.readyState = FakeWebSocket.CLOSED;
        for (const cb of this.listeners.get(type) || []) cb(payload);
    }
}

describe('WebSocketManager reconnect lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic 0.85 jitter
        FakeWebSocket.instances = [];
        vi.stubGlobal('WebSocket', FakeWebSocket);
        window.wsConnectionStatus = 'disconnected';
        window.logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()};
        window.toast = {success: vi.fn(), error: vi.fn()};
    });

    afterEach(async () => {
        try {
            const manager = await import('./WebSocketManager.js');
            manager.disconnect();
        } catch {
            // Best-effort teardown: the module may not have been imported by a failed test.
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    test('keeps exponential backoff attempts until a connection opens', async () => {
        const manager = await import('./WebSocketManager.js');
        manager.connect();
        expect(FakeWebSocket.instances).toHaveLength(1);

        FakeWebSocket.instances[0].emit('close');
        await vi.advanceTimersByTimeAsync(849);
        expect(FakeWebSocket.instances).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(FakeWebSocket.instances).toHaveLength(2);

        // The second failed attempt must use the 2s base delay (1.7s at 0.85 jitter),
        // not reset to the first 1s delay merely because connect() ran again.
        FakeWebSocket.instances[1].emit('close');
        await vi.advanceTimersByTimeAsync(1699);
        expect(FakeWebSocket.instances).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(FakeWebSocket.instances).toHaveLength(3);

        // A successful open resets the attempt counter, so the next loss starts at 850ms again.
        FakeWebSocket.instances[2].emit('open');
        FakeWebSocket.instances[2].emit('close');
        await vi.advanceTimersByTimeAsync(850);
        expect(FakeWebSocket.instances).toHaveLength(4);
    });

    test('disconnect cancels a pending reconnect', async () => {
        const manager = await import('./WebSocketManager.js');
        manager.connect();
        FakeWebSocket.instances[0].emit('close');
        manager.disconnect();

        await vi.advanceTimersByTimeAsync(30000);
        expect(FakeWebSocket.instances).toHaveLength(1);
        expect(manager.getStatus()).toBe('disconnected');
    });
});
