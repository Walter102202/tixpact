import {
  checkPass,
  decodePass,
  type EntryPass,
  encodePass,
  type PassCheck,
} from '@ticket-escrow/client';
import { type FormEvent, useId, useState } from 'react';
import { replaceHash, useHash } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useServices } from '../../services';
import { LoadState } from '../../ui/LoadState';
import { DoorScanner } from './DoorScanner';
import {
  type Admission,
  admissionOf,
  admissionScope,
  clockTime,
  forgetAdmission,
  recordAdmission,
} from './passFlow';

const CHECK_NAMES: Record<PassCheck['id'], string> = {
  signature: 'Signature',
  key: 'Key',
  holder: 'Holder',
  ticket: 'Ticket',
  fresh: 'Fresh',
};

/** In demo mode no verdict reads like a real one: the data is not the chain. */
const WORDS = {
  live: { admit: 'Admit', refuse: 'Do not admit' },
  demo: { admit: 'Demo: would admit', refuse: 'Demo: would not admit' },
};
const DEMO_RESULT = 'Demo data, not the chain: this result admits no one.';

/**
 * Where this check runs. The holder's QR or link can name any site, including a copy of this one
 * in demo mode that admits anyone, so the attendant opens the door page from their own bookmark.
 */
function CheckingSite() {
  return (
    <p className="door-site">
      Checking site: <strong>{window.location.origin}</strong>. Open this page yourself, from your
      own bookmark: a link or code the holder shows you can lead to a copy of this site that admits
      anyone.
    </p>
  );
}

/** `/door`: checks the entry pass in the URL fragment against the chain, or takes a pasted one. */
export function DoorPage() {
  const hash = useHash();
  const pass = decodePass(hash);
  if (pass === null) return <DoorIntro unreadable={hash.length > 1} />;
  // Keyed by the pass: a new scan starts a new check.
  return <DoorCheck key={encodePass(pass)} pass={pass} />;
}

function DoorIntro({ unreadable }: { unreadable: boolean }) {
  const { fixtureMode } = useServices();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  function check(formEvent: FormEvent) {
    formEvent.preventDefault();
    const pass = decodePass(text);
    if (pass === null) {
      setError('That is not an entry pass. Paste the whole link or pass.');
      return;
    }
    setError(null);
    replaceHash(`p=${encodePass(pass)}`);
  }

  return (
    <section className="page door-page">
      <h1>Door check</h1>
      <p className="lead">
        Paste the holder's entry pass or its link below. It is checked against{' '}
        {fixtureMode ? 'demo data, not the chain' : 'the chain'}; it is sent nowhere else.
      </p>
      <CheckingSite />
      <DoorScanner onPass={(pass) => replaceHash(`p=${encodePass(pass)}`)} />
      {unreadable && (
        <p className="tx tx-notice" role="alert">
          This link does not carry a readable entry pass. Ask the holder to show it again.
        </p>
      )}
      <form className="door-form" onSubmit={check} noValidate>
        <label htmlFor={inputId}>Pass or door link</label>
        <textarea
          id={inputId}
          className="input door-input"
          rows={3}
          value={text}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(change) => setText(change.target.value)}
        />
        {error !== null && (
          <p id={errorId} className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn">
          Check the pass
        </button>
      </form>
    </section>
  );
}

function DoorCheck({ pass }: { pass: EntryPass }) {
  const { contractId, passChain, fixtureMode } = useServices();
  const scope = admissionScope(fixtureMode, contractId);
  const [attempt, setAttempt] = useState(0);
  // Random, so a record left by an earlier visit is never taken for this one.
  const [instance] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const checksId = useId();
  const load = useLoad(`door:${attempt}`, async (): Promise<DoorResult> => {
    const now = Date.now();
    const result = await checkPass(pass, contractId, passChain, now);
    const check = `${instance}:${attempt}`;
    const earlier = admissionOf(scope, pass.ticket);
    if (earlier !== null && earlier.check !== check) return { ...result, earlier };
    if (!result.admitted) return { ...result, earlier: null };
    // Recorded when the verdict is Admit, not on a button the attendant may forget. In development
    // React runs this twice; the second run finds the record of its own check and keeps it.
    const recorded = earlier ?? { at: now, check };
    const saved = earlier !== null || recordAdmission(scope, pass.ticket, recorded);
    return { ...result, earlier: null, recorded, saved };
  });

  return (
    <section className="page door-page">
      <h1>Door check</h1>
      <LoadState
        load={load}
        loadingText={`Checking the pass against ${fixtureMode ? 'demo data' : 'the chain'}…`}
      >
        {(result) => (
          <>
            <Verdict pass={pass} result={result} scope={scope} />
            <h2 id={checksId} className="door-checks-heading">
              The five checks
            </h2>
            <ol className="door-checks" aria-labelledby={checksId}>
              {result.checks.map((check) => (
                <li key={check.id} className={check.ok ? 'door-check-ok' : 'door-check-no'}>
                  <span className="door-check-mark">{check.ok ? 'ok' : 'NO'}</span>{' '}
                  <strong>{CHECK_NAMES[check.id]}</strong>
                  <span className="visually-hidden">{check.ok ? ' passed: ' : ' failed: '}</span>{' '}
                  <span>{check.detail}</span>
                </li>
              ))}
            </ol>
            <p className="door-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Check again
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => replaceHash('')}>
                Check another pass
              </button>
            </p>
          </>
        )}
      </LoadState>
    </section>
  );
}

