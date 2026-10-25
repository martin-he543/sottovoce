/**
 * Eases a scroll position to a target with a critically damped spring, so the line that is current glides to the middle
 * and a new target mid-flight bends the motion instead of restarting it, as in a music player's lyrics view.
 * The spring step is Fraktality's `spr` (MIT), by way of the port in Spicy Lyrics; the rest is ours.
 */
const FREQUENCY = 1.6;

export interface SpringScroller {
  to: (target: number) => void;
  /** Jump with no motion (for a first paint, or reduced motion). */
  snap: (target: number) => void;
  stop: () => void;
  /** True while the spring is moving the scroll position, or it is still where the spring put it (so a scroll event is ours, not the person's). */
  active: () => boolean;
}

export function springScroller(el: HTMLElement, axis: 'x' | 'y'): SpringScroller {
  const read = () => (axis === 'y' ? el.scrollTop : el.scrollLeft);
  let written = read();
  const write = (v: number) => {
    axis === 'y' ? (el.scrollTop = v) : (el.scrollLeft = v);
    written = read();
  };
  let goal = read();
  let velocity = 0;
  let raf = 0;
  let last = 0;

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const f = FREQUENCY * 2 * Math.PI;
    const q = Math.exp(-f * dt);
    const w = dt * q;
    const o = read() - goal;
    const p = o * (q + w * f) + velocity * w + goal;
    velocity = velocity * (q - w * f) - o * (w * f * f);
    write(p);
    if (Math.abs(p - goal) < 0.4 && Math.abs(velocity) < 2) {
      write(goal);
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  return {
    to(target) {
      goal = target;
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        write(goal);
        return;
      }
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    },
    snap(target) {
      goal = target;
      velocity = 0;
      cancelAnimationFrame(raf);
      raf = 0;
      write(target);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      velocity = 0;
    },
    active: () => raf !== 0 || Math.abs(read() - written) < 1.5,
  };
}
