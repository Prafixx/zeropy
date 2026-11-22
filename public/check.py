"""ZeroPy check: shows the course that a task works on your computer.

Run it in a terminal, in the folder of the task:

    python check.py python      (on macOS and Linux: python3 check.py python)

Then copy the block between the two lines of dashes into the lesson.

What it reports: only the facts of the task, for example your Python
version, or the first line that your hello.py prints. It never reports
names of folders, your user name, the name and email that git knows, the
address of a repository online, or the code in your files. Read this
file: it is short, and it changes none of your files.
"""

import hashlib
import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

CHECK_VERSION = "13"
# The seal shows the page that the block came from this script unchanged.
# It is not a secret: it only catches a block that was typed or edited by hand.
SALT = "zeropy-local-v1"
MAX_VALUE = 60


def clean(value):
    """One short line of text, safe for any terminal."""
    text = " ".join(str(value).split())
    text = text.encode("ascii", "replace").decode("ascii")
    return text[:MAX_VALUE]


def seal(lines):
    body = "\n".join(lines)
    return hashlib.sha256((SALT + "\n" + body).encode("utf-8")).hexdigest()[:10]


def python_facts():
    version = sys.version_info
    return [
        ("python", f"{version.major}.{version.minor}.{version.micro}"),
        ("os", platform.system() or "unknown"),
        ("bits", "64" if sys.maxsize > 2**32 else "32"),
    ]


def task_python():
    """Python runs from a terminal."""
    facts = python_facts()
    tips = []
    if sys.version_info < (3, 10):
        tips.append("This Python is old. Install a new version from python.org.")
    return facts, tips


def task_hello():
    """hello.py is in this folder and runs."""
    facts = python_facts()
    tips = []
    script = Path("hello.py")
    facts.append(("hello_exists", "yes" if script.is_file() else "no"))
    if not script.is_file():
        tips.append("There is no hello.py in this folder. Run this script in the folder of hello.py.")
        return facts, tips
    try:
        result = subprocess.run(
            [sys.executable, str(script)],
            input="",
            capture_output=True,
            text=True,
            timeout=10,
        )
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        facts.append(("hello_ok", "yes" if result.returncode == 0 else "no"))
        facts.append(("hello_lines", str(len(lines))))
        facts.append(("hello_first", lines[0] if lines else ""))
        if result.returncode != 0:
            last = (result.stderr.strip().splitlines() or ["?"])[-1]
            facts.append(("hello_error", last.split(":")[0]))
            tips.append("hello.py stops with an error. Run python hello.py and read the message.")
    except subprocess.TimeoutExpired:
        facts.append(("hello_ok", "timeout"))
        tips.append("hello.py did not end in 10 seconds. Does it wait for input()?")
    return facts, tips


def yes_no(value):
    return "yes" if value else "no"


def normal_name(name):
    """Package names: "Markdown_It.py" and "markdown-it-py" are the same."""
    return re.sub(r"[-_.]+", "-", name).lower()


def installed_packages():
    """Names and versions of the packages that this Python can import."""
    try:
        from importlib import metadata
    except ImportError:  # Python 3.7
        return None
    packages = {}
    for dist in metadata.distributions():
        name = dist.metadata["Name"]
        if name:
            packages[normal_name(name)] = dist.version
    return packages


def read_text(path):
    """Text of a file. PowerShell 5 writes 'pip freeze > file' as UTF-16."""
    data = path.read_bytes()
    if data[:2] in (bytes([0xFF, 0xFE]), bytes([0xFE, 0xFF])):
        return data.decode("utf-16", "replace")
    return data.decode("utf-8-sig", "replace")


def requirement_names(text):
    names = []
    for line in text.splitlines():
        line = line.split("#")[0].strip()
        if not line or line.startswith("-"):
            continue
        match = re.match(r"[A-Za-z0-9][A-Za-z0-9._-]*", line)
        if match:
            names.append(normal_name(match.group(0)))
    return names


def same_folder(a, b):
    try:
        return os.path.samefile(a, b)
    except OSError:
        return False


def venv_facts(facts, tips):
    """Is the .venv of this folder active? Returns True if a venv is active."""
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    exists = Path(".venv", "pyvenv.cfg").is_file()
    here = in_venv and exists and same_folder(sys.prefix, ".venv")
    facts.append(("venv_exists", yes_no(exists)))
    facts.append(("in_venv", yes_no(in_venv)))
    facts.append(("venv_here", yes_no(here)))
    if not exists:
        tips.append("There is no .venv in this folder. Make one with: python -m venv .venv")
    elif not in_venv:
        tips.append("This Python is not the one in .venv. Activate .venv, then run the check again.")
    elif not here:
        tips.append("This Python is from another venv, not from the .venv of this folder.")
    return in_venv


def task_venv():
    """The .venv of this folder is active; its packages; requirements.txt."""
    facts = python_facts()
    tips = []
    in_venv = venv_facts(facts, tips)

    packages = installed_packages()
    own = {name: version for name, version in (packages or {}).items() if name not in ("pip", "setuptools", "wheel")}
    facts.append(("packages", "unknown" if packages is None else str(len(own))))
    facts.append(("rich", own.get("rich", "no")))

    reqs = Path("requirements.txt")
    facts.append(("reqs_exists", yes_no(reqs.is_file())))
    if reqs.is_file():
        names = requirement_names(read_text(reqs))
        missing = [name for name in names if packages is not None and name not in packages]
        facts.append(("reqs_count", str(len(names))))
        facts.append(("reqs_rich", yes_no("rich" in names)))
        facts.append(("reqs_missing", str(len(missing))))
        if missing:
            tips.append("Some packages in requirements.txt are not installed here. Run: pip install -r requirements.txt")
    elif in_venv and own:
        tips.append("There is no requirements.txt yet. Make it with: pip freeze > requirements.txt")

    program = Path("colors.py")
    facts.append(("colors_exists", yes_no(program.is_file())))
    if program.is_file():
        ok, used = run_and_see_imports(program, "rich")
        facts.append(("colors_ok", ok))
        facts.append(("colors_rich", yes_no(used)))
        if ok == "no":
            tips.append("colors.py stops with an error. Run python colors.py and read the message.")
    return facts, tips


