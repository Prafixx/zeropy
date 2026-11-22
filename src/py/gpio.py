# A pretend Raspberry Pi for the Raspberry Pi lessons. Loaded after
# harness.py. `import gpiozero` gives classes with the names and defaults
# of the real library (gpiozero.readthedocs.io): LED, PWMLED, Buzzer,
# Button, MotionSensor, DistanceSensor, CPUTemperature, TrafficLights,
# LightSensor, MCP3008, Motor, Robot, and `source` (led.source = pot).
#
# Time is simulated. sleep() does not wait: it moves a clock forward, and
# every change of a pin is written into a timeline with its time. The page
# plays the timeline back. Inputs (a press, a distance) come from the case:
# events with a time. A program that waits for an input that never comes,
# or that runs longer than _CAP seconds, ends quietly (it is not an error).
import collections
import heapq
import inspect
import signal
import sys
import time
import types

_CAP = 30.0  # seconds of simulated time
_POLL = 0.01  # reading an input lets this much time pass, so polling loops move on
_PINS = range(0, 28)  # GPIO numbers of the 40-pin header (BCM)


class _SimEnd(BaseException):
    """The simulation ends: not an error of the program."""

    _zp_quiet = True

    def __init__(self, why, wait=None):
        super().__init__(why)
        self.why = why
        self.wait = wait


class _Board:
    def __init__(self, case=None):
        gpio = (case or {}).get("gpio") or {}
        self.now = 0.0
        self.devices = []
        self.pins = {}
        self.timeline = []
        self.outs = []
        self.queue = []
        self.seq = 0
        self.cpu = float(gpio.get("cpu", 47.2))
        self.end = None
        self.inputs = []
        self.in_due = False  # a scheduled task runs: reading a value must not move the clock
        self.light = float(gpio.get("light", 0.6))
        self.analog = dict(gpio.get("analog") or {})
        for e in sorted(gpio.get("events") or [], key=lambda e: float(e.get("at", 0))):
            self.schedule(float(e.get("at", 0)), lambda e=e: self.apply_input(e))

    # ---- the clock -----------------------------------------------------------
    def schedule(self, at, fn):
        self.seq += 1
        heapq.heappush(self.queue, (at, self.seq, fn))

    def mark_out(self):
        out = sys.stdout
        if hasattr(out, "getvalue"):
            pos = len(out.getvalue())
            if not self.outs or self.outs[-1]["pos"] != pos:
                self.outs.append({"t": round(self.now, 3), "pos": pos})

    def advance(self, until):
        """Lets time pass until `until`, and runs what is due on the way."""
        # What was printed until now belongs to now, before the clock moves on.
        self.mark_out()
        if until > _CAP:
            self.run_due(_CAP)
            self.now = _CAP
            raise _SimEnd("cap")
        self.run_due(until)
        self.now = max(self.now, until)

    def run_due(self, until):
        while self.queue and self.queue[0][0] <= until:
            at, _, fn = heapq.heappop(self.queue)
            self.mark_out()
            self.now = max(self.now, at)
            was, self.in_due = self.in_due, True
            try:
                fn()
            finally:
                self.in_due = was
            self.mark_out()

    def idle(self, until_true=None, timeout=None):
        """Waits for the next things in the queue, until `until_true()` (or forever)."""
        limit = self.now + timeout if timeout is not None else None
        while True:
            if until_true and until_true():
                return True
            nxt = self.queue[0][0] if self.queue else None
            if nxt is None or (limit is not None and nxt > limit):
                if limit is not None:
                    self.advance(limit)
                    return bool(until_true and until_true())
                self.mark_out()
                raise _SimEnd("waiting")
            self.advance(nxt)

    # ---- the record ----------------------------------------------------------
    def add(self, device, kind, pins):
        for pin in pins.values():
            if pin is None:
                continue
            if not isinstance(pin, int) or pin not in _PINS:
                raise PinInvalidPin(f"{pin!r} is not a valid pin. Use a GPIO number from 0 to 27 (BCM numbering), like 17.")
            if pin in self.pins:
                other = self.devices[self.pins[pin]]["kind"]
                if kind == other == "MCP3008":
                    continue  # the channels of one MCP3008 share its SPI pins
                raise GPIOPinInUse(f"pin GPIO{pin} is already in use by the {other}")
        dev_id = len(self.devices)
        self.devices.append({"id": dev_id, "kind": kind, "pins": pins})
        for pin in pins.values():
            if pin is not None:
                self.pins.setdefault(pin, dev_id)
        return dev_id

    def record(self, dev_id, value):
        self.mark_out()
        self.timeline.append({"t": round(self.now, 3), "id": dev_id, "value": value})

    def apply_input(self, e):
        self.inputs.append(e)
        target = None
        for d in _objects:
            if d._zp_matches(e):
                target = d
                break
        if target is not None:
            target._zp_input(e)

    def result(self):
        self.mark_out()
        return {
            "devices": self.devices,
            "timeline": self.timeline,
            "outs": self.outs,
            "inputs": self.inputs,
            "cpu": self.cpu,
            "end": self.end or {"t": round(self.now, 3), "why": "done"},
        }


