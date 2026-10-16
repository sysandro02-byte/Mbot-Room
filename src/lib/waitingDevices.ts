// Human-readable names from browser/Android MediaDevices labels.
// Never infer that a device exists from its label alone; only enumerateDevices
// provides the list of selectable devices.
export function waitingDeviceLabel(
  kind: 'audioinput' | 'videoinput' | 'audiooutput',
  rawLabel: string,
  index = 0,
): string {
  const original = String(rawLabel || '').trim();
  const label = original.toLowerCase();
  if (kind === 'videoinput') {
    if (/\b(facing\s*front|front\s*camera|camera\s*1,\s*facing\s*front|user-facing|avant)\b/i.test(label)) return 'Caméra avant';
    if (/\b(facing\s*back|back\s*camera|rear|environment|arrière)\b/i.test(label)) return 'Caméra arrière';
    if (!label || label === 'default') return index ? `Caméra ${index + 1}` : 'Caméra par défaut';
  }
  if (kind === 'audiooutput') {
    if (/speakerphone|loudspeaker|haut.parleur/.test(label)) return 'Haut-parleur du téléphone';
    if (/headset earpiece|earpiece/.test(label)) return 'Écouteur du téléphone';
    if (/headphones|headset|casque/.test(label)) return 'Casque ou écouteurs';
    if (!label || label === 'default' || /system.*(output|audio)/.test(label)) return 'Sortie audio par défaut';
  }
  if (kind === 'audioinput') {
    if (/built.in|internal microphone/.test(label)) return 'Microphone du téléphone';
    if (!label || label === 'default') return 'Microphone par défaut';
  }
  return original || (kind === 'videoinput' ? `Caméra ${index + 1}` : kind === 'audioinput' ? `Microphone ${index + 1}` : `Sortie audio ${index + 1}`);
}