# Runs a program, then tells on stderr if it imported a module.
# The question of input() goes to stderr, so the output holds only what the
# program prints.
WRAPPER = """import builtins, runpy, sys
_input = builtins.input
def _quiet_input(prompt=""):
    sys.stderr.write(str(prompt))
    return _input()
builtins.input = _quiet_input
runpy.run_path(sys.argv[1], run_name="__main__")
sys.stderr.write("\\nzeropy-import: " + ("yes" if all(m in sys.modules for m in sys.argv[2].split(",")) else "no") + "\\n")
"""


def run_script(script, module, stdin="", env_extra=None, timeout=20):
    """Runs a program of the learner. Returns ("yes" | "no" | "timeout" for
    "it ended without an error", what it printed, True if it imported the module)."""
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    env.update(env_extra or {})
    try:
        result = subprocess.run(
            [sys.executable, "-c", WRAPPER, str(script), module],
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return "timeout", "", False
    ok = "yes" if result.returncode == 0 and "Traceback" not in result.stderr else "no"
    return ok, result.stdout, "zeropy-import: yes" in result.stderr


def run_and_see_imports(script, module):
    """("yes" | "no" | "timeout", True if the program imported the module)."""
    ok, _, used = run_script(script, module)
    return ok, used


def printed_lines(text):
    return [line for line in text.splitlines() if line.strip()]


# A proxy that does not exist: requests then cannot reach any server, like
# a computer without internet.
OFFLINE = {"HTTPS_PROXY": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9",
           "https_proxy": "http://127.0.0.1:9", "http_proxy": "http://127.0.0.1:9", "NO_PROXY": "", "no_proxy": ""}


def task_api():
    """where.py asks for a place, finds it with a web API, and survives errors."""
    facts = python_facts()
    tips = []
    venv_facts(facts, tips)
    packages = installed_packages() or {}
    facts.append(("requests", packages.get("requests", "no")))
    if "requests" not in packages:
        tips.append("requests is not installed here. With the venv active, run: pip install requests")

    program = Path("where.py")
    facts.append(("where_exists", yes_no(program.is_file())))
    if not program.is_file():
        tips.append("There is no where.py in this folder.")
        return facts, tips
    # 1. A real place: the answer must name its country.
    found_ok, out, used = run_script(program, "requests", stdin="Oslo\n")
    facts.append(("where_requests", yes_no(used)))
    facts.append(("found_ok", found_ok))
    facts.append(("found_lines", str(len(printed_lines(out)))))
    facts.append(("found_country", yes_no("norway" in out.lower())))
    # 2. A place that does not exist.
    missing_ok, out, _ = run_script(program, "requests", stdin="Xqzwvbn\n")
    facts.append(("missing_ok", missing_ok))
    facts.append(("missing_lines", str(len(printed_lines(out)))))
    # 3. No internet.
    offline_ok, out, _ = run_script(program, "requests", stdin="Oslo\n", env_extra=OFFLINE)
    facts.append(("offline_ok", offline_ok))
    facts.append(("offline_lines", str(len(printed_lines(out)))))
    if found_ok == "no":
        tips.append("where.py stops with an error for Oslo. Run python where.py and read the message.")
    if missing_ok == "no":
        tips.append("where.py stops with an error when the place does not exist. Is there a 'results' list?")
    if offline_ok == "no":
        tips.append("where.py stops with an error without internet. Catch requests.RequestException.")
    return facts, tips


def git(*args):
    """(exit code, output) of a git command that only reads. (-1, "") if git is missing."""
    try:
        result = subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return -1, ""
    return result.returncode, result.stdout.strip()


def git_lines(*args):
    code, out = git(*args)
    return [line for line in out.splitlines() if line.strip()] if code == 0 else []


def remote_host(url):
    """Only the host of a remote, for example github.com. Never the rest of the address."""
    match = re.match(r"^(?:[a-z+]+://)?(?:[^@/]+@)?([^/:]+)", url)
    host = match.group(1).lower() if match else ""
    return host if host in ("github.com", "gitlab.com", "bitbucket.org") else "other"


def task_git():
    """git is set up; this folder is a repository; commits, branches, .venv, GitHub."""
    facts = python_facts()
    tips = []
    code, version = git("--version")
    if code != 0:
        facts.append(("git", "no"))
        tips.append("git is not found. Install it, then open a new terminal.")
        return facts, tips
    facts.append(("git", version.replace("git version", "").strip().split(" ")[0]))
    # Only if a name and an email are set, never what they are.
    name_set = git("config", "user.name")[1] != ""
    email_set = git("config", "user.email")[1] != ""
    facts.append(("git_name", yes_no(name_set)))
    facts.append(("git_email", yes_no(email_set)))
    if not (name_set and email_set):
        tips.append('Tell git who you are: git config --global user.name "Your Name" (and user.email).')

    code, top = git("rev-parse", "--show-toplevel")
    repo_here = code == 0 and same_folder(top, ".")
    facts.append(("repo", "no" if code != 0 else ("here" if repo_here else "above")))
    if code != 0:
        tips.append("This folder is not a git repository. Run: git init")
        return facts, tips
    if not repo_here:
        tips.append("The repository starts in a folder above this one. Run git init in the folder of the project.")

    code, count = git("rev-list", "--count", "HEAD")
    commits = int(count) if code == 0 and count.isdigit() else 0
    facts.append(("commits", str(commits)))
    changes = len(git_lines("status", "--porcelain"))
    facts.append(("changes", str(changes)))
    branches = git_lines("branch", "--format=%(refname:short)")
    facts.append(("branches", str(len(branches))))
    current = git("branch", "--show-current")[1]
    facts.append(("on_main", yes_no(current in ("main", "master"))))
    # A merge leaves the line "merge <branch>: ..." in the log of HEAD.
    merged = any(line.startswith("merge ") for line in git_lines("reflog", "--format=%gs"))
    facts.append(("merged", yes_no(merged)))
    if commits and changes:
        tips.append("Some changes are not committed yet. git status shows them.")

    facts.append(("gitignore", yes_no(Path(".gitignore").is_file())))
    if Path(".venv").exists():
        facts.append(("venv_ignored", yes_no(git("check-ignore", "-q", ".venv")[0] == 0)))
        venv_tracked = bool(git_lines("ls-files", ".venv"))
        facts.append(("venv_tracked", yes_no(venv_tracked)))
        if venv_tracked:
            tips.append("The repository holds .venv. Put .venv/ in .gitignore, then run: git rm -r --cached .venv")
    tracked = git_lines("ls-files")
    facts.append(("tracked", str(len(tracked))))
    facts.append(("colors_tracked", yes_no("colors.py" in tracked)))
    facts.append(("reqs_tracked", yes_no("requirements.txt" in tracked)))

    code, url = git("remote", "get-url", "origin")
    facts.append(("remote", remote_host(url) if code == 0 else "no"))
    code, _ = git("rev-parse", "--abbrev-ref", "@{u}")
    facts.append(("upstream", yes_no(code == 0)))
    if code == 0:
        code, ahead = git("rev-list", "--count", "@{u}..HEAD")
        facts.append(("ahead", ahead if code == 0 else "?"))
        if code == 0 and ahead != "0":
            tips.append("Some commits are not online yet. Run: git push")
    return facts, tips


DATE_LINE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")


def day_lines(text):
    """Lines of a forecast: the ones with a date like 2026-11-13."""
    return [line for line in printed_lines(text) if DATE_LINE.search(line)]


def task_weather():
    """The weather project: venv, requirements, git, and weather.py in four runs."""
    facts = python_facts()
    tips = []
    venv_facts(facts, tips)
    packages = installed_packages() or {}
    facts.append(("requests", packages.get("requests", "no")))
    reqs = Path("requirements.txt")
    names = requirement_names(read_text(reqs)) if reqs.is_file() else []
    facts.append(("reqs_requests", yes_no("requests" in names)))
    if "requests" not in names:
        tips.append("requirements.txt does not name requests. Run: pip freeze > requirements.txt")

    code, top = git("rev-parse", "--show-toplevel")
    facts.append(("repo", "no" if code != 0 else ("here" if same_folder(top, ".") else "above")))
    code, count = git("rev-list", "--count", "HEAD")
    facts.append(("commits", count if code == 0 and count.isdigit() else "0"))
    # check.py itself does not count: it is not part of the project.
    changes = [line for line in git_lines("status", "--porcelain") if not line.endswith("check.py")]
    facts.append(("changes", str(len(changes))))
    tracked = git_lines("ls-files")
    facts.append(("venv_tracked", yes_no(any(name.startswith(".venv/") for name in tracked))))
    facts.append(("weather_tracked", yes_no("weather.py" in tracked)))

    program = Path("weather.py")
    facts.append(("weather_exists", yes_no(program.is_file())))
    if not program.is_file():
        tips.append("There is no weather.py in this folder.")
        return facts, tips
    runs = [
        # name, what the check types, environment
        ("oslo", "Oslo\n3\n", None),
        ("missing", "Xqzwvbn\n3\n", None),
        ("baddays", "Oslo\nten\n0\n2\n", None),
        ("offline", "Oslo\n3\n", OFFLINE),
    ]
    for name, stdin, env in runs:
        ok, out, used = run_script(program, "requests", stdin=stdin, env_extra=env, timeout=30)
        facts.append((f"{name}_ok", ok))
        facts.append((f"{name}_lines", str(len(printed_lines(out)))))
        facts.append((f"{name}_days", str(len(day_lines(out)))))
        if name == "oslo":
            facts.append(("weather_requests", yes_no(used)))
            facts.append(("oslo_country", yes_no("norway" in out.lower())))
        if ok != "yes":
            tips.append(f"weather.py stops with an error in the run '{name}'. Try it yourself with the same input.")
    return facts, tips


SUMMARY = re.compile(r"(\d+) (passed|failed|errors?|skipped)")


def task_pytest():
    """Tests of the weather project: pytest is installed, and the tests pass."""
    facts = python_facts()
    tips = []
    venv_facts(facts, tips)
    packages = installed_packages() or {}
    facts.append(("pytest", packages.get("pytest", "no")))
    test_files = sorted(p.name for p in Path(".").glob("test_*.py"))
    facts.append(("test_files", str(len(test_files))))
    if not test_files:
        tips.append("There is no test file. Its name must start with test_, for example test_weather.py.")

    # Can the tests import weather.py without starting the tool?
    if Path("weather.py").is_file():
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
        try:
            result = subprocess.run([sys.executable, "-c", "import weather"], input="", capture_output=True,
                                    text=True, encoding="utf-8", errors="replace", timeout=15, env=env)
            ok = "yes" if result.returncode == 0 else "no"
        except subprocess.TimeoutExpired:
            ok = "timeout"
        facts.append(("import_ok", ok))
        if ok != "yes":
            tips.append('import weather starts the tool. Put its last lines under: if __name__ == "__main__":')

    if "pytest" not in packages:
        tips.append("pytest is not installed here. With the venv active, run: pip install pytest")
        return facts, tips
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no"],
            input="", capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120, env=env,
        )
    except subprocess.TimeoutExpired:
        facts.append(("pytest_exit", "timeout"))
        tips.append("pytest did not end in 2 minutes. Does a test wait for input()?")
        return facts, tips
    counts = {"passed": 0, "failed": 0, "error": 0}
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    for count, kind in SUMMARY.findall(lines[-1] if lines else ""):
        counts["error" if kind.startswith("error") else kind if kind in counts else "error"] += int(count)
    facts.append(("pytest_exit", str(result.returncode)))
    facts.append(("tests_passed", str(counts["passed"])))
    facts.append(("tests_failed", str(counts["failed"])))
    facts.append(("tests_errors", str(counts["error"])))
    if counts["failed"] or counts["error"]:
        tips.append("Some tests fail. Run python -m pytest and read the report.")

    # Do the tests catch bugs? Each run puts a broken function into weather
    # (in memory only: no file changes) and runs pytest. Good tests fail.
    if facts_value(facts, "import_ok") == "yes" and counts["passed"] and not counts["failed"]:
        for name, broken in MUTANTS:
            code = "import sys, weather\n" + broken + f"\nweather.{name} = {name}\n" + \
                "import pytest\nsys.exit(pytest.main(['-q', '-p', 'no:cacheprovider', '--color=no']))\n"
            try:
                result = subprocess.run([sys.executable, "-c", code], input="", capture_output=True, text=True,
                                        encoding="utf-8", errors="replace", timeout=120, env=env)
                caught = "yes" if result.returncode == 1 else "no"
            except subprocess.TimeoutExpired:
                caught = "timeout"
            facts.append((f"catches_{name}", caught))
            if caught == "no":
                tips.append(f"Your tests pass with a broken {name}. Add a test that would catch it.")
    return facts, tips


