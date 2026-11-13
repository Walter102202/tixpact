import { EventPage } from './features/events/EventPage';
import { HomePage } from './features/events/HomePage';
import { OrganizerPage } from './features/organizer/OrganizerPage';
import { TicketPage } from './features/tickets/TicketPage';
import { TicketsPage } from './features/tickets/TicketsPage';
import { VerifyPage } from './features/verify/VerifyPage';
import { matchPath, usePath } from './lib/router';
import { type AppServices, ServicesContext } from './services';
import { Shell } from './ui/Shell';

export function App({ services }: { services: AppServices }) {
  return (
    <ServicesContext.Provider value={services}>
      <Shell>
        <Routes />
      </Shell>
    </ServicesContext.Provider>
  );
}

function Routes() {
  const path = usePath();
  if (path === '/') return <HomePage />;
  const event = matchPath('/events/:id', path);
  if (event?.id) return <EventPage key={event.id} id={event.id} />;
  if (matchPath('/tickets', path)) return <TicketsPage />;
  const ticket = matchPath('/tickets/:id', path);
  if (ticket?.id) return <TicketPage key={ticket.id} id={ticket.id} />;
  if (matchPath('/organizer', path)) return <OrganizerPage />;
  const verify = matchPath('/verify/:id', path);
  if (verify?.id) return <VerifyPage key={verify.id} id={verify.id} />;
  return (
    <section className="page">
      <h1>Not found</h1>
      <p>There is no page at {path}.</p>
    </section>
  );
}
