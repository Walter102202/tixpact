import { decodePass, type EntryPass } from '@ticket-escrow/client';
import { useEffect, useRef, useState } from 'react';

// A QR scanner inside the door page, so the attendant never leaves their own page: the code is
// read here and goes through `decodePass`, which ignores the site the code names. Only what the
// browser has: `BarcodeDetector` and `getUserMedia`. Where either is missing, nothing is rendered.

interface DetectedCode {
  rawValue: string;
}
interface QrDetector {
  detect(source: HTMLVideoElement): Promise<DetectedCode[]>;
}
interface DetectorClass {
  new (options: { formats: string[] }): QrDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

function detectorClass(): DetectorClass | null {
  const candidate = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  return typeof candidate === 'function' ? (candidate as DetectorClass) : null;
}

const canOpenCamera = () => typeof navigator.mediaDevices?.getUserMedia === 'function';

/** True once this browser is known to read QR codes from a camera. */
function useScannerSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const Detector = detectorClass();
    if (Detector === null || !canOpenCamera()) return;
    let current = true;
    Promise.resolve(Detector.getSupportedFormats?.() ?? ['qr_code']).then(
      (formats) => current && setSupported(formats.includes('qr_code')),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);
  return supported;
}

const SCAN_EVERY_MS = 200;
const HIDDEN = 'The camera stopped because the page was hidden. Scan again.';
const NO_CAMERA = 'The camera could not be opened. Paste the pass or its link instead.';

export function DoorScanner({ onPass }: { onPass: (pass: EntryPass) => void }) {
  const supported = useScannerSupport();
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!supported) return null;
  return (
    <div className="door-scanner">
      {scanning ? (
        <Camera
          onPass={(pass) => {
            setScanning(false);
            onPass(pass);
          }}
          onStop={(why) => {
            setScanning(false);
            setNote(why);
          }}
        />
      ) : (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setNote(null);
            setScanning(true);
          }}
        >
          Scan the QR code with this page
        </button>
      )}
      {note !== null && (
        <p className="tx tx-notice" role="alert">
          {note}
        </p>
      )}
    </div>
  );
}

/** The camera while it scans. Its tracks stop on a hit, on unmount and when the page is hidden. */
function Camera({
  onPass,
  onStop,
}: {
  onPass: (pass: EntryPass) => void;
  onStop: (why: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [notPass, setNotPass] = useState(false);
  const handlers = useRef({ onPass, onStop });
  handlers.current = { onPass, onStop };

  useEffect(() => {
    const Detector = detectorClass();
    if (Detector === null) return;
    const detector = new Detector({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    function stop() {
      stopped = true;
      clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      document.removeEventListener('visibilitychange', onVisibility);
    }
    function onVisibility() {
      if (document.visibilityState !== 'hidden') return;
      stop();
      handlers.current.onStop(HIDDEN);
    }
    async function scan() {
      if (stopped) return;
      let codes: DetectedCode[] = [];
      try {
        if (videoRef.current) codes = await detector.detect(videoRef.current);
      } catch {
        codes = []; // the video is not ready yet
      }
      if (stopped) return;
      for (const code of codes) {
        const pass = decodePass(code.rawValue);
        if (pass !== null) {
          stop();
          handlers.current.onPass(pass);
          return;
        }
      }
      if (codes.length > 0) setNotPass(true);
      timer = setTimeout(scan, SCAN_EVERY_MS);
    }

    document.addEventListener('visibilitychange', onVisibility);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(
        async (opened) => {
          if (stopped) {
            for (const track of opened.getTracks()) track.stop();
            return;
          }
          stream = opened;
          const video = videoRef.current;
          if (video) {
            video.srcObject = opened;
            try {
              await video.play();
            } catch {
              // autoplay and muted cover browsers that refuse play() here
            }
          }
          void scan();
        },
        () => {
          if (stopped) return;
          stop();
          handlers.current.onStop(NO_CAMERA);
        },
      );
    return stop;
  }, []);

  return (
    <div className="door-camera">
      <video ref={videoRef} className="door-video" muted playsInline autoPlay aria-label="Camera" />
      <p className="muted">
        Point the camera at the holder's QR code. It is read on this page; the site the code names
        is ignored.
      </p>
      {notPass && <p className="field-error">That code is not an entry pass.</p>}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => handlers.current.onStop(null)}
      >
        Stop the camera
      </button>
    </div>
  );
}
