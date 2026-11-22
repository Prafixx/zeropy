# Real Flask in the page (its wheels are in public/pyodide). Loaded after
# harness.py. A page cannot open a network port, so app.run() starts no real
# server here: the program stops at that line, as if the server were running
# (a real app.run() also never returns), and the page shows a small browser.
# The browser's requests go to the app through Flask's own test client, so the
# routes, the request object, templates and errors are those of real Flask.
# The pretend requests (harness.py) sends requests for http://127.0.0.1:5000
# and http://localhost:5000 to the apps of the same program too.
import importlib.util
import json
import sys
import time

_SRV_LOCAL_HOSTS = ("127.0.0.1", "localhost")
_SRV_MAX_BODY = 200_000


class _ServerRunning(Exception):
    """app.run() was called: the program waits for requests from now on."""

    _zp_quiet = True


class _ServerState:
    def __init__(self):
        self.apps = []
        self.served = None
        self.host = "127.0.0.1"
        self.port = 5000
        self.debug = False

    def app(self):
        """The app that answers: the one that runs, or else the last one made."""
        return self.served or (self.apps[-1] if self.apps else None)


_srv_state = _ServerState()
_srv_kept = {}  # key -> _ServerState of each run of this request (for the checks)
_srv_live = None  # the server of the last run's first case, for the page's browser


def _srv_log_line(method, path, status):
    stamp = time.strftime("%d/%b/%Y %H:%M:%S")
    return f'127.0.0.1 - - [{stamp}] "{method} {path} HTTP/1.1" {status} -'


