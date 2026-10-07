import {afterEach, expect, test, vi} from 'vitest';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

test('initializes a page whose dynamic imports register after DOMContentLoaded', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main id="page-content" data-page="late-page"></main>';
    Object.defineProperty(document, 'readyState', {value: 'complete', configurable: true});
    const controller = await import('./PageController.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.advanceTimersByTimeAsync(1);
    let starts = 0;
    controller.registerPage('late-page', {init: () => { starts++; }});
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toBe(1);
    document.body.dispatchEvent(new CustomEvent('htmx:afterSettle', {detail: {target: document.getElementById('page-content')}}));
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toBe(1);
});

test('serializes asynchronous initialization and cleanup when navigation interrupts loading', async () => {
    const controller = await import('./PageController.js');
    document.body.innerHTML = '<main id="page-content" data-page="slow-radar"></main>';
    let finishLoading;
    const loading = new Promise(resolve => { finishLoading = resolve; });
    let radarActive = false;
    let settingsActive = false;
    let initSignal;
    const order = [];
    controller.registerPage('slow-radar', {
        init: async signal => { initSignal = signal; await loading; radarActive = true; order.push('radar-init'); },
        destroy: () => { radarActive = false; order.push('radar-destroy'); }
    });
    await vi.waitFor(() => expect(initSignal).toBeDefined());
    const target = document.getElementById('page-content');
    document.body.dispatchEvent(new CustomEvent('htmx:beforeSwap', {detail: {target}}));
    target.dataset.page = 'slow-settings';
    controller.registerPage('slow-settings', {init: () => { settingsActive = true; order.push('settings-init'); }});
    document.body.dispatchEvent(new CustomEvent('htmx:afterSettle', {detail: {target}}));
    expect(initSignal?.aborted).toBe(true);
    expect(settingsActive).toBe(false);
    finishLoading();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(radarActive).toBe(false);
    expect(settingsActive).toBe(true);
    expect(order).toEqual(['radar-init', 'radar-destroy', 'settings-init']);
});

test('reinitialization destroys the current instance before starting another', async () => {
    const controller = await import('./PageController.js');
    document.body.innerHTML = '<main id="page-content" data-page="reinit-page"></main>';
    const order = [];
    controller.registerPage('reinit-page', {init: () => order.push('init'), destroy: () => order.push('destroy')});
    await new Promise(resolve => setTimeout(resolve, 0));
    await controller.reinitCurrentPage();
    expect(order).toEqual(['init', 'destroy', 'init']);
});

test('skips a page superseded while the previous page is still being destroyed', async () => {
    const controller = await import('./PageController.js');
    document.body.innerHTML = '<main id="page-content" data-page="destroy-first"></main>';
    let finishDestroy;
    const destroying = new Promise(resolve => { finishDestroy = resolve; });
    const order = [];
    controller.registerPage('destroy-first', {
        init: () => order.push('first-init'),
        destroy: async () => { order.push('first-destroy'); await destroying; }
    });
    await vi.waitFor(() => expect(order).toEqual(['first-init']));
    const target = document.getElementById('page-content');
    // Late registration can start a transition even without beforeSwap.
    target.dataset.page = 'destroy-second';
    controller.registerPage('destroy-second', {init: () => order.push('second-init')});
    await vi.waitFor(() => expect(order).toContain('first-destroy'));
    document.body.dispatchEvent(new CustomEvent('htmx:beforeSwap', {detail: {target}}));
    target.dataset.page = 'destroy-third';
    controller.registerPage('destroy-third', {init: () => order.push('third-init')});
    finishDestroy();
    await vi.waitFor(() => expect(order).toContain('third-init'));
    expect(order).toEqual(['first-init', 'first-destroy', 'third-init']);
});