_board = _Board()
_objects = []


def _call(fn, device):
    """A callback may take no argument, or the device that fired."""
    if fn is None:
        return
    try:
        params = [p for p in inspect.signature(fn).parameters.values() if p.default is p.empty and p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)]
    except (TypeError, ValueError):
        params = []
    if params:
        fn(device)
    else:
        fn()


# ---- errors with the names of gpiozero -------------------------------------------
class GPIOZeroError(Exception):
    pass


class GPIODeviceError(GPIOZeroError):
    pass


class GPIOPinInUse(GPIOZeroError):
    pass


class PinInvalidPin(GPIOZeroError):
    pass


class GPIODeviceClosed(GPIOZeroError):
    pass


# ---- devices ---------------------------------------------------------------------
class _Device:
    _zp_kind = "Device"

    def __init__(self, pins):
        for role, pin in pins.items():
            if pin is None and role in ("pin", "echo", "trigger", "red", "green", "forward", "backward"):
                raise GPIODeviceError(f"No pin given: {type(self).__name__} needs a GPIO number")
        self._zp_id = _board.add(self, self._zp_kind, pins)
        self._zp_closed = False
        _objects.append(self)

    def _zp_matches(self, e):
        return False

    def _zp_input(self, e):
        pass

    def close(self):
        self._zp_closed = True

    @property
    def closed(self):
        return self._zp_closed

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ---- source and values: one device drives another (led.source = pot) ------------
    source_delay = 0.01

    def _zp_now(self):
        return getattr(self, "_value", 0)

    @property
    def values(self):
        """An endless stream of the value of the device."""
        def stream():
            while True:
                if not _board.in_due:
                    _board.advance(_board.now + _POLL)
                yield self._zp_now()
        return stream()

    @property
    def source(self):
        return getattr(self, "_zp_source", None)

    @source.setter
    def source(self, value):
        self._zp_source_gen = getattr(self, "_zp_source_gen", 0) + 1
        self._zp_source = value
        if value is None:
            return
        it = value.values if isinstance(value, _Device) else iter(value)
        gen = self._zp_source_gen

        def step():
            if self._zp_source_gen != gen or self._zp_closed:
                return
            try:
                v = next(it)
            except StopIteration:
                return
            self.value = v
            _board.schedule(_board.now + self.source_delay, step)

        was, _board.in_due = _board.in_due, True
        try:
            step()
        finally:
            _board.in_due = was

    def __repr__(self):
        pins = ", ".join(f"GPIO{p}" for p in _board.devices[self._zp_id]["pins"].values() if p is not None)
        return f"<gpiozero.{type(self).__name__} object on pin {pins}>"


class _Pin:
    def __init__(self, number):
        self.number = number

    def __repr__(self):
        return f"GPIO{self.number}"