# Builds the window of greeter.py with the real tkinter, without waiting in
# mainloop, then types "Ana", clicks the first button, and looks at the
# labels. It prints only counts and yes or no.
GREETER = r'''
import json, runpy, sys, tkinter
called = []
tkinter.Misc.mainloop = lambda self, n=0: called.append(1)
facts = {}
runpy.run_path(sys.argv[1], run_name="__main__")
root = tkinter._default_root
if root is None:
    print(json.dumps({"window": "no"}))
    sys.exit(0)
def walk(widget):
    for child in widget.winfo_children():
        yield child
        yield from walk(child)
def shown(w):
    while w is not root:
        if not w.winfo_manager():
            return False
        w = w.master
    return True
def kind(w):
    return w.winfo_class().lstrip("T")
widgets = [w for w in walk(root) if shown(w)]
labels = [w for w in widgets if kind(w) == "Label"]
buttons = [w for w in widgets if kind(w) == "Button"]
entries = [w for w in widgets if kind(w) == "Entry"]
facts = {"window": "yes", "mainloop": "yes" if called else "no", "title_set": "yes" if root.title() not in ("tk", "") else "no",
         "labels": len(labels), "buttons": len(buttons), "entries": len(entries)}
greets = "no"
if entries and buttons:
    entries[0].delete(0, "end")
    entries[0].insert(0, "Ana")
    try:
        buttons[0].invoke()
        greets = "yes" if any("Ana" in str(w.cget("text")) for w in labels) else "no"
    except Exception as error:
        greets = "error"
facts["greets"] = greets
print(json.dumps(facts))
root.destroy()
'''


