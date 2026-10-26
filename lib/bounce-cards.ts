// Bounce Cards physics and stable picking, adapted from React Bits (David Haz).
// Retained license: THIRD_PARTY_NOTICES.md.
export type BounceSlot = { x: number; y: number; rotate: number };
export type BouncePose = BounceSlot & { scale: number };
export type BounceClock = { now: () => number; request: (frame: (now: number) => void) => number; cancel: (id: number) => void };
const pattern = [1, .5, -.3, -1, .2, .75, -.6, .35, -.85, .1];
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export function bounceSlots(count: number, spread: number, rotation: number, arc: number): BounceSlot[] {
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: (i - middle) * spread,
    y: arc * ((i - middle) / Math.max(1, middle)) ** 2, rotate: pattern[i % pattern.length] * rotation }));
}
// Hit-test resting slots, not cards that move beneath the pointer. Hysteresis
// at each boundary prevents the selected card from oscillating.
export function pickBounceCard(slots: BounceSlot[], x: number, y: number, size: number, previous = -1, push = 0): number {
  let next = -1, distance = Infinity;
  slots.forEach((slot, i) => { const gap = Math.abs(x - slot.x); if (gap < distance) { distance = gap; next = i; } });
  if (next < 0 || Math.abs(y - slots[next].y) > size / 2 + 28 || distance > size / 2 + push + 20) return -1;
  if (previous >= 0 && previous !== next && slots[previous] && Math.abs(x - slots[previous].x) - distance < 6) return previous;
  return next;
}
type Body = BouncePose & { vx: number; vy: number; vr: number; vs: number };
type Settings = { cardSize: number; pushDistance: number; hoverScale: number; bounciness: number; animationDelay: number; animationStagger: number };
export function createBounceAnimator(initialSlots: BounceSlot[], initial: Settings, clock: BounceClock, paint: (poses: BouncePose[], active: number) => void) {
  let slots = initialSlots, settings = initial, active = -1, frame = 0, alive = true, paused = false;
  let last = clock.now(), introStart: number | null = null, introFrom = 1;
  const bodies: Body[] = slots.map(s => ({ ...s, scale: 1, vx: 0, vy: 0, vr: 0, vs: 0 }));
  const target = (i: number): BouncePose => ({ ...slots[i],
    x: slots[i].x + (active >= 0 && i !== active ? Math.sign(i - active) * settings.pushDistance : 0),
    y: slots[i].y - (i === active ? settings.cardSize * .04 : 0),
    rotate: i === active ? 0 : slots[i].rotate, scale: i === active ? settings.hoverScale : 1 });
  const render = () => paint(bodies.map(({ x, y, rotate, scale }) => ({ x, y, rotate, scale: Math.max(0, scale) })), active);
  function settle() { introStart = null; bodies.forEach((b, i) => Object.assign(b, target(i), { vx: 0, vy: 0, vr: 0, vs: 0 })); render(); }
  function tick(now: number) {
    frame = 0; if (!alive || paused) return;
    const dt = clamp((now - last) / 1000, 1 / 240, 1 / 30); last = now;
    const steps = Math.ceil(dt * 240), h = dt / steps;
    const damping = 2 * (1 - .85 * clamp(settings.bounciness, 0, 1)) * Math.sqrt(170);
    let moving = 0;
    bodies.forEach((b, i) => {
      const to = target(i), waiting = introStart !== null && now - introStart < (settings.animationDelay + i * settings.animationStagger) * 1000;
      if (waiting) to.scale = introFrom;
      for (let k = 0; k < steps; k++) {
        b.vx += ((to.x - b.x) * 210 - b.vx * 20.87) * h; b.x += b.vx * h;
        b.vy += ((to.y - b.y) * 210 - b.vy * 20.87) * h; b.y += b.vy * h;
        b.vr += ((to.rotate - b.rotate) * 210 - b.vr * 20.87) * h; b.rotate += b.vr * h;
        b.vs += ((to.scale - b.scale) * 170 - b.vs * damping) * h; b.scale += b.vs * h;
      }
      moving += Math.abs(to.x - b.x) + Math.abs(to.y - b.y) + Math.abs(to.rotate - b.rotate) + Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.vr) + (Math.abs(to.scale - b.scale) + Math.abs(b.vs)) * 100 + (waiting ? 1 : 0);
    });
    if (moving > .02) { render(); frame = clock.request(tick); } else settle();
  }
  function wake() { if (!alive || paused || frame) return; last = clock.now(); frame = clock.request(tick); }
  return {
    activate(i: number) { const next = i >= 0 && i < slots.length ? i : -1; if (next === active) return; active = next; introStart = null; wake(); },
    layout(next: BounceSlot[], config: Settings) { slots = next; settings = config; wake(); },
    reveal(from = 0) { introFrom = from; introStart = clock.now(); bodies.forEach(b => { b.scale = from; b.vs = 0; }); render(); wake(); },
    pause() { paused = true; if (frame) clock.cancel(frame); frame = 0; settle(); },
    resume() { paused = false; },
    destroy() { alive = false; if (frame) clock.cancel(frame); frame = 0; },
  };
}