class _Output(_Device):
    """On/off output: LED, Buzzer. Blinking runs "in the background", on the clock."""

    _zp_kind = "LED"

    def __init__(self, pin=None, active_high=True, initial_value=False, pin_factory=None):
        super().__init__({"pin": pin})
        self._value = 0
        self._gen = 0  # a new blink() or on()/off() stops the old blink
        self.pin = _Pin(pin)
        self._set(1 if initial_value else 0)

    def _set(self, value):
        if value != self._value:
            self._value = value
            _board.record(self._zp_id, value)

    def on(self):
        self._gen += 1
        self._set(1)

    def off(self):
        self._gen += 1
        self._set(0)

    def toggle(self):
        self._gen += 1
        self._set(0 if self._value else 1)

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        self._gen += 1
        self._set(1 if v else 0)

    @property
    def is_active(self):
        return bool(self._value)

    def _cycle(self, on_time, off_time, n, background, on_value=1, off_value=0):
        self._gen += 1
        gen = self._gen
        count = [0]

        def turn_on():
            if gen != self._gen:
                return
            if n is not None and count[0] >= n:
                return
            count[0] += 1
            self._set(on_value)
            _board.schedule(_board.now + on_time, turn_off)

        def turn_off():
            if gen != self._gen:
                return
            self._set(off_value)
            if n is None or count[0] < n:
                _board.schedule(_board.now + off_time, turn_on)

        _board.schedule(_board.now, turn_on)
        if not background:
            # Runs here and now: the program goes on after the last blink.
            total = None if n is None else n * (on_time + off_time)
            if total is None:
                _board.idle()
            else:
                _board.advance(_board.now + total)

    def blink(self, on_time=1, off_time=1, n=None, background=True):
        self._cycle(on_time, off_time, n, background)


class LED(_Output):
    _zp_kind = "LED"

    @property
    def is_lit(self):
        return bool(self._value)


class Buzzer(_Output):
    _zp_kind = "Buzzer"

    def beep(self, on_time=1, off_time=1, n=None, background=True):
        self._cycle(on_time, off_time, n, background)


class PWMLED(_Output):
    """An LED with a brightness from 0.0 to 1.0."""

    _zp_kind = "PWMLED"

    def __init__(self, pin=None, active_high=True, initial_value=0, frequency=100, pin_factory=None):
        if not 0 <= float(initial_value) <= 1:
            raise ValueError("initial_value must be between 0 and 1")
        super().__init__(pin, active_high, False, pin_factory)
        self._set(float(initial_value) if initial_value else 0)

    def _set(self, value):
        value = round(float(value), 3)
        if value != self._value:
            self._value = value
            _board.record(self._zp_id, value)

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        v = float(v)
        if not 0 <= v <= 1:
            raise ValueError("PWM value must be between 0 and 1")
        self._gen += 1
        self._set(v)

    @property
    def is_lit(self):
        return self._value > 0

    def on(self):
        self._gen += 1
        self._set(1.0)

    def toggle(self):
        self._gen += 1
        self._set(0.0 if self._value else 1.0)

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, n=None, background=True):
        if fade_in_time or fade_out_time:
            return self._pulse(fade_in_time, fade_out_time, n, background, hold_on=on_time, hold_off=off_time)
        self._cycle(on_time, off_time, n, background, 1.0, 0.0)

    def pulse(self, fade_in_time=1, fade_out_time=1, n=None, background=True):
        self._pulse(fade_in_time, fade_out_time, n, background)

    def _pulse(self, fade_in, fade_out, n, background, hold_on=0, hold_off=0):
        """Brightness steps of 0.1 s: up in fade_in, down in fade_out."""
        self._gen += 1
        gen = self._gen
        steps = []
        k = max(1, int(round(fade_in / 0.1)))
        steps += [(i / k, fade_in / k) for i in range(1, k + 1)]
        if hold_on:
            steps.append((1.0, hold_on))
        k = max(1, int(round(fade_out / 0.1)))
        steps += [(1 - i / k, fade_out / k) for i in range(1, k + 1)]
        if hold_off:
            steps.append((0.0, hold_off))
        cycle_time = sum(d for _, d in steps)
        cycles = [0]

        def step(i):
            if gen != self._gen:
                return
            if i == 0:
                if n is not None and cycles[0] >= n:
                    return
                cycles[0] += 1
            value, dur = steps[i]
            self._set(value)
            nxt = (i + 1) % len(steps)
            _board.schedule(_board.now + dur, lambda: step(nxt))

        _board.schedule(_board.now, lambda: step(0))
        if not background:
            if n is None:
                _board.idle()
            else:
                _board.advance(_board.now + n * cycle_time)