def task_greeter():
    """greeter.py of the tkinter lesson: a window that greets the name in its entry."""
    facts = python_facts()
    tips = []
    try:
        import tkinter  # noqa: F401
        facts.append(("tkinter", "yes"))
    except ImportError:
        facts.append(("tkinter", "no"))
        tips.append("tkinter is missing. On Linux: sudo apt install python3-tk. Elsewhere, install Python from python.org.")
        return facts, tips
    program = Path("greeter.py")
    facts.append(("greeter_exists", yes_no(program.is_file())))
    if not program.is_file():
        tips.append("There is no greeter.py in this folder.")
        return facts, tips
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    try:
        result = subprocess.run([sys.executable, "-c", GREETER, str(program)], input="", capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=20, env=env)
    except subprocess.TimeoutExpired:
        facts.append(("greeter_ok", "timeout"))
        tips.append("greeter.py did not build its window in 20 seconds.")
        return facts, tips
    lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
    if result.returncode != 0 or not lines:
        facts.append(("greeter_ok", "no"))
        last = (result.stderr.strip().splitlines() or ["?"])[-1]
        facts.append(("greeter_error", last.split(":")[0]))
        tips.append("greeter.py stops with an error. Run it, and read the message.")
        return facts, tips
    import json
    found = json.loads(lines[-1])
    facts.append(("greeter_ok", "yes"))
    for key in ("window", "mainloop", "title_set", "labels", "buttons", "entries", "greets"):
        if key in found:
            facts.append((key, str(found[key])))
    if found.get("greets") != "yes":
        tips.append('Type a name, click the button: a label must show it, like "Hello, Ana!".')
    return facts, tips


