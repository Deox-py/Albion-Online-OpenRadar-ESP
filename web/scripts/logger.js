import {CATEGORY_SETTINGS, LOG_LEVELS} from './constants/LoggerConstants.js';
import settingsSync from './utils/SettingsSync.js';
import {buildWsUrl} from './utils/wsUrl.js';

let socket = null;
let reconnectAttempts = 0;
let reconnectTimeoutId = null;
const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

class Logger {
    constructor() {
        this.wsClient = null;
        this.buffer = [];
        this.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.maxBufferSize = 200;
        this.flushIntervalMs = 5000;
        this.flushIntervalId = null;
    }

    startFlushInterval() {
        if (this.flushIntervalId) clearInterval(this.flushIntervalId);
        this.flushIntervalId = setInterval(() => this.flush(), this.flushIntervalMs);
    }

    stopFlushInterval() {
        if (this.flushIntervalId) {
            clearInterval(this.flushIntervalId);
            this.flushIntervalId = null;
        }
    }

    shouldLog(level, category) {
        const minLevelName = settingsSync.get('logLevel', 'WARN');
        const minLevel = LOG_LEVELS[minLevelName] ?? LOG_LEVELS.WARN;

        if (minLevel === LOG_LEVELS.OFF) return false;
        if (level === 'CRITICAL') return true;

        const currentLevel = LOG_LEVELS[level] ?? LOG_LEVELS.DEBUG;
        if (currentLevel < minLevel) return false;

        if (level === 'DEBUG' || level === 'INFO') {
            const settingKey = CATEGORY_SETTINGS[category];
            if (settingKey && !settingsSync.getBool(settingKey)) {
                return false;
            }
        }

        return true;
    }

    log(level, category, event, data = {}) {
        if (!this.shouldLog(level, category)) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            category,
            event,
            data,
            sessionId: this.sessionId,
            page: window.location.pathname
        };

        if (settingsSync.getBool('settingLogToConsole')) {
            this.logToConsole(logEntry);
        }

        if (settingsSync.getBool('settingLogToServer')) {
            // Keep a bounded backlog while the log-only connection is opening
            // or reconnecting. Retain it until the transport accepts the send.
            if (this.buffer.length >= this.maxBufferSize) this.buffer.shift();
            this.buffer.push(logEntry);
            if (this.buffer.length >= this.maxBufferSize) this.flush();
        }
    }

    logToConsole(entry) {
        const emoji = {'DEBUG': '🔍', 'INFO': 'ℹ️', 'WARN': '⚠️', 'ERROR': '❌', 'CRITICAL': '🚨'}[entry.level] || '📝';
        const color = {
            'DEBUG': 'color: #888', 'INFO': 'color: #0af', 'WARN': 'color: #fa0',
            'ERROR': 'color: #f00', 'CRITICAL': 'color: #f0f; font-weight: bold'
        }[entry.level] || 'color: #000';

        const time = new Date(entry.timestamp).toLocaleTimeString('en-GB');
        console.log(`%c${emoji} [${entry.level}] ${entry.category}.${entry.event} @ ${time}`, color, entry.data);
    }

    debug(category, event, data) {
        this.log('DEBUG', category, event, data);
    }

    info(category, event, data) {
        this.log('INFO', category, event, data);
    }

    warn(category, event, data) {
        this.log('WARN', category, event, data);
    }

    error(category, event, data) {
        this.log('ERROR', category, event, data);
    }

    critical(category, event, data) {
        this.log('CRITICAL', category, event, data);
    }

    flush() {
        if (!settingsSync.getBool('settingLogToServer') || this.buffer.length === 0) return;

        if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            try {
                this.wsClient.send(JSON.stringify({type: 'logs', logs: this.buffer}));
                this.buffer = [];
            } catch (e) {
                // Exception: console allowed here to avoid logger recursion
                console.warn('[Logger] WebSocket send failed:', e?.message);
            }
        }
    }
}

const globalLogger = new Logger();
window.logger = globalLogger;

function onLoggerSocketOpen() {
    reconnectAttempts = 0;
    globalLogger.wsClient = socket;
    globalLogger.flush();
}

function onLoggerSocketClose() {
    globalLogger.wsClient = null;
    scheduleLoggerReconnect();
}

function onLoggerSocketError() {
    globalLogger.wsClient = null;
}

function cleanupLoggerSocket() {
    globalLogger.wsClient = null;
    if (socket) {
        socket.removeEventListener('open', onLoggerSocketOpen);
        socket.removeEventListener('close', onLoggerSocketClose);
        socket.removeEventListener('error', onLoggerSocketError);
        socket.close();
        socket = null;
    }
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
}

function connectLoggerWebSocket() {
    if (!settingsSync.getBool('settingLogToServer')) return;
    cleanupLoggerSocket();
    try {
        socket = new WebSocket(`${buildWsUrl()}?mode=logs`);
        socket.addEventListener('open', onLoggerSocketOpen);
        socket.addEventListener('close', onLoggerSocketClose);
        socket.addEventListener('error', onLoggerSocketError);
    } catch (e) {
        // Exception: console allowed here to avoid logger recursion
        console.warn('[Logger] WebSocket connection failed:', e?.message);
        scheduleLoggerReconnect();
    }
}

function scheduleLoggerReconnect() {
    if (!settingsSync.getBool('settingLogToServer') || reconnectTimeoutId !== null) return;
    reconnectAttempts++;
    const delay = Math.min(INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        connectLoggerWebSocket();
    }, delay);
}

function syncServerLogging() {
    if (settingsSync.getBool('settingLogToServer')) {
        if (!globalLogger.flushIntervalId) globalLogger.startFlushInterval();
        if (!socket || socket.readyState === WebSocket.CLOSED) connectLoggerWebSocket();
    } else {
        cleanupLoggerSocket();
        globalLogger.stopFlushInterval();
        globalLogger.buffer = [];
        reconnectAttempts = 0;
    }
}

function shutdownLogger() {
    cleanupLoggerSocket();
    globalLogger.stopFlushInterval();
    settingsSync.off('settingLogToServer', syncServerLogging);
}

export {globalLogger as logger};

settingsSync.on('settingLogToServer', syncServerLogging);
window.addEventListener('beforeunload', shutdownLogger, {once: true});
syncServerLogging();