class TrafficLights:
    """Three LEDs: red, amber and green."""

    def __init__(self, red=None, amber=None, green=None, *, yellow=None, pwm=False, initial_value=False, pin_factory=None):
        if amber is not None and yellow is not None:
            raise ValueError("Give amber or yellow, not both")
        middle = amber if amber is not None else yellow
        self.red = LED(red, initial_value=initial_value)
        if yellow is not None:
            self.yellow = LED(middle, initial_value=initial_value)
        else:
            self.amber = LED(middle, initial_value=initial_value)
        self.green = LED(green, initial_value=initial_value)
        for led, color in ((self.red, "red"), (self._middle(), "amber"), (self.green, "green")):
            _board.devices[led._zp_id]["color"] = color

    def _middle(self):
        return getattr(self, "amber", None) or getattr(self, "yellow")

    def _leds(self):
        return [self.red, self._middle(), self.green]

    def on(self, *indexes):
        for i, led in enumerate(self._leds()):
            if not indexes or i in indexes:
                led.on()

    def off(self, *indexes):
        for i, led in enumerate(self._leds()):
            if not indexes or i in indexes:
                led.off()

    def toggle(self, *indexes):
        for i, led in enumerate(self._leds()):
            if not indexes or i in indexes:
                led.toggle()

    def blink(self, on_time=1, off_time=1, fade_in_time=0, fade_out_time=0, n=None, background=True):
        for led in self._leds():
            led.blink(on_time, off_time, n, True)
        if not background:
            _board.advance(_board.now + (n or 1) * (on_time + off_time))

    @property
    def value(self):
        return tuple(led.value for led in self._leds())

    @property
    def is_lit(self):
        return any(led.is_lit for led in self._leds())

    def close(self):
        for led in self._leds():
            led.close()

    def __repr__(self):
        return "<gpiozero.TrafficLights object>"


class _Input(_Device):
    """Something that is active or not: a button, a motion sensor."""

    _zp_kind = "Input"
    _zp_word = "press"

    def __init__(self, pins):
        super().__init__(pins)
        self._active = False
        self._when = {}
        self._since = None

    def _zp_matches(self, e):
        return e.get("pin") == _board.devices[self._zp_id]["pins"].get("pin") and self._zp_word in e

    def _zp_input(self, e):
        active = bool(e[self._zp_word])
        if active == self._active:
            return
        self._active = active
        self._since = _board.now if active else None
        _board.record(self._zp_id, 1 if active else 0)
        _call(self._when.get("on" if active else "off"), self)
        if active and self._when.get("held") is not None:
            since = self._since
            def held():
                if self._active and self._since == since:
                    _call(self._when.get("held"), self)
            _board.schedule(_board.now + getattr(self, "hold_time", 1), held)

    def _read(self):
        _board.advance(_board.now + _POLL)
        return self._active

    @property
    def value(self):
        return 1 if self._read() else 0

    @property
    def is_active(self):
        return self._read()

    def _wait(self, want, timeout):
        return _board.idle(lambda: self._active == want, timeout)

    def wait_for_active(self, timeout=None):
        return self._wait(True, timeout)

    def wait_for_inactive(self, timeout=None):
        return self._wait(False, timeout)


class Button(_Input):
    _zp_kind = "Button"
    _zp_word = "press"

    def __init__(self, pin=None, pull_up=True, active_state=None, bounce_time=None, hold_time=1, hold_repeat=False, pin_factory=None):
        super().__init__({"pin": pin})
        self.pin = _Pin(pin)
        self.pull_up = pull_up
        self.hold_time = hold_time
        self.hold_repeat = hold_repeat

    @property
    def is_pressed(self):
        return self._read()

    @property
    def is_held(self):
        self._read()
        return self._active and self._since is not None and _board.now - self._since >= self.hold_time

    @property
    def held_time(self):
        if not self.is_held:
            return None
        return _board.now - self._since - self.hold_time

    def wait_for_press(self, timeout=None):
        return self._wait(True, timeout)

    def wait_for_release(self, timeout=None):
        return self._wait(False, timeout)

    when_pressed = property(lambda s: s._when.get("on"), lambda s, f: s._when.__setitem__("on", f))
    when_released = property(lambda s: s._when.get("off"), lambda s, f: s._when.__setitem__("off", f))
    when_held = property(lambda s: s._when.get("held"), lambda s, f: s._when.__setitem__("held", f))
    when_activated = when_pressed
    when_deactivated = when_released