# Runs todo.py twice with the real tkinter (no mainloop, no message windows)
# in a temporary folder: add, refuse an empty task, save, load, remove.
TODO = r'''
import json, os, runpy, sys, tkinter
import tkinter.messagebox as box
shown = []
for name in ("showinfo", "showwarning", "showerror"):
    setattr(box, name, lambda *a, **k: shown.append(1) or "ok")
box.askyesno = box.askokcancel = lambda *a, **k: True
tkinter.Misc.mainloop = lambda self, n=0: None
def start():
    runpy.run_path("todo.py", run_name="__main__")
    root = tkinter._default_root
    found = {"entry": None, "list": None, "Add": None, "Remove": None}
    def walk(w):
        for child in w.winfo_children():
            kind = child.winfo_class().lstrip("T")
            if kind == "Entry" and found["entry"] is None:
                found["entry"] = child
            elif kind == "Listbox" and found["list"] is None:
                found["list"] = child
            elif kind == "Button" and str(child.cget("text")) in ("Add", "Remove"):
                found[str(child.cget("text"))] = child
            walk(child)
    if root is not None:
        walk(root)
    return root, found
def saved():
    try:
        return json.dumps(json.load(open("tasks.json", encoding="utf-8")))
    except Exception:
        return ""
yes = lambda ok: "yes" if ok else "no"
root, w = start()
if root is None or None in w.values():
    print(json.dumps({"ok": "nobuttons"}))
    sys.exit(0)
facts = {"ok": "yes", "starts_empty": yes(w["list"].size() == 0)}
before = len(shown)
w["entry"].delete(0, "end"); w["entry"].insert(0, "   "); w["Add"].invoke()
facts["refuses_empty"] = yes(w["list"].size() == 0 and len(shown) > before)
w["entry"].delete(0, "end"); w["entry"].insert(0, "Buy milk"); w["Add"].invoke()
facts["adds"] = yes(tuple(w["list"].get(0, "end")) == ("Buy milk",))
facts["saves"] = yes("Buy milk" in saved())
root.destroy()
root, w = start()
facts["loads"] = yes(w["list"] is not None and "Buy milk" in w["list"].get(0, "end"))
if w["list"] is not None and w["Remove"] is not None:
    if w["list"].size() == 0:
        w["entry"].delete(0, "end"); w["entry"].insert(0, "Buy milk"); w["Add"].invoke()
    had = "Buy milk" in w["list"].get(0, "end")
    w["list"].selection_clear(0, "end"); w["list"].selection_set(0); w["Remove"].invoke()
    facts["removes"] = yes(had and "Buy milk" not in w["list"].get(0, "end"))
print(json.dumps(facts))
root.destroy()
'''


def task_todo():
    """todo.py of the app lesson: add, refuse an empty task, save, load, remove."""
    import json
    import shutil
    import tempfile
    facts = python_facts()
    tips = []
    try:
        import tkinter  # noqa: F401
        facts.append(("tkinter", "yes"))
    except ImportError:
        facts.append(("tkinter", "no"))
        tips.append("tkinter is missing. On Linux: sudo apt install python3-tk.")
        return facts, tips
    facts.append(("todo_exists", yes_no(Path("todo.py").is_file())))
    if not Path("todo.py").is_file():
        tips.append("There is no todo.py in this folder.")
        return facts, tips
    # A copy of the program in a temporary folder: your tasks.json stays as it is.
    work = tempfile.mkdtemp(prefix="zeropy-todo-")
    try:
        for source in Path(".").glob("*.py"):
            if source.name != "check.py":
                shutil.copy(source, work)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
        try:
            result = subprocess.run([sys.executable, "-c", TODO], cwd=work, input="", capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=30, env=env)
        except subprocess.TimeoutExpired:
            facts.append(("todo_ok", "timeout"))
            tips.append("todo.py did not build its window in 30 seconds.")
            return facts, tips
    finally:
        shutil.rmtree(work, ignore_errors=True)
    lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
    if result.returncode != 0 or not lines:
        facts.append(("todo_ok", "no"))
        last = (result.stderr.strip().splitlines() or ["?"])[-1]
        facts.append(("todo_error", last.split(":")[0]))
        tips.append("todo.py stops with an error. Run it, click each button, and read the terminal.")
        return facts, tips
    found = json.loads(lines[-1])
    facts.append(("todo_ok", found.get("ok", "no")))
    if found.get("ok") == "nobuttons":
        tips.append("The check needs the buttons Add and Remove, one Entry and one Listbox.")
        return facts, tips
    for key in ("starts_empty", "adds", "saves", "loads", "removes", "refuses_empty"):
        if key in found:
            facts.append((key, found[key]))
    if "no" in found.values():
        tips.append("Something does not work yet: look for the lines with 'no' above.")
    return facts, tips


# Runs a copy of todo.py from another folder, with a temporary home folder,
# and adds "Buy milk": where does the app save it?
WHERE = r'''
import json, runpy, sys, tkinter
import tkinter.messagebox as box
for name in ("showinfo", "showwarning", "showerror"):
    setattr(box, name, lambda *a, **k: "ok")
tkinter.Misc.mainloop = lambda self, n=0: None
runpy.run_path(sys.argv[1], run_name="__main__")
root = tkinter._default_root
entry = add = None
def walk(w):
    global entry, add
    for child in w.winfo_children():
        kind = child.winfo_class().lstrip("T")
        if kind == "Entry" and entry is None:
            entry = child
        elif kind == "Button" and str(child.cget("text")) == "Add":
            add = child
        walk(child)
if root is not None:
    walk(root)
if entry is None or add is None:
    print(json.dumps({"ok": "nobuttons"}))
    sys.exit(0)
entry.insert(0, "Buy milk")
add.invoke()
print(json.dumps({"ok": "yes"}))
root.destroy()
'''


def data_place():
    """Where todo.py saves: "home", "program" (next to the file), "cwd" (where it was started), or "none"."""
    import shutil
    import tempfile
    work = Path(tempfile.mkdtemp(prefix="zeropy-where-"))
    try:
        program, started, home = work / "program", work / "started", work / "home"
        for folder in (program, started, home):
            folder.mkdir()
        for source in Path(".").glob("*.py"):
            if source.name != "check.py":
                shutil.copy(source, program)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8",
                   HOME=str(home), USERPROFILE=str(home))
        try:
            result = subprocess.run([sys.executable, "-c", WHERE, str(program / "todo.py")], cwd=started, input="",
                                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, env=env)
        except subprocess.TimeoutExpired:
            return "timeout"
        if result.returncode != 0 or '"ok": "yes"' not in result.stdout:
            return "nobuttons" if "nobuttons" in result.stdout else "error"

        def holds(folder):
            for path in folder.rglob("*"):
                if path.is_file() and path.suffix != ".py":
                    try:
                        if "Buy milk" in path.read_text(encoding="utf-8", errors="replace"):
                            return True
                    except OSError:
                        pass
            return False

        for name, folder in (("home", home), ("program", program), ("cwd", started)):
            if holds(folder):
                return name
        return "none"
    finally:
        shutil.rmtree(work, ignore_errors=True)


