"""ZeroPy harness: runs learner code and reports what happened.

Loaded once into Pyodide (browser worker) and into Node by
scripts/check-content.mjs. Entry point: run(request_json) -> result_json.
"""
import ast
import builtins
import copy
import io
import json
import importlib
import linecache
import os
import random
import reprlib
import shutil
import sys
import traceback
import types
import urllib.parse
_json_module = json  # _request() has a parameter called json, like requests
from contextlib import redirect_stderr, redirect_stdout

_FILE = "main.py"
# No __pycache__ folders next to the learner's files.
sys.dont_write_bytecode = True
_MAX_STEPS = 400  # trace steps that are recorded for the stepper
_MAX_LINES = 100_000  # lines a program may run before it is stopped
# Extensions (gpio.py) add hooks: start(case) before a run, end(exc) after it,
# finish() for the data of the run, env(data) for the checks. An exception
# with `_zp_quiet` ends a run without an error (a simulation that is over).
_RUN_HOOKS = []
_MAX_OUTPUT = 20_000  # characters a program may print
_MAX_FEED = 40  # values of a for-loop that the stepper can show
_MAX_ITEMS = 10  # values of a list that the stepper can show
_HIDDEN_TYPES = ("module", "function", "type", "builtin_function_or_method")

class _ShortRepr(reprlib.Repr):
    """reprlib, but an object of the learner without its own __repr__ is
    "<Dog object>", also inside a list or as an attribute."""

    def repr_instance(self, x, level):
        if getattr(type(x), "__module__", "") == "__main__" and hasattr(x, "__dict__") and type(x).__repr__ is object.__repr__:
            return f"<{type(x).__name__} object>"
        return super().repr_instance(x, level)

    def repr_dict(self, x, level):
        """Like print: the keys in the order they were added (reprlib sorts them)."""
        if not x:
            return "{}"
        if level <= 0:
            return "{...}"
        pieces = [f"{self.repr1(k, level - 1)}: {self.repr1(x[k], level - 1)}" for k in list(x)[: self.maxdict]]
        if len(x) > self.maxdict:
            pieces.append("...")
        return "{" + ", ".join(pieces) + "}"


_repr = _ShortRepr()
_repr.maxstring = 28
_repr.maxother = 28
_repr.maxlist = 4
_repr.maxdict = 3


class _Stopped(BaseException):
    """The program ran too long or printed too much. Most often an endless loop."""


class _Out(io.StringIO):
    def write(self, text):
        if self.tell() > _MAX_OUTPUT:
            raise _Stopped("The program printed too much text.")
        return super().write(text)


class _NeedInput(EOFError):
    """input() was called and no answer is left. The page then asks the learner."""


def _user_object(value):
    """An object of a class that the learner wrote (not a class itself)."""
    return getattr(type(value), "__module__", "") == "__main__" and hasattr(value, "__dict__") and not isinstance(value, type)


def _show(value):
    """The short text of a value in the picture. An object without its own
    __repr__ is "<Dog object>", not "<__main__.Dog object at 0x7f...>"."""
    if _user_object(value) and type(value).__repr__ is object.__repr__:
        return f"<{type(value).__name__} object>"
    return _repr.repr(value)


def _parts(value, names):
    """An attribute that holds objects, as the picture writes it: the names
    of the objects that have one ("[tea, cake]"), else "<Item>". It shows
    that the big object holds the same objects, not copies."""
    if not isinstance(value, (list, tuple)) or not any(_user_object(v) for v in value):
        return None
    shown = [names.get(id(v)) or (f"<{type(v).__name__}>" if _user_object(v) else _repr.repr(v)) for v in value[:4]]
    more = ", ..." if len(value) > 4 else ""
    return "[" + ", ".join(shown) + more + "]"


def _snapshot(ns, outer=None):
    items = []
    # Objects that have a name here (or outside, for a function call), to
    # show them by name inside other objects.
    names = {}
    for scope in (outer or {}, ns):
        for name, value in scope.items():
            if not name.startswith("_") and _user_object(value):
                names.setdefault(id(value), name)
    for name, value in ns.items():
        if name.startswith("_"):
            continue
        type_name = type(value).__name__
        if type_name in _HIDDEN_TYPES:
            continue
        try:
            text = _show(value)
        except Exception:
            text = "<?>"
        entry = {"name": name, "type": type_name, "repr": text}
        if isinstance(value, list):
            # The picture shows a list as numbered places with one value each.
            entry["size"] = len(value)
            entry["items"] = [{"repr": _show(v), "type": type(v).__name__} for v in value[:_MAX_ITEMS]]
            # Two names with the same ref are two names for one list.
            entry["ref"] = str(id(value))
        elif isinstance(value, dict):
            # A dictionary: places that have a key instead of a number.
            entry["size"] = len(value)
            entry["items"] = [
                {"repr": _show(v), "type": type(v).__name__, "key": _repr.repr(k)}
                for k, v in list(value.items())[:_MAX_ITEMS]
            ]
            entry["ref"] = str(id(value))
        elif isinstance(value, (tuple, set, frozenset)):
            # A tuple: numbered places that cannot change. A set: values
            # without order. Its values are drawn sorted, so the picture is
            # the same in every run.
            values = list(value)
            if not isinstance(value, tuple):
                values.sort(key=repr)
            entry["size"] = len(value)
            entry["items"] = [{"repr": _show(v), "type": type(v).__name__} for v in values[:_MAX_ITEMS]]
            entry["ref"] = str(id(value))
        elif _user_object(value):
            # An object: places named by its attributes, like a dictionary
            # with names instead of keys. Two names with one ref are one object.
            attrs = list(vars(value).items())
            entry["object"] = True
            entry["size"] = len(attrs)
            entry["items"] = [
                {"repr": _parts(v, names) or _show(v), "type": type(v).__name__, "key": k} for k, v in attrs[:_MAX_ITEMS]
            ]
            entry["ref"] = str(id(value))
        items.append(entry)
    return items


def _frozen(value):
    try:
        return copy.deepcopy(value)
    except Exception:
        return value


# The browser Python numbers some file errors in another way than Python on a
# computer ("[Errno 44]" for a missing file). Show the numbers that learners
# will see on their own machine.
_ERRNO = {"[Errno 44]": "[Errno 2]", "[Errno 20]": "[Errno 17]", "[Errno 31]": "[Errno 21]", "[Errno 54]": "[Errno 20]"}


def _real_errno(text):
    for wasm, real in _ERRNO.items():
        if text.startswith(wasm) or f": {wasm}" in text:
            return text.replace(wasm, real, 1)
    return text


def _rel(name):
    """The name of a learner's file as the learner sees it: models.py, not
    /home/learner-2/models.py. Other names stay as they are."""
    if name and name.startswith(_HOME):
        rest = name[len(_HOME):]
        return rest.split("/", 1)[1] if "/" in rest else rest
    return name


def _own_frames(exc):
    """The frames of the learner's files (main.py and the files in the folder),
    with short file names."""
    frames = []
    for f in traceback.extract_tb(exc.__traceback__):
        if f.filename == _FILE or (f.filename or "").startswith(_HOME):
            _ = f.line  # read the line while the full path still finds it
            f.filename = _rel(f.filename)
            frames.append(f)
    return frames


