# A pretend matplotlib for the Data and AI lessons. Loaded after harness.py.
# `import matplotlib.pyplot as plt` gives the common functions with the names,
# arguments and default colours of the real library (matplotlib.org): plot,
# scatter, bar, hist, title, xlabel, ylabel, legend, grid, xlim, ylim, axhline,
# figure, show. A program records figures; the page draws them as charts.
# On a real computer the same code draws with the real matplotlib.
import builtins as _builtins
import sys
import types

# The default colour cycle of matplotlib ("tab10"), and its colour letters.
_CYCLE = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"]
_LETTERS = {"b": "#1f77b4", "g": "#2ca02c", "r": "#d62728", "c": "#17becf", "m": "#9467bd", "y": "#bcbd22", "k": "#000000", "w": "#ffffff"}
_NAMED = {"blue": "#1f77b4", "orange": "#ff7f0e", "green": "#2ca02c", "red": "#d62728", "purple": "#9467bd",
          "brown": "#8c564b", "pink": "#e377c2", "gray": "#7f7f7f", "grey": "#7f7f7f", "olive": "#bcbd22",
          "cyan": "#17becf", "black": "#000000", "white": "#ffffff", "yellow": "#ffd700"}
_MARKERS = "o.s^vx+*Dd"
_STYLES = ["--", "-.", "-", ":"]
_MAX_POINTS = 2000


class _State:
    def __init__(self):
        self.figures = []
        self.current = None

    def figure(self):
        if self.current is None:
            self.current = {"title": "", "xlabel": "", "ylabel": "", "series": [], "legend": False, "grid": False,
                            "xlim": None, "ylim": None, "lines": [], "shown": False}
            self.figures.append(self.current)
        return self.current


_state = _State()


def _values(data, name):
    """A list from a list, a tuple, a range, a numpy array or a dict view."""
    if data is None:
        return []
    if hasattr(data, "tolist"):
        data = data.tolist()
    try:
        values = list(data)
    except TypeError:
        values = [data]
    if len(values) > _MAX_POINTS:
        raise ValueError(f"{name}: this app draws at most {_MAX_POINTS} points in one chart")
    return values


def _numbers(data, name):
    out = []
    for v in _values(data, name):
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise TypeError(f"{name}: all values must be numbers, not {type(v).__name__} ({v!r})") from None
        out.append(float(v))
    return out


def _xs(data, name):
    """x values: numbers, or names (matplotlib puts names in order, as categories)."""
    values = _values(data, name)
    if values and all(isinstance(v, str) for v in values):
        return values
    return _numbers(values, name)


_TAB = dict(zip(["blue", "orange", "green", "red", "purple", "brown", "pink", "gray", "olive", "cyan"], _CYCLE))


def _color(value, fig):
    if value is None:
        n = len([s for s in fig["series"] if not s.get("own_color")])
        return _CYCLE[n % len(_CYCLE)], False
    text = str(value).strip()
    if text.lower().startswith("tab:") and text.lower()[4:] in _TAB:
        return _TAB[text.lower()[4:]], True
    if text.lower() in _NAMED:
        return _NAMED[text.lower()], True
    if text in _LETTERS:
        return _LETTERS[text], True
    if len(text) == 2 and text[0] == "C" and text[1].isdigit():
        return _CYCLE[int(text[1])], True
    if text.startswith("#") and len(text) in (4, 7):
        return text, True
    raise ValueError(f"{value!r} is not a valid value for color")


def _fmt(fmt):
    """'ro-' -> colour r, marker o, line -. Like matplotlib's format strings."""
    color = marker = style = None
    rest = fmt
    for s in _STYLES:
        if s in rest:
            style, rest = s, rest.replace(s, "", 1)
            break
    for ch in rest:
        if ch in _LETTERS and color is None:
            color = ch
        elif ch in _MARKERS and marker is None:
            marker = ch
        else:
            raise ValueError(f"{fmt!r} is not a valid format string (unrecognized character {ch!r})")
    if style is None and marker is None:
        style = "-"
    return color, marker, style