def task_build():
    """The packaged to-do app: where it saves, PyInstaller, the built program, .gitignore."""
    facts = python_facts()
    tips = []
    venv_facts(facts, tips)
    packages = installed_packages() or {}
    facts.append(("pyinstaller", packages.get("pyinstaller", "no")))
    if not Path("todo.py").is_file():
        facts.append(("todo_exists", "no"))
        tips.append("There is no todo.py in this folder. Run the check in the folder of your to-do app.")
        return facts, tips
    try:
        import tkinter  # noqa: F401
        place = data_place()
    except ImportError:
        place = "notk"
    facts.append(("data_place", place))
    if place == "cwd":
        tips.append("todo.py saves where it was started. Save in the home folder: Path.home() / \"todo-tasks.json\".")
    elif place == "program":
        tips.append("todo.py saves next to itself. A program from PyInstaller --onefile runs from a temporary folder: use Path.home().")
    dist = Path("dist")
    candidates = [dist / "todo.exe", dist / "todo.app", dist / "todo", dist / "todo" / "todo.exe", dist / "todo" / "todo"]
    built = next((c for c in candidates if c.exists() and (c.is_file() or c.suffix == ".app")), None)
    facts.append(("program", "no" if built is None else ("app" if built.suffix == ".app" else "yes")))
    if built is None:
        tips.append("There is no built program in dist. Run: pyinstaller --onefile --windowed todo.py")
    else:
        fresh = built.stat().st_mtime >= Path("todo.py").stat().st_mtime
        facts.append(("program_fresh", yes_no(fresh)))
        if not fresh:
            tips.append("todo.py changed after the build. Build again, so the program has the new code.")
    facts.append(("spec", yes_no(Path("todo.spec").is_file())))
    ignored = set()
    if Path(".gitignore").is_file():
        for line in read_text(Path(".gitignore")).splitlines():
            ignored.add(line.strip().strip("/"))
    facts.append(("ignores_build", yes_no("build" in ignored and "dist" in ignored)))
    if not ("build" in ignored and "dist" in ignored):
        tips.append("Put build/ and dist/ into .gitignore: they are made again by each build.")
    return facts, tips


# Builds the window of app.py with the real tkinter (no mainloop, message
# windows recorded), types "1" into every entry, and clicks every button.
APP = r'''
import json, runpy, sys, tkinter
import tkinter.messagebox as box
errors = []
for name in ("showinfo", "showwarning", "showerror"):
    setattr(box, name, lambda *a, **k: "ok")
box.askyesno = box.askokcancel = lambda *a, **k: True
tkinter.Misc.mainloop = lambda self, n=0: None
tkinter.Tk.report_callback_exception = lambda self, kind, value, tb: errors.append(kind.__name__)
runpy.run_path("app.py", run_name="__main__")
root = tkinter._default_root
if root is None:
    print(json.dumps({"window": "no"}))
    sys.exit(0)
def walk(w):
    for child in w.winfo_children():
        yield child
        yield from walk(child)
def kind(w):
    return w.winfo_class().lstrip("T")
widgets = [w for w in walk(root) if w.winfo_manager()]
buttons = [w for w in widgets if kind(w) == "Button" and str(w.cget("command"))]
entries = [w for w in widgets if kind(w) == "Entry"]
lists = [w for w in widgets if kind(w) == "Listbox"]
facts = {"window": "yes", "title_set": "yes" if root.title() not in ("tk", "") else "no",
         "buttons": len(buttons), "inputs": len(entries) + len(lists)}
rounds = [("1", b) for b in buttons] + [("", b) for b in buttons]
for text, button in rounds:
    try:
        if not root.winfo_exists():
            break
        for entry in entries:
            entry.delete(0, "end")
            entry.insert(0, text)
        for lb in lists:
            if lb.size():
                lb.selection_clear(0, "end")
                lb.selection_set(0)
        button.invoke()
    except tkinter.TclError:
        break
    except Exception as error:
        errors.append(type(error).__name__)
facts["clicks_ok"] = "yes" if not errors else "no"
if errors:
    facts["click_error"] = errors[0]
print(json.dumps(facts))
try:
    root.destroy()
except tkinter.TclError:
    pass
'''


def run_tests_quiet(env):
    """(passed, failed, errors) of python -m pytest -q here, or None without pytest."""
    try:
        result = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "--color=no"],
                                input="", capture_output=True, text=True, encoding="utf-8", errors="replace",
                                timeout=120, env=env)
    except subprocess.TimeoutExpired:
        return None
    counts = {"passed": 0, "failed": 0, "error": 0}
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    for count, kind in SUMMARY.findall(lines[-1] if lines else ""):
        counts["error" if kind.startswith("error") else kind if kind in counts else "error"] += int(count)
    return counts["passed"], counts["failed"], counts["error"]