def _describe(exc):
    """Short, real traceback that shows only the learner's files.
    "line" is the last line of main.py in it; "at" is where the error really
    happened, also in another file of the learner (a module of a project)."""
    line = None
    at = None
    if isinstance(exc, _Stopped):
        frames = _own_frames(exc)
        main = [f for f in frames if f.filename == _FILE]
        return {
            "type": "Timeout",
            "message": str(exc),
            "line": main[-1].lineno if main else None,
            "at": {"file": frames[-1].filename, "line": frames[-1].lineno} if frames else None,
            "traceback": f"Stopped: {exc} Python did not reach the end of the program.",
            "needsInput": False,
        }
    if isinstance(exc, SyntaxError):
        name = _rel(exc.filename) if exc.filename else _FILE
        line = exc.lineno if name == _FILE else None
        at = {"file": name, "line": exc.lineno}
        message = exc.msg or str(exc)
        text = "".join(traceback.format_exception_only(type(exc), exc))
        if exc.filename and name != exc.filename:
            text = text.replace(exc.filename, name)
    else:
        frames = _own_frames(exc)
        main = [f for f in frames if f.filename == _FILE]
        if main:
            line = main[-1].lineno
        if frames:
            at = {"file": frames[-1].filename, "line": frames[-1].lineno}
        message = str(exc)
        text = "".join(
            ["Traceback (most recent call last):\n"]
            + traceback.format_list(frames)
            + traceback.format_exception_only(type(exc), exc)
        )
    needs_input = isinstance(exc, _NeedInput)
    if isinstance(exc, OSError):
        message, text = _real_errno(message), _real_errno(text)
    return {
        "type": "EOFError" if needs_input else type(exc).__name__,
        "message": message,
        "line": line,
        "at": at,
        "traceback": text.rstrip().replace("_NeedInput", "EOFError"),
        "needsInput": needs_input,
    }


class _FeedWrap(ast.NodeTransformer):
    """Wraps the values of every `for` loop: `for x in __zp_feed(line, values)`.

    The stepper uses this to show the values that wait for the loop variable.
    """

    def visit_For(self, node):
        self.generic_visit(node)
        call = ast.Call(
            func=ast.Name(id="__zp_feed", ctx=ast.Load()),
            args=[ast.Constant(node.lineno), node.iter],
            keywords=[],
        )
        node.iter = ast.copy_location(call, node.iter)
        return node


class _Override(ast.NodeTransformer):
    """Replaces the first top-level `name = ...` with a given constant."""

    def __init__(self, values):
        self.values = dict(values)

    def visit_Module(self, node):
        for stmt in node.body:
            if (
                isinstance(stmt, ast.Assign)
                and len(stmt.targets) == 1
                and isinstance(stmt.targets[0], ast.Name)
                and stmt.targets[0].id in self.values
            ):
                value = self.values.pop(stmt.targets[0].id)
                # A list or a dict is not a constant: build it from its text.
                if isinstance(value, (list, dict, tuple, set)):
                    new = ast.parse(repr(value), mode="eval").body
                else:
                    new = ast.Constant(value)
                stmt.value = ast.copy_location(new, stmt.value)
        return node


_HOME = "/home/learner"
_MAX_FILES = 12
_MAX_FILE_CHARS = 4000


def _folder(index, files):
    """A fresh, empty folder for one case, with the starting files of the case.
    Every run starts the same, also when an earlier run wrote files."""
    path = _HOME if index == 0 else f"{_HOME}-{index + 1}"
    # Forget the learner's own modules of earlier runs (helpers.py, a package):
    # an import must read the file as it is now, not the copy Python keeps.
    for name, module in list(sys.modules.items()):
        if (getattr(module, "__file__", None) or "").startswith(_HOME):
            del sys.modules[name]
    # A file of the case with the name of a module (random.py) hides that
    # module, as on a real computer: the folder of the program comes first.
    own = {p.split("/")[0][:-3] if p.split("/")[0].endswith(".py") else p.split("/")[0] for p in (files or {})}
    for name in list(sys.modules):
        if name.split(".")[0] in own:
            del sys.modules[name]
    importlib.invalidate_caches()
    shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path)
    for name, text in (files or {}).items():
        target = os.path.join(path, name)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as handle:
            handle.write(text)
    return path


def _enter(path):
    """Makes `path` the working folder, also when the program deleted it.
    The home folder of the run (Path.home()) is its subfolder `home`: apart
    from the working folder, so a lesson can show where a program saves."""
    os.makedirs(path, exist_ok=True)
    os.chdir(path)
    home = os.path.join(path, "home")
    os.makedirs(home, exist_ok=True)
    os.environ["HOME"] = home


def _files_in(path):
    """The text files in a folder after the run: {"notes.txt": "..."}."""
    found = {}
    for root, dirs, names in os.walk(path):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for name in sorted(names):
            if len(found) >= _MAX_FILES:
                return found
            full = os.path.join(root, name)
            rel = os.path.relpath(full, path).replace(os.sep, "/")
            try:
                with open(full, "rb") as handle:
                    raw = handle.read(_MAX_FILE_CHARS * 4 + 4)
                try:
                    text = raw.decode("utf-8")
                except UnicodeDecodeError as exc:
                    # A long text file can be cut in the middle of a letter.
                    text = raw[: exc.start].decode("utf-8") if exc.start >= len(raw) - 3 else None
                found[rel] = text[: _MAX_FILE_CHARS + 1] if text is not None else f"(binary file, {os.path.getsize(full)} bytes)"
            except OSError:
                found[rel] = ""
    return found


# ---------- The pretend web ----------
# Python in the page has no real network. `import requests` gives this small
# copy of the requests library instead. Each case says which URL gives which
# answer ("web"), so a lesson can test a success, a 404, a timeout and a lost
# connection on purpose. Every request is logged for the checks.


class _Web:
    routes = {}
    log = []

    def use(self, routes, log):
        self.routes = routes or {}
        self.log = log


_web = _Web()
# Functions that may answer a request for this computer (127.0.0.1) from an
# app of the same program (server.py). Each returns a _Response or None.
_LOCAL_SERVERS = []


def _split_url(url):
    base, _, query = url.partition("?")
    return base, {k: v[-1] for k, v in urllib.parse.parse_qs(query, keep_blank_values=True).items()}


def _route_for(base, params):
    """The answer whose URL matches best: same address, and all parameters of
    the key are in the request. A key without parameters matches any."""
    best, best_size = None, -1
    for key, route in _web.routes.items():
        key_base, key_params = _split_url(key)
        if key_base == base and key_params.items() <= params.items() and len(key_params) > best_size:
            best, best_size = route, len(key_params)
    return best


class _RequestException(OSError):
    def __init__(self, *args, response=None, request=None):
        super().__init__(*args)
        self.response = response
        self.request = request


def _exception(name, *bases):
    cls = type(name, bases, {})
    cls.__module__ = "requests.exceptions"
    cls.__qualname__ = name
    return cls


_RequestException.__module__ = "requests.exceptions"
_RequestException.__name__ = _RequestException.__qualname__ = "RequestException"
_ConnectionError = _exception("ConnectionError", _RequestException)
_HTTPError = _exception("HTTPError", _RequestException)
_Timeout = _exception("Timeout", _RequestException)
_ReadTimeout = _exception("ReadTimeout", _Timeout)
_ConnectTimeout = _exception("ConnectTimeout", _ConnectionError, _Timeout)
_JSONDecodeError = _exception("JSONDecodeError", _RequestException, ValueError)

_REASONS = {200: "OK", 201: "Created", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
            404: "Not Found", 429: "Too Many Requests", 500: "Internal Server Error", 503: "Service Unavailable"}


class _Response:
    def __init__(self, url, status, text):
        self.url = url
        self.status_code = status
        self.reason = _REASONS.get(status, "")
        self.ok = status < 400
        self.text = text
        self.headers = {"Content-Type": "application/json"}

    def json(self):
        try:
            return json.loads(self.text)
        except ValueError as exc:
            raise _JSONDecodeError(f"Expecting value: line 1 column 1 (char 0)", response=self) from None

    def raise_for_status(self):
        if 400 <= self.status_code:
            kind = "Client" if self.status_code < 500 else "Server"
            raise _HTTPError(f"{self.status_code} {kind} Error: {self.reason} for url: {self.url}", response=self)

    def __repr__(self):
        return f"<Response [{self.status_code}]>"


