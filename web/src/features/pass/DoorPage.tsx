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
import { admittedAt, clockTime, markAdmitted } from './passFlow';

const CHECK_NAMES: Record<PassCheck['id'], string> = {
  signature: 'Signature',
  key: 'Key',
  holder: 'Holder',
  ticket: 'Ticket',
  fresh: 'Fresh',
};

/** In demo mode no verdict reads like a real one: the data is not the chain. */
const WORDS = {
  live: { admit: 'Admit', refuse: 'Do not admit', again: 'Already admitted' },
  demo: {
    admit: 'Demo: would admit',
    refuse: 'Demo: would not admit',
    again: 'Demo: already admitted',
  },
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
  const [attempt, setAttempt] = useState(0);
  const checksId = useId();
  const load = useLoad(`door:${attempt}`, async () => {
    const result = await checkPass(pass, contractId, passChain, Date.now());
    // Read once per check: a mark made during this check shows as "Marked", not "Already".
    return { ...result, before: admittedAt(contractId, pass.ticket) };
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
            <Verdict
              pass={pass}
              admitted={result.admitted}
              checks={result.checks}
              before={result.before}
            />
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

function Verdict({
  pass,
  admitted,
  checks,
  before,
}: {
  pass: EntryPass;
  admitted: boolean;
  checks: PassCheck[];
  before: number | null;
}) {
  const { contractId, timeZone, fixtureMode } = useServices();
  const [marked, setMarked] = useState<number | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const who = `Ticket ${pass.ticket} · ${pass.account}`;
  const words = fixtureMode ? WORDS.demo : WORDS.live;
  const site = (
    <>
      {fixtureMode && <p className="verdict-demo">{DEMO_RESULT}</p>}
      <CheckingSite />
    </>
  );

  if (!admitted) {
    return (
      <div className="verdict verdict-no" role="status">
        <p className="verdict-word">{words.refuse}</p>
        <p>{who}</p>
        <ul>
          {checks
            .filter((check) => !check.ok)
            .map((check) => (
              <li key={check.id}>{check.detail}</li>
            ))}
        </ul>
        {site}
      </div>
    );
  }
  if (before !== null) {
    return (
      <div className="verdict verdict-again" role="status">
        <p className="verdict-word">{words.again}</p>
        <p>{who}</p>
        <p>Already admitted on this device at {clockTime(before, timeZone)}.</p>
        {site}
      </div>
    );
  }
  return (
    <div className="verdict verdict-ok" role="status">
      <p className="verdict-word">{words.admit}</p>
      <p>{who}</p>
      {site}
      {marked === null ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            const at = Date.now();
            setUnsaved(!markAdmitted(contractId, pass.ticket, at));
            setMarked(at);
          }}
        >
          Mark as admitted
        </button>
      ) : (
        <p>
          Marked as admitted at {clockTime(marked, timeZone)}.
          {unsaved &&
            ' This browser would not store it, so a second scan here will not be flagged.'}
        </p>
      )}
    </div>
  );
}