def task_capstone():
    """The final project: venv, requirements, git, tests, a window that saves at home, a build."""
    import json
    import shutil
    import tempfile
    facts = python_facts()
    tips = []
    venv_facts(facts, tips)
    packages = installed_packages() or {}
    reqs = Path("requirements.txt")
    facts.append(("requirements", yes_no(reqs.is_file())))
    readme = Path("README.md")
    readme_lines = len([l for l in read_text(readme).splitlines() if l.strip()]) if readme.is_file() else 0
    facts.append(("readme_lines", str(readme_lines)))

    code, top = git("rev-parse", "--show-toplevel")
    facts.append(("repo", "no" if code != 0 else ("here" if same_folder(top, ".") else "above")))
    code, count = git("rev-list", "--count", "HEAD")
    facts.append(("commits", count if code == 0 and count.isdigit() else "0"))
    changes = [line for line in git_lines("status", "--porcelain") if not line.endswith("check.py")]
    facts.append(("changes", str(len(changes))))
    tracked = git_lines("ls-files")
    facts.append(("venv_tracked", yes_no(any(name.startswith(".venv/") for name in tracked))))
    facts.append(("build_tracked", yes_no(any(name.startswith(("build/", "dist/")) for name in tracked))))

    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    test_files = list(Path(".").glob("test_*.py"))
    facts.append(("test_files", str(len(test_files))))
    if "pytest" in packages and test_files:
        counts = run_tests_quiet(env)
        if counts is None:
            facts.append(("tests_passed", "timeout"))
        else:
            facts.append(("tests_passed", str(counts[0])))
            facts.append(("tests_failed", str(counts[1] + counts[2])))
    elif "pytest" not in packages:
        tips.append("pytest is not installed in this venv. Run: pip install pytest")

    app = Path("app.py")
    facts.append(("app_exists", yes_no(app.is_file())))
    if app.is_file():
        try:
            import tkinter  # noqa: F401
        except ImportError:
            facts.append(("window", "notk"))
        else:
            # A copy in a temporary folder, with a temporary home: your data stays as it is.
            work = Path(tempfile.mkdtemp(prefix="zeropy-capstone-"))
            try:
                program, home = work / "program", work / "home"
                program.mkdir()
                home.mkdir()
                for source in Path(".").glob("*.py"):
                    if source.name != "check.py":
                        shutil.copy(source, program)
                for folder in Path(".").iterdir():
                    if folder.is_dir() and not folder.name.startswith(".") and folder.name not in ("build", "dist", "__pycache__"):
                        if any(folder.glob("*.py")):
                            shutil.copytree(folder, program / folder.name, dirs_exist_ok=True)
                run_env = dict(env, HOME=str(home), USERPROFILE=str(home))
                try:
                    result = subprocess.run([sys.executable, "-c", APP], cwd=program, input="", capture_output=True,
                                            text=True, encoding="utf-8", errors="replace", timeout=30, env=run_env)
                    lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
                    if result.returncode != 0 or not lines:
                        facts.append(("window", "error"))
                        last = (result.stderr.strip().splitlines() or ["?"])[-1]
                        facts.append(("app_error", last.split(":")[0]))
                    else:
                        for key, value in json.loads(lines[-1]).items():
                            facts.append((key, str(value)))
                        facts.append(("saves_home", yes_no(any(p.is_file() for p in home.rglob("*")))))
                except subprocess.TimeoutExpired:
                    facts.append(("window", "timeout"))
            finally:
                shutil.rmtree(work, ignore_errors=True)

    dist = Path("dist")
    built = next((c for c in (dist / "app.exe", dist / "app.app", dist / "app") if c.exists()), None)
    facts.append(("program", "no" if built is None else "yes"))
    if built is not None and app.is_file():
        facts.append(("program_fresh", yes_no(built.stat().st_mtime >= app.stat().st_mtime)))
    return facts, tips


SHOP_CASES = [
    ("[('tea', 2.5, 2), ('cake', 4.0, 1), ('milk', 1.5, 3)]", 13.5),
    ("[('pen', 1.25, 4)]", 5.0),
    ("[]", 0),
]


def task_shop():
    """shop.py of the debugger lesson: total() is fixed."""
    facts = python_facts()
    tips = []
    program = Path("shop.py")
    facts.append(("shop_exists", yes_no(program.is_file())))
    if not program.is_file():
        tips.append("There is no shop.py in this folder.")
        return facts, tips
    lines = ["import io, contextlib", "with contextlib.redirect_stdout(io.StringIO()):", "    import shop"]
    lines += [f"print(repr(shop.total({cart})))" for cart, _ in SHOP_CASES]
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    try:
        result = subprocess.run([sys.executable, "-c", "\n".join(lines)], input="", capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=15, env=env)
    except subprocess.TimeoutExpired:
        facts.append(("shop_ok", "timeout"))
        tips.append("shop.py did not end in 15 seconds.")
        return facts, tips
    facts.append(("shop_ok", "yes" if result.returncode == 0 else "no"))
    if result.returncode != 0:
        last = (result.stderr.strip().splitlines() or ["?"])[-1]
        facts.append(("shop_error", last.split(":")[0]))
        tips.append("shop.py stops with an error. Run it and read the message.")
        return facts, tips
    got = result.stdout.split()
    right = 0
    for (cart, want), text in zip(SHOP_CASES, got):
        try:
            right += abs(float(text) - want) < 1e-9
        except ValueError:
            pass
    facts.append(("total_right", f"{right}/{len(SHOP_CASES)}"))
    if right < len(SHOP_CASES):
        tips.append("total() still gives a wrong answer. Set a breakpoint in its loop, and watch result.")
    return facts, tips


# Broken versions of the functions of the weather tool.
MUTANTS = [
    ("parse_days", "def parse_days(text):\n    return int(text.strip())"),
    ("format_day", "def format_day(day):\n"
                   "    return f\"{day['date']}: {day['high']} to {day['low']} \\u00b0C, rain {day['rain']} mm\""),
]


CARS_HEADER = "weight,fuel"


