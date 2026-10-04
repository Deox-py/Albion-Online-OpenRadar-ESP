import {CATEGORIES} from '../constants/LoggerConstants.js';

const COALESCABLE_EVENTS = new Set([3, 6, 91]);
const MESSAGE_TYPES = new Set(['event', 'request', 'response']);
const THROTTLED_EVENTS = { 6: 50, 91: 100 };
const MAX_EVENT_QUEUE = 5000;
const MAX_EVENTS_PER_FLUSH = 1000;
const HIDDEN_FLUSH_DELAY_MS = 75;
const MAP_CONTEXT_SOURCES = new Set(['join', 'change-cluster', 'mists-player-joined']);

function parseMapContext(data) {
    const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 256 &&
        id.trim() === id && id !== '-1';
    if (!validId(data.mapId) || !Number.isSafeInteger(data.observedAt) || data.observedAt <= 0 ||
        !MAP_CONTEXT_SOURCES.has(data.source) ||
        (data.originCluster !== undefined && !validId(data.originCluster)) ||
        (data.mistLethal !== undefined && typeof data.mistLethal !== 'boolean')) {
        throw new Error('contexto de mapa inválido');
    }
    const context = {mapId: data.mapId, observedAt: data.observedAt, source: data.source};
    if (data.originCluster !== undefined) context.originCluster = data.originCluster;
    if (data.mistLethal !== undefined) context.mistLethal = data.mistLethal;
    return context;
}

export class WebSocketEventQueue {
    constructor() {
        this.eventQueue = new Map();
        this.throttleMap = new Map();
        this.flushScheduled = false;
        this.flushCallback = null;
        this.resetCallback = null;
        this.mapContextCallback = null;
        this.rafId = null;
        this.flushTimerId = null;
        this.queueSeq = 0;
        this.coalescingEpoch = 0;
        this.droppedEvents = 0;
        this.cleanupInterval = setInterval(() => this.cleanupThrottleMap(), 30000);
        this.onVisibilityChange = () => {
            // A frame scheduled while visible may be suspended after hiding.
            if (document.hidden && this.rafId !== null) {
                this.cancelScheduledFlush();
                if (this.eventQueue.size) this.scheduleFlush();
            }
        };
        document.addEventListener('visibilitychange', this.onVisibilityChange);
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

    setResetCallback(callback) {
        this.resetCallback = callback;
    }

    setMapContextCallback(callback) { this.mapContextCallback = callback; }

    cancelScheduledFlush() {
        if (this.rafId !== null) cancelAnimationFrame(this.rafId);
        if (this.flushTimerId !== null) clearTimeout(this.flushTimerId);
        this.rafId = null;
        this.flushTimerId = null;
        this.flushScheduled = false;
    }

    reset(reason) {
        this.cancelScheduledFlush();
        this.eventQueue.clear();
        this.throttleMap.clear();
        this.resetCallback?.(reason);
    }

    parseMessage(msg) {
        if (!msg || typeof msg !== 'object' || Array.isArray(msg) || !MESSAGE_TYPES.has(msg.code)) {
            throw new Error('tipo de mensaje inválido');
        }
        const dict = typeof msg.dictionary === 'string' ? JSON.parse(msg.dictionary) : msg.dictionary;
        if (!dict || typeof dict !== 'object' || Array.isArray(dict)) throw new Error('dictionary inválido');
        if (!dict.parameters || typeof dict.parameters !== 'object' || Array.isArray(dict.parameters)) {
            throw new Error('parameters inválido');
        }
        const failedBoundary = msg.code === 'response' && [2, 41].includes(dict.parameters[253]) &&
            dict.returnCode !== undefined && dict.returnCode !== 0;
        return { code: msg.code, params: dict.parameters, failedBoundary };
    }

    queueRawMessage(rawData) {
        try {
            const data = JSON.parse(rawData);
            if (data?.type === 'stream-reset') {
                this.reset(typeof data.reason === 'string' ? data.reason : 'stream-reset');
                return;
            }
            if (data?.type === 'map-context') {
                const context = parseMapContext(data);
                this.flush(Infinity);
                this.throttleMap.clear();
                this.mapContextCallback?.(context);
                return;
            }
            const messages = data.type === 'batch' ? data.messages : [data];
            if (!Array.isArray(messages)) throw new Error('batch.messages no es un array');

            // Validate the complete batch before mutating entity state.
            const parsed = messages.map(msg => this.parseMessage(msg));
            for (const { code, params, failedBoundary } of parsed) {
                if (!failedBoundary) this.queueEventInternal(code, params);
            }
        } catch (e) {
            this.reset('malformed-stream');
            window.logger?.warn(CATEGORIES.NETWORK, 'MalformedWSMessage', {error: e?.message});
        }
    }

    queueEventInternal(messageType, params) {
        if (messageType !== 'event') {
            // Requests/responses can change maps. Drain earlier entity events
            // first so they cannot populate the next map after its clear.
            this.flush(Infinity);
            if (messageType === 'response' && [2, 35, 41].includes(params?.[253])) this.throttleMap.clear();
            this.processImmediately(messageType, params);
            return;
        }
        if (!params || typeof params !== 'object') {
            window.logger?.warn(CATEGORIES.NETWORK, 'MalformedWSEvent', {reason: 'missing parameters'});
            return;
        }

        const eventCode = params[252];
        const entityId = params[0];

        // Spawn/removal and other lifecycle events form ordering barriers.
        // A later update must never overwrite an update ahead of that barrier.
        if (!COALESCABLE_EVENTS.has(eventCode)) {
            this.coalescingEpoch++;
            this.throttleMap.clear();
        }

        if (this.enableThrottling && THROTTLED_EVENTS[eventCode]) {
            const throttleKey = `${eventCode}-${entityId}`;
            const lastProcessed = this.throttleMap.get(throttleKey);
            const now = performance.now();

            if (lastProcessed !== undefined && now - lastProcessed < THROTTLED_EVENTS[eventCode]) return;
            this.throttleMap.set(throttleKey, now);
        }

        const queueKey = this.enableCoalescing && COALESCABLE_EVENTS.has(eventCode)
            ? `${eventCode}-${entityId}-epoch-${this.coalescingEpoch}`
            : `${eventCode}-seq-${++this.queueSeq}`;

        // Coalesced updates overwrite in place and do not increase queue size.
        // A lost spawn/removal makes the retained state incomplete. Invalidate
        // the old queue instead of silently replaying a partial history.
        if (!this.eventQueue.has(queueKey) && this.eventQueue.size >= MAX_EVENT_QUEUE) {
            this.droppedEvents += this.eventQueue.size;
            this.reset('frontend-overflow');
            window.logger?.warn(CATEGORIES.NETWORK, 'WebSocketEventQueueOverflow', {
                dropped: this.droppedEvents,
                maxQueue: MAX_EVENT_QUEUE,
            });
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

    flush(limit = MAX_EVENTS_PER_FLUSH) {
        this.cancelScheduledFlush();
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
            if (processed >= limit) break;
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
        this.cancelScheduledFlush();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.eventQueue.clear();
        this.throttleMap.clear();
        this.flushCallback = null;
        this.resetCallback = null;
        this.mapContextCallback = null;
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
