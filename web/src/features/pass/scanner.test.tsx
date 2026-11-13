import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import {
  demoPassKey,
  type EntryPass,
  encodePass,
  FIXTURE_CONTRACT_ID,
  passRequest,
  signPassWithKey,
} from '@ticket-escrow/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixtureWallet } from '../../lib/near/wallet';
import { renderAt, testServices } from '../../test/render';

// The door's scanner with a mocked BarcodeDetector and camera. It was not tried on a physical phone.

const LUIS = 'luis.testnet';
const SCAN = 'Scan the QR code with this page';

function demoPass(): EntryPass {
  const request = passRequest({
    contract: FIXTURE_CONTRACT_ID,
    ticket: '1-3',
    issuedAtMs: Date.now(),
  });
  return signPassWithKey(request, LUIS, demoPassKey(LUIS));
}

const live = () => testServices({ wallet: createFixtureWallet(null), fixtureMode: false });

/** Installs a camera whose one track records `stop`, and a detector that answers `codes()`. */
function installCamera(
  codes: () => Array<{ rawValue: string }>,
  {
    formats = ['qr_code'],
    camera = 'opens',
  }: { formats?: string[]; camera?: 'opens' | 'refuses' } = {},
) {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async () => {
    if (camera === 'refuses') throw new DOMException('denied', 'NotAllowedError');
    return { getTracks: () => [track] };
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  const detect = vi.fn(async () => codes());
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      static getSupportedFormats = async () => formats;
      detect = detect;
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  return { track, getUserMedia, detect };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  window.localStorage.clear();
});

describe('the door scanner', () => {
  it('is not offered where the browser lacks BarcodeDetector, a camera, or QR codes', async () => {
    renderAt('/door', live());
    await screen.findByRole('heading', { level: 1, name: 'Door check' });
    expect(screen.queryByRole('button', { name: SCAN })).toBeNull();
    cleanup();

    installCamera(() => [], { formats: ['ean_13'] });
    renderAt('/door', live());
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: SCAN })).toBeNull();
    expect(screen.getByLabelText('Pass or door link')).toBeTruthy();
  });

  it('reads a pass from the camera, ignores the site the code names, and stops the camera', async () => {
    const code = `https://copy.example/door#p=${encodePass(demoPass())}`;
    const { track, getUserMedia } = installCamera(() => [{ rawValue: code }]);
    renderAt('/door', live());
    fireEvent.click(await screen.findByRole('button', { name: SCAN }));
    expect(await screen.findByText('Admit', { selector: '.verdict-word' })).toBeTruthy();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'environment' },
      audio: false,
    });
    expect(track.stop).toHaveBeenCalled();
    expect(window.location.pathname).toBe('/door');
    expect(window.location.origin).not.toBe('https://copy.example');
  });

  it('keeps scanning past a code that is not a pass', async () => {
    const answers = [
      [{ rawValue: 'https://example.com/menu' }],
      [{ rawValue: encodePass(demoPass()) }],
    ];
    installCamera(() => answers.shift() ?? []);
    renderAt('/door', live());
    fireEvent.click(await screen.findByRole('button', { name: SCAN }));
    expect(await screen.findByText('That code is not an entry pass.')).toBeTruthy();
    expect(await screen.findByText('Admit', { selector: '.verdict-word' })).toBeTruthy();
  });

  it('stops the camera when the page is hidden', async () => {
    const { track, detect } = installCamera(() => []);
    renderAt('/door', live());
    fireEvent.click(await screen.findByRole('button', { name: SCAN }));
    await waitFor(() => expect(detect).toHaveBeenCalled());
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(track.stop).toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The camera stopped because the page was hidden. Scan again.',
    );
  });

  it('stops the camera when the page goes away, or on "Stop the camera"', async () => {
    const first = installCamera(() => []);
    renderAt('/door', live());
    fireEvent.click(await screen.findByRole('button', { name: SCAN }));
    await waitFor(() => expect(first.detect).toHaveBeenCalled());
    cleanup();
    expect(first.track.stop).toHaveBeenCalled();

    const second = installCamera(() => []);
    renderAt('/door', live());
    fireEvent.click(await screen.findByRole('button', { name: SCAN }));
    await waitFor(() => expect(second.detect).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Stop the camera' }));
    expect(second.track.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: SCAN })).toBeTruthy();
  });

  it('says so when the camera cannot be opened, and keeps the paste box', async () => {
    installCamera(() => [], { camera: 'refuses' });
    renderAt('/door', live());
    fireEvent.click(await screen.findByRole('button', { name: SCAN }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The camera could not be opened. Paste the pass or its link instead.',
    );
    expect(screen.getByLabelText('Pass or door link')).toBeTruthy();
  });
});
