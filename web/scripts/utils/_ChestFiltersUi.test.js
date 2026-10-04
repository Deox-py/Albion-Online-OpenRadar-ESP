import {readFileSync} from 'node:fs';
import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.stubGlobal('BroadcastChannel', undefined);

const {SettingsSync, default: defaultSettingsSync} = await import('./SettingsSync.js');
const template = readFileSync('internal/templates/pages/chests.gohtml', 'utf8');
const pageMarkup = template.match(/{{define "pages\/chests"}}([\s\S]*?){{end}}/)[1];
const pageScript = template.match(/<script>([\s\S]*?)<\/script>/)[1];
const filters = [
    ['settingChestUnknown', 'Rareza desconocida'],
    ['settingChestAvalon', 'Avalon'],
    ['settingChestCamp', 'Campamentos'],
    ['settingChestSmallTreasure', 'Pequeños tesoros'],
    ['settingChestOther', 'Otros']
];

async function loadPageHandlers() {
    let handlers;
    // Replace only the browser's absolute module import; execute the page script unchanged.
    const script = pageScript.replace(
        "await import('/scripts/core/PageController.js')",
        'await loadPageController()'
    );
    await new Function('loadPageController', `return ${script.trim()}`)(async () => ({
        registerPage: (name, registeredHandlers) => {
            if (name !== 'chests') throw new Error(`Unexpected page registration: ${name}`);
            handlers = registeredHandlers;
        }
    }));
    return handlers;
}

describe('chest filter UI preferences', () => {
    let settings;
    let handlers;

    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = pageMarkup;
        delete window._chestsPageRegistered;
        settings = new SettingsSync();
        window.settingsSync = settings;
    });

    afterEach(() => {
        handlers?.destroy();
        handlers = undefined;
        settings.destroy();
        delete window.settingsSync;
        delete window._chestsPageRegistered;
        document.body.innerHTML = '';
    });

    afterAll(() => {
        defaultSettingsSync.destroy();
        vi.unstubAllGlobals();
    });

    test('offers all new filters in the chest group and persists enabled defaults on first visit', async () => {
        handlers = await loadPageHandlers();
        handlers.init();

        for (const [id, label] of filters) {
            const checkbox = document.getElementById(id);
            expect(checkbox, `${label} checkbox`).toBeInstanceOf(HTMLInputElement);
            expect(checkbox.type).toBe('checkbox');
            expect(checkbox.closest('label').textContent).toContain(label);
            expect(checkbox.closest('.card').querySelector('h2').textContent).toContain('Cofres');
            expect(checkbox.checked).toBe(true);
            expect(localStorage.getItem(id)).toBe('true');
        }
    });

    test.each([
        ['false', false],
        ['true', true],
        ['', false]
    ])('keeps an existing %j preference instead of assigning a default', async (storedValue, checked) => {
        for (const [id] of filters) localStorage.setItem(id, storedValue);
        handlers = await loadPageHandlers();
        handlers.init();

        for (const [id] of filters) {
            const checkbox = document.getElementById(id);
            expect(checkbox, `${id} checkbox`).toBeInstanceOf(HTMLInputElement);
            expect(checkbox.checked).toBe(checked);
            expect(localStorage.getItem(id)).toBe(storedValue);
        }
    });

    test('persists checkbox changes for every new chest filter', async () => {
        handlers = await loadPageHandlers();
        handlers.init();

        for (const [id] of filters) {
            const checkbox = document.getElementById(id);
            expect(checkbox, `${id} checkbox`).toBeInstanceOf(HTMLInputElement);
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));
            expect(localStorage.getItem(id)).toBe('false');
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            expect(localStorage.getItem(id)).toBe('true');
        }
    });

    test('removes filter listeners on navigation and binds once when the page returns', async () => {
        handlers = await loadPageHandlers();
        handlers.init();
        const changes = [];
        settings.on('settingChestUnknown', (_key, value) => changes.push(value));
        const checkbox = document.getElementById('settingChestUnknown');
        expect(checkbox).toBeInstanceOf(HTMLInputElement);

        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
        expect(changes).toEqual(['false']);

        handlers.destroy();
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('settingChestUnknown')).toBe('false');
        expect(changes).toEqual(['false']);

        handlers.init();
        expect(checkbox.checked).toBe(false);
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
        expect(changes).toEqual(['false', 'true']);
        expect(localStorage.getItem('settingChestUnknown')).toBe('true');
    });
});
