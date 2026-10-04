import {afterEach, expect, test, vi} from 'vitest';
import * as DatabaseLoader from '../core/DatabaseLoader.js';
import {initRadar, destroyRadar} from './Utils.js';
import * as EventRouter from '../core/EventRouter.js';
import {getEventQueue} from './WebSocketEventQueue.js';

vi.mock('../core/DatabaseLoader.js', () => ({load: vi.fn()}));

class LifecycleSocket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    static instances = [];
    constructor() {
        super();
        this.readyState = LifecycleSocket.CONNECTING;
        LifecycleSocket.instances.push(this);
    }
    close() { this.readyState = 3; }
}

afterEach(() => {
    destroyRadar();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

test('navigation cancellation during database loading never creates a radar socket or handlers', async () => {
    vi.stubGlobal('WebSocket', LifecycleSocket);
    LifecycleSocket.instances = [];
    window.harvestablesHandler = null;
    let finishLoading;
    DatabaseLoader.load.mockImplementation(() => new Promise(resolve => { finishLoading = resolve; }));
    const controller = new AbortController();
    const loading = initRadar(controller.signal);
    controller.abort();
    finishLoading();
    await loading;
    expect(LifecycleSocket.instances).toHaveLength(0);
    expect(window.harvestablesHandler).toBeNull();
});

test('every stream gap invalidates old identity until a fresh context arrives', async () => {
    vi.stubGlobal('WebSocket', LifecycleSocket);
    DatabaseLoader.load.mockResolvedValue();
    await initRadar();
    for (const reason of ['queue-overflow', 'connection-lost', 'capture-changed']) {
        EventRouter.applyObservedMapContext({mapId:'1000',source:'join',observedAt:1234});
        expect(EventRouter.getMapIdentity().source).toBe('observed');
        getEventQueue().reset(reason);
        expect(EventRouter.getMapIdentity()).toMatchObject({mapId:-1,source:'unknown'});
    }
    getEventQueue().queueRawMessage(JSON.stringify({type:'map-context',mapId:'1001',source:'join',observedAt:1235}));
    expect(EventRouter.getMapIdentity()).toMatchObject({mapId:'1001',source:'observed',bootstrap:true});
});
