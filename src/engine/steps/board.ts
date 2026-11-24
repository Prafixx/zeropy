// The pretend Raspberry Pi on screen: the 40-pin header (the used GPIO pins
// light up) and a card for each part the program made: an LED that glows,
// a button to press, a buzzer, a distance sensor with a slider. It plays the
// timeline of a run (gpio.py) in real time. An input (a press, a distance)
// at time t runs the program again with that input: the run is the same up
// to t, so the playback simply goes on.
import { place } from '@/kit/motion';
import type { GpioDevice, GpioInput, GpioRun } from '../types';
// Light sensor, knob (MCP3008), motor and robot cards: milestone 55.
import { h } from '../ui';

/** GPIO numbers of the 40-pin header, by physical pin (1 to 40). Others: power or ground. */
const HEADER: (number | '3V3' | '5V' | 'GND')[] = [
  '3V3', '5V', 2, '5V', 3, 'GND', 4, 14, 'GND', 15, 17, 18, 27, 'GND', 22, 23, '3V3', 24, 10, 'GND',
  9, 25, 11, 8, 'GND', 7, 0, 1, 5, 'GND', 6, 12, 13, 'GND', 19, 16, 26, 20, 'GND', 21,
];

const NAMES: Record<string, string> = {
  LED: 'LED',
  PWMLED: 'LED (brightness)',
  Buzzer: 'Buzzer',
  Button: 'Button',
  MotionSensor: 'Motion sensor',
  DistanceSensor: 'Distance sensor',
  CPUTemperature: 'CPU temperature',
  LightSensor: 'Light sensor',
  MCP3008: 'Knob (MCP3008)',
  Motor: 'Motor',
  Robot: 'Robot',
};

interface Card {
  el: HTMLElement;
  set(value: number): void;
  /** Parts that depend on time, not on one value (the robot on its floor). */
  tick?(t: number): void;
}

/** The floor of the robot, in cm: 2 m by 1.2 m. A wheel at full speed: 40 cm/s. */
const FLOOR = { w: 200, h: 120, speed: 40 };

/** Where the robot is at time t: it starts in the middle, facing right, and drives with its two motors. */
export function robotPose(timeline: GpioRun['timeline'], left: number, right: number, t: number): { x: number; y: number; a: number; trail: [number, number][]; bump: boolean } {
  let x = FLOOR.w / 2;
  let y = FLOOR.h / 2;
  let a = 0;
  let l = 0;
  let r = 0;
  let bump = false;
  const trail: [number, number][] = [[x, y]];
  const events = timeline.filter((e) => e.id === left || e.id === right);
  let k = 0;
  const dt = 0.02;
  for (let now = 0; now < t; now += dt) {
    while (k < events.length && events[k].t <= now + 1e-9) {
      if (events[k].id === left) l = events[k].value;
      else r = events[k].value;
      k++;
    }
    const step = Math.min(dt, t - now);
    const v = ((l + r) / 2) * FLOOR.speed;
    // Left faster than right: the robot turns clockwise (to the right). Full spin: 180 degrees a second.
    a += ((l - r) / 2) * Math.PI * step;
    const nx = x + v * Math.cos(a) * step;
    const ny = y + v * Math.sin(a) * step;
    x = Math.max(8, Math.min(FLOOR.w - 8, nx));
    y = Math.max(8, Math.min(FLOOR.h - 8, ny));
    bump = bump || x !== nx || y !== ny;
    const last = trail[trail.length - 1];
    if (Math.hypot(last[0] - x, last[1] - y) > 3) trail.push([x, y]);
  }
  return { x, y, a, trail, bump };
}

export interface BoardPlayer {
  el: HTMLElement;
  /** Plays a new run. `from`: go on from this time (after an input), else from 0. */
  play(run: GpioRun | null | undefined, stdout: string, from?: number): void;
  /** The inputs the learner gave, with their times. */
  inputs(): GpioInput[];
  reset(): void;
  dispose(): void;
}