def _request(method, url, params=None, timeout=None, data=None, json=None, **kwargs):
    json_body = json
    json = _json_module
    base, params_in_url = _split_url(str(url))
    all_params = dict(params_in_url)
    if isinstance(params, (str, bytes)):
        params = _split_url("?" + (params.decode() if isinstance(params, bytes) else params))[1]
    all_params.update({str(k): str(v) for k, v in dict(params or {}).items()})
    full = base + ("?" + urllib.parse.urlencode(all_params) if all_params else "")
    _web.log.append({"method": method, "url": full, "base": base, "params": all_params, "timeout": timeout})
    parts = urllib.parse.urlparse(full)
    host = parts.netloc or base
    path = (parts.path or "/") + ("?" + parts.query if parts.query else "")
    for serve in _LOCAL_SERVERS:
        answer = serve(method, full, all_params, data, json_body)
        if answer is not None:
            return answer
    route = _route_for(base, all_params)
    if route is None or route.get("error") == "ConnectionError":
        pool = "HTTPConnectionPool" if parts.scheme == "http" else "HTTPSConnectionPool"
        port = parts.port or (80 if parts.scheme == "http" else 443)
        raise _ConnectionError(
            f"{pool}(host='{parts.hostname or host}', port={port}): Max retries exceeded with url: {path} "
            f"(Failed to establish a new connection)"
        )
    if route.get("error") == "Timeout":
        raise _ReadTimeout(f"HTTPSConnectionPool(host='{host}', port=443): Read timed out. (read timeout={timeout})")
    if "json" in route:
        text = json.dumps(route["json"])
    else:
        text = str(route.get("text", ""))
    return _Response(full, int(route.get("status", 200)), text)


def _make_requests():
    exceptions = types.ModuleType("requests.exceptions")
    module = types.ModuleType("requests")
    module.__doc__ = "A small copy of requests for this page: it answers from a pretend web."
    for cls in (_RequestException, _ConnectionError, _HTTPError, _Timeout, _ReadTimeout, _ConnectTimeout, _JSONDecodeError):
        setattr(exceptions, cls.__name__, cls)
        setattr(module, cls.__name__, cls)
    module.exceptions = exceptions
    module.Response = _Response
    module.request = _request
    module.get = lambda url, params=None, **kwargs: _request("GET", url, params=params, **kwargs)
    module.post = lambda url, data=None, json=None, **kwargs: _request("POST", url, data=data, json=json, **kwargs)
    module.put = lambda url, data=None, json=None, **kwargs: _request("PUT", url, data=data, json=json, **kwargs)
    module.delete = lambda url, **kwargs: _request("DELETE", url, **kwargs)
    module.codes = types.SimpleNamespace(ok=200, not_found=404)
    sys.modules["requests"] = module
    sys.modules["requests.exceptions"] = exceptions


_make_requests()


# ---------- Tests, like pytest ----------
# Real pytest is not in the page. On a step with "pytest": true, the harness
# runs every function whose name starts with "test" after the program, and
# prints a short report in the style of pytest. `import pytest` gives
# raises() and approx(). Checks can run the tests again, also with a broken
# version of a function, to see if the tests catch the bug.


class _Failed(AssertionError):
    """pytest.fail() and a pytest.raises() block that raised nothing."""


_Failed.__module__ = "pytest"
_Failed.__name__ = _Failed.__qualname__ = "Failed"


class _Raises:
    def __init__(self, expected, match=None):
        self.expected = expected
        self.match = match
        self.value = None

    def __enter__(self):
        return self

    def __exit__(self, kind, value, tb):
        name = getattr(self.expected, "__name__", str(self.expected))
        if kind is None:
            raise _Failed(f"DID NOT RAISE {name}")
        if not issubclass(kind, self.expected):
            return False
        if self.match is not None:
            import re

            if not re.search(self.match, str(value)):
                raise _Failed(f"Regex pattern did not match. Regex: {self.match!r} Input: {str(value)!r}")
        self.value = value
        return True


class _Approx:
    def __init__(self, expected, rel=1e-6, abs=1e-12):
        self.expected, self.rel, self.abs = expected, rel, abs

    def __eq__(self, other):
        try:
            return abs(other - self.expected) <= max(self.rel * abs(self.expected), self.abs)
        except TypeError:
            return False

    def __repr__(self):
        return f"{self.expected} ± {self.rel * abs(self.expected):.1e}"


class _Mark:
    """pytest.mark: only parametrize does something here."""

    @staticmethod
    def parametrize(argnames, argvalues, ids=None):
        names = [n.strip() for n in argnames.split(",")] if isinstance(argnames, str) else list(argnames)

        def mark(fn):
            # The first decorator is the inner one: keep the order of the file.
            fn._zp_params = [(names, list(argvalues), ids)] + list(getattr(fn, "_zp_params", []))
            return fn

        return mark

    def __getattr__(self, name):
        # Other marks (skip, slow ...) are accepted and change nothing.
        return lambda *args, **kwargs: (args[0] if len(args) == 1 and callable(args[0]) and not kwargs else (lambda fn: fn))


def _fixture(fn=None, **kwargs):
    """@pytest.fixture or @pytest.fixture(): marks a function as a fixture."""
    def mark(f):
        f._zp_fixture = True
        return f
    return mark(fn) if callable(fn) else mark


class _CaptureResult(tuple):
    @property
    def out(self):
        return self[0]

    @property
    def err(self):
        return self[1]


class _Capsys:
    """capsys: catches what the test prints. readouterr() gives it and starts again."""

    def __init__(self):
        self._out, self._err = io.StringIO(), io.StringIO()
        self._saved = (sys.stdout, sys.stderr)
        sys.stdout, sys.stderr = self._out, self._err

    def readouterr(self):
        result = _CaptureResult((self._out.getvalue(), self._err.getvalue()))
        self._out.seek(0)
        self._out.truncate()
        self._err.seek(0)
        self._err.truncate()
        return result

    def _close(self):
        sys.stdout, sys.stderr = self._saved


class _MonkeyPatch:
    """monkeypatch: changes for one test, put back after it."""

    def __init__(self):
        self._undo = []

    def setattr(self, target, name, value=None, raising=True):
        if isinstance(target, str):
            module_name, _, attr = target.rpartition(".")
            target, name, value = importlib.import_module(module_name), attr, name
        if raising and not hasattr(target, name):
            raise AttributeError(f"{target!r} has no attribute {name!r}")
        old = getattr(target, name, None)
        had = hasattr(target, name)
        self._undo.append(lambda: setattr(target, name, old) if had else delattr(target, name))
        setattr(target, name, value)

    def setenv(self, name, value):
        old = os.environ.get(name)
        self._undo.append(lambda: os.environ.__setitem__(name, old) if old is not None else os.environ.pop(name, None))
        os.environ[name] = str(value)

    def delenv(self, name, raising=True):
        if name not in os.environ:
            if raising:
                raise KeyError(name)
            return
        old = os.environ[name]
        self._undo.append(lambda: os.environ.__setitem__(name, old))
        del os.environ[name]

    def _close(self):
        for undo in reversed(self._undo):
            undo()


class _FixtureError(Exception):
    pass


def _make_pytest():
    module = types.ModuleType("pytest")
    module.__doc__ = "A small copy of pytest for this page: raises, approx, fail, mark.parametrize and fixtures."
    module.raises = lambda expected, match=None: _Raises(expected, match)
    module.approx = _Approx

    def fail(reason=""):
        raise _Failed(reason)

    module.fail = fail
    module.Failed = _Failed
    module.mark = _Mark()
    module.fixture = _fixture
    module.MonkeyPatch = _MonkeyPatch
    sys.modules["pytest"] = module


_make_pytest()


def _tests_of(ns):
    """The test functions of the learner, in the order of the file."""
    return [(name, fn) for name, fn in list(ns.items())
            if name.startswith("test") and callable(fn) and not getattr(fn, "_zp_fixture", False)
            and getattr(getattr(fn, "__code__", None), "co_filename", "") == _FILE]


def _param_id(value, name, index):
    if isinstance(value, (int, float, str, bool)) or value is None:
        return str(value)
    return f"{name}{index}"


