import { CLAIM_LABELS, PHASE_LABELS } from '@ticket-escrow/client';
import { useEffect, useId, useState } from 'react';
import { Link } from '../../lib/router';
import { prefersReducedMotion, useInView } from './Reveal';

type Phase = keyof typeof PHASE_LABELS;
type Claim = keyof typeof CLAIM_LABELS;

/**
 * The refund story on the ticket stub of the real pages, one state per beat. The claim word is the
 * one the ticket page shows: past the deadline the holder can claim, so it reads "Claimable".
 */
const BEATS: ReadonlyArray<{ caption: string; phase: Phase; claim: Claim; holder: string }> = [
  {
    caption: 'Ana buys a ticket. 1.5 NEAR is reserved in the contract.',
    phase: 'OnSale',
    claim: 'Reserved',
    holder: 'ana.testnet',
  },
  {
    caption: 'Ana gives the ticket to Luis. The refund right goes with it.',
    phase: 'OnSale',
    claim: 'Reserved',
    holder: 'luis.testnet',
  },
  {
    caption: 'The organizer goes silent. The deadline passes with no confirmation.',
    phase: 'Expirable',
    claim: 'Refundable',
    holder: 'luis.testnet',
  },
  {
    caption: 'Anyone switches the event to refunds.',
    phase: 'Refundable',
    claim: 'Refundable',
    holder: 'luis.testnet',
  },
  {
    caption: 'Luis claims. 1.5 NEAR goes back to luis.testnet.',
    phase: 'Refundable',
    claim: 'Refunded',
    holder: 'luis.testnet',
  },
];

/** Five beats and a pause: about 9 seconds. */
const BEAT_MS = 1800;
const LAST = BEATS.length - 1;

export function Replay() {
  const titleId = useId();
  const { ref, inView } = useInView<HTMLElement>('0px 0px -20% 0px');
  const [reduced] = useState(prefersReducedMotion);
  const [beat, setBeat] = useState(reduced ? LAST : 0);
  const [done, setDone] = useState(reduced);
  const [run, setRun] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `run` is the Replay trigger; a new value restarts the timeline.
  useEffect(() => {
    if (!inView || reduced) return;
    setBeat(0);
    setDone(false);
    const timers = BEATS.slice(1).map((_, i) =>
      window.setTimeout(() => setBeat(i + 1), (i + 1) * BEAT_MS),
    );
    timers.push(window.setTimeout(() => setDone(true), BEATS.length * BEAT_MS));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [inView, reduced, run]);

  const state = BEATS[beat] ?? BEATS[LAST];
  if (!state) return null;
  return (
    <figure ref={ref} className="replay" aria-labelledby={titleId}>
      <h3 id={titleId}>Watch a ticket when the organizer disappears</h3>
      <div className="window">
        <div className="window-chrome">
          <span className="window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="window-url">/tickets/1-4</span>
          {reduced ? (
            <span />
          ) : (
            <button
              type="button"
              className="window-replay"
              disabled={!done}
              onClick={() => setRun((n) => n + 1)}
            >
              Replay
            </button>
          )}
        </div>
        <div className="window-body">
          <div className="stub card replay-stub">
            <p className="stub-eyebrow">Ticket 1-4 · Jazz night</p>
            <p className="stub-amount">1.5 NEAR</p>
            <p className="replay-state">
              <span key={state.phase} className={`phase phase-${state.phase} replay-pill`}>
                {PHASE_LABELS[state.phase]}
              </span>
              <span key={state.claim} className="replay-claim">
                {CLAIM_LABELS[state.claim]}
              </span>
            </p>
            <p key={state.holder} className="stub-note replay-holder">
              Held by {state.holder}
            </p>
          </div>

          {reduced ? (
            <ol className="replay-steps">
              {BEATS.map((b) => (
                <li key={b.caption}>{b.caption}</li>
              ))}
            </ol>
          ) : (
            <>
              <p className="replay-caption" aria-live="polite">
                <span key={beat}>{state.caption}</span>
              </p>
              <span className="replay-progress" aria-hidden="true">
                {BEATS.map((b, i) => (
                  <i key={b.caption} data-on={i <= beat || undefined} />
                ))}
              </span>
            </>
          )}
        </div>
      </div>

      <p className="muted replay-note">
        A replay with demo data. The real transactions are on the{' '}
        <Link to="/proof">Proof page</Link>.
      </p>
    </figure>
  );
}
