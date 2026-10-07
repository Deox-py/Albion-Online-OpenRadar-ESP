import {describe, expect, test} from 'vitest';
import {NetworkSettingsHandler} from './NetworkSettingsHandler.js';

describe('capture diagnostic display', () => {
    test('renders capture counters separately from Photon fragments', () => {
        const container = document.createElement('div');
        const handler = new NetworkSettingsHandler(container);
        handler.state = {captureDiagnostics: {truncatedFrames: 2, decodeErrors: 3, ipv4FragmentsSkipped: 4}};
        handler.render();
        const diagnostics = container.querySelector('[data-capture-diagnostics]');
        expect(diagnostics?.textContent).toContain('Tramas truncadas: 2');
        expect(diagnostics?.textContent).toContain('Errores de decodificación: 3');
        expect(diagnostics?.textContent).toContain('Fragmentos IPv4 omitidos: 4');
        expect(diagnostics?.textContent).toContain('Photon');
    });

    test('does not inject unsafe counter values into markup', () => {
        const container = document.createElement('div');
        const handler = new NetworkSettingsHandler(container);
        handler.state = {captureDiagnostics: {truncatedFrames: '<img src=x>', decodeErrors: -1, ipv4FragmentsSkipped: NaN}};
        handler.render();
        const diagnostics = container.querySelector('[data-capture-diagnostics]');
        expect(diagnostics?.textContent).toContain('Tramas truncadas: —');
        expect(diagnostics?.querySelector('img')).toBeNull();
    });
});
