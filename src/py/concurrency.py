# Pretend threads and asyncio for the concurrency lesson. Loaded after
# harness.py and gpio.py, in the same namespace.
#
# The Python of the browser (Pyodide) cannot start threads, and asyncio.run()
# cannot run inside the harness. Programs that wait (for a download, a slow
# server) still behave as on a real computer here, on a simulated clock:
#
# - time.sleep() and asyncio.sleep() do not wait. They move the clock.
# - time.perf_counter(), time.monotonic() and time.time() are the real clock
#   plus the simulated waiting, so timing code shows the real effect.
# - threading.Thread and concurrent.futures.ThreadPoolExecutor run each task
#   at once, one after the other, but on its own clock that starts when the
#   task would start. join(), result() and the end of a `with` block move the
#   main clock to the end of the task, as a real wait would. The results and
#   the times are those of real threads; only prints inside tasks may come in
#   another order than on a real computer (there the order is not fixed).
# - asyncio.run() uses a small event loop on the same clock, so the order of
#   events is exact. A time.sleep() inside a coroutine blocks every task, as
#   it does in real asyncio.
import asyncio
import asyncio.base_events
import concurrent.futures
import heapq
import threading
import time


class _CcClock:
    def __init__(self):
        self.offset = 0.0  # simulated seconds of the main program
        self.task = None  # the running pretend task: its own clock
        self.threads = 0
        self.pools = 0
        self.async_runs = 0
        self.peak = 0  # the most tasks waiting at the same time

    def now(self):
        return self.task.clock if self.task is not None else self.offset

    def wait(self, seconds):
        if self.task is not None:
            self.task.clock += seconds
            return
        self.offset += seconds
        # The sleep that was there before (gpio.py: the Pi's clock, which also
        # ends a program quietly after 30 simulated seconds) still runs.
        if _cc_before_sleep is not None:
            _cc_before_sleep(seconds)

    def until(self, t):
        """The main program waits until simulated time t."""
        if self.task is None and t > self.offset:
            self.wait(t - self.offset)


_cc = _CcClock()
_cc_real = {}
_cc_before_sleep = None


def _cc_sleep(seconds):
    if seconds < 0:
        raise ValueError("sleep length must be non-negative")
    _cc.wait(float(seconds))


def _cc_perf_counter():
    return _cc_real["perf_counter"]() + _cc.now()


def _cc_monotonic():
    return _cc_real["monotonic"]() + _cc.now()


def _cc_time():
    return _cc_real["time"]() + _cc.now()


class _CcTask:
    """The clock of one pretend thread or pool task."""

    def __init__(self, start):
        self.start = start
        self.clock = start
        self.end = start


def _cc_run_task(start, fn, args, kwargs):
    task = _CcTask(start)
    outer, _cc.task = _cc.task, task
    t0 = _cc_real["perf_counter"]()
    try:
        return task, fn(*args, **kwargs), None
    except BaseException as exc:  # noqa: BLE001 - kept for result() / join()
        if not isinstance(exc, Exception):
            raise
        return task, None, exc
    finally:
        # The task's own work (not only its waiting) takes time too.
        task.clock += _cc_real["perf_counter"]() - t0
        task.end = task.clock
        _cc.task = outer


class _CcThread:
    """threading.Thread, run on its own clock (see the top of this file)."""

    def __init__(self, group=None, target=None, name=None, args=(), kwargs=None, *, daemon=None):
        self._target = target
        self._args = tuple(args)
        self._kwargs = dict(kwargs or {})
        self.name = name or f"Thread-{_cc.threads + 1}"
        self.daemon = bool(daemon)
        self._task = None

    def run(self):
        if self._target is not None:
            self._target(*self._args, **self._kwargs)

    def start(self):
        if self._task is not None:
            raise RuntimeError("threads can only be started once")
        _cc.threads += 1
        task, _, exc = _cc_run_task(_cc.now(), self.run, (), {})
        self._task = task
        _cc_note_peak([t for t in _cc_open if t.end > _cc.now()] + [task])
        _cc_open.append(task)
        if exc is not None:
            # A real thread prints its error and dies; the program goes on.
            import traceback
            print(f"Exception in thread {self.name}:")
            traceback.print_exception(exc)

    def join(self, timeout=None):
        if self._task is None:
            raise RuntimeError("cannot join thread before it is started")
        end = self._task.end
        if timeout is not None:
            end = min(end, _cc.now() + timeout)
        _cc.until(end)

    def is_alive(self):
        return self._task is not None and self._task.end > _cc.now()

    def __repr__(self):
        return f"<Thread({self.name}, {'started' if self._task else 'initial'})>"


_cc_open = []  # tasks of this run, for the peak count


def _cc_note_peak(tasks):
    _cc.peak = max(_cc.peak, len(tasks))


class _CcFuture(concurrent.futures.Future):
    def __init__(self, task):
        super().__init__()
        self._cc_task = task

    def result(self, timeout=None):
        _cc.until(self._cc_task.end)
        return super().result(timeout)

    def exception(self, timeout=None):
        _cc.until(self._cc_task.end)
        return super().exception(timeout)

    def done(self):
        return self._cc_task.end <= _cc.now()

    def running(self):
        return self._cc_task.start <= _cc.now() < self._cc_task.end