def plot(*args, **kwargs):
    fig = _state.figure()
    groups = []
    args = list(args)
    while args:
        if len(args) >= 2 and not isinstance(args[1], str):
            x, y, args = args[0], args[1], args[2:]
        else:
            y, args = args[0], args[1:]
            x = None
        fmt = None
        if args and isinstance(args[0], str):
            fmt, args = args[0], args[1:]
        groups.append((x, y, fmt))
    if not groups:
        return []
    made = []
    for x, y, fmt in groups:
        ys = _numbers(y, "y")
        xs = list(range(len(ys))) if x is None else _xs(x, "x")
        if len(xs) != len(ys):
            raise ValueError(f"x and y must have same first dimension, but have shapes ({len(xs)},) and ({len(ys)},)")
        color, marker, style = _fmt(fmt) if fmt else (None, None, "-")
        colour, own = _color(kwargs.get("color", kwargs.get("c", color)), fig)
        if "linestyle" in kwargs or "ls" in kwargs:
            style = {"solid": "-", "dashed": "--", "dotted": ":", "dashdot": "-.", "None": None, "": None}.get(
                kwargs.get("linestyle", kwargs.get("ls")), kwargs.get("linestyle", kwargs.get("ls")))
        series = {"kind": "line", "x": xs, "y": ys, "color": colour, "own_color": own,
                  "marker": kwargs.get("marker", marker), "style": style, "label": kwargs.get("label")}
        fig["series"].append(series)
        made.append(_Artist(series))
    return made


def scatter(x, y, s=None, c=None, marker="o", label=None, color=None, alpha=None, **kwargs):
    fig = _state.figure()
    xs, ys = _xs(x, "x"), _numbers(y, "y")
    if len(xs) != len(ys):
        raise ValueError("x and y must be the same size")
    colours = None
    if c is not None and not isinstance(c, str):
        colours = [(_color(v, fig)[0] if isinstance(v, str) else _CYCLE[int(v) % len(_CYCLE)]) for v in _values(c, "c")]
        if len(colours) != len(xs):
            raise ValueError(f"'c' argument has {len(colours)} elements, which is inconsistent with 'x' and 'y' with size {len(xs)}.")
    colour, own = _color(color if color is not None else c if isinstance(c, str) else None, fig)
    series = {"kind": "scatter", "x": xs, "y": ys, "color": colour, "own_color": own, "colors": colours,
              "marker": marker, "label": label}
    fig["series"].append(series)
    return _Artist(series)


def bar(x, height, width=0.8, label=None, color=None, **kwargs):
    fig = _state.figure()
    names = [str(v) for v in _values(x, "x")]
    heights = _numbers(height, "height")
    if len(names) != len(heights):
        if len(heights) == 1:
            heights = heights * len(names)
        else:
            raise ValueError(f"shape mismatch: objects cannot be broadcast to a single shape. Mismatch is between arg 0 with shape ({len(names)},) and arg 1 with shape ({len(heights)},).")
    colour, own = _color(color, fig)
    series = {"kind": "bar", "x": names, "y": heights, "color": colour, "own_color": own, "label": label}
    fig["series"].append(series)
    return _Artist(series)


def hist(x, bins=10, range=None, label=None, color=None, **kwargs):
    fig = _state.figure()
    data = _numbers(x, "x")
    if not data:
        lo, hi = 0.0, 1.0
    else:
        lo, hi = range if range is not None else (min(data), max(data))
    if lo == hi:
        lo, hi = lo - 0.5, hi + 0.5
    if isinstance(bins, int):
        if bins < 1:
            raise ValueError("`bins` must be positive, when an integer")
        edges = [lo + (hi - lo) * k / bins for k in _builtins.range(bins + 1)]
    else:
        edges = _numbers(bins, "bins")
    counts = [0] * (len(edges) - 1)
    for v in data:
        for k in _builtins.range(len(counts)):
            last = k == len(counts) - 1
            if edges[k] <= v < edges[k + 1] or (last and v == edges[-1]):
                counts[k] += 1
                break
    colour, own = _color(color, fig)
    series = {"kind": "hist", "edges": edges, "y": [float(c) for c in counts], "color": colour, "own_color": own, "label": label}
    fig["series"].append(series)
    return counts, edges, _Artist(series)


