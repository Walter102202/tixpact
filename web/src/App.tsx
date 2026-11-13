import { useEffect, useRef } from 'react';
import { EventPage } from './features/events/EventPage';
import { HomePage } from './features/events/HomePage';
import { OrganizerPage } from './features/organizer/OrganizerPage';
import { DoorPage } from './features/pass/DoorPage';
import { PassPage } from './features/pass/PassPage';
import { ProofPage } from './features/proof/ProofPage';
import { TicketPage } from './features/tickets/TicketPage';
import { TicketsPage } from './features/tickets/TicketsPage';
import { VerifyPage } from './features/verify/VerifyPage';
import { Link, matchPath, usePath } from './lib/router';
import { type AppServices, ServicesContext } from './services';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Shell } from './ui/Shell';

export function App({ services }: { services: AppServices }) {
  const path = usePath();
  useFocusOnNavigate(path);
  return (
    <ServicesContext.Provider value={services}>
      <Shell>
        {/* Keyed by the path: a page that crashed does not take the next one down with it. */}
        <ErrorBoundary key={path}>
          <Route path={path} />
        </ErrorBoundary>
      </Shell>
    </ServicesContext.Provider>
  );
}

/** After an in-app navigation, focus the content so a screen reader starts at the new page. */
function useFocusOnNavigate(path: string) {
  // Compared with the last path, not a "first render" flag: React's strict mode runs effects
  // twice on mount, which would otherwise steal focus from the skip link on the first load.
  const previous = useRef(path);
  useEffect(() => {
    if (previous.current === path) return;
    previous.current = path;
    document.getElementById('main')?.focus();
  }, [path]);
}

function Route({ path }: { path: string }) {
  if (path === '/') return <HomePage />;
  const event = matchPath('/events/:id', path);
  if (event?.id) return <EventPage key={event.id} id={event.id} />;
  if (matchPath('/tickets', path)) return <TicketsPage />;
  const pass = matchPath('/tickets/:id/pass', path);
  if (pass?.id) return <PassPage key={pass.id} id={pass.id} />;
  if (matchPath('/door', path)) return <DoorPage />;
  const ticket = matchPath('/tickets/:id', path);
  if (ticket?.id) return <TicketPage key={ticket.id} id={ticket.id} />;
  if (matchPath('/organizer', path)) return <OrganizerPage />;
  const verify = matchPath('/verify/:id', path);
  if (verify?.id) return <VerifyPage key={verify.id} id={verify.id} />;
  if (matchPath('/proof', path)) return <ProofPage />;
  return (
    <section className="page">
      <h1>Not found</h1>
      <p>There is no page at {path}.</p>
      <Link to="/">See the events</Link>
    </section>
  );
}
