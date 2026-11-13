import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Link } from '../../lib/router';
import { prefersReducedMotion, useInView } from './Reveal';

// The agent's real output on NEAR testnet, from docs/mcp.md, section "Verification" (2026-11-13):
// contract te-d3-escrow.testnet, agent te-d1-agent.testnet, caps 2 NEAR per ticket and 5 NEAR of
// exposure. Lines starting with "#" say which run follows; every other line is as printed.

type Line =
  | { kind: 'call'; text: string }
  | { kind: 'out' | 'denied' | 'note'; text: string }
  | { kind: 'out'; text: string; href: string };

interface Run {
  id: string;
  chip: string;
  lines: Line[];
}

const tx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

const RUNS: Run[] = [
  {
    id: 'within',
    chip: '/within-caps',
    lines: [
      { kind: 'call', text: 'get_wallet {}' },
      { kind: 'out', text: 'Per-ticket cap: 2 NEAR' },
      { kind: 'out', text: 'Exposure cap: 5 NEAR' },
      { kind: 'out', text: 'Exposure now: 0 NEAR, leaving 5 NEAR under the cap.' },
      { kind: 'call', text: 'buy_ticket {"event_id":2}' },
      {
        kind: 'out',
        text: 'Bought ticket 2-1 for 0.5 NEAR. Its price stays reserved in the contract until the event is confirmed or switched to refunds. Transaction:',
        href: tx('Dj5bhTYztQbZgUt7wCpeuDXPyTBQk1fxTb2jf5J64J3j'),
      },
    ],
  },
  {
    id: 'over',
    chip: '/over-the-cap',
    lines: [
      {
        kind: 'note',
        text: '# The same run with an exposure cap of 0.5 NEAR, holding ticket 2-1.',
      },
      { kind: 'call', text: 'buy_ticket {"event_id":2}' },
      {
        kind: 'denied',
        text: 'Denied: Exposure would be 1 NEAR (0.5 NEAR in tickets held plus 0.5 NEAR for this one), above the cap of 0.5 NEAR. Nothing was signed.',
      },
    ],
  },
  {
    id: 'watcher',
    chip: '/refund-watcher',
    lines: [
      {
        kind: 'note',
        text: '# The refund watcher. Event 2 had a deadline of 03:51:06 UTC and no confirmation.',
      },
      {
        kind: 'out',
        text: '2026-11-13T03:49:35.284Z Watching te-d1-agent.testnet: a plain loop that checks every 30 s. Stop it with Ctrl+C.',
      },
      {
        kind: 'out',
        text: '2026-11-13T03:50:39.905Z Nothing to claim: 1 ticket held, none claimable now.',
      },
      {
        kind: 'out',
        text: '2026-11-13T03:51:14.755Z expire_event 2: succeeded, tx 3zYb7PV3KjR2ePTSUexqVAyHHFGoA9Siw8887EnS4BGg',
        href: tx('3zYb7PV3KjR2ePTSUexqVAyHHFGoA9Siw8887EnS4BGg'),
      },
      {
        kind: 'out',
        text: '2026-11-13T03:51:21.084Z claim_refund 2-1: succeeded, tx 23DM83YCghZv1Ad3aDhVxhXDjHm9KXjnCtBApDEMmY3e',
        href: tx('23DM83YCghZv1Ad3aDhVxhXDjHm9KXjnCtBApDEMmY3e'),
      },
    ],
  },
];

const STEP_MS = 600;