def _expand(file, name, fn, space):
    """One test item for each set of values of @pytest.mark.parametrize, like
    pytest: test_add[1-2-3]. Without parametrize: one item."""
    items = [(name, {})]
    for names, values, ids in getattr(fn, "_zp_params", []):
        rows = []
        for i, value in enumerate(values):
            row = tuple(value) if len(names) > 1 else (value,)
            if len(row) != len(names):
                raise _FixtureError(f"{name}: parametrize needs {len(names)} values in each set, not {len(row)}")
            label = ids[i] if ids and i < len(ids) else "-".join(_param_id(v, n, i) for n, v in zip(names, row))
            rows.append((label, dict(zip(names, row))))
        items = [
            (f"{base[:-1]}-{label}]" if base.endswith("]") else f"{base}[{label}]", {**given, **row})
            for base, given in items for label, row in rows
        ]
    return [{"file": file, "name": item, "fn": fn, "params": params, "space": space} for item, params in items]


def _arg_names(fn):
    code = getattr(fn, "__code__", None)
    if code is None:
        return []
    return list(code.co_varnames[: code.co_argcount + code.co_kwonlyargcount])


def _call_test(test, on_fail=None):
    """Calls one test with its parameters and fixtures (also fixtures that
    use fixtures, and fixtures with yield: the part after yield runs at the
    end). Built in: tmp_path, capsys, monkeypatch."""
    fn, params, space = test["fn"], test["params"], test["space"]
    values = {}
    closers = []

    def tmp_path():
        import pathlib
        safe = "".join(c if c.isalnum() or c in "_-" else "_" for c in test["name"])
        # Outside the folder of the program, like pytest's own temporary folders.
        path = pathlib.Path("/tmp/pytest-of-learner") / safe
        shutil.rmtree(path, ignore_errors=True)
        path.mkdir(parents=True)
        return path

    def capsys():
        cap = _Capsys()
        closers.append(cap._close)
        return cap

    def monkeypatch():
        patch = _MonkeyPatch()
        closers.append(patch._close)
        return patch

    built_in = {"tmp_path": tmp_path, "capsys": capsys, "monkeypatch": monkeypatch}

    def get(name, chain=()):
        if name in values:
            return values[name]
        if name in params:
            value = params[name]
        elif name in built_in:
            value = built_in[name]()
        else:
            fixture = space.get(name)
            if not (callable(fixture) and getattr(fixture, "_zp_fixture", False)):
                raise _FixtureError(f"fixture '{name}' not found")
            if name in chain:
                raise _FixtureError(f"fixture '{name}' uses itself")
            made = fixture(**{arg: get(arg, chain + (name,)) for arg in _arg_names(fixture)})
            if isinstance(made, types.GeneratorType):
                value = next(made)
                closers.append(lambda gen=made: next(gen, None))
            else:
                value = made
        values[name] = value
        return value

    try:
        fn(**{arg: get(arg) for arg in _arg_names(fn)})
    except _Stopped:
        raise
    except BaseException as exc:
        # The values of a failed assert are read now, while the fixtures
        # (a patched input, a capture) still work as in the test.
        if on_fail is not None:
            on_fail(exc)
        raise
    finally:
        for close in reversed(closers):
            close()


def _all_tests(ns):
    """Every test, as pytest finds them: (file, name, function). First the
    tests in main.py, then the tests of each test file of the learner
    (test_*.py in the working folder, in the order of their names)."""
    tests = [t for name, fn in _tests_of(ns) for t in _expand(_FILE, name, fn, ns)]
    for entry in sorted(os.listdir(".")):
        if not (entry.startswith("test_") and entry.endswith(".py")):
            continue
        module = importlib.import_module(entry[:-3])
        path = getattr(module, "__file__", "") or ""
        space = vars(module)
        tests += [t for name, fn in list(space.items())
                  if name.startswith("test") and callable(fn) and not getattr(fn, "_zp_fixture", False)
                  and getattr(getattr(fn, "__code__", None), "co_filename", "") == path
                  for t in _expand(_rel(path), name, fn, space)]
    return tests


_OPS = {ast.Eq: "==", ast.NotEq: "!=", ast.Lt: "<", ast.LtE: "<=", ast.Gt: ">", ast.GtE: ">=",
        ast.Is: "is", ast.IsNot: "is not", ast.In: "in", ast.NotIn: "not in"}


def _assert_detail(exc, src_lines, test_code=None, filename=_FILE):
    """What pytest shows under a failing test: the line of the test, and the
    values. An error inside a called function points at the line of the
    test that made the call."""
    tb = exc.__traceback__
    last = None
    in_test = None
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == filename:
            last = tb
        if tb.tb_frame.f_code is test_code:
            in_test = tb
        tb = tb.tb_next
    last = in_test or last
    line_no = last.tb_lineno if last else None
    source = src_lines[line_no - 1].strip() if line_no and line_no <= len(src_lines) else ""
    if isinstance(exc, _Failed):
        return line_no, source, f"Failed: {exc}"
    if isinstance(exc, _FixtureError):
        return line_no, source, str(exc)
    if isinstance(exc, AssertionError) and source.startswith("assert"):
        detail = "assert " + (str(exc) if str(exc) else "False")
        try:
            node = ast.parse(source).body[0]
            if isinstance(node, ast.Assert) and isinstance(node.test, ast.Compare) and len(node.test.ops) == 1:
                frame = last.tb_frame
                env = dict(frame.f_globals)
                env.update(frame.f_locals)
                left = eval(compile(ast.Expression(node.test.left), "<assert>", "eval"), env)
                right = eval(compile(ast.Expression(node.test.comparators[0]), "<assert>", "eval"), env)
                op = _OPS.get(type(node.test.ops[0]), "?")
                detail = f"assert {left!r} {op} {right!r}"
                if node.msg is not None:
                    detail = f"AssertionError: {exc}\n{detail}"
        except Exception:
            pass
        return line_no, source, detail
    return line_no, source, f"{type(exc).__name__}: {exc}"


def _run_tests(ns, src):
    """Runs the tests. Returns one result for each: name, outcome, and details."""
    lines_of = {_FILE: src.splitlines()}
    results = []
    for test in _all_tests(ns):
        file, name, fn = test["file"], test["name"], test["fn"]
        code = getattr(fn, "__code__", None)
        path = code.co_filename if code else _FILE
        if file not in lines_of:
            try:
                with open(path, encoding="utf-8") as handle:
                    lines_of[file] = handle.read().splitlines()
            except OSError:
                lines_of[file] = []
        found = []

        def on_fail(exc, src_lines=lines_of[file], code=code, path=path):
            try:
                found.append(_assert_detail(exc, src_lines, code, path))
            except _Stopped:
                raise
            except BaseException:  # the detail must never stop the report
                pass

        try:
            _call_test(test, on_fail)
            results.append({"file": file, "name": name, "outcome": "passed", "error": None})
        except _Stopped:
            raise
        except BaseException as exc:  # a test may raise anything
            line_no, source, detail = found[0] if found else _assert_detail(exc, lines_of[file], code, path)
            if isinstance(exc, _FixtureError) and code is not None:
                # Like pytest: the error is at the `def` line of the test.
                line_no = code.co_firstlineno
                source = lines_of[file][line_no - 1].strip() if line_no <= len(lines_of[file]) else ""
            outcome = "failed" if isinstance(exc, AssertionError) else "error"
            results.append({"file": file, "name": name, "outcome": "failed", "error": "FixtureError" if isinstance(exc, _FixtureError) else type(exc).__name__, "line": line_no,
                            "source": source, "detail": detail, "kind": outcome})
    return results


def _report(results):
    """The test report, in the style of pytest."""
    if not results:
        return "collected 0 items\n\nno tests ran: write functions whose names start with test_\n"
    files = []
    for r in results:
        if r.get("file", _FILE) not in files:
            files.append(r.get("file", _FILE))
    lines = [f"collected {len(results)} item{'s' if len(results) != 1 else ''}", ""]
    for file in files:
        marks = "".join("." if r["outcome"] == "passed" else "F" for r in results if r.get("file", _FILE) == file)
        lines.append(f"{file} {marks}")
    failed = [r for r in results if r["outcome"] != "passed"]
    for r in failed:
        lines += ["", f"___ {r['name']} ___", f">   {r['source']}"]
        lines += [f"E   {part}" for part in r["detail"].splitlines()]
        lines.append(f"{r.get('file', _FILE)}:{r['line']}: {r['error']}")
    passed = len(results) - len(failed)
    summary = ", ".join(part for part in (f"{len(failed)} failed" if failed else "", f"{passed} passed" if passed else "") if part)
    lines += ["", f"=== {summary} ==="]
    return "\n".join(lines) + "\n"