class MotionSensor(_Input):
    """A PIR sensor: active while it sees movement."""

    _zp_kind = "MotionSensor"
    _zp_word = "motion"

    def __init__(self, pin=None, pull_up=False, active_state=None, queue_len=1, sample_rate=10, threshold=0.5, partial=False, pin_factory=None):
        super().__init__({"pin": pin})
        self.pin = _Pin(pin)

    @property
    def motion_detected(self):
        return self._read()

    def wait_for_motion(self, timeout=None):
        return self._wait(True, timeout)

    def wait_for_no_motion(self, timeout=None):
        return self._wait(False, timeout)

    when_motion = property(lambda s: s._when.get("on"), lambda s, f: s._when.__setitem__("on", f))
    when_no_motion = property(lambda s: s._when.get("off"), lambda s, f: s._when.__setitem__("off", f))


class DistanceSensor(_Device):
    """An HC-SR04: the distance to the nearest thing in front, in meters."""

    _zp_kind = "DistanceSensor"

    def __init__(self, echo=None, trigger=None, queue_len=9, max_distance=1, threshold_distance=0.3, partial=False, pin_factory=None):
        if max_distance <= 0:
            raise ValueError("invalid maximum distance (must be positive)")
        super().__init__({"echo": echo, "trigger": trigger})
        self.max_distance = max_distance
        self.threshold_distance = threshold_distance
        self.echo = _Pin(echo)
        self.trigger = _Pin(trigger)
        self._distance = max_distance
        self._when = {}
        _board.record(self._zp_id, round(self._distance, 3))

    def _zp_matches(self, e):
        return "distance" in e and e.get("echo", _board.devices[self._zp_id]["pins"]["echo"]) == _board.devices[self._zp_id]["pins"]["echo"]

    def _zp_input(self, e):
        before = self._distance < self.threshold_distance
        self._distance = max(0.0, min(float(e["distance"]), self.max_distance))
        _board.record(self._zp_id, round(self._distance, 3))
        after = self._distance < self.threshold_distance
        if after and not before:
            _call(self._when.get("in"), self)
        elif before and not after:
            _call(self._when.get("out"), self)

    @property
    def distance(self):
        _board.advance(_board.now + _POLL)
        return self._distance

    @property
    def value(self):
        return self.distance / self.max_distance

    @property
    def is_active(self):
        return self.distance > self.threshold_distance

    def wait_for_in_range(self, timeout=None):
        return _board.idle(lambda: self._distance < self.threshold_distance, timeout)

    def wait_for_out_of_range(self, timeout=None):
        return _board.idle(lambda: self._distance >= self.threshold_distance, timeout)

    when_in_range = property(lambda s: s._when.get("in"), lambda s, f: s._when.__setitem__("in", f))
    when_out_of_range = property(lambda s: s._when.get("out"), lambda s, f: s._when.__setitem__("out", f))


class LightSensor(_Device):
    """A light-dependent resistor (LDR) with a capacitor: 0 is dark, 1 is light."""

    _zp_kind = "LightSensor"

    def __init__(self, pin=None, queue_len=5, charge_time_limit=0.01, threshold=0.1, partial=False, pin_factory=None):
        super().__init__({"pin": pin})
        self.pin = _Pin(pin)
        self.threshold = threshold
        self.charge_time_limit = charge_time_limit
        self._light = max(0.0, min(1.0, float(_board.light)))
        self._when = {}
        _board.record(self._zp_id, round(self._light, 3))

    def _zp_matches(self, e):
        return "light" in e and e.get("pin", _board.devices[self._zp_id]["pins"]["pin"]) == _board.devices[self._zp_id]["pins"]["pin"]

    def _zp_input(self, e):
        before = self._light > self.threshold
        self._light = max(0.0, min(1.0, float(e["light"])))
        _board.record(self._zp_id, round(self._light, 3))
        after = self._light > self.threshold
        if after and not before:
            _call(self._when.get("light"), self)
        elif before and not after:
            _call(self._when.get("dark"), self)

    def _zp_now(self):
        return self._light

    @property
    def value(self):
        _board.advance(_board.now + _POLL)
        return self._light

    @property
    def light_detected(self):
        return self.value > self.threshold

    is_active = light_detected

    def wait_for_light(self, timeout=None):
        return _board.idle(lambda: self._light > self.threshold, timeout)

    def wait_for_dark(self, timeout=None):
        return _board.idle(lambda: self._light <= self.threshold, timeout)

    when_light = property(lambda s: s._when.get("light"), lambda s, f: s._when.__setitem__("light", f))
    when_dark = property(lambda s: s._when.get("dark"), lambda s, f: s._when.__setitem__("dark", f))
    when_activated = when_light
    when_deactivated = when_dark


