export const DEFAULT_SOUND = 'player.wav';

export const ALERT_SOUNDS = [
    {file: 'player.wav', label: 'Predeterminado'},
    {file: 'brass.wav', label: 'Metales'},
    {file: 'buzzer.wav', label: 'Zumbador'},
    {file: 'coin.wav', label: 'Moneda'},
    {file: 'drums.wav', label: 'Batería'},
    {file: 'piano.wav', label: 'Piano'},
    {file: 'pop.wav', label: 'Pop'},
    {file: 'vibraphone.wav', label: 'Vibráfono'},
];

export function findSound(file) {
    return ALERT_SOUNDS.find(sound => sound.file === file) || null;
}
