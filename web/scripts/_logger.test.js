import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

// A WebSocket is the external transport boundary; settings and the logger run
// unchanged so assertions cover real subscriptions, buffering, and lifecycle.
class LogSocket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSED = 3;
    static instances = [];

    constructor(url) {
        super();
        this.url = url;
        this.readyState = LogSocket.CONNECTING;
        this.messages = [];
        this.failSend = false;
        LogSocket.instances.push(this);
    }

    open() {
        this.readyState = LogSocket.OPEN;
        this.dispatchEvent(new Event('open'));
    }

    close() {
        this.readyState = LogSocket.CLOSED;
        this.dispatchEvent(new Event('close'));
    }

    send(message) {
        if (this.failSend) throw new Error('transport unavailable');
        this.messages.push(JSON.parse(message));
    }
}

describe('logger server subscription', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.stubGlobal('WebSocket', LogSocket);
        vi.stubGlobal('BroadcastChannel', undefined);
        localStorage.clear();
        LogSocket.instances = [];
    });

    afterEach(() => {
        window.dispatchEvent(new Event('beforeunload'));
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test('disabled server logging starts without a socket', async () => {
        await import('./logger.js');
        expect(LogSocket.instances).toHaveLength(0);
    });

    test('enabling server logging opens an input-only subscription and disabling cancels retries', async () => {
        const {logger} = await import('./logger.js');
        const {default: settings} = await import('./utils/SettingsSync.js');
        settings.setBool('settingLogToServer', true);
        expect(LogSocket.instances).toHaveLength(1);
        const socket = LogSocket.instances[0];
        expect(socket.url).toMatch(/\/ws\?mode=logs$/);
        socket.open();
        logger.warn('System', 'enabled', {ok: true});
        logger.flush();
        expect(socket.messages).toHaveLength(1);
        expect(socket.messages[0].type).toBe('logs');
        expect(socket.messages[0].logs[0].event).toBe('enabled');
        socket.close();
        settings.setBool('settingLogToServer', false);
        vi.advanceTimersByTime(60000);
        expect(LogSocket.instances).toHaveLength(1);
        expect(socket.readyState).toBe(LogSocket.CLOSED);
    });

    test('logs captured while connecting survive until a successful send', async () => {
        localStorage.setItem('settingLogToServer', 'true');
        const {logger} = await import('./logger.js');
        const socket = LogSocket.instances[0];
        logger.warn('System', 'before-open', {});
        logger.flush();
        socket.open();
        logger.flush();
        expect(socket.messages).toHaveLength(1);
        expect(socket.messages[0].logs[0].event).toBe('before-open');
        const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        socket.failSend = true;
        logger.warn('System', 'retry-send', {});
        logger.flush();
        socket.failSend = false;
        logger.flush();
        expect(socket.messages).toHaveLength(2);
        expect(socket.messages[1].logs[0].event).toBe('retry-send');
        consoleWarning.mockRestore();
    });

    test('an offline backlog stays bounded and reconnects through the log-only subscription', async () => {
        localStorage.setItem('settingLogToServer', 'true');
        const {logger} = await import('./logger.js');
        const initial = LogSocket.instances[0];
        for (let i = 0; i < 250; i++) logger.warn('System', `offline-${i}`, {});
        initial.close();
        vi.advanceTimersByTime(1000);
        expect(LogSocket.instances).toHaveLength(2);
        const reconnect = LogSocket.instances[1];
        expect(reconnect.url).toMatch(/\/ws\?mode=logs$/);
        reconnect.open();
        expect(reconnect.messages[0].logs).toHaveLength(200);
        expect(reconnect.messages[0].logs[0].event).toBe('offline-50');
        expect(reconnect.messages[0].logs[199].event).toBe('offline-249');
    });
});
