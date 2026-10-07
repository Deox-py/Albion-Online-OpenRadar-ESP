// PageController - Manages page lifecycle for SPA navigation
// Each page registers init/destroy callbacks called on HTMX navigation

import {CATEGORIES} from '../constants/LoggerConstants.js';

const pageHandlers = new Map();
let currentPage = null;
let transitionPromise = Promise.resolve();
let initController = null;
let navigationGeneration = 0;
let isPageControllerInitialized = false;  // Guard against duplicate initialization

export function registerPage(pageName, handlers) {
    if (pageHandlers.has(pageName)) {
        window.logger?.warn(CATEGORIES.SYSTEM, 'PageController_Overwrite', {pageName});
    }
    pageHandlers.set(pageName, {
        init: handlers.init || (() => {
        }),
        destroy: handlers.destroy || (() => {
        })
    });
    window.logger?.debug(CATEGORIES.SYSTEM, 'PageController_Registered', {pageName});
    // Page modules arrive through dynamic imports. DOMContentLoaded/HTMX may
    // settle before registration; start the now-ready page in that case.
    if (document.readyState !== 'loading' && detectCurrentPage() === pageName) {
        void initCurrentPage();
    }
}

function detectCurrentPage() {
    const pageContent = document.getElementById('page-content');
    return pageContent?.dataset?.page || null;
}

// Queue the complete lifecycle, including async init. Destroying an instance
// before its initializer settles can leave late sockets/timers orphaned.
function transition(action) {
    const next = transitionPromise.then(action);
    transitionPromise = next.catch(error => {
        window.logger?.error(CATEGORIES.SYSTEM, 'PageController_TransitionError', {error: error.message});
    });
    return next;
}

async function destroyActivePage() {
    if (!currentPage) return;
    const pageToDestroy = currentPage;
    try {
        window.logger?.info(CATEGORIES.SYSTEM, 'PageController_Destroying', {page: pageToDestroy});
        await pageHandlers.get(pageToDestroy)?.destroy();
    } catch (error) {
        window.logger?.error(CATEGORIES.SYSTEM, 'PageController_DestroyError', {page: pageToDestroy, error: error.message});
    } finally {
        currentPage = null;
    }
}

function destroyCurrentPage() {
    navigationGeneration++;
    initController?.abort();
    return transition(destroyActivePage);
}

async function initializeVisiblePage() {
    // Read the page when the queued operation runs, since multiple HTMX swaps
    // can happen while a database or page module is still loading.
    let newPage = detectCurrentPage();
    if (!newPage || newPage === currentPage) return;
    if (!pageHandlers.has(newPage)) return;
    const generation = navigationGeneration;
    await destroyActivePage();
    if (generation !== navigationGeneration) return;
    newPage = detectCurrentPage();
    const handlers = pageHandlers.get(newPage);
    if (!handlers) return;
    currentPage = newPage;
    initController = new AbortController();
    try {
        window.logger?.info(CATEGORIES.SYSTEM, 'PageController_Initializing', {page: newPage});
        await handlers.init(initController.signal);
    } catch (error) {
        window.logger?.error(CATEGORIES.SYSTEM, 'PageController_InitError', {page: newPage, error: error.message});
        window.toast?.error('No se pudo inicializar esta página');
        await destroyActivePage();
    } finally {
        initController = null;
    }
}

function initCurrentPage() {
    return transition(initializeVisiblePage);
}

export function initPageController() {
    // Guard against duplicate initialization (prevents listener accumulation)
    if (isPageControllerInitialized) {
        window.logger?.debug(CATEGORIES.SYSTEM, 'PageController_AlreadyInitialized', {});
        return;
    }
    isPageControllerInitialized = true;

    document.body.addEventListener('htmx:beforeSwap', (event) => {
        if (event.detail.target?.id === 'page-content') {
            destroyCurrentPage();
        }
    });

    document.body.addEventListener('htmx:afterSettle', (event) => {
        if (event.detail.target?.id === 'page-content') {
            initCurrentPage();
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            // Don't set currentPage here - initCurrentPage handles it
            // Just trigger init, it will detect and init the page
            initCurrentPage();
        }, 0);
    });
    if (document.readyState !== 'loading') void initCurrentPage();

    // Handle browser back/forward navigation
    window.addEventListener('popstate', () => window.location.reload());

    window.logger?.info(CATEGORIES.SYSTEM, 'PageController_Initialized', {});
}

export function reinitCurrentPage() {
    navigationGeneration++;
    initController?.abort();
    return transition(async () => {
        await destroyActivePage();
        await initializeVisiblePage();
    });
}

initPageController();
