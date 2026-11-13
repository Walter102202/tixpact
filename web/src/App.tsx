import { EventPage } from './features/events/EventPage';
import { HomePage } from './features/events/HomePage';
import { TicketPage } from './features/tickets/TicketPage';
import { TicketsPage } from './features/tickets/TicketsPage';
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
  return (
    <section className="page">
      <h1>Not found</h1>
      <p>There is no page at {path}.</p>
    </section>
  );
}