# ---------- A pretend tkinter ----------
# Python in the page has no windows. `import tkinter` gives this small copy.
# It keeps the widgets as data; the page draws them as HTML, and a click
# calls the command of the button through gui_event(). Checks can click and
# type too. Mistakes work as in real tkinter: a widget that is not packed is
# not shown, and command=f() calls f at once.


class _GuiState:
    def __init__(self):
        self.root = None
        self.widgets = {}
        self.next_id = 1
        self.dialogs = []
        self.home = None


class _Gui:
    state = _GuiState()


_gui = _Gui()
_gui_last = None  # the window of the last run (its first case), for clicks


class TclError(Exception):
    pass


TclError.__module__ = "_tkinter"

_OPTIONS = set(
    "text textvariable font fg bg foreground background width height padx pady anchor justify relief bd "
    "borderwidth command state wraplength cursor highlightthickness highlightbackground highlightcolor "
    "activebackground activeforeground image compound takefocus show selectmode exportselection "
    "selectbackground selectforeground disabledforeground insertbackground underline listvariable "
    "variable onvalue offvalue value orient from_ to resolution length label".split()
)


class _Var:
    _default = ""

    def __init__(self, master=None, value=None, name=None):
        self._value = self._default if value is None else self._convert(value)

    def _convert(self, value):
        return value

    def get(self):
        return self._value

    def set(self, value):
        self._value = self._convert(value)


class StringVar(_Var):
    _default = ""

    def _convert(self, value):
        return str(value)


class IntVar(_Var):
    _default = 0

    def _convert(self, value):
        return int(value)


class DoubleVar(_Var):
    _default = 0.0

    def _convert(self, value):
        return float(value)


class BooleanVar(_Var):
    _default = False

    def _convert(self, value):
        return bool(value)


class _Event:
    def __init__(self, widget, keysym=""):
        self.widget = widget
        self.keysym = keysym
        self.char = ""
        self.x = self.y = 0


class _Widget:
    _kind = "Widget"

    def __init__(self, master=None, cnf=None, **options):
        state = _gui.state
        if master is None:
            master = state.root if state.root is not None else Tk()
        self._register(state, master)
        self.configure(cnf, **options)

    def _register(self, state, master):
        self.master = master
        self._state = state
        self._order = []
        self.options = {}
        self.manager = None
        self.layout = {}
        self.bindings = {}
        self.id = state.next_id
        state.next_id += 1
        state.widgets[self.id] = self
        if master is not None:
            master._order.append(self)

    def configure(self, cnf=None, **options):
        opts = dict(cnf or {})
        opts.update(options)
        for key, value in opts.items():
            if key not in _OPTIONS:
                raise TclError(f'unknown option "-{key}"')
            self.options[key] = value

    config = configure

    def cget(self, key):
        if key == "text" and "textvariable" in self.options:
            return self.options["textvariable"].get()
        return self.options.get(key, "")

    def __getitem__(self, key):
        return self.cget(key)

    def __setitem__(self, key, value):
        self.configure(**{key: value})

    def keys(self):
        return sorted(self.options)

    def pack(self, cnf=None, **kw):
        self.manager, self.layout = "pack", {**(cnf or {}), **kw}

    def grid(self, cnf=None, **kw):
        self.manager, self.layout = "grid", {**(cnf or {}), **kw}

    def place(self, cnf=None, **kw):
        self.manager, self.layout = "place", {**(cnf or {}), **kw}

    pack_configure = pack
    grid_configure = grid

    def pack_forget(self):
        self.manager = None

    grid_forget = place_forget = grid_remove = pack_forget

    def destroy(self):
        for child in list(self._order):
            child.destroy()
        if self.master is not None and self in self.master._order:
            self.master._order.remove(self)
        self._state.widgets.pop(self.id, None)

    def winfo_children(self):
        return list(self._order)

    def bind(self, sequence=None, func=None, add=None):
        self.bindings[sequence] = func

    def focus_set(self):
        pass

    focus = focus_set

    def after(self, ms, func=None, *args):
        return "after#0"

    def update(self):
        pass

    def columnconfigure(self, index, **options):
        pass

    rowconfigure = grid_columnconfigure = grid_rowconfigure = columnconfigure

    def text_of(self):
        return str(self.cget("text"))


class Tk(_Widget):
    _kind = "Tk"

    def __init__(self, screenName=None, baseName=None, className="Tk", useTk=True, sync=False, use=None):
        state = _gui.state
        self._register(state, None)
        state.root = self
        self._title = "tk"
        self.closed = False
        self.looping = False
        self.handlers = {}

    def title(self, string=None):
        if string is None:
            return self._title
        self._title = str(string)

    wm_title = title

    def geometry(self, newGeometry=None):
        self.options["geometry"] = newGeometry

    def mainloop(self, n=0):
        # In the page, the clicks come later, one by one.
        self.looping = True

    def destroy(self):
        self.closed = True

    quit = destroy

    def protocol(self, name=None, func=None):
        self.handlers[name] = func

    def resizable(self, width=None, height=None):
        pass

    minsize = maxsize = iconbitmap = attributes = resizable


class Frame(_Widget):
    _kind = "Frame"


class Label(_Widget):
    _kind = "Label"


class Button(_Widget):
    _kind = "Button"

    def invoke(self):
        if self.options.get("state") == "disabled":
            return None
        command = self.options.get("command")
        return command() if callable(command) else None


class Entry(_Widget):
    _kind = "Entry"

    def __init__(self, master=None, cnf=None, **options):
        self._text = ""
        super().__init__(master, cnf, **options)

    def _index(self, index):
        if index in ("end", END):
            return len(self.get())
        return int(index)

    def get(self):
        var = self.options.get("textvariable")
        return var.get() if var is not None else self._text

    def _set(self, text):
        var = self.options.get("textvariable")
        if var is not None:
            var.set(text)
        else:
            self._text = text

    def insert(self, index, string):
        text = self.get()
        at = self._index(index)
        self._set(text[:at] + str(string) + text[at:])

    def delete(self, first, last=None):
        text = self.get()
        start = self._index(first)
        end = start + 1 if last is None else self._index(last)
        self._set(text[:start] + text[end:])


class Listbox(_Widget):
    _kind = "Listbox"

    def __init__(self, master=None, cnf=None, **options):
        self.items = []
        self.selected = set()
        super().__init__(master, cnf, **options)

    def _index(self, index):
        if index in ("end", END):
            return len(self.items)
        if index == "active":
            return min(self.selected) if self.selected else 0
        return int(index)

    def insert(self, index, *elements):
        at = self._index(index)
        self.items[at:at] = list(elements)

    def delete(self, first, last=None):
        start = self._index(first)
        end = start + 1 if last is None else self._index(last) + (0 if last in ("end", END) else 1)
        del self.items[start:end]
        self.selected = {i for i in self.selected if i < len(self.items)}

    def get(self, first, last=None):
        if last is None:
            return self.items[self._index(first)]
        end = self._index(last) + (0 if last in ("end", END) else 1)
        return tuple(self.items[self._index(first):end])

    def size(self):
        return len(self.items)

    def curselection(self):
        return tuple(sorted(self.selected))

    def selection_set(self, first, last=None):
        end = self._index(first) if last is None else self._index(last)
        self.selected |= set(range(self._index(first), end + 1))

    def selection_clear(self, first, last=None):
        self.selected = set()

    select_set, select_clear = selection_set, selection_clear

    def activate(self, index):
        pass

    see = activate


class Checkbutton(_Widget):
    _kind = "Checkbutton"

    def invoke(self):
        var = self.options.get("variable")
        if var is not None:
            var.set(not var.get())
        command = self.options.get("command")
        return command() if callable(command) else None


