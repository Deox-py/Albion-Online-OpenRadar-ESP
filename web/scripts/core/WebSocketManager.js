// WebSocketManager.js - WebSocket connection with auto-reconnect
// Extracted from Utils.js during Phase 1B refactor

import {CATEGORIES} from '../constants/LoggerConstants.js';
import {buildWsUrl} from '../utils/wsUrl.js';

const MAX_RECONNECT_DELAY = 30000;
const INITIAL_RECONNECT_DELAY = 1000;

// Module state
let socket = null;
let reconnectTimeoutId = null;
let reconnectAttempts = 0;
let messageCallback = null;
let isActive = false;  // Guard for cleanup during destroy
let isGracefulDisconnect = false;  // Distinguish intentional disconnect from connection loss

// Connection status tracking
window.wsConnectionStatus = 'disconnected';

function updateConnectionStatus(status) {
    const previousStatus = window.wsConnectionStatus;
    window.wsConnectionStatus = status;
    document.dispatchEvent(new CustomEvent('wsStatusChange', {detail: {status}}));

    if (window.toast && previousStatus !== status) {
        if (status === 'connected') {
            window.toast.success('Conectado al backend del radar');
        } else if (status === 'disconnected' && previousStatus === 'connected' && !isGracefulDisconnect) {
            // Only show "Connection lost" for unexpected disconnects, not graceful navigation
            window.toast.error('Se perdió la conexión con el radar');
        }
    }
}

function onSocketOpen() {
    reconnectAttempts = 0;
    updateConnectionStatus('connected');
    window.logger?.info(CATEGORIES.NETWORK, 'WebSocketConnected', {});
}

function onSocketClose() {
    // Guard: Don't handle close events after destroy
    if (!isActive) return;

    updateConnectionStatus('disconnected');
    window.logger?.warn(CATEGORIES.NETWORK, 'WebSocketDisconnected', {});
    scheduleReconnect();
}

function onSocketError(error) {
    window.logger?.error(CATEGORIES.NETWORK, 'WebSocketError', {error: error?.message});
}

function onSocketMessage(event) {
    messageCallback?.(event.data);
}

function scheduleReconnect() {
    // Guard: Don't schedule reconnect if destroyed or one is already pending.
    if (!isActive || reconnectTimeoutId) return;

    reconnectAttempts++;
    const baseDelay = Math.min(
        INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1),
        MAX_RECONNECT_DELAY
    );
    // Small jitter prevents multiple tabs from hammering the backend in lockstep.
    const delay = Math.round(baseDelay * (0.85 + Math.random() * 0.30));
    window.logger?.debug(CATEGORIES.NETWORK, 'WebSocketReconnecting', {
        delay: delay / 1000,
        attempt: reconnectAttempts
    });
    reconnectTimeoutId = setTimeout(() => {
        reconnectTimeoutId = null;
        connect();
    }, delay);
}

function cleanupSocket({resetAttempts = false} = {}) {
    // Clear reconnect timeout FIRST to prevent ghost reconnects
    if (reconnectTimeoutId) {
        clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
    }
    if (resetAttempts) reconnectAttempts = 0;

    if (socket) {
        // Remove listeners BEFORE closing to prevent callbacks
        socket.removeEventListener('open', onSocketOpen);
        socket.removeEventListener('close', onSocketClose);
        socket.removeEventListener('error', onSocketError);
        socket.removeEventListener('message', onSocketMessage);

        // Close socket if not already closed
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close();
        }
        socket = null;
    }
}

export function connect() {
    isActive = true;
    isGracefulDisconnect = false;  // Reset on new connection

    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;

    cleanupSocket({resetAttempts: false});
    updateConnectionStatus('connecting');

    window.logger?.debug(CATEGORIES.NETWORK, 'WebSocketConnecting', {attempt: reconnectAttempts + 1});
    socket = new WebSocket(buildWsUrl());
    socket.addEventListener('open', onSocketOpen);
    socket.addEventListener('close', onSocketClose);
    socket.addEventListener('error', onSocketError);
    socket.addEventListener('message', onSocketMessage);
}

export function disconnect() {
    isActive = false;
    isGracefulDisconnect = true;  // Mark as intentional disconnect (no "Connection lost" toast)
    cleanupSocket({resetAttempts: true});
    updateConnectionStatus('disconnected');
    messageCallback = null;  // Clear callback to prevent memory leaks
}

export function setMessageCallback(callback) {
    messageCallback = callback;
}

export function getStatus() {
    return window.wsConnectionStatus;
}