class SPIError(GPIOZeroError):
    pass


class SPIBadChannel(SPIError):
    pass


class MCP3008(_Device):
    """An analogue-to-digital converter with 8 channels (0 to 7), on the SPI pins.
    Here, a knob (potentiometer) is on each channel that the program reads."""

    _zp_kind = "MCP3008"

    def __init__(self, channel=0, differential=False, max_voltage=3.3, **spi_args):
        if not isinstance(channel, int) or not 0 <= channel <= 7:
            raise SPIBadChannel("channel must be between 0 and 7")
        select = spi_args.get("select_pin", 7 if spi_args.get("device") == 1 else 8)
        super().__init__({
            "clock": spi_args.get("clock_pin", 11),
            "mosi": spi_args.get("mosi_pin", 10),
            "miso": spi_args.get("miso_pin", 9),
            "select": select,
        })
        _board.devices[self._zp_id]["channel"] = channel
        self.channel = channel
        self.differential = differential
        self.max_voltage = max_voltage
        self.bits = 10
        self._analog = max(0.0, min(1.0, float((_board.analog or {}).get(str(channel), 0.5))))
        _board.record(self._zp_id, round(self._analog, 3))

    def _zp_matches(self, e):
        return "analog" in e and int(e.get("channel", 0)) == self.channel

    def _zp_input(self, e):
        self._analog = max(0.0, min(1.0, float(e["analog"])))
        _board.record(self._zp_id, round(self._analog, 3))

    def _zp_now(self):
        return self._analog

    @property
    def value(self):
        _board.advance(_board.now + _POLL)
        return self._analog

    @property
    def voltage(self):
        return self.value * self.max_voltage

    @property
    def raw_value(self):
        return int(round(self.value * 1023))

    def __repr__(self):
        return f"<gpiozero.MCP3008 object using pins 11, 10, 9, {_board.devices[self._zp_id]['pins']['select']} channel {self.channel}>"


class Motor(_Device):
    """A DC motor on a motor controller (H-bridge): value -1 (full backward) to 1 (full forward)."""

    _zp_kind = "Motor"

    def __init__(self, forward=None, backward=None, *, enable=None, pwm=True, pin_factory=None):
        if forward is None or backward is None:
            raise GPIODeviceError("forward and backward pins must be provided")
        super().__init__({"forward": forward, "backward": backward, "enable": enable})
        self.pwm = pwm
        self._value = 0.0
        _board.record(self._zp_id, 0)

    def _set(self, value):
        value = round(float(value), 3)
        if value != self._value:
            self._value = value
            _board.record(self._zp_id, value)

    def _zp_now(self):
        return self._value

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, v):
        if not -1 <= v <= 1:
            raise ValueError("Motor value must be between -1 and 1")
        if not self.pwm and v not in (-1, 0, 1):
            raise ValueError("Motor value must be -1, 0 or 1 with non-PWM Motors")
        self._set(v)

    @property
    def is_active(self):
        return self._value != 0

    def forward(self, speed=1):
        if not 0 <= speed <= 1:
            raise ValueError("forward speed must be between 0 and 1")
        if not self.pwm and speed not in (0, 1):
            raise ValueError("forward speed must be 0 or 1 with non-PWM Motors")
        self._set(speed)

    def backward(self, speed=1):
        if not 0 <= speed <= 1:
            raise ValueError("backward speed must be between 0 and 1")
        if not self.pwm and speed not in (0, 1):
            raise ValueError("backward speed must be 0 or 1 with non-PWM Motors")
        self._set(-speed)

    def reverse(self):
        self._set(-self._value)

    def stop(self):
        self._set(0)


RobotValue = collections.namedtuple("RobotValue", ["left_motor", "right_motor"])