def axhline(y=0, color=None, linestyle="--", label=None, **kwargs):
    fig = _state.figure()
    colour, _ = _color(color or "gray", fig)
    fig["lines"].append({"y": float(y), "color": colour, "style": linestyle, "label": label})


def title(text, **kwargs):
    _state.figure()["title"] = str(text)


def xlabel(text, **kwargs):
    _state.figure()["xlabel"] = str(text)


def ylabel(text, **kwargs):
    _state.figure()["ylabel"] = str(text)


def legend(*args, **kwargs):
    fig = _state.figure()
    if not any(s.get("label") for s in fig["series"]):
        # Like matplotlib: a warning, and no legend.
        print("No artists with labels found to put in legend.  Note that artists whose label start with an underscore are ignored when legend() is called with no argument.", file=sys.stderr)
        return None
    fig["legend"] = True


def grid(visible=True, **kwargs):
    _state.figure()["grid"] = bool(visible)


def xlim(*args, **kwargs):
    fig = _state.figure()
    if args:
        lo, hi = args if len(args) == 2 else args[0]
        fig["xlim"] = [float(lo), float(hi)]
    return tuple(fig["xlim"] or (0.0, 1.0))


def ylim(*args, **kwargs):
    fig = _state.figure()
    if args:
        lo, hi = args if len(args) == 2 else args[0]
        fig["ylim"] = [float(lo), float(hi)]
    return tuple(fig["ylim"] or (0.0, 1.0))


def figure(*args, **kwargs):
    _state.current = None
    _state.figure()


def show(*args, **kwargs):
    if _state.current is not None:
        _state.current["shown"] = True
    _state.current = None


def close(*args, **kwargs):
    _state.current = None


def savefig(fname, **kwargs):
    raise NotImplementedError("savefig: in this app, plt.show() draws the chart. On your computer, savefig() writes an image file.")


class _Artist:
    """What plot(), bar() and scatter() give back (a Line2D, a container...)."""

    def __init__(self, series):
        self._series = series

    def set_label(self, text):
        self._series["label"] = str(text)

    def __repr__(self):
        kind = {"line": "Line2D", "scatter": "PathCollection", "bar": "BarContainer", "hist": "BarContainer"}[self._series["kind"]]
        return f"<matplotlib.{'lines' if kind == 'Line2D' else 'collections' if kind == 'PathCollection' else 'container'}.{kind} object>"


def _make_matplotlib():
    mpl = types.ModuleType("matplotlib")
    mpl.__version__ = "3.10.8"
    pyplot = types.ModuleType("matplotlib.pyplot")
    for name in ("plot", "scatter", "bar", "hist", "axhline", "title", "xlabel", "ylabel", "legend", "grid",
                 "xlim", "ylim", "figure", "show", "close", "savefig"):
        setattr(pyplot, name, globals()[name])
    pyplot.__doc__ = "A small copy of matplotlib.pyplot for this app: the same names; the page draws the charts."
    mpl.pyplot = pyplot
    mpl.use = lambda *a, **k: None
    sys.modules["matplotlib"] = mpl
    sys.modules["matplotlib.pyplot"] = pyplot


class _PlotHook:
    """Called by harness.py around each run of a case."""

    name = "plot"

    def start(self, case):
        global _state
        _state = _State()
        _make_matplotlib()

    def end(self, exc):
        pass

    def finish(self):
        figures = [f for f in _state.figures if f["series"] or f["lines"]]
        for f in figures:
            for s in f["series"]:
                s.pop("own_color", None)
        return figures or None

    def env(self, data):
        figures = data or []

        def chart(k=-1):
            """A figure as a dictionary (title, xlabel, ylabel, series...), or None."""
            return figures[k] if figures and -len(figures) <= k < len(figures) else None

        return {"charts": figures, "chart": chart}


_RUN_HOOKS.append(_PlotHook())  # noqa: F821 (harness.py)