export interface BoardOptions {
  /** The learner gave an input: run the program again with all inputs. */
  onInput(inputs: GpioInput[], at: number): void;
  /** The output that is printed by the time the playback reached. */
  onOutput(text: string): void;
}

/**
 * A slider that the learner moves. The value is taken at the moment of the
 * move (not later), one input is sent when the slider rests, and while the
 * learner uses it the playback does not move it back. Phones often do not
 * give a range slider the focus, so focus alone cannot tell.
 */
function sliderTouch(slider: HTMLInputElement, preview: (v: number) => void, send: (v: number) => void): { busy(): boolean } {
  let timer = 0;
  let until = 0;
  let holding = false;
  slider.addEventListener('pointerdown', () => (holding = true));
  const release = (): void => {
    holding = false;
    until = performance.now() + 400;
  };
  slider.addEventListener('pointerup', release);
  slider.addEventListener('pointercancel', release);
  slider.addEventListener('input', () => {
    const v = Number(slider.value) / 100;
    until = performance.now() + 400;
    preview(v);
    window.clearTimeout(timer);
    // One input when the slider rests, not one for every pixel.
    timer = window.setTimeout(() => {
      until = performance.now() + 400;
      send(v);
    }, 150);
  });
  return { busy: () => holding || performance.now() < until || document.activeElement === slider };
}

function pinLabel(pin: number | null | undefined): string {
  return pin === null || pin === undefined ? '' : `GPIO${pin}`;
}

