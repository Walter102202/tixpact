import { type ElementType, type ReactNode, useEffect, useRef, useState } from 'react';

// The landing's motion: content rises out of a soft blur the first time it scrolls into view.
// Content is visible by default. It waits hidden only when the browser can say when it is seen
// (IntersectionObserver) and has not asked for reduced motion.

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** True once the element has entered the viewport, and from then on. True at once without an observer. */
export function useInView<T extends Element>(rootMargin = '0px 0px -12% 0px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const node = ref.current;
    if (inView || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);
  return { ref, inView };
}

/** Delay steps for the cards of one section, about 90 ms apart. */
export type RevealDelay = 0 | 1 | 2 | 3;

export function Reveal({
  as: Tag = 'div',
  delay = 0,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  delay?: RevealDelay;
  className?: string;
  children: ReactNode;
  'aria-labelledby'?: string;
  id?: string;
}) {
  // Decided once: a section that started visible never hides again.
  const [animated] = useState(
    () => typeof IntersectionObserver !== 'undefined' && !prefersReducedMotion(),
  );
  const { ref, inView } = useInView<HTMLElement>();
  const classes = ['reveal', animated && !inView ? 'reveal-wait' : null, className]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag ref={ref} className={classes} data-delay={delay} {...rest}>
      {children}
    </Tag>
  );
}