interface DoorResult {
  admitted: boolean;
  checks: PassCheck[];
  /** An admission of this ticket recorded on this device by an earlier check. */
  earlier: Admission | null;
  /** The admission this check recorded, and whether the browser stored it. */
  recorded?: Admission;
  saved?: boolean;
}

function Verdict({ pass, result, scope }: { pass: EntryPass; result: DoorResult; scope: string }) {
  const { timeZone, fixtureMode } = useServices();
  const [undone, setUndone] = useState(false);
  const who = `Ticket ${pass.ticket} · ${pass.account}`;
  const words = fixtureMode ? WORDS.demo : WORDS.live;
  const time = (ms: number) => clockTime(ms, timeZone, true);
  const site = (
    <>
      {fixtureMode && <p className="verdict-demo">{DEMO_RESULT}</p>}
      <CheckingSite />
    </>
  );

  if (!result.admitted || result.earlier !== null) {
    return (
      <div
        className={`verdict verdict-no${result.earlier !== null ? ' verdict-again' : ''}`}
        role="status"
      >
        <p className="verdict-word">{words.refuse}</p>
        <p>{who}</p>
        {result.earlier !== null && (
          <p className="verdict-again-line">
            Already admitted on this device at {time(result.earlier.at)}.
          </p>
        )}
        <ul>
          {result.checks
            .filter((check) => !check.ok)
            .map((check) => (
              <li key={check.id}>{check.detail}</li>
            ))}
        </ul>
        {site}
      </div>
    );
  }
  const recorded = result.recorded;
  return (
    <div className="verdict verdict-ok" role="status">
      <p className="verdict-word">{words.admit}</p>
      <p>{who}</p>
      {recorded !== undefined && !result.saved && (
        <p>
          This browser would not store the admission, so a second scan here will not be flagged.
        </p>
      )}
      {recorded !== undefined && result.saved && !undone && (
        <p>
          This device now remembers ticket {pass.ticket} as admitted at {time(recorded.at)}: any
          other pass for it reads "{words.refuse}" here.{' '}
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setUndone(forgetAdmission(scope, pass.ticket, recorded.check))}
          >
            Undo: scanned by mistake
          </button>
        </p>
      )}
      {undone && <p>Undone: this device no longer remembers ticket {pass.ticket} as admitted.</p>}
      {site}
    </div>
  );
}