/** The agent's terminal, replayed line by line; the chips pick the run. */
export function AgentTerminal() {
  const id = useId();
  const { ref, inView } = useInView<HTMLElement>();
  const [reduced] = useState(prefersReducedMotion);
  const [active, setActive] = useState(0);
  const run = RUNS[active] ?? RUNS[0];
  const lines = run?.lines ?? [];
  const [shown, setShown] = useState(reduced ? lines.length : 0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setShown(lines.length);
      return;
    }
    setShown(0);
    const timers = lines.map((_, i) => window.setTimeout(() => setShown(i + 1), 250 + i * STEP_MS));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [inView, reduced, lines]);

  function select(index: number) {
    const next = (index + RUNS.length) % RUNS.length;
    setActive(next);
    tabs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const moves: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: RUNS.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  }

  return (
    <div className="agent-demo">
      <figure ref={ref} className="term-wrap" aria-label="The agent on NEAR testnet">
        <div className="term-chips">
          <span className="term-chips-label" id={`${id}-chips`}>
            Try it
          </span>
          <div role="tablist" aria-labelledby={`${id}-chips`} className="term-chip-list">
            {RUNS.map((r, i) => (
              <button
                key={r.id}
                ref={(node) => {
                  tabs.current[i] = node;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${r.id}`}
                aria-selected={i === active}
                aria-controls={`${id}-panel`}
                tabIndex={i === active ? 0 : -1}
                className="chip"
                onClick={() => setActive(i)}
                onKeyDown={onKeyDown}
              >
                {r.chip}
              </button>
            ))}
          </div>
        </div>
        <div className="term">
          <div className="term-bar">
            <span className="window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>ticket-escrow-agent · te-d1-agent.testnet</span>
          </div>
          <div
            className="term-body"
            role="tabpanel"
            id={`${id}-panel`}
            aria-labelledby={`${id}-tab-${run?.id}`}
            aria-live="polite"
          >
            {lines.slice(0, shown).map((line) => (
              <TermLine key={`${run?.id}-${line.text}`} line={line} />
            ))}
            {shown < lines.length && <span className="term-caret" aria-hidden="true" />}
          </div>
        </div>
        <figcaption className="muted term-caption">
          Real output on NEAR testnet, 2026-11-13. Replayed line by line from the agent's log; the
          links open the real transactions. The contract this site reads is on the{' '}
          <Link to="/proof">Proof page</Link>.
        </figcaption>
      </figure>
      <CapMeter />
    </div>
  );
}

function TermLine({ line }: { line: Line }) {
  if (line.kind === 'call') {
    return (
      <p className="term-line term-call">
        <span aria-hidden="true">› </span>
        {line.text}
      </p>
    );
  }
  return (
    <p className="term-line" data-kind={line.kind}>
      {line.text}
      {'href' in line && (
        <>
          {' '}
          <a href={line.href} target="_blank" rel="noreferrer">
            {line.href}
          </a>
        </>
      )}
    </p>
  );
}

// The agent's exposure as it stood in the run above, after buying ticket 2-1.
const HELD = 0.5;
const PER_TICKET = 2;
const EXPOSURE_CAP = 5;

/** The exposure cap: how much the agent holds in tickets, against the cap, with the per-ticket cap marked. */
function CapMeter() {
  const { ref, inView } = useInView<HTMLElement>();
  return (
    <figure ref={ref} className="card cap-meter" aria-label="Exposure cap">
      <p className="cap-meter-head">
        <span>Exposure cap</span>
        <span>
          {HELD} NEAR of {EXPOSURE_CAP} NEAR in tickets
        </span>
      </p>
      <div className="cap-meter-bar" aria-hidden="true">
        <span
          className="cap-meter-fill"
          style={{ width: inView ? `${(HELD / EXPOSURE_CAP) * 100}%` : '0%' }}
        />
        <span
          className="cap-meter-mark"
          style={{ left: `${(PER_TICKET / EXPOSURE_CAP) * 100}%` }}
        />
      </div>
      <p className="cap-meter-legend">
        <span>held in tickets</span>
        <span>per-ticket cap {PER_TICKET} NEAR</span>
      </p>
      <p className="muted">
        te-d1-agent.testnet after buying ticket 2-1. A purchase that would pass either cap is denied
        before anything is signed.
      </p>
    </figure>
  );
}
