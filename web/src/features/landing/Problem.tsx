import { Reveal, type RevealDelay } from './Reveal';

// The only figures in this section. Words and links as checked against their sources on
// 2026-11-12 (docs/plans/2026-11-13-landing-problem-and-motion.md); add nothing they do not say.
const FACTS = [
  {
    figure: '$9 million',
    sentence:
      'A ticketing company “relied on incoming funds from new ticket sales to cover its costs and debts”. It was ordered to pay about $9 million to an estimated 45,000 organizers and buyers.',
    source: 'Washington State Attorney General, 2021',
    href: 'https://atg.wa.gov/news/news-releases/ag-ferguson-brown-paper-tickets-will-fully-refund-event-organizers-ticket-buyers',
  },
  {
    figure: '$300,664',
    sentence:
      'A festival’s operator “owed more than $7 million to over 900 creditors” with “only $300,664 in the bank”.',
    source: 'ABC News, 2026',
    href: 'https://www.abc.net.au/news/2026-06-11/byron-bay-bluesfest-report-reveals-debt/106769938',
  },
  {
    figure: '620',
    sentence:
      'About 620 complaints for one cancelled match remain unresolved, most of them for money not refunded; one of the producers could not be found.',
    source: 'SERNAC, Chile’s consumer agency, 2026',
    href: 'https://sernac.cl/portal/604/w3-article-89234.html',
  },
] as const;

export function Problem() {
  return (
    <Reveal as="section" className="landing-section problem" aria-labelledby="problem-heading">
      <p className="eyebrow section-eyebrow">01 · The problem</p>
      <h2 id="problem-heading">A refund is only a promise.</h2>
      <p className="lead">
        Today the ticket money goes to the seller the day you pay. If the event is cancelled and the
        money is gone, nobody can give it back.
      </p>
      <ul className="fact-list">
        {FACTS.map((fact, i) => (
          <Reveal as="li" key={fact.figure} delay={(i + 1) as RevealDelay} className="card fact">
            <p className="fact-figure">{fact.figure}</p>
            <p>{fact.sentence}</p>
            <a className="fact-source" href={fact.href} target="_blank" rel="noreferrer">
              {fact.source}
            </a>
          </Reveal>
        ))}
      </ul>
    </Reveal>
  );
}