def task_data():
    """Data and AI: pandas and scikit-learn in a venv, cars.csv, and model.py."""
    facts = python_facts()
    tips = []
    venv_facts(facts, tips)
    packages = installed_packages() or {}
    facts.append(("pandas", packages.get("pandas", "no")))
    facts.append(("sklearn", packages.get("scikit-learn", "no")))
    if "pandas" not in packages or "scikit-learn" not in packages:
        tips.append("pandas or scikit-learn is not installed here. With the venv active: pip install pandas scikit-learn")

    data = Path("cars.csv")
    facts.append(("cars_exists", yes_no(data.is_file())))
    if data.is_file():
        lines = [line.strip() for line in read_text(data).splitlines() if line.strip()]
        facts.append(("cars_header", yes_no(bool(lines) and lines[0].replace(" ", "") == CARS_HEADER)))
        facts.append(("cars_rows", str(max(0, len(lines) - 1))))
    else:
        tips.append("There is no cars.csv in this folder.")

    program = Path("model.py")
    facts.append(("model_exists", yes_no(program.is_file())))
    if not program.is_file():
        tips.append("There is no model.py in this folder.")
        return facts, tips
    ok, out, used = run_script(program, "pandas,sklearn", timeout=90)
    facts.append(("model_ok", ok))
    facts.append(("model_libs", yes_no(used)))
    found = re.search(r"MAE\D*?(\d+(?:\.\d+)?)", out)
    facts.append(("mae", found.group(1) if found else "none"))
    if ok != "yes":
        tips.append("model.py stops with an error. Run python model.py and read the message.")
    elif not used:
        tips.append("model.py does not use both pandas and scikit-learn (sklearn).")
    elif not found:
        tips.append("model.py does not print a line with MAE and a number, like: MAE: 0.21")
    return facts, tips


# Imports app.py as a module (like `flask --app app run` does) and asks its
# app for two pages with Flask's test client: no server, no network. A file
# that starts the server on import never ends: then the probe times out.
FLASK_PROBE = """import importlib.util, json, sys
sys.path.insert(0, ".")
spec = importlib.util.spec_from_file_location("app", sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules["app"] = module
spec.loader.exec_module(module)
from flask import Flask
apps = [v for v in vars(module).values() if isinstance(v, Flask)]
out = {"found": bool(apps)}
if apps:
    app = apps[0]
    out["routes"] = len([r for r in app.url_map.iter_rules() if r.endpoint != "static"])
    client = app.test_client()
    out["home"] = client.get("/").status_code
    out["missing"] = client.get("/zeropy-no-such-page").status_code
print("ZEROPY-PROBE " + json.dumps(out))
"""


def task_flask():
    """Networks and the web: Flask in a venv, and an app.py that Flask can import."""
    facts = python_facts()
    tips = []
    venv_facts(facts, tips)
    packages = installed_packages() or {}
    facts.append(("flask", packages.get("flask", "no")))
    if "flask" not in packages:
        tips.append("Flask is not installed here. With the venv active: pip install flask")
    reqs = Path("requirements.txt")
    facts.append(("reqs_flask", yes_no(reqs.is_file() and "flask" in requirement_names(read_text(reqs)))))
    if not reqs.is_file():
        tips.append("There is no requirements.txt yet. Make it with: pip freeze > requirements.txt")

    program = Path("app.py")
    facts.append(("app_exists", yes_no(program.is_file())))
    if not program.is_file():
        tips.append("There is no app.py in this folder.")
        return facts, tips
    try:
        result = subprocess.run(
            [sys.executable, "-c", FLASK_PROBE, str(program)],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
            env=dict(os.environ, PYTHONIOENCODING="utf-8"),
        )
    except subprocess.TimeoutExpired:
        facts.append(("app_ok", "timeout"))
        tips.append('app.py starts the server when it is imported. Put app.run() under: if __name__ == "__main__":')
        return facts, tips
    found = re.search(r"ZEROPY-PROBE (\{.*\})", result.stdout)
    data = json.loads(found.group(1)) if found else {}
    facts.append(("app_ok", "yes" if found else "no"))
    facts.append(("app_found", yes_no(data.get("found"))))
    facts.append(("routes", str(data.get("routes", 0))))
    facts.append(("home_status", str(data.get("home", 0))))
    facts.append(("missing_status", str(data.get("missing", 0))))
    if not found:
        tips.append("app.py stops with an error when it is imported. Run python app.py and read the message.")
    elif not data.get("found"):
        tips.append("app.py has no Flask app. Make one with: app = Flask(__name__)")
    elif data.get("home") != 200:
        tips.append("The home page / does not answer 200. Open it in the browser and read the server's log.")
    return facts, tips


def facts_value(facts, key):
    return next((value for k, value in facts if k == key), None)


TASKS = {
    "python": task_python,
    "hello": task_hello,
    "venv": task_venv,
    "git": task_git,
    "api": task_api,
    "weather": task_weather,
    "pytest": task_pytest,
    "shop": task_shop,
    "greeter": task_greeter,
    "todo": task_todo,
    "build": task_build,
    "capstone": task_capstone,
    "data": task_data,
    "flask": task_flask,
}


def main(argv):
    if len(argv) < 2 or argv[1] not in TASKS:
        print("Name a task, for example:  python check.py python")
        print("Tasks: " + ", ".join(sorted(TASKS)))
        print("Is the task of the lesson not in the list? Download check.py again from the course.")
        return 2
    name = argv[1]
    facts, tips = TASKS[name]()
    lines = [f"task: {name}", f"check: {CHECK_VERSION}"]
    # No space at the end of a line: a terminal may drop it when you copy.
    lines += [f"{key}: {clean(value)}".rstrip() for key, value in facts]

    print(f"ZeroPy check: {name}")
    for key, value in facts:
        print(f"  {key:18} {clean(value)}")
    for tip in tips:
        print(f"  Note: {tip}")
    print()
    print("Copy all lines from the first dashes to the last dashes into the lesson:")
    print("----- ZEROPY CHECK -----")
    for line in lines:
        print(line)
    print(f"seal: {seal(lines)}")
    print("----- END -----")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
