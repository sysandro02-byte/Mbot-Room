import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingDeviceLabel } from '../src/lib/waitingDevices.ts';

test('Android camera names are localized without swapping lenses', () => {
  assert.equal(waitingDeviceLabel('videoinput', 'camera 1, facing front'), 'Caméra avant');
  assert.equal(waitingDeviceLabel('videoinput', 'camera 0, facing back'), 'Caméra arrière');
  assert.equal(waitingDeviceLabel('videoinput', '', 0), 'Caméra par défaut');
});

test('Android speaker routes have clear French names', () => {
  assert.equal(waitingDeviceLabel('audiooutput', 'Speakerphone'), 'Haut-parleur du téléphone');
  assert.equal(waitingDeviceLabel('audiooutput', 'Headset earpiece'), 'Écouteur du téléphone');
  assert.equal(waitingDeviceLabel('audiooutput', 'default'), 'Sortie audio par défaut');
});

test('microphones and unknown device labels remain meaningful', () => {
  assert.equal(waitingDeviceLabel('audioinput', 'default'), 'Microphone par défaut');
  assert.equal(waitingDeviceLabel('audioinput', 'Built-in microphone'), 'Microphone du téléphone');
  assert.equal(waitingDeviceLabel('videoinput', 'USB Camera'), 'USB Camera');
});