class Robot:
    """Two motors: a robot with a wheel on the left and one on the right."""

    def __init__(self, left=None, right=None, *, pwm=True, pin_factory=None):
        def motor(m, side):
            if isinstance(m, Motor):
                return m
            if isinstance(m, tuple) and len(m) == 2:
                return Motor(*m, pwm=pwm)
            raise GPIODeviceError(f"{side} must be a Motor, for example Robot(left=Motor(4, 14), right=Motor(17, 18))")

        self.left_motor = motor(left, "left")
        self.right_motor = motor(right, "right")
        self._zp_id = len(_board.devices)
        _board.devices.append({"id": self._zp_id, "kind": "Robot", "pins": {},
                               "left": self.left_motor._zp_id, "right": self.right_motor._zp_id})

    @staticmethod
    def _curve(name, value):
        if not 0 <= value <= 1:
            raise ValueError(f"{name} must be between 0 and 1")

    def forward(self, speed=1, *, curve_left=0, curve_right=0):
        self._curve("curve_left", curve_left)
        self._curve("curve_right", curve_right)
        if curve_left and curve_right:
            raise ValueError("curve_left and curve_right can't be used at the same time")
        self.left_motor.forward(speed * (1 - curve_left))
        self.right_motor.forward(speed * (1 - curve_right))

    def backward(self, speed=1, *, curve_left=0, curve_right=0):
        self._curve("curve_left", curve_left)
        self._curve("curve_right", curve_right)
        if curve_left and curve_right:
            raise ValueError("curve_left and curve_right can't be used at the same time")
        self.left_motor.backward(speed * (1 - curve_left))
        self.right_motor.backward(speed * (1 - curve_right))

    def left(self, speed=1):
        self.right_motor.forward(speed)
        self.left_motor.backward(speed)

    def right(self, speed=1):
        self.left_motor.forward(speed)
        self.right_motor.backward(speed)

    def reverse(self):
        self.left_motor.reverse()
        self.right_motor.reverse()

    def stop(self):
        self.left_motor.stop()
        self.right_motor.stop()

    @property
    def value(self):
        return RobotValue(self.left_motor.value, self.right_motor.value)

    @value.setter
    def value(self, v):
        left, right = v
        self.left_motor.value = left
        self.right_motor.value = right

    @property
    def is_active(self):
        return self.left_motor.is_active or self.right_motor.is_active

    def close(self):
        self.left_motor.close()
        self.right_motor.close()

    def __repr__(self):
        return "<gpiozero.Robot object containing 2 devices: left_motor, right_motor>"


class CPUTemperature:
    """The temperature of the processor, in degrees Celsius. No wiring needed."""

    def __init__(self, sensor_file="/sys/class/thermal/thermal_zone0/temp", min_temp=0.0, max_temp=100.0, threshold=80.0, event_delay=5, pin_factory=None):
        self.min_temp = min_temp
        self.max_temp = max_temp
        self.threshold = threshold
        if not any(d["kind"] == "CPUTemperature" for d in _board.devices):
            _board.devices.append({"id": len(_board.devices), "kind": "CPUTemperature", "pins": {}})
        self._zp_id = next(d["id"] for d in _board.devices if d["kind"] == "CPUTemperature")
        _board.record(self._zp_id, _board.cpu)

    @property
    def temperature(self):
        return _board.cpu

    @property
    def value(self):
        return (_board.cpu - self.min_temp) / (self.max_temp - self.min_temp)

    @property
    def is_active(self):
        return _board.cpu > self.threshold

    def close(self):
        pass

    def __repr__(self):
        return f"<gpiozero.CPUTemperature temperature={_board.cpu:.2f}>"


# ---- the module, time and pause ---------------------------------------------------
def _sleep(seconds):
    if seconds < 0:
        raise ValueError("sleep length must be non-negative")
    _board.advance(_board.now + float(seconds))


def _pause():
    """Waits for events (the callbacks run), until there are none left."""
    _board.idle()