END = "end"


def _make_tkinter():
    module = types.ModuleType("tkinter")
    module.__doc__ = "A small copy of tkinter for this page. The page draws the window."
    names = {
        "Tk": Tk, "Frame": Frame, "Label": Label, "Button": Button, "Entry": Entry, "Listbox": Listbox,
        "Checkbutton": Checkbutton, "StringVar": StringVar, "IntVar": IntVar, "DoubleVar": DoubleVar,
        "BooleanVar": BooleanVar, "TclError": TclError, "END": END, "LEFT": "left", "RIGHT": "right",
        "TOP": "top", "BOTTOM": "bottom", "BOTH": "both", "X": "x", "Y": "y", "N": "n", "S": "s", "E": "e",
        "W": "w", "NW": "nw", "NE": "ne", "SW": "sw", "SE": "se", "NSEW": "nsew", "EW": "ew", "NS": "ns",
        "CENTER": "center", "DISABLED": "disabled", "NORMAL": "normal", "SINGLE": "single", "BROWSE": "browse",
        "MULTIPLE": "multiple", "ACTIVE": "active", "YES": True, "NO": False,
    }
    for name, value in names.items():
        setattr(module, name, value)
    module.__all__ = list(names)

    box = types.ModuleType("tkinter.messagebox")

    def dialog(kind, answer):
        def show(title=None, message=None, **options):
            _gui.state.dialogs.append({"kind": kind, "title": str(title or ""), "message": str(message or "")})
            return answer
        return show

    box.showinfo, box.showwarning, box.showerror = dialog("info", "ok"), dialog("warning", "ok"), dialog("error", "ok")
    box.askyesno, box.askokcancel, box.askquestion = dialog("question", True), dialog("question", True), dialog("question", "yes")
    ttk = types.ModuleType("tkinter.ttk")
    for name in ("Frame", "Label", "Button", "Entry", "Checkbutton"):
        setattr(ttk, name, names[name])
    module.messagebox = box
    module.ttk = ttk
    sys.modules["tkinter"] = module
    sys.modules["tkinter.messagebox"] = box
    sys.modules["tkinter.ttk"] = ttk


_make_tkinter()


def _json_safe(value):
    return value if isinstance(value, (str, int, float, bool)) or value is None else str(value)


def _gui_node(w):
    node = {"id": w.id, "kind": w._kind, "manager": w.manager,
            "layout": {k: _json_safe(v) for k, v in w.layout.items()},
            "style": {k: _json_safe(w.options[k]) for k in ("fg", "bg", "foreground", "background", "font", "width", "state", "padx", "pady") if k in w.options},
            "keys": sorted(k for k in w.bindings if isinstance(k, str)),
            "children": [_gui_node(c) for c in w._order]}
    if w._kind in ("Label", "Button", "Checkbutton"):
        node["text"] = w.text_of()
    if w._kind == "Checkbutton":
        var = w.options.get("variable")
        node["checked"] = bool(var.get()) if var is not None else False
    if w._kind == "Entry":
        node["value"] = w.get()
        node["secret"] = bool(w.options.get("show"))
    if w._kind == "Listbox":
        node["items"] = [str(i) for i in w.items]
        node["selected"] = sorted(w.selected)
    return node


def _gui_tree(state):
    root = state.root
    if root is None:
        return None
    return {"title": root._title, "closed": root.closed, "looping": root.looping,
            "children": [_gui_node(c) for c in root._order], "dialogs": state.dialogs[:30]}


def _shown(w):
    """Shown on the screen: placed with pack, grid or place, and so are all its parents."""
    while w is not None and not isinstance(w, Tk):
        if w.manager is None:
            return False
        w = w.master
    return True


def _all_widgets(state):
    found = []

    def walk(w):
        for child in w._order:
            found.append(child)
            walk(child)

    if state.root is not None:
        walk(state.root)
    return found


def gui_event(request_json):
    """A click (or a key) in the window of the last run."""
    req = json.loads(request_json)
    state = _gui_last
    if state is None or state.root is None:
        return json.dumps({"gui": None, "stdout": "", "error": None})
    _gui.state = state
    for key, text in (req.get("values") or {}).items():
        w = state.widgets.get(int(key))
        if isinstance(w, Entry):
            w._set(str(text))
    for key, chosen in (req.get("selections") or {}).items():
        w = state.widgets.get(int(key))
        if isinstance(w, Listbox):
            w.selected = {int(i) for i in chosen if 0 <= int(i) < len(w.items)}
    out = _Out()
    error = None
    count = [0]

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != _FILE:
            return None
        if event == "line":
            count[0] += 1
            if count[0] > _MAX_LINES:
                raise _Stopped("The program ran for a very long time.")
        return tracer

    if state.home:
        _enter(state.home)
    with redirect_stdout(out), redirect_stderr(out):
        try:
            sys.settrace(tracer)
            w = state.widgets.get(req.get("id"))
            action = req.get("action")
            if action == "click" and w is not None and hasattr(w, "invoke"):
                w.invoke()
            elif action in ("key", "select") and w is not None:
                handler = w.bindings.get(req.get("key") if action == "key" else "<<ListboxSelect>>")
                if callable(handler):
                    handler(_Event(w, req.get("key", "")))
            elif action == "close":
                handler = state.root.handlers.get("WM_DELETE_WINDOW")
                if callable(handler):
                    handler()
                else:
                    state.root.destroy()
        except BaseException as exc:  # a callback may raise anything
            error = _describe(exc)
        finally:
            sys.settrace(None)
    files = _files_in(state.home) if state.home else {}
    return json.dumps({"gui": _gui_tree(state), "stdout": out.getvalue(), "error": error, "files": files})


