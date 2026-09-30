import {CATEGORIES} from '../constants/LoggerConstants.js';

const COALESCABLE_EVENTS = new Set([3, 6, 91]);
const THROTTLED_EVENTS = { 6: 50, 91: 100 };
const MAX_EVENT_QUEUE = 5000;
const MAX_EVENTS_PER_FLUSH = 1000;
const HIDDEN_FLUSH_DELAY_MS = 75;

export class WebSocketEventQueue {
    constructor() {
        this.eventQueue = new Map();
        this.throttleMap = new Map();
        this.flushScheduled = false;
        this.flushCallback = null;
        this.rafId = null;
        this.flushTimerId = null;
        this.queueSeq = 0;
        this.droppedEvents = 0;
        this.cleanupInterval = setInterval(() => this.cleanupThrottleMap(), 30000);
    }

    get enableCoalescing() {
        return window.settingsSync?.getBool('settingWsCoalescing', true) ?? true;
    }

    get enableThrottling() {
        return window.settingsSync?.getBool('settingWsThrottling', true) ?? true;
    }

    setFlushCallback(callback) {
        this.flushCallback = callback;
    }

    parseMessage(msg) {
        const dict = typeof msg.dictionary === 'string' ? JSON.parse(msg.dictionary) : msg.dictionary;
        if (!dict || typeof dict !== 'object') throw new Error('dictionary inválido');
        return { code: msg.code, params: dict.parameters };
    }

    queueRawMessage(rawData) {
        try {
            const data = JSON.parse(rawData);
            const messages = data.type === 'batch' ? data.messages : [data];
            if (!Array.isArray(messages)) throw new Error('batch.messages no es un array');

            for (const msg of messages) {
                const { code, params } = this.parseMessage(msg);
                this.queueEventInternal(code, params);
            }
        } catch (e) {
            window.logger?.warn(CATEGORIES.NETWORK, 'MalformedWSMessage', {error: e?.message});
        }
    }

    queueEventInternal(messageType, params) {
        if (messageType !== 'event') {
            this.processImmediately(messageType, params);
            return;
        }
        if (!params || typeof params !== 'object') {
            window.logger?.warn(CATEGORIES.NETWORK, 'MalformedWSEvent', {reason: 'missing parameters'});
            return;
        }

        const eventCode = params[252];
        const entityId = params[0];

        if (this.enableThrottling && THROTTLED_EVENTS[eventCode]) {
            const throttleKey = `${eventCode}-${entityId}`;
            const lastProcessed = this.throttleMap.get(throttleKey) || 0;
            const now = performance.now();

            if (now - lastProcessed < THROTTLED_EVENTS[eventCode]) return;
            this.throttleMap.set(throttleKey, now);
        }

        const queueKey = this.enableCoalescing && COALESCABLE_EVENTS.has(eventCode)
            ? `${eventCode}-${entityId}`
            : `${eventCode}-seq-${++this.queueSeq}`;

        // Coalesced updates overwrite in place and do not increase queue size.
        // For non-coalesced bursts, discard the oldest item once the hard cap
        // is reached. This keeps a hidden/throttled browser tab from growing
        // memory indefinitely while the backend continues streaming events.
        if (!this.eventQueue.has(queueKey) && this.eventQueue.size >= MAX_EVENT_QUEUE) {
            const oldestKey = this.eventQueue.keys().next().value;
            if (oldestKey !== undefined) this.eventQueue.delete(oldestKey);
            this.droppedEvents++;
            if (this.droppedEvents === 1 || this.droppedEvents % 500 === 0) {
                window.logger?.warn(CATEGORIES.NETWORK, 'WebSocketEventQueueOverflow', {
                    dropped: this.droppedEvents,
                    maxQueue: MAX_EVENT_QUEUE,
                });
            }
        }

        this.eventQueue.set(queueKey, { messageType, params });
        this.scheduleFlush();
    }

    processImmediately(messageType, params) {
        if (this.flushCallback) this.flushCallback(messageType, params);
    }

    scheduleFlush() {
        if (this.flushScheduled) return;
        this.flushScheduled = true;

        // Browsers can pause requestAnimationFrame almost completely for hidden
        // tabs. Keep state processing alive at a low cadence in the background.
        if (document.hidden) {
            this.flushTimerId = setTimeout(() => {
                this.flushTimerId = null;
                this.flush();
            }, HIDDEN_FLUSH_DELAY_MS);
        } else {
            this.rafId = requestAnimationFrame(() => {
                this.rafId = null;
                this.flush();
            });
        }
    }

    flush() {
        this.flushScheduled = false;
        if (this.eventQueue.size === 0) return;

        if (!this.flushCallback) {
            this.eventQueue.clear();
            return;
        }

        let processed = 0;
        for (const [key, event] of this.eventQueue) {
            this.eventQueue.delete(key);
            this.flushCallback(event.messageType, event.params);
            processed++;
            if (processed >= MAX_EVENTS_PER_FLUSH) break;
        }

        if (this.eventQueue.size > 0) this.scheduleFlush();
    }

    cleanupThrottleMap() {
        const now = performance.now();
        for (const [key, timestamp] of this.throttleMap) {
            if (now - timestamp > 5000) this.throttleMap.delete(key);
        }
    }

    destroy() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.flushTimerId !== null) {
            clearTimeout(this.flushTimerId);
            this.flushTimerId = null;
        }
        this.flushScheduled = false;

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.eventQueue.clear();
        this.throttleMap.clear();
        this.flushCallback = null;
    }
}

let instance = null;

export function getEventQueue() {
    if (!instance) instance = new WebSocketEventQueue();
    return instance;
}

export function destroyEventQueue() {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}