def _make_gpiozero():
    module = types.ModuleType("gpiozero")
    for name, value in {
        "LED": LED,
        "PWMLED": PWMLED,
        "Buzzer": Buzzer,
        "Button": Button,
        "MotionSensor": MotionSensor,
        "DistanceSensor": DistanceSensor,
        "CPUTemperature": CPUTemperature,
        "TrafficLights": TrafficLights,
        "LightSensor": LightSensor,
        "MCP3008": MCP3008,
        "Motor": Motor,
        "Robot": Robot,
        "SPIError": SPIError,
        "SPIBadChannel": SPIBadChannel,
        "GPIOZeroError": GPIOZeroError,
        "GPIODeviceError": GPIODeviceError,
        "GPIOPinInUse": GPIOPinInUse,
        "PinInvalidPin": PinInvalidPin,
        "GPIODeviceClosed": GPIODeviceClosed,
    }.items():
        setattr(module, name, value)
    exc = types.ModuleType("gpiozero.exc")
    for name in ("GPIOZeroError", "GPIODeviceError", "GPIOPinInUse", "PinInvalidPin", "GPIODeviceClosed", "SPIError", "SPIBadChannel"):
        setattr(exc, name, getattr(module, name))
    module.exc = exc
    sys.modules["gpiozero"] = module
    sys.modules["gpiozero.exc"] = exc


class _GpioHook:
    """Called by harness.py around each run of a case."""

    name = "gpio"

    def start(self, case):
        global _board, _objects
        _board = _Board(case)
        _objects = []
        _make_gpiozero()
        self.saved = (time.sleep, getattr(signal, "pause", None))
        time.sleep = _sleep
        signal.pause = _pause

    def end(self, exc):
        if isinstance(exc, _SimEnd):
            _board.end = {"t": round(_board.now, 3), "why": exc.why}
        elif _board.end is None:
            # The program ended: background blinks would go on with it on a real Pi,
            # but the program is over, so the pins stay as they are.
            _board.end = {"t": round(_board.now, 3), "why": "done"}

    def finish(self):
        time.sleep, saved_pause = self.saved
        if saved_pause is not None:
            signal.pause = saved_pause
        if not _board.devices:
            return None
        return _board.result()

    def env(self, data):
        data = data or {"devices": [], "timeline": [], "inputs": [], "end": {"t": 0, "why": "done"}}
        devices = data["devices"]

        def dev_ids(pin):
            return [d["id"] for d in devices if pin in d["pins"].values()]

        def history(pin):
            ids = dev_ids(pin)
            return [(e["t"], e["value"]) for e in data["timeline"] if e["id"] in ids]

        def at(pin, t):
            value = 0
            for when, v in history(pin):
                if when <= t + 1e-9:
                    value = v
            return value

        def turned_on(pin):
            times, last = [], 0
            for when, v in history(pin):
                if v and not last:
                    times.append(when)
                last = v
            return times

        def on_for(pin, until=None):
            end = data["end"]["t"] if until is None else until
            total, since = 0.0, None
            for when, v in history(pin) + [(end, None)]:
                if when > end:
                    when = end
                if since is not None:
                    total += when - since
                    since = None
                if v:
                    since = when
            return round(total, 3)

        def flashes(pin):
            """Each time the output was on: (start, seconds on), rounded to 0.01 s."""
            out, since = [], None
            for when, v in history(pin) + [(data["end"]["t"], 0)]:
                if v and since is None:
                    since = when
                elif not v and since is not None:
                    out.append((round(since, 2), round(when - since, 2)))
                    since = None
            return out

        def presses(pin):
            return [float(e["at"]) for e in data.get("inputs", []) if e.get("pin") == pin and e.get("press")]

        def device(pin):
            ids = dev_ids(pin)
            return devices[ids[0]]["kind"] if ids else None

        def value_of(dev_id, t):
            value = 0
            for e in data["timeline"]:
                if e["id"] == dev_id and e["t"] <= t + 1e-9:
                    value = e["value"]
            return value

        def robot_at(t):
            """The speeds (left, right) of the robot at time t."""
            robot = next((d for d in devices if d["kind"] == "Robot"), None)
            if robot is None:
                return None
            return (value_of(robot["left"], t), value_of(robot["right"], t))

        return {
            "gpio": data,
            "history": history,
            "at": at,
            "turned_on": turned_on,
            "on_for": on_for,
            "presses": presses,
            "flashes": flashes,
            "cpu": data.get("cpu"),
            "device": device,
            "robot_at": robot_at,
            "kinds": [d["kind"] for d in devices],
            "end_time": data["end"]["t"],
            "ended": data["end"]["why"],
        }


_RUN_HOOKS.append(_GpioHook())  # noqa: F821 (harness.py)