def _execute(src, case, trace, index=0, pytest=False):
    ns = {"__name__": "__main__"}
    out = _Out()
    ran = [0]
    asked = [0]
    inputs = list(case.get("stdin") or [])
    steps = []
    feeds = []
    error = None
    pre = {}
    tree = None

    def fake_input(prompt=""):
        asked[0] += 1
        out.write(str(prompt))
        if not inputs:
            raise _NeedInput("input() was called, but there is no more input")
        answer = inputs.pop(0)
        out.write(answer + "\n")
        return answer

    def feed(line, values):
        # Called when a for-loop starts. `at` links the event to a trace step.
        if isinstance(values, (range, str, list, tuple, dict, set, frozenset)) and len(values) <= _MAX_FEED:
            # A loop over a dictionary gets its keys.
            items = [{"repr": _show(v), "type": type(v).__name__} for v in values]
            feeds.append({"at": len(steps), "line": line, "values": items})
        return values

    # Every call gets its own number, so two calls of one function, one
    # after the other, are two calls (two desks) and not one.
    call_ids = {}
    next_call = [1]

    def stack_of(frame):
        """The function calls that run now, from the outside in, with their own
        names, their number, and the line that made the call."""
        calls = []
        f = frame
        while f is not None:
            name = f.f_code.co_name
            if f.f_code.co_filename == _FILE and not name.startswith("<"):
                calls.append(
                    {
                        "name": name,
                        "vars": _snapshot(f.f_locals, ns),
                        "call": call_ids.get(id(f), 0),
                        "at": f.f_back.f_lineno if f.f_back is not None else None,
                    }
                )
            f = f.f_back
        calls.reverse()
        return calls

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != _FILE:
            return None
        if event == "call" and not frame.f_code.co_name.startswith("<"):
            call_ids[id(frame)] = next_call[0]
            next_call[0] += 1
        elif event == "line":
            ran[0] += 1
            if ran[0] > _MAX_LINES:
                raise _Stopped("The program ran for a very long time.")
            if trace and len(steps) < _MAX_STEPS:
                steps.append(
                    {"line": frame.f_lineno, "vars": _snapshot(ns), "out": len(out.getvalue()), "stack": stack_of(frame)}
                )
        elif event == "return" and trace and not frame.f_code.co_name.startswith("<") and len(steps) < _MAX_STEPS:
            # A function ends. One step for the way back, with the value it gives.
            steps.append(
                {
                    "line": frame.f_lineno,
                    "vars": _snapshot(ns),
                    "out": len(out.getvalue()),
                    "stack": stack_of(frame),
                    "ret": {"repr": _show(arg), "type": type(arg).__name__},
                }
            )
        return tracer

    # A seed makes random numbers repeat. The page uses one seed for all
    # re-runs of one game, so a secret number stays the same between answers.
    random.seed(case.get("seed"))
    # The words after the program name, as in `python main.py report --top 3`.
    real_argv = sys.argv
    sys.argv = [_FILE] + [str(a) for a in (case.get("argv") or [])]
    exit_code = 0
    _reset_logging()
    real_input = builtins.input
    builtins.input = fake_input
    # Each case runs in its own folder. Relative paths like "notes.txt" are
    # inside it. The folder stays until the checks of the run are done.
    home = _folder(index, case.get("files"))
    _enter(home)
    web_log = []
    test_results = []
    # A fresh, empty set of windows for each run.
    _gui.state = _GuiState()
    _gui.state.home = home
    _web.use(case.get("web"), web_log)
    try:
        with redirect_stdout(out), redirect_stderr(out):
            try:
                for hook in _RUN_HOOKS:
                    hook.start(case)
                if case.get("setup"):
                    exec(compile(case["setup"], "setup.py", "exec"), ns)
                # A true copy: a check must see the values before the learner's
                # code changed a list in place.
                pre = {k: _frozen(v) for k, v in ns.items() if not k.startswith("_")}
                linecache.cache[_FILE] = (len(src), None, src.splitlines(True), _FILE)
                tree = ast.parse(src, _FILE)
                run_tree = tree
                if case.get("set"):
                    run_tree = _Override(case["set"]).visit(ast.parse(src, _FILE))
                    ast.fix_missing_locations(run_tree)
                if trace:
                    if run_tree is tree:
                        run_tree = ast.parse(src, _FILE)
                    run_tree = _FeedWrap().visit(run_tree)
                    ast.fix_missing_locations(run_tree)
                    ns["__zp_feed"] = feed
                code = compile(run_tree, _FILE, "exec")
                # Always traced: the tracer also stops endless loops.
                sys.settrace(tracer)
                try:
                    exec(code, ns)
                    if pytest:
                        # Like running pytest on the file: every test, then the report.
                        test_results.extend(_run_tests(ns, src))
                        out.write("\n" + _report(test_results))
                    for hook in _RUN_HOOKS:
                        hook.end(None)
                finally:
                    sys.settrace(None)
            except SystemExit as exc:
                # sys.exit() ends a program normally, with an exit code. A
                # text is printed (to stderr, as Python does) and gives code 1.
                for hook in _RUN_HOOKS:
                    hook.end(None)
                if isinstance(exc.code, str):
                    out.write(exc.code + "\n")
                    exit_code = 1
                else:
                    exit_code = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
            except BaseException as exc:  # includes KeyboardInterrupt
                for hook in _RUN_HOOKS:
                    hook.end(exc)
                if not getattr(exc, "_zp_quiet", False):
                    error = _describe(exc)
    finally:
        builtins.input = real_input
        sys.argv = real_argv
        _flush_logging()
        ext = {hook.name: hook.finish() for hook in _RUN_HOOKS}

    stdout = out.getvalue()
    _enter(home)  # the program may have changed the folder
    files = _files_in(home)
    final = _snapshot(ns)
    # A trace event fires before its line runs. Shift so each step holds the
    # state after its line.
    shifted = []
    for i, step in enumerate(steps):
        nxt = steps[i + 1] if i + 1 < len(steps) else None
        shifted.append(
            {
                "line": step["line"],
                "vars": nxt["vars"] if nxt else final,
                "out": nxt["out"] if nxt else len(stdout),
                "stack": nxt["stack"] if nxt else [],
                "ret": step.get("ret"),
            }
        )
    return {"inputs": list(case.get("stdin") or []), "asked": asked[0], "ns": ns, "pre": pre, "stdout": stdout, "error": error, "steps": shifted, "feeds": feeds, "vars": final, "tree": tree, "src": src, "home": home, "files": files, "start_files": dict(case.get("files") or {}), "web_log": web_log, "test_results": test_results, "gui": _gui.state, "ext": ext, "exit_code": exit_code, "argv": list(case.get("argv") or [])}


def _reset_logging():
    """Each run starts with logging as in a new Python: no handlers, level
    WARNING, no loggers of earlier runs (they would write to old output)."""
    logging = sys.modules.get("logging")
    if logging is None:
        return
    for handler in list(logging.root.handlers):
        try:
            handler.close()
        except Exception:
            pass
        logging.root.removeHandler(handler)
    logging.root.setLevel(logging.WARNING)
    for logger in list(logging.Logger.manager.loggerDict.values()):
        if isinstance(logger, logging.Logger):
            for handler in list(logger.handlers):
                try:
                    handler.close()
                except Exception:
                    pass
                logger.removeHandler(handler)
    logging.Logger.manager.loggerDict.clear()
    logging.disable(logging.NOTSET)


def _flush_logging():
    """A log file must be complete when the folder is shown after the run."""
    logging = sys.modules.get("logging")
    if logging is None:
        return
    for logger in [logging.root] + [l for l in logging.Logger.manager.loggerDict.values() if isinstance(l, logging.Logger)]:
        for handler in logger.handlers:
            try:
                handler.flush()
            except Exception:
                pass