class _CcPool:
    """concurrent.futures.ThreadPoolExecutor, run on pretend clocks."""

    def __init__(self, max_workers=None, thread_name_prefix="", initializer=None, initargs=()):
        if max_workers is not None and max_workers <= 0:
            raise ValueError("max_workers must be greater than 0")
        self._max = max_workers or 5
        self._free = [_cc.now()] * self._max  # when each worker is free again
        self._tasks = []
        self._shut = False
        self._init = (initializer, tuple(initargs))
        _cc.pools += 1

    def submit(self, fn, /, *args, **kwargs):
        if self._shut:
            raise RuntimeError("cannot schedule new futures after shutdown")
        free = heapq.heappop(self._free)
        start = max(_cc.now(), free)
        task, value, exc = _cc_run_task(start, fn, args, kwargs)
        heapq.heappush(self._free, task.end)
        self._tasks.append(task)
        _cc_note_peak([t for t in self._tasks if t.start <= start < t.end or t is task])
        future = _CcFuture(task)
        if exc is None:
            future.set_result(value)
        else:
            future.set_exception(exc)
        return future

    def map(self, fn, *iterables, timeout=None, chunksize=1):
        futures = [self.submit(fn, *args) for args in zip(*iterables)]

        def results():
            for f in futures:
                yield f.result()

        return results()

    def shutdown(self, wait=True, *, cancel_futures=False):
        self._shut = True
        if wait and self._tasks:
            _cc.until(max(t.end for t in self._tasks))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.shutdown(wait=True)
        return False


def _cc_as_completed(fs, timeout=None):
    fs = list(fs)
    pretend = sorted((f for f in fs if isinstance(f, _CcFuture)), key=lambda f: f._cc_task.end)
    others = [f for f in fs if not isinstance(f, _CcFuture)]
    for f in others:
        yield f
    for f in pretend:
        _cc.until(f._cc_task.end)
        yield f


def _cc_wait(fs, timeout=None, return_when=concurrent.futures.ALL_COMPLETED):
    fs = list(fs)
    ends = [f._cc_task.end for f in fs if isinstance(f, _CcFuture)]
    if ends:
        _cc.until(min(ends) if return_when == concurrent.futures.FIRST_COMPLETED else max(ends))
    done = {f for f in fs if f.done()}
    return concurrent.futures._base.DoneAndNotDoneFutures(done, set(fs) - done)


class _CcSelector:
    """The 'wait for events' of the loop: here, it lets time pass."""

    def __init__(self, loop):
        self.loop = loop

    def select(self, timeout=None):
        if timeout is None:
            raise RuntimeError("the program waits for something that never comes (no task will ever wake up)")
        if timeout > 0:
            _cc.wait(timeout)
        return []

    def close(self):
        pass


class _CcLoop(asyncio.base_events.BaseEventLoop):
    """An asyncio event loop on the simulated clock."""

    def __init__(self):
        super().__init__()
        self._selector = _CcSelector(self)

    def time(self):
        return _cc_monotonic()

    def _process_events(self, event_list):
        pass

    def _write_to_self(self):
        pass

    def close(self):
        super().close()


def _cc_asyncio_run(main, *, debug=None, loop_factory=None):
    _cc.async_runs += 1
    # Pyodide's own loop of the browser counts as running; asyncio.run()
    # refuses to start inside it. Set it aside for this run.
    outer = asyncio.events._get_running_loop()
    asyncio.events._set_running_loop(None)
    try:
        return _cc_real["asyncio.run"](main, debug=debug, loop_factory=_CcLoop)
    finally:
        asyncio.events._set_running_loop(outer)


class _ConcurrencyHook:
    """Called by harness.py around each run of a case."""

    name = "concurrency"

    def start(self, case):
        global _cc, _cc_open, _cc_before_sleep
        _cc = _CcClock()
        _cc_open = []
        _cc_before_sleep = time.sleep
        if not _cc_real:
            _cc_real.update({
                "perf_counter": time.perf_counter,
                "monotonic": time.monotonic,
                "time": time.time,
                "asyncio.run": asyncio.run,
                "Thread": threading.Thread,
                "Pool": concurrent.futures.ThreadPoolExecutor,
                "as_completed": concurrent.futures.as_completed,
                "wait": concurrent.futures.wait,
            })
        # gpio.py set its own sleep; ours keeps its clock in step (see wait()).
        self.saved_sleep = time.sleep
        time.sleep = _cc_sleep
        time.perf_counter = _cc_perf_counter
        time.monotonic = _cc_monotonic
        time.time = _cc_time
        asyncio.run = _cc_asyncio_run
        threading.Thread = _CcThread
        concurrent.futures.ThreadPoolExecutor = _CcPool
        concurrent.futures.as_completed = _cc_as_completed
        concurrent.futures.wait = _cc_wait

    def end(self, exc):
        pass

    def finish(self):
        time.sleep = self.saved_sleep
        time.perf_counter = _cc_real["perf_counter"]
        time.monotonic = _cc_real["monotonic"]
        time.time = _cc_real["time"]
        asyncio.run = _cc_real["asyncio.run"]
        threading.Thread = _cc_real["Thread"]
        concurrent.futures.ThreadPoolExecutor = _cc_real["Pool"]
        concurrent.futures.as_completed = _cc_real["as_completed"]
        concurrent.futures.wait = _cc_real["wait"]
        if not (_cc.threads or _cc.pools or _cc.async_runs):
            return None  # helpers for checks only when the program used them
        return {
            "waited": round(_cc.offset, 3),
            "threads": _cc.threads,
            "pools": _cc.pools,
            "async_runs": _cc.async_runs,
            "peak": _cc.peak,
        }

    def env(self, data):
        # For checks: the simulated seconds the program waited in all, and
        # what it used.
        return {
            "waited": data["waited"],
            "threads_started": data["threads"],
            "pools_used": data["pools"],
            "async_runs": data["async_runs"],
            "most_at_once": data["peak"],
        }


_RUN_HOOKS.append(_ConcurrencyHook())  # noqa: F821 (harness.py)