export function createBoard(options: BoardOptions): BoardPlayer {
  const header = h('div', { class: 'pi-header', 'aria-hidden': 'true' });
  const parts = h('div', { class: 'pi-parts' });
  const clock = h('span', { class: 'pi-clock' }, '0.0 s');
  const status = h('span', { class: 'pi-status', 'aria-live': 'polite' }, 'Press Run: the program plays on the board.');
  const skip = h('button', { type: 'button', class: 'btn btn-ghost btn-small' }, h('span', { class: 'btn-label' }, 'Skip to the end'));
  skip.hidden = true;
  const el = h(
    'div',
    { class: 'pi' },
    h('div', { class: 'pi-top' }, h('span', { class: 'pi-title' }, 'Raspberry Pi'), clock, skip),
    h('div', { class: 'pi-body' }, h('div', { class: 'pi-board' }, header, h('span', { class: 'pi-board-name' }, 'GPIO header')), parts),
    status,
  );

  let run: GpioRun | null = null;
  let stdout = '';
  let given: GpioInput[] = [];
  let start = 0; // performance.now() at time 0 of the run
  let frame = 0;
  let disposed = false;
  let shownUntil = -1;
  const cards = new Map<number, Card>();

  /** The header: every pin, and the GPIO pins in use light up with their part. */
  function drawHeader(devices: GpioDevice[]): void {
    const used = new Map<number, string>();
    devices.forEach((d) => Object.values(d.pins).forEach((p) => p !== null && used.set(p, NAMES[d.kind] ?? d.kind)));
    header.replaceChildren(
      ...HEADER.map((pin, i) => {
        const kind = typeof pin === 'number' ? (used.has(pin) ? 'is-used' : 'is-gpio') : pin === 'GND' ? 'is-gnd' : 'is-power';
        return h('i', { class: `pi-pin ${kind}`, title: typeof pin === 'number' ? `GPIO${pin}${used.has(pin) ? `: ${used.get(pin)}` : ''} (pin ${i + 1})` : `${pin} (pin ${i + 1})` });
      }),
    );
  }

  function now(): number {
    return (performance.now() - start) / 1000;
  }

  function input(e: Omit<GpioInput, 'at'>): void {
    if (!run) return;
    const at = Math.round(Math.min(now(), 30) * 100) / 100;
    given = [...given, { ...e, at }];
    options.onInput(given, at);
  }

  /** A part with a slider: the light on a light sensor, or a knob on an MCP3008. */
  function sliderCard(look: HTMLElement, label: HTMLElement, what: string, send: (v: number) => Omit<GpioInput, 'at'>, show: (v: number) => string): Card {
    const read = h('b', { class: 'pi-reading' }, show(0.5));
    const slider = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '50', class: 'pi-slider', 'aria-label': what });
    const touch = sliderTouch(slider, (v) => {
      read.textContent = show(v);
      look.style.setProperty('--level', String(v));
    }, (v) => input(send(v)));
    const el = h('div', { class: 'pi-part pi-part-wide' }, look, label, read, slider);
    return {
      el,
      set(v) {
        if (!touch.busy()) {
          slider.value = String(Math.round(v * 100));
          read.textContent = show(v);
          look.style.setProperty('--level', String(v));
        }
      },
    };
  }

  function card(d: GpioDevice): Card {
    const pins = Object.entries(d.pins)
      .filter(([, p]) => p !== null)
      .map(([role, p]) => (role === 'pin' ? pinLabel(p) : `${role} ${pinLabel(p)}`))
      .join(', ');
    const label = h('span', { class: 'pi-part-name' }, NAMES[d.kind] ?? d.kind, pins ? h('small', null, pins) : null);
    if (d.kind === 'LED' || d.kind === 'PWMLED') {
      const bulb = h('span', { class: `pi-led is-${d.color ?? 'red'}` });
      const el = h('div', { class: 'pi-part' }, bulb, label);
      return {
        el,
        set(v) {
          bulb.style.setProperty('--glow', String(Math.max(0, Math.min(1, v))));
          bulb.classList.toggle('is-on', v > 0);
          el.setAttribute('aria-label', `${NAMES[d.kind]} on ${pins}: ${v > 0 ? (d.kind === 'PWMLED' ? `brightness ${v}` : 'on') : 'off'}`);
        },
      };
    }
    if (d.kind === 'Buzzer') {
      const icon_ = h('span', { class: 'pi-buzzer' }, '♪');
      const el = h('div', { class: 'pi-part' }, icon_, label);
      return {
        el,
        set(v) {
          icon_.classList.toggle('is-on', v > 0);
          el.setAttribute('aria-label', `Buzzer on ${pins}: ${v > 0 ? 'beeping' : 'silent'}`);
        },
      };
    }
    if (d.kind === 'Button' || d.kind === 'MotionSensor') {
      const word = d.kind === 'Button' ? 'press' : 'motion';
      const knob = h(
        'button',
        { type: 'button', class: d.kind === 'Button' ? 'pi-button' : 'pi-motion', 'aria-label': d.kind === 'Button' ? `Press the button on ${pins}` : `Move in front of the motion sensor on ${pins}` },
        d.kind === 'Button' ? '' : 'Move here',
      );
      const pin = d.pins.pin ?? undefined;
      let down = false;
      const press = (value: boolean) => {
        if (down === value) return;
        down = value;
        input({ pin, [word]: value });
      };
      knob.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        knob.setPointerCapture(event.pointerId);
        press(true);
      });
      knob.addEventListener('pointerup', () => press(false));
      knob.addEventListener('pointercancel', () => press(false));
      knob.addEventListener('keydown', (event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
          event.preventDefault();
          press(true);
        }
      });
      knob.addEventListener('keyup', (event) => {
        if (event.key === ' ' || event.key === 'Enter') press(false);
      });
      const el = h('div', { class: 'pi-part' }, knob, label);
      return { el, set: (v) => knob.classList.toggle('is-down', v > 0) };
    }
    if (d.kind === 'DistanceSensor') {
      const read = h('b', { class: 'pi-reading' }, '100 cm');
      const slider = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '100', class: 'pi-slider', 'aria-label': 'Distance to the sensor in centimeters' });
      const touch = sliderTouch(slider, (v) => (read.textContent = `${Math.round(v * 100)} cm`), (v) => input({ echo: d.pins.echo ?? undefined, distance: v }));
      const el = h('div', { class: 'pi-part pi-part-wide' }, h('span', { class: 'pi-eyes' }, h('i'), h('i')), label, read, slider);
      return {
        el,
        set(v) {
          if (!touch.busy()) {
            slider.value = String(Math.round(v * 100));
            read.textContent = `${Math.round(v * 100)} cm`;
          }
        },
      };
    }
    if (d.kind === 'LightSensor') {
      return sliderCard(
        h('span', { class: 'pi-sun', 'aria-hidden': 'true' }),
        label,
        'Light on the sensor, from dark to bright',
        (v) => ({ pin: d.pins.pin ?? undefined, light: v }),
        (v) => (v <= 0.1 ? `dark (${v.toFixed(2)})` : `light ${v.toFixed(2)}`),
      );
    }
    if (d.kind === 'MCP3008') {
      const channel = d.channel ?? 0;
      return sliderCard(
        h('span', { class: 'pi-knob', 'aria-hidden': 'true' }, h('i')),
        h('span', { class: 'pi-part-name' }, 'Knob', h('small', null, `MCP3008 channel ${channel}`)),
        `Turn the knob on channel ${channel}`,
        (v) => ({ channel, analog: v }),
        (v) => `${v.toFixed(2)} (${(v * 3.3).toFixed(2)} V)`,
      );
    }
    if (d.kind === 'Motor') {
      const wheel = h('span', { class: 'pi-wheel', 'aria-hidden': 'true' }, h('i'), h('i'));
      const read = h('b', { class: 'pi-reading' }, 'stopped');
      const el = h('div', { class: 'pi-part' }, wheel, label, read);
      return {
        el,
        set(v) {
          const speed = Math.abs(v);
          wheel.classList.toggle('is-on', speed > 0);
          wheel.classList.toggle('is-back', v < 0);
          // Full speed: one turn in 0.5 s. Half speed: one turn in 1 s.
          wheel.style.setProperty('--turn', `${speed > 0 ? 0.5 / speed : 0}s`);
          read.textContent = speed === 0 ? 'stopped' : `${v > 0 ? 'forward' : 'backward'} ${Math.round(speed * 100)}%`;
          el.setAttribute('aria-label', `Motor on ${pins}: ${read.textContent}`);
        },
      };
    }
    if (d.kind === 'Robot') {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', `0 0 ${FLOOR.w} ${FLOOR.h}`);
      svg.setAttribute('class', 'pi-floor');
      svg.setAttribute('role', 'img');
      const trail = document.createElementNS(ns, 'polyline');
      trail.setAttribute('class', 'pi-trail');
      const bot = document.createElementNS(ns, 'g');
      bot.setAttribute('class', 'pi-bot');
      const body = document.createElementNS(ns, 'rect');
      for (const [k, v] of Object.entries({ x: '-8', y: '-7', width: '16', height: '14', rx: '3' })) body.setAttribute(k, v);
      const nose = document.createElementNS(ns, 'path');
      nose.setAttribute('d', 'M 9 -4 L 14 0 L 9 4 Z');
      bot.append(body, nose);
      svg.append(trail, bot);
      const where = h('b', { class: 'pi-reading' }, '');
      const el = h('div', { class: 'pi-part pi-part-wide pi-part-floor' }, svg, h('span', { class: 'pi-part-name' }, 'Robot', h('small', null, 'on a floor of 2 m × 1.2 m')), where);
      let last = -1;
      return {
        el,
        set: () => undefined,
        tick(t) {
          if (!run || Math.abs(t - last) < 0.03) return;
          last = t;
          const pose = robotPose(run.timeline, d.left ?? -1, d.right ?? -1, t);
          bot.setAttribute('transform', `translate(${pose.x.toFixed(1)} ${pose.y.toFixed(1)}) rotate(${((pose.a * 180) / Math.PI).toFixed(1)})`);
          trail.setAttribute('points', pose.trail.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
          where.textContent = pose.bump ? 'bumped into the wall' : '';
          svg.setAttribute('aria-label', `The robot is at ${Math.round(pose.x)} cm from the left and ${Math.round(pose.y)} cm from the top${pose.bump ? ', at a wall' : ''}.`);
        },
      };
    }
    if (d.kind === 'CPUTemperature') {
      const read = h('b', { class: 'pi-reading' }, '');
      const el = h('div', { class: 'pi-part' }, h('span', { class: 'pi-chip' }, 'CPU'), label, read);
      return { el, set: (v) => (read.textContent = `${v.toFixed(1)} °C`) };
    }
    const el = h('div', { class: 'pi-part' }, label);
    return { el, set: () => undefined };
  }

  function build(devices: GpioDevice[]): void {
    const same = devices.length === cards.size && devices.every((d) => cards.has(d.id));
    if (same) return;
    cards.clear();
    drawHeader(devices);
    parts.replaceChildren(
      ...devices.map((d) => {
        const c = card(d);
        cards.set(d.id, c);
        c.set(0);
        return c.el;
      }),
    );
    if (!devices.length) parts.append(h('p', { class: 'muted' }, 'The program made no parts.'));
    place(parts.children);
  }

  /** Shows the state at time t: the last value of each part, and the output so far. */
  function show(t: number): void {
    if (!run) return;
    const values = new Map<number, number>();
    for (const e of run.timeline) if (e.t <= t) values.set(e.id, e.value);
    cards.forEach((c, id) => {
      c.set(values.get(id) ?? 0);
      c.tick?.(t);
    });
    let pos = 0;
    for (const o of run.outs) if (o.t <= t) pos = o.pos;
    const end = t >= run.end.t;
    if (end) pos = stdout.length;
    if (pos !== shownUntil) {
      shownUntil = pos;
      options.onOutput(stdout.slice(0, pos));
    }
    clock.textContent = `${Math.min(t, 30).toFixed(1)} s`;
  }

  function tick(): void {
    if (disposed || !run) return;
    const t = now();
    show(Math.min(t, run.end.t));
    if (t < run.end.t) {
      frame = requestAnimationFrame(tick);
      return;
    }
    skip.hidden = true;
    if (run.end.why === 'waiting') {
      status.textContent = 'The program waits for you: use the parts on the board.';
      // The clock goes on, so an input later is at the right time.
      const wait = (): void => {
        if (disposed || !run || run.end.why !== 'waiting') return;
        clock.textContent = `${Math.min(now(), 30).toFixed(1)} s`;
        if (now() < 30) frame = requestAnimationFrame(wait);
        else status.textContent = 'Stopped after 30 seconds. On a real Pi, the program would wait until you stop it (Ctrl+C).';
      };
      frame = requestAnimationFrame(wait);
    } else if (run.end.why === 'cap') {
      status.textContent = 'Stopped after 30 seconds. On a real Pi, the program would go on until you stop it (Ctrl+C).';
    } else {
      status.textContent = 'The program ended.';
    }
  }

  skip.addEventListener('click', () => {
    if (!run) return;
    start = performance.now() - run.end.t * 1000;
  });

  return {
    el,
    play(next, text, from) {
      cancelAnimationFrame(frame);
      run = next ?? null;
      stdout = text;
      shownUntil = -1;
      if (!run) {
        status.textContent = 'This program does not use gpiozero, so the board stays empty.';
        options.onOutput(text);
        return;
      }
      build(run.devices);
      if (from === undefined) start = performance.now();
      const kinds = new Set(run.devices.map((d) => d.kind));
      const ways = [
        kinds.has('Button') ? 'press the button' : '',
        kinds.has('MotionSensor') ? 'move in front of the sensor' : '',
        kinds.has('DistanceSensor') ? 'move the slider' : '',
        kinds.has('LightSensor') ? 'make it dark or light with the slider' : '',
        kinds.has('MCP3008') ? 'turn the knob' : '',
      ].filter(Boolean);
      status.textContent = ways.length ? `Running. Try it: ${ways.join(', ')}.` : 'Running.';
      skip.hidden = run.end.why === 'waiting' || run.end.t <= 2;
      tick();
    },
    inputs: () => given,
    reset() {
      given = [];
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
    },
  };
}