def _check_env(result):
    ns, tree = result["ns"], result["tree"]
    nodes = list(ast.walk(tree)) if tree is not None else []

    def called(name):
        for node in nodes:
            if isinstance(node, ast.Call):
                func = node.func
                if getattr(func, "id", None) == name or getattr(func, "attr", None) == name:
                    return True
        return False

    def calls_in(func, name):
        """True when the body of function `func` calls `name`."""
        for node in nodes:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == func:
                for sub in ast.walk(node):
                    if isinstance(sub, ast.Call):
                        f = sub.func
                        if getattr(f, "id", None) == name or getattr(f, "attr", None) == name:
                            return True
        return False

    def syntax(kind):
        """How many parts of the code are of this kind, for example "ListComp",
        "DictComp", "Try" or "With" (the names of the ast module)."""
        return sum(1 for node in nodes if type(node).__name__ == kind)

    def import_out(name="mymodule"):
        """What the code prints when another file imports it (then __name__ is
        the module name, not "__main__"). An error gives its name in brackets."""
        buffer = io.StringIO()
        module_ns = {"__name__": name}
        try:
            with redirect_stdout(buffer), redirect_stderr(buffer):
                exec(compile(result["src"], f"{name}.py", "exec"), module_ns)
        except BaseException as exc:  # a check must never stop
            buffer.write(f"[{type(exc).__name__}]")
        return buffer.getvalue()

    def raises(fn, *args, **kwargs):
        """The name of the error that a call raises, or None."""
        try:
            fn(*args, **kwargs)
        except BaseException as exc:  # a check must never stop
            return type(exc).__name__
        return None

    def assigned(name):
        count = 0
        for node in nodes:
            targets = []
            if isinstance(node, ast.Assign):
                targets = node.targets
            elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
                targets = [node.target]
            for target in targets:
                for sub in ast.walk(target):
                    if isinstance(sub, ast.Name) and sub.id == name:
                        count += 1
        return count

    def tests_pass():
        """True when the learner has tests and all of them pass."""
        found = _all_tests(ns)
        return bool(found) and all(r["outcome"] == "passed" for r in _run_tests(ns, result["src"]))

    def fails_with(code, module=None):
        """True when at least one test fails after `code` replaced a part of
        the program (for example a function with a bug). Then it is put back.
        With `module` ("models"), the code runs inside that file of the
        learner: it can replace a method of a class (Library.find = ...), so
        the tests in a test file meet the bug too."""
        if module is None:
            saved = dict(ns)
            try:
                exec(compile(code, "mutant.py", "exec"), ns)
                return any(r["outcome"] != "passed" for r in _run_tests(ns, result["src"]))
            finally:
                ns.clear()
                ns.update(saved)
        target = vars(sys.modules.get(module) or importlib.import_module(module))
        saved = dict(target)
        classes = {name: dict(vars(value)) for name, value in saved.items()
                   if isinstance(value, type) and value.__module__ == target.get("__name__")}
        rebound = []
        try:
            exec(compile(code, "mutant.py", "exec"), target)
            # A file that did `from storage import load` has its own name for
            # the old function: it gets the new one too.
            changed = {k: (saved[k], v) for k, v in target.items() if k in saved and v is not saved[k]}
            spaces = [ns] + [vars(m) for m in list(sys.modules.values())
                             if (getattr(m, "__file__", None) or "").startswith(_HOME) and vars(m) is not target]
            for space in spaces:
                for k, (old, new) in changed.items():
                    if space.get(k) is old:
                        rebound.append((space, k, old))
                        space[k] = new
            return any(r["outcome"] != "passed" for r in _run_tests(ns, result["src"]))
        finally:
            for space, k, old in rebound:
                space[k] = old
            for name, attrs in classes.items():
                cls = saved[name]
                for attr in [a for a in vars(cls) if a not in attrs]:
                    try:
                        delattr(cls, attr)
                    except (AttributeError, TypeError):
                        pass
                for attr, value in attrs.items():
                    if vars(cls).get(attr) is not value:
                        try:
                            setattr(cls, attr, value)
                        except (AttributeError, TypeError):
                            pass
            target.clear()
            target.update(saved)

    # The window of this case. Checks click and type like a user.
    gui_state = result["gui"]

    def gui_widgets(kind=None):
        """The widgets that are shown, in the order of the window."""
        return [w for w in _all_widgets(gui_state) if _shown(w) and (kind is None or w._kind == kind)]

    def gui_texts():
        return [w.text_of() for w in gui_widgets() if w._kind in ("Label", "Button", "Checkbutton")]

    def gui_find(text):
        for w in gui_widgets():
            if w._kind in ("Label", "Button", "Checkbutton") and w.text_of() == text:
                return w
        return None

    def gui_click(target):
        w = gui_find(target) if isinstance(target, str) else target
        if w is None:
            raise LookupError(f"no button {target!r} is shown")
        _gui.state = gui_state
        return w.invoke()

    def gui_type(target, text):
        """Types text into an Entry (by its number among the shown entries)."""
        w = gui_widgets("Entry")[target] if isinstance(target, int) else target
        w._set(str(text))
        return True

    def gui_select(index, target=0):
        """Selects one line of a Listbox (by its number among the shown lists)."""
        w = gui_widgets("Listbox")[target] if isinstance(target, int) else target
        w.selected = {index}
        return True

    def gui_items(target=0):
        """The lines of a Listbox, as texts."""
        if isinstance(target, int):
            lists = gui_widgets("Listbox")
            if target >= len(lists):
                return []
            target = lists[target]
        return [str(item) for item in target.items]

    def uses(name):
        return any(isinstance(n, ast.Name) and n.id == name and isinstance(n.ctx, ast.Load) for n in nodes)

    env = {k: v for k, v in ns.items() if k != "__builtins__"}
    env.update(
        ns=ns,
        pre=result["pre"],
        inputs=result["inputs"],
        asked=result["asked"],
        out=result["stdout"],
        lines=result["stdout"].splitlines(),
        src=result["src"],
        err=result["error"]["type"] if result["error"] else None,
        files=result["files"],
        start_files=result["start_files"],
        # Requests to the pretend web: [{"method", "url", "base", "params", "timeout"}].
        requests_made=result["web_log"],
        # The code of sys.exit() (0 when the program just ends), and the words after the program name.
        exit_code=result["exit_code"],
        argv=result["argv"],
        # Tests (steps with "pytest"): [{"name", "outcome", "error", ...}].
        test_results=result["test_results"],
        # Windows (pretend tkinter). The names start with gui_, so they do
        # not hide names of the learner.
        gui_window=gui_state.root,
        gui_title=gui_state.root._title if gui_state.root is not None else None,
        gui_dialogs=gui_state.dialogs,
        gui_widgets=gui_widgets,
        gui_texts=gui_texts,
        gui_find=gui_find,
        gui_click=gui_click,
        gui_type=gui_type,
        gui_select=gui_select,
        gui_items=gui_items,
        tests_pass=tests_pass,
        fails_with=fails_with,
        called=called,
        calls_in=calls_in,
        raises=raises,
        import_out=import_out,
        syntax=syntax,
        assigned=assigned,
        uses=uses,
    )
    return env


def _truthy(expr, env):
    # A check can call a function of the learner. What it prints is not output.
    try:
        with redirect_stdout(io.StringIO()):
            return bool(eval(expr, env))
    except Exception:
        return False


def run(request_json):
    global _gui_last
    # The window of the run before is gone now, with its folder.
    if _gui_last is not None and _gui_last.home:
        os.chdir("/")
        shutil.rmtree(_gui_last.home, ignore_errors=True)
    _gui_last = None
    for hook in _RUN_HOOKS:
        if hasattr(hook, "reset"):
            hook.reset()
    req = json.loads(request_json)
    src = req["code"]
    cases = req.get("cases") or [{}]
    # The learner's other files of a project (models.py, storage.py): in the
    # folder of every case, next to main.py, so main.py can import them.
    sources = req.get("sources") or {}
    if sources:
        cases = [{**case, "files": {**(case.get("files") or {}), **sources}} for case in cases]
    results = [_execute(src, case, bool(req.get("trace")) and i == 0, i, bool(req.get("pytest"))) for i, case in enumerate(cases)]
    envs = [_check_env(r) for r in results]
    # Helpers of an extension, only for a run that used it (a Pi program).
    for env, result in zip(envs, results):
        for hook in _RUN_HOOKS:
            if result["ext"].get(hook.name) is not None:
                env.update(hook.env(result["ext"][hook.name]))

    checks = []
    for check in req.get("checks") or []:
        verdict = {"pass": True, "case": None, "note": None}
        for case, env, result in zip(cases, envs, results):
            # A check can call a function that reads a file of this case.
            _enter(result["home"])
            # ...and the web of this case, for a function that makes a request.
            _web.use(case.get("web"), result["web_log"])
            # ...and the windows of this case, for a check that clicks.
            _gui.state = result["gui"]
            if _truthy(check["expr"], env):
                continue
            verdict["pass"] = False
            verdict["case"] = case.get("label")
            for item in check.get("misconceptions") or []:
                _enter(result["home"])
                _web.use(case.get("web"), result["web_log"])
                _gui.state = result["gui"]
                if _truthy(item["when"], env):
                    verdict["note"] = item["say"]
                    break
            break
        checks.append(verdict)

    first = results[0]
    for result in results:
        os.chdir("/")
        shutil.rmtree(result["home"], ignore_errors=True)
    # A program with a window: the page shows it, and its clicks go to
    # gui_event(). The checks may have clicked already, so it gets a fresh
    # run of the first case, in a folder that stays until the next run.
    gui = None
    live = None
    serving = (first["ext"].get("server") or {}).get("served")
    if first["gui"].root is not None or serving:
        live = _execute(src, cases[0], False, len(cases), bool(req.get("pytest")))
        _gui_last = live["gui"]
        if _gui_last.root is not None:
            gui = _gui_tree(_gui_last)
        os.chdir("/")
    # A server of the live run answers the page's browser (server.py).
    for hook in _RUN_HOOKS:
        if hasattr(hook, "keep"):
            hook.keep(live["ext"].get(hook.name) if live else None)
    return json.dumps(
        {
            "gui": gui,
            "stdout": first["stdout"],
            "error": first["error"],
            "vars": first["vars"],
            "steps": first["steps"],
            "feeds": first["feeds"],
            "checks": checks,
            "files": first["files"],
            "exitCode": first["exit_code"],
            "gpio": first["ext"].get("gpio"),
            "plot": first["ext"].get("plot"),
            "server": first["ext"].get("server"),
        }
    )