def _srv_install():
    """Puts our app.run() into Flask, once. Only when Flask is in the page."""
    if importlib.util.find_spec("flask") is None:
        return
    import flask

    cls = flask.Flask
    if getattr(cls, "_zp_ready", False):
        return
    original_init = cls.__init__

    def __init__(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        _srv_state.apps.append(self)

    def run(self, host=None, port=None, debug=None, load_dotenv=True, **options):
        _srv_state.served = self
        _srv_state.host = str(host or "127.0.0.1")
        _srv_state.port = int(port or 5000)
        _srv_state.debug = bool(debug)
        # What the real development server prints when it starts.
        # Real Flask names an app made in main.py "main" (from the file name).
        print(f" * Serving Flask app '{'main' if self.name == '__main__' else self.name}'", file=sys.stderr)
        print(f" * Debug mode: {'on' if debug else 'off'}", file=sys.stderr)
        print("WARNING: This is a development server. Do not use it in a production deployment. "
              "Use a production WSGI server instead.", file=sys.stderr)
        if _srv_state.host == "0.0.0.0":
            print(" * Running on all addresses (0.0.0.0)", file=sys.stderr)
        shown = "127.0.0.1" if _srv_state.host in ("0.0.0.0", "localhost") else _srv_state.host
        print(f" * Running on http://{shown}:{_srv_state.port}", file=sys.stderr)
        print("Press CTRL+C to quit", file=sys.stderr)
        raise _ServerRunning()

    cls.__init__ = __init__
    cls.run = run
    cls._zp_ready = True


def _srv_call(app, method, path, form=None, json_body=None, headers=None, port=5000):
    """One request through the test client. Returns (response, exception).
    The client says it is at 127.0.0.1 and the port of the server, so the
    request (request.host, url_for(_external=True), a redirect's Location)
    looks like one to a real development server."""
    app.config["PROPAGATE_EXCEPTIONS"] = True
    client = app.test_client()
    kwargs = {"method": method, "headers": headers or {}, "base_url": f"http://127.0.0.1:{port}"}
    if json_body is not None:
        kwargs["json"] = json_body
    elif form is not None:
        kwargs["data"] = form
    try:
        return client.open(path, **kwargs), None
    except BaseException as exc:  # an error in a view of the learner
        if isinstance(exc, (KeyboardInterrupt, _Stopped)):  # noqa: F821 (harness.py)
            raise
        from werkzeug.exceptions import InternalServerError

        return InternalServerError().get_response(), exc


def _srv_local_answer(method, url, params, data, json_body):
    """The pretend requests asks: is this a request for one of our apps?"""
    import urllib.parse

    parts = urllib.parse.urlsplit(url)
    if parts.hostname not in _SRV_LOCAL_HOSTS:
        return None
    app = _srv_state.app()
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if app is None or port != _srv_state.port or parts.scheme != "http":
        return None
    path = (parts.path or "/") + ("?" + urllib.parse.urlencode(params) if params else "")
    response, exc = _srv_call(app, method, path, form=data if isinstance(data, dict) else None, json_body=json_body, port=_srv_state.port)
    if exc is not None:
        print(f"[server] Exception on {parts.path or '/'} [{method}]: {type(exc).__name__}: {exc}")
    body = response.get_data(as_text=True)
    answer = _Response(url, response.status_code, body)  # noqa: F821 (harness.py)
    answer.reason = response.status.split(" ", 1)[1].title() if " " in response.status else ""
    answer.headers = dict(response.headers)
    return answer


def web_request(request_json):
    """A request from the page's browser to the server of the last run."""
    req = json.loads(request_json)
    state = _srv_live
    app = state.app() if state else None
    if app is None:
        return json.dumps({"status": 0, "error": None, "log": "", "stdout": ""})
    method = str(req.get("method") or "GET").upper()
    path = str(req.get("path") or "/")
    if not path.startswith("/"):
        path = "/" + path
    out = _Out()  # noqa: F821 (harness.py)
    error = None
    count = [0]

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != _FILE:  # noqa: F821 (harness.py)
            return None
        if event == "line":
            count[0] += 1
            if count[0] > _MAX_LINES:  # noqa: F821 (harness.py)
                raise _Stopped("The program ran for a very long time.")  # noqa: F821 (harness.py)
        return tracer

    home = _gui_last.home if _gui_last is not None else None  # noqa: F821 (harness.py)
    if home:
        _enter(home)  # noqa: F821 (harness.py)
    with redirect_stdout(out), redirect_stderr(out):  # noqa: F821 (harness.py)
        try:
            sys.settrace(tracer)
            response, exc = _srv_call(app, method, path, form=req.get("form"), json_body=req.get("json"), port=state.port)
        except BaseException as stop:
            response, exc = None, stop
        finally:
            sys.settrace(None)
    if exc is not None:
        error = _describe(exc)  # noqa: F821 (harness.py)
    if response is None:
        return json.dumps({"status": 0, "error": error, "log": "", "stdout": out.getvalue()})
    body = response.get_data(as_text=True)
    lines = [_srv_log_line(method, path, response.status_code)]
    if exc is not None:
        lines.insert(0, f"[ERROR] Exception on {path.split('?')[0]} [{method}]")
    return json.dumps(
        {
            "status": response.status_code,
            "reason": response.status.split(" ", 1)[1] if " " in response.status else "",
            "headers": [[k, v] for k, v in response.headers.items()],
            "type": response.mimetype or "",
            "body": body[:_SRV_MAX_BODY],
            "cut": len(body) > _SRV_MAX_BODY,
            "location": response.headers.get("Location"),
            "stdout": out.getvalue(),
            "log": "\n".join(lines),
            "error": error,
        }
    )


class _ServerHook:
    """Called by harness.py around each run of a case."""

    name = "server"

    def start(self, case):
        global _srv_state
        _srv_state = _ServerState()
        _srv_install()

    def end(self, exc):
        pass

    def finish(self):
        app = _srv_state.app()
        if app is None:
            return None
        key = len(_srv_kept)
        _srv_kept[key] = _srv_state
        routes = [
            {"rule": rule.rule, "methods": sorted(m for m in rule.methods if m not in ("HEAD", "OPTIONS"))}
            for rule in app.url_map.iter_rules()
            if rule.endpoint != "static"
        ]
        return {"served": _srv_state.served is not None, "host": _srv_state.host, "port": _srv_state.port,
                "debug": _srv_state.debug, "name": app.name, "routes": routes, "key": key}

    def env(self, data):
        state = _srv_kept.get(data.get("key"))
        app = state.app() if state else None
        if app is not None:
            app.config["PROPAGATE_EXCEPTIONS"] = True
        return {
            "app": app,
            "client": app.test_client() if app is not None else None,
            "served": bool(data.get("served")),
            "server_port": data.get("port"),
            "server_host": data.get("host"),
            "server_debug": bool(data.get("debug")),
            "routes": {r["rule"]: r["methods"] for r in data.get("routes", [])},
        }

    def reset(self):
        """A new request from the page: forget the servers of the last one."""
        _srv_kept.clear()

    def keep(self, data):
        """The live run of the first case: its server answers the page's browser."""
        global _srv_live
        _srv_live = _srv_kept.get(data.get("key")) if data else None


_RUN_HOOKS.append(_ServerHook())  # noqa: F821 (harness.py)
_LOCAL_SERVERS.append(_srv_local_answer)  # noqa: F821 (harness.py)
