# A pretend Linux shell for the terminal steps. Loaded after harness.py.
#
# The page keeps the whole state (files, folders, the working folder, the
# history, variables, processes, services, the journal) and sends it with
# each command; shell() gives back the output and the new state. Nothing here
# touches a real disk or the learner's computer: the file system is a
# dictionary. The commands behave like their Linux versions (output and error
# messages), for the cases a beginner meets.
#
# The shell part reads bash: quotes, $variables, $1, $?, $(command),
# $((arithmetic)), pipes, redirects, ; && ||, if/elif/else/fi, for, while,
# until, break, continue, exit. Processes, services (systemd) and the journal
# are pretend too: a learner's Python program "runs" as a service with the
# same Python as the lessons, on a pretend clock.
import ast
import fnmatch
import json
import posixpath
import re
import shlex

HOME = "/home/pi"
USER = "pi"
HOST = "raspberrypi"
SHELL_PID = 611
_MAX_OUT = 20_000
_MAX_DEPTH = 8  # scripts that run scripts
_MAX_STEPS = 20_000  # commands in one line, with every round of every loop
_MAX_ROUNDS = 1_000  # rounds of one loop
_PY_SECONDS = 30  # pretend seconds a Python program may sleep before it is stopped
_BASE_DIRS = {
    "/", "/home", HOME, "/tmp", "/etc", "/etc/systemd", "/etc/systemd/system",
    "/var", "/var/log", "/usr", "/usr/bin", "/dev", "/boot", "/boot/firmware", "/proc",
}
_BOOT_SECONDS = 8040  # the Pi started 2:14 before 10:00:00

_HELP = {
    "pwd": "pwd: print the working directory (where you are).",
    "ls": "ls [-l] [-a] [path]: list what is in a directory.",
    "cd": "cd [path]: change the working directory. cd alone goes home (~).",
    "mkdir": "mkdir [-p] name: make a directory. -p makes the parents too.",
    "touch": "touch file: make an empty file, or update the time of a file.",
    "cat": "cat file...: print the content of files.",
    "echo": "echo [-n] [-e] text: print the text. echo text > file writes it to a file.",
    "printf": "printf format values: print with a format, like printf '%s has %d files\\n' docs 3.",
    "rm": "rm [-r] [-f] path: remove files. -r also removes directories.",
    "rmdir": "rmdir dir: remove an empty directory.",
    "cp": "cp [-r] source target: copy. -r copies directories.",
    "mv": "mv source target: move or rename.",
    "head": "head [-n N] file: the first lines (10 by default).",
    "tail": "tail [-n N] file: the last lines (10 by default).",
    "wc": "wc [-l] [-w] [-c] file: count lines, words and characters.",
    "grep": "grep [-i] [-n] [-v] [-c] [-r] pattern file: the lines that contain the pattern.",
    "sort": "sort [-r] [-n] file: sort lines. -r: reverse, -n: as numbers.",
    "uniq": "uniq [-c] file: remove repeated lines that are next to each other.",
    "find": "find [path] [-name pattern] [-type f|d]: search for files and directories.",
    "chmod": "chmod mode file: change who may read, write or run a file (755, +x).",
    "python3": "python3 [-u] file.py: run a Python program. -u: print at once (no buffer).",
    "nano": "nano file: a small text editor.",
    "sudo": "sudo command: run a command as the administrator (root).",
    "apt": "apt install name: install a program (needs sudo).",
    "whoami": "whoami: your user name.",
    "hostname": "hostname: the name of this computer.",
    "date": "date: the date and the time.",
    "history": "history: the commands you typed.",
    "clear": "clear: empty the screen.",
    "man": "man command: help for a command.",
    "test": "test expression, or [ expression ]: true or false, as the exit status. -f file, -d dir, -z text, a = b, 3 -gt 2.",
    "export": "export NAME=value: a variable that programs and scripts started from here can see.",
    "seq": "seq [first] last: the numbers from first (1) to last, one per line.",
    "sleep": "sleep seconds: wait.",
    "ps": "ps aux: every process (running program), with its PID, user, CPU and memory.",
    "top": "top: the processes that use the most CPU, with the memory of the computer.",
    "kill": "kill PID: ask a process to stop. kill -9 PID: stop it at once (the last resort).",
    "pkill": "pkill name: kill the processes with this name.",
    "free": "free -h: the memory (RAM): total, used, free and available.",
    "df": "df -h: the space on the disks (the SD card): size, used, free.",
    "uptime": "uptime: how long the computer has run, and its load.",
    "systemctl": "systemctl status|start|stop|restart|enable|disable name: control a service. Changes need sudo.",
    "journalctl": "journalctl [-u name] [-n N] [-p err] [-b]: read the system log (the journal).",
    "reboot": "reboot: restart the computer (needs sudo).",
    "which": "which command: where the program of a command is.",
    "type": "type name: what a name is: a program, a shell builtin or a keyword.",
    "basename": "basename path [suffix]: the last part of a path.",
    "dirname": "dirname path: the path without its last part.",
}

_KEYWORDS = {"if", "then", "elif", "else", "fi", "for", "in", "do", "done", "while", "until", "case", "esac", "function", "select", "!", "{", "}"}
_BUILTINS = {"cd", "echo", "printf", "pwd", "export", "unset", "exit", "test", "[", "true", "false", "read", "source", ".", "break", "continue", "history", "type", "kill"}
_PROGRAMS = {
    "ls", "mkdir", "touch", "cat", "rm", "rmdir", "cp", "mv", "head", "tail", "wc", "grep", "sort", "uniq", "find",
    "chmod", "whoami", "hostname", "date", "clear", "man", "nano", "sudo", "apt", "apt-get", "bash", "sh",
    "python3", "python", "seq", "sleep", "ps", "top", "pkill", "killall", "free", "df", "uptime", "systemctl",
    "journalctl", "reboot", "shutdown", "poweroff", "which", "basename", "dirname", "env", "printenv", "tee",
}
_REDIRECTS = {">", ">>", "<", "2>", "2>>", "&>", "2>&1", ">&2"}

# The services of a fresh Raspberry Pi OS (Bookworm). ssh is off until you turn it on.
_UNITS = {
    "ssh": {
        "desc": "OpenBSD Secure Shell server", "exec": "/usr/sbin/sshd -D", "comm": "sshd",
        "proc": "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups",
        "lines": ["Server listening on 0.0.0.0 port 22.", "Server listening on :: port 22."],
        "enabled": False, "active": False,
    },
    "cron": {
        "desc": "Regular background program processing daemon", "exec": "/usr/sbin/cron -f", "comm": "cron",
        "proc": "/usr/sbin/cron -f", "lines": ["(CRON) INFO (pidfile fd = 3)", "(CRON) INFO (Running @reboot jobs)"],
        "enabled": True, "active": True, "pid": 412,
    },
    "bluetooth": {
        "desc": "Bluetooth service", "exec": "/usr/libexec/bluetooth/bluetoothd", "comm": "bluetoothd",
        "proc": "/usr/libexec/bluetooth/bluetoothd", "lines": ["Starting SDP server"],
        "enabled": True, "active": True, "pid": 398,
    },
}
# Processes that always run (PID, user, %CPU, %MEM, command).
_BASE_PROCS = [
    (1, "root", 0.1, 0.3, "/sbin/init splash"),
    (2, "root", 0.0, 0.0, "[kthreadd]"),
    (245, "root", 0.0, 0.4, "/usr/lib/systemd/systemd-journald"),
    (280, "root", 0.0, 0.2, "/usr/lib/systemd/systemd-udevd"),
    (498, "root", 0.1, 0.5, "/usr/sbin/NetworkManager --no-daemon"),
]
_MEM_MB = 3794.2
# The groups of a new Raspberry Pi OS, with the first user (pi) in all of them.
_GROUPS = [("adm", 4), ("dialout", 20), ("cdrom", 24), ("sudo", 27), ("audio", 29), ("video", 44), ("plugdev", 46),
           ("games", 60), ("users", 100), ("input", 102), ("render", 105), ("netdev", 106), ("gpio", 993), ("i2c", 994), ("spi", 995)]
_HOSTS = """127.0.0.1\tlocalhost
::1\t\tlocalhost ip6-localhost ip6-loopback
ff02::1\t\tip6-allnodes
ff02::2\t\tip6-allrouters

127.0.1.1\t\traspberrypi
"""

_OS_RELEASE = """PRETTY_NAME="Debian GNU/Linux 13 (trixie)"
NAME="Debian GNU/Linux"
VERSION_ID="13"
VERSION="13 (trixie)"
VERSION_CODENAME=trixie
ID=debian
HOME_URL="https://www.debian.org/"
SUPPORT_URL="https://www.debian.org/support"
BUG_REPORT_URL="https://bugs.debian.org/"
"""
# Packages that `apt update` finds new versions of (names of real Raspberry Pi OS packages).
_UPGRADES = ["raspi-firmware", "linux-image-rpi-v8", "linux-image-rpi-2712", "rpi-eeprom", "libcamera0.5",
             "rpicam-apps", "chromium", "chromium-common", "python3-gpiozero", "rpi-connect", "openssh-server", "tzdata"]



class Quoted(str):
    """A word that was in quotes (kept for older code that marks words)."""


class _Exit(Exception):
    """A command failed: message for the screen, and its exit code."""

    def __init__(self, message, code=1):
        super().__init__(message)
        self.message = message
        self.code = code


class _Syntax(Exception):
    """The code cannot be read. `end` names a missing keyword at the end."""

    def __init__(self, message, line, end=None):
        super().__init__(message)
        self.message = message
        self.line = line
        self.end = end


class _ScriptExit(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class _Stop(Exception):
    """Too many commands or too much output: like Ctrl+C."""


class _Break(Exception):
    pass


class _Continue(Exception):
    pass


class _SleptEnough(BaseException):
    """A Python program slept for a long time: it is still running. Not an error."""

    _zp_quiet = True


# ---- words and tokens -----------------------------------------------------------
class Word:
    """One word of a command, in parts: ("lit", text, quoted), ("var", name, quoted),
    ("cmd", source, quoted) for $(...), ("arith", expression, quoted) for $((...))."""

    __slots__ = ("parts", "line")

    def __init__(self, line):
        self.parts = []
        self.line = line

    def add(self, kind, value, quoted):
        if kind == "lit" and self.parts and self.parts[-1][0] == "lit" and self.parts[-1][2] == quoted:
            self.parts[-1] = ("lit", self.parts[-1][1] + value, quoted)
        else:
            self.parts.append((kind, value, quoted))

    def plain(self):
        """The text of a word with no quotes and no $ in it, else None."""
        if len(self.parts) == 1 and self.parts[0][0] == "lit" and not self.parts[0][2]:
            return self.parts[0][1]
        return None

    def text(self):
        """The word as written, without quotes: for messages and the history check."""
        out = []
        for kind, value, _ in self.parts:
            out.append(value if kind == "lit" else "$" + ("{" + value + "}" if kind == "var" else "(" + value + ")"))
        return "".join(out)


class Op:
    __slots__ = ("op", "line")

    def __init__(self, op, line):
        self.op = op
        self.line = line


def _close_paren(text, i, depth=1):
    """The index of the ) that closes an open ( before i, skipping quotes."""
    n = len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "'":
            j = text.find("'", i + 1)
            if j < 0:
                return -1
            i = j + 1
            continue
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def tokenize(text):
    """Words and operators of a piece of shell code, with their line numbers."""
    toks = []
    i, n, line = 0, len(text), 1
    word = None

    def flush():
        nonlocal word
        if word is not None:
            toks.append(word)
            word = None

    def cur():
        nonlocal word
        if word is None:
            word = Word(line)
        return word

    def dollar(i, quoted):
        """Reads $... at text[i]. Returns the index after it."""
        w = cur()
        if text.startswith("$((", i):
            depth, j = 0, i + 3
            while j < n:
                if text[j] == "(":
                    depth += 1
                elif text[j] == ")":
                    if depth == 0 and j + 1 < n and text[j + 1] == ")":
                        break
                    depth -= 1
                j += 1
            if j >= n:
                raise _Exit("bash: unexpected EOF while looking for matching `))'", 2)
            w.add("arith", text[i + 3:j], quoted)
            return j + 2
        if text.startswith("$(", i):
            j = _close_paren(text, i + 2)
            if j < 0:
                raise _Exit("bash: unexpected EOF while looking for matching `)'", 2)
            w.add("cmd", text[i + 2:j], quoted)
            return j + 1
        if text.startswith("${", i):
            j = text.find("}", i + 2)
            if j < 0:
                raise _Exit("bash: unexpected EOF while looking for matching `}'", 2)
            inner = text[i + 2:j]
            if not re.fullmatch(r"#?([A-Za-z_][A-Za-z0-9_]*|[0-9]|[@#?*$!])(:-.*)?", inner, re.S):
                raise _Exit(f"bash: ${{{inner}}}: bad substitution", 1)
            w.add("var", inner, quoted)
            return j + 1
        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*|[0-9]|[@#?*$!]", text[i + 1:])
        if m:
            w.add("var", m.group(0), quoted)
            return i + 1 + len(m.group(0))
        w.add("lit", "$", quoted)
        return i + 1

    while i < n:
        c = text[i]
        if c in " \t\r":
            flush()
            i += 1
            continue
        if c == "\n":
            flush()
            toks.append(Op("\n", line))
            line += 1
            i += 1
            continue
        if c == "#" and word is None:
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "\\":
            if i + 1 < n and text[i + 1] == "\n":
                line += 1
                i += 2
                continue
            cur().add("lit", text[i + 1:i + 2], True)
            i += 2
            continue
        if c == "'":
            j = text.find("'", i + 1)
            if j < 0:
                raise _Exit("bash: unexpected EOF while looking for matching `''", 2)
            cur().add("lit", text[i + 1:j], True)
            line += text.count("\n", i, j)
            i = j + 1
            continue
        if c == '"':
            w = cur()
            before = len(w.parts)
            i += 1
            buf = ""
            while True:
                if i >= n:
                    raise _Exit("bash: unexpected EOF while looking for matching `\"'", 2)
                ch = text[i]
                if ch == '"':
                    break
                if ch == "\\" and i + 1 < n and text[i + 1] in '$`"\\\n':
                    if text[i + 1] != "\n":
                        buf += text[i + 1]
                    i += 2
                    continue
                if ch == "$" or ch == "`":
                    if buf:
                        w.add("lit", buf, True)
                        buf = ""
                    if ch == "`":
                        j = text.find("`", i + 1)
                        if j < 0:
                            raise _Exit("bash: unexpected EOF while looking for matching ``'", 2)
                        w.add("cmd", text[i + 1:j], True)
                        i = j + 1
                    else:
                        i = dollar(i, True)
                    continue
                if ch == "\n":
                    line += 1
                buf += ch
                i += 1
            if buf or len(w.parts) == before:
                w.add("lit", buf, True)
            i += 1
            continue
        if c == "$":
            i = dollar(i, False)
            continue
        if c == "`":
            j = text.find("`", i + 1)
            if j < 0:
                raise _Exit("bash: unexpected EOF while looking for matching ``'", 2)
            cur().add("cmd", text[i + 1:j], False)
            i = j + 1
            continue
        if c in "|&;<>()":
            # 2> and 2>&1: the 2 is the number of the error stream, not a word.
            if c == ">" and word is not None and word.plain() == "2":
                word = None
                if text.startswith(">&1", i):
                    toks.append(Op("2>&1", line))
                    i += 3
                elif text.startswith(">>", i):
                    toks.append(Op("2>>", line))
                    i += 2
                else:
                    toks.append(Op("2>", line))
                    i += 1
                continue
            flush()
            for op in ("&&", "||", ">>", "&>", ">&2", "<<", ";;"):
                if text.startswith(op, i):
                    break
            else:
                op = c
            toks.append(Op(op, line))
            i += len(op)
            continue
        cur().add("lit", c, False)
        i += 1
    flush()
    return toks


# ---- the tree of a piece of code --------------------------------------------------
class Simple:
    def __init__(self, words, redirs, line):
        self.words, self.redirs, self.line = words, redirs, line


class If:
    def __init__(self, branches, other, line):
        self.branches, self.other, self.line, self.redirs = branches, other, line, []


class For:
    def __init__(self, name, items, body, line):
        self.name, self.items, self.body, self.line, self.redirs = name, items, body, line, []


class While:
    def __init__(self, cond, body, until, line):
        self.cond, self.body, self.until, self.line, self.redirs = cond, body, until, line, []


class Pipeline:
    def __init__(self, cmds, neg, line):
        self.cmds, self.neg, self.line = cmds, neg, line


class AndOr:
    def __init__(self, first, rest):
        self.first, self.rest = first, rest


class Parser:
    def __init__(self, toks):
        self.toks = toks
        self.pos = 0
        self.last_line = toks[-1].line if toks else 1

    def peek(self):
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def kw(self):
        tok = self.peek()
        return tok.plain() if isinstance(tok, Word) else None

    def unexpected(self, tok):
        if tok is None:
            raise _Syntax("bash: syntax error: unexpected end of file", self.last_line, end="?")
        shown = "newline" if isinstance(tok, Op) and tok.op == "\n" else tok.op if isinstance(tok, Op) else tok.text()
        raise _Syntax(f"bash: syntax error near unexpected token `{shown}'", tok.line)

    def expect(self, keyword):
        if self.kw() != keyword:
            if self.peek() is None:
                raise _Syntax("bash: syntax error: unexpected end of file", self.last_line, end=keyword)
            self.unexpected(self.peek())
        self.pos += 1

    def newlines(self):
        while isinstance(self.peek(), Op) and self.peek().op == "\n":
            self.pos += 1

    def next_top(self):
        """One complete command of the top level, or None at the end."""
        self.newlines()
        if self.peek() is None:
            return None
        node = self.andor()
        tok = self.peek()
        if isinstance(tok, Op) and tok.op in (";", "\n", "&"):
            if tok.op == "&":
                raise _Exit("bash: this terminal cannot run programs in the background (&). Run them without &.", 1)
            self.pos += 1
        elif tok is not None:
            self.unexpected(tok)
        return node

    def block(self, stops, end):
        """Commands until one of the keywords in stops. Never empty. end: the keyword
        that closes the block, for the message at the end of the code."""
        items = []
        while True:
            self.newlines()
            tok = self.peek()
            if tok is None or self.kw() in stops:
                break
            items.append(self.andor())
            tok = self.peek()
            if isinstance(tok, Op) and tok.op in (";", "\n", "&"):
                if tok.op == "&":
                    raise _Exit("bash: this terminal cannot run programs in the background (&). Run them without &.", 1)
                self.pos += 1
                continue
            break
        if not items:
            tok = self.peek()
            if tok is None:
                raise _Syntax("bash: syntax error: unexpected end of file", self.last_line, end=end)
            self.unexpected(tok)
        return items

    def andor(self):
        first = self.pipeline()
        rest = []
        while isinstance(self.peek(), Op) and self.peek().op in ("&&", "||"):
            op = self.peek().op
            self.pos += 1
            self.newlines()
            rest.append((op, self.pipeline()))
        return AndOr(first, rest)

    def pipeline(self):
        neg = False
        tok = self.peek()
        if self.kw() == "!":
            neg = True
            self.pos += 1
        cmds = [self.command()]
        while isinstance(self.peek(), Op) and self.peek().op == "|":
            self.pos += 1
            self.newlines()
            cmds.append(self.command())
        return Pipeline(cmds, neg, tok.line if tok is not None else self.last_line)

    def command(self):
        tok = self.peek()
        if tok is None:
            raise _Syntax("bash: syntax error: unexpected end of file", self.last_line, end="?")
        if isinstance(tok, Op):
            if tok.op == "<<":
                raise _Exit("bash: this terminal does not know << (here documents). Write the text to a file first.", 2)
            if tok.op in _REDIRECTS:
                return self.simple()
            self.unexpected(tok)
        kw = tok.plain()
        if kw == "if":
            node = self.if_()
        elif kw == "for":
            node = self.for_()
        elif kw in ("while", "until"):
            node = self.while_()
        elif kw in ("then", "do", "done", "fi", "else", "elif", "esac", "}"):
            self.unexpected(tok)
        elif kw in ("case", "function", "select"):
            raise _Exit(f"bash: this terminal does not know `{kw}`. Use if, for and while.", 2)
        else:
            return self.simple()
        node.redirs = self.redirects()
        return node

    def redirects(self):
        redirs = []
        while isinstance(self.peek(), Op) and self.peek().op in _REDIRECTS:
            op = self.peek().op
            self.pos += 1
            if op in ("2>&1", ">&2"):
                redirs.append((op, None))
                continue
            target = self.peek()
            if not isinstance(target, Word):
                self.unexpected(target if target is not None else Op("\n", self.last_line))
            self.pos += 1
            redirs.append((op, target))
        return redirs

    def simple(self):
        line = self.peek().line
        words, redirs = [], []
        while True:
            tok = self.peek()
            if isinstance(tok, Word):
                words.append(tok)
                self.pos += 1
                continue
            if isinstance(tok, Op) and tok.op in _REDIRECTS:
                redirs.extend(self.redirects())
                continue
            if isinstance(tok, Op) and tok.op == "<<":
                raise _Exit("bash: this terminal does not know << (here documents). Write the text to a file first.", 2)
            if isinstance(tok, Op) and tok.op in ("(", ")"):
                if words and tok.op == "(":
                    raise _Exit("bash: this terminal does not know functions (name() { ... }). Write the commands in a script.", 2)
                self.unexpected(tok)
            break
        return Simple(words, redirs, line)

    def if_(self):
        line = self.peek().line
        self.expect("if")
        branches = []
        cond = self.block({"then"}, "then")
        self.expect("then")
        body = self.block({"elif", "else", "fi"}, "fi")
        branches.append((cond, body))
        other = None
        while self.kw() == "elif":
            self.pos += 1
            cond = self.block({"then"}, "then")
            self.expect("then")
            body = self.block({"elif", "else", "fi"}, "fi")
            branches.append((cond, body))
        if self.kw() == "else":
            self.pos += 1
            other = self.block({"fi"}, "fi")
        self.expect("fi")
        return If(branches, other, line)

    def for_(self):
        line = self.peek().line
        self.expect("for")
        tok = self.peek()
        name = tok.plain() if isinstance(tok, Word) else None
        if not name or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            if tok is None:
                raise _Syntax("bash: syntax error: unexpected end of file", self.last_line, end="done")
            raise _Syntax(f"bash: `{tok.text() if isinstance(tok, Word) else tok.op}': not a valid identifier", tok.line)
        self.pos += 1
        items = None
        self.newlines()
        if self.kw() == "in":
            self.pos += 1
            items = []
            while isinstance(self.peek(), Word):
                items.append(self.peek())
                self.pos += 1
        tok = self.peek()
        if isinstance(tok, Op) and tok.op in (";", "\n"):
            self.pos += 1
        self.newlines()
        self.expect("do")
        body = self.block({"done"}, "done")
        self.expect("done")
        return For(name, items, body, line)

    def while_(self):
        line = self.peek().line
        until = self.kw() == "until"
        self.pos += 1
        cond = self.block({"do"}, "do")
        self.expect("do")
        body = self.block({"done"}, "done")
        self.expect("done")
        return While(cond, body, until, line)


# ---- the shell ---------------------------------------------------------------------
class Shell:
    def __init__(self, state):
        state = state or {}
        self.files = {}
        self.dirs = set(_BASE_DIRS)
        self.modes = dict(state.get("modes") or {})
        self.cwd = state.get("cwd") or HOME
        self.history = list(state.get("history") or [])
        self.packages = list(state.get("packages") or [])
        for d in state.get("dirs") or []:
            self._mkdirs(self.abs(d, HOME))
        for name, text in (state.get("files") or {}).items():
            path = self.abs(name, HOME)
            self._mkdirs(posixpath.dirname(path))
            self.files[path] = text
        self.files.setdefault("/etc/hostname", HOST + "\n")
        self.files.setdefault("/etc/os-release", _OS_RELEASE)
        self.files.setdefault("/etc/hosts", _HOSTS)
        self.files.setdefault("/etc/resolv.conf", "# Generated by NetworkManager\nnameserver 192.168.1.1\n")
        self.links = dict(state.get("links") or {})
        self.owners = dict(state.get("owners") or {})
        self.users = [dict(u) for u in state.get("users") or []] or [{"name": USER, "uid": 1000, "groups": [g for g, _ in _GROUPS], "shell": "/bin/bash"}]
        if self.cwd not in self.dirs:
            self.cwd = HOME
        self.vars = dict(state.get("vars") or {})
        self.exported = set(state.get("exported") or [])
        self.last = int(state.get("last") or 0)
        self.clock = int(state.get("clock") or 0)
        self.boots = int(state.get("boots") or 1)
        self.next_pid = int(state.get("nextPid") or 1500)
        self.boot_at = int(state.get("bootAt") or 0)
        self.procs = [dict(p) for p in state.get("procs") or []]
        self.services = {k: dict(v) for k, v in (state.get("services") or {}).items()}
        # The real Pi: its power supply and temperature, the password of pi, updates.
        self.power = state.get("power") or "good"
        self.temp = float(state.get("temp") or 47.2)
        self.password = state.get("password")
        self.pw_changed = bool(state.get("pwChanged"))
        self.updates = dict(state.get("updates") or {})
        # Your PC (PowerShell), and SSH from it to the Pi.
        self.at = state.get("at") or "pi"
        self.via = bool(state.get("via"))
        pc = state.get("pc") or {}
        self.pc_files = dict(pc.get("files") or {})
        self.pc_dirs = set(pc.get("dirs") or [])
        self.pc_cwd = pc.get("cwd") or ""
        self.pc_history = list(pc.get("history") or [])
        self.known = list(pc.get("known") or [])
        self.logins = int(state.get("logins") or 0)
        self.logins_after = int(state.get("loginsAfter") or 0)
        self.pending = state.get("pending")
        self.journal = [list(e) for e in state.get("journal") or []] or self._boot_journal()
        self.setup = list(state.get("setup") or [])
        self.editor = None
        self.cleared = False
        self.depth = 0
        self.root = False
        self.frames = []  # names of the scripts that run now
        self.args = []
        self.steps = 0
        self.screen = []
        self.out = self.err = self.screen
        self.py_running = False

    # ---- paths ---------------------------------------------------------------
    def abs(self, path, base=None):
        if path == "~" or path.startswith("~/"):
            path = HOME + path[1:]
        if not path.startswith("/"):
            path = posixpath.join(base or self.cwd, path)
        path = posixpath.normpath(path)
        if path.startswith("//"):
            path = "/" + path.lstrip("/")
        return path

    def show(self, path):
        """A path as the prompt writes it: ~ for the home directory."""
        if path == HOME:
            return "~"
        if path.startswith(HOME + "/"):
            return "~" + path[len(HOME):]
        return path

    def exists(self, path):
        if path in self.files or path in self.dirs or path in self.links:
            return True
        p = self.real(path)
        return p in self.files or p in self.dirs or self.virtual(p) is not None

    def children(self, d):
        prefix = d.rstrip("/") + "/"
        names = set()
        for p in list(self.files) + list(self.dirs):
            if p != d and p.startswith(prefix):
                rest = p[len(prefix):]
                if rest and "/" not in rest:
                    names.add(rest)
        for p in self.links:
            if posixpath.dirname(p) == d.rstrip("/") or (d == "/" and posixpath.dirname(p) == "/"):
                names.add(posixpath.basename(p))
        if d == "/proc":
            names |= {"cpuinfo", "meminfo", "uptime", "version"}
        elif d == "/dev":
            names |= set(self._DEV)
        elif d == "/etc":
            names |= {"passwd", "group"}
        return sorted(names, key=lambda n: (n.lstrip(".").lower(), n))

    def _mkdirs(self, d):
        parts = [p for p in d.split("/") if p]
        cur = ""
        for part in parts:
            cur += "/" + part
            self.dirs.add(cur)
        self.dirs.add("/")

    def mode(self, path):
        return self.modes.get(path) or ("755" if path in self.dirs else "644")

    def tree_under(self, d):
        prefix = d.rstrip("/") + "/"
        return [p for p in list(self.files) + list(self.dirs) if p == d or p.startswith(prefix)]

    def remove(self, path):
        for p in self.tree_under(path):
            self.files.pop(p, None)
            self.dirs.discard(p)
            self.modes.pop(p, None)
            self.owners.pop(p, None)
        for p in list(self.links):
            if p == path or p.startswith(path.rstrip("/") + "/"):
                del self.links[p]

    def read(self, name, cmd):
        path = self.real(self.abs(name))
        special = self.virtual(path)
        if special is not None:
            return special
        if path in self.dirs:
            raise _Exit(f"{cmd}: {name}: Is a directory")
        if path not in self.files:
            raise _Exit(f"{cmd}: {name}: No such file or directory")
        return self.files[path]

    def may_write(self, path):
        """Only root may change files outside the home directory and /tmp."""
        return self.root or path == HOME or path.startswith(HOME + "/") or path.startswith("/tmp/")

    def write(self, name, text, append=False):
        path = self.real(self.abs(name))
        if path == "/dev/null":
            return
        if self.virtual(path) is not None:
            raise _Exit(f"bash: {name}: Permission denied")
        if path in self.dirs:
            raise _Exit(f"bash: {name}: Is a directory")
        parent = posixpath.dirname(path)
        if parent not in self.dirs:
            raise _Exit(f"bash: {name}: No such file or directory")
        if not self.may_write(path):
            raise _Exit(f"bash: {name}: Permission denied")
        self.files[path] = (self.files.get(path, "") if append else "") + text

    # ---- variables -------------------------------------------------------------
    def getvar(self, name):
        if name == "?":
            return str(self.last)
        if name == "#":
            return str(len(self.args))
        if name in ("@", "*"):
            return " ".join(self.args)
        if name == "0":
            return self.frames[-1] if self.frames else "bash"
        if name.isdigit():
            k = int(name)
            return self.args[k - 1] if 0 < k <= len(self.args) else ""
        if name == "$":
            return str(SHELL_PID)
        if name == "!":
            return ""
        if name in self.vars:
            return self.vars[name]
        defaults = {
            "HOME": HOME, "USER": USER, "LOGNAME": USER, "HOSTNAME": HOST, "SHELL": "/bin/bash",
            "PWD": self.cwd, "PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "en_GB.UTF-8",
        }
        return defaults.get(name, "")

    def setvar(self, name, value):
        self.vars[name] = value

    # ---- expansion -------------------------------------------------------------
    def tilde(self, text):
        if text == "~" or text.startswith("~/"):
            return HOME + text[1:]
        return text

    def braces(self, text):
        """{1..5} and {a,b}: one word becomes many (only in words without quotes)."""
        m = re.search(r"\{([^{}]*)\}", text)
        if not m:
            return [text]
        inner = m.group(1)
        head, tail = text[:m.start()], text[m.end():]
        r = re.fullmatch(r"(-?\d+)\.\.(-?\d+)", inner)
        if r:
            a, b = int(r.group(1)), int(r.group(2))
            step = 1 if b >= a else -1
            items = [str(k) for k in range(a, b + step, step)][:1000]
        elif re.fullmatch(r"[A-Za-z]\.\.[A-Za-z]", inner):
            a, b = ord(inner[0]), ord(inner[-1])
            step = 1 if b >= a else -1
            items = [chr(k) for k in range(a, b + step, step)]
        elif "," in inner:
            items = inner.split(",")
        else:
            return [text]
        out = []
        for item in items:
            out.extend(self.braces(head + item + tail))
        return out

    def glob(self, tok):
        if not any(ch in tok for ch in "*?[") or tok.startswith("-"):
            return [tok]
        base = posixpath.dirname(tok)
        pattern = posixpath.basename(tok)
        folder = self.abs(base) if base else self.cwd
        if folder in self.dirs:
            hits = [n for n in self.children(folder) if fnmatch.fnmatchcase(n, pattern) and not n.startswith(".")]
            if hits:
                return [posixpath.join(base, n) if base else n for n in hits]
        return [tok]

    def expand_part(self, kind, value):
        if kind == "var":
            if ":-" in value:
                name, default = value.split(":-", 1)
                got = self.getvar(name)
                return got if got else self.expand_string(default)
            if value.startswith("#") and len(value) > 1:
                return str(len(self.getvar(value[1:])))
            return self.getvar(value)
        if kind == "cmd":
            return self.substitute(value)
        if kind == "arith":
            return str(self.arith(value))
        return value

    def expand_string(self, text):
        """A piece of text with $ in it, as one string (no splitting)."""
        try:
            toks = tokenize('"' + text.replace('"', '\\"') + '"')
        except _Exit:
            return text
        return "".join(self.expand_word(toks[0], split=False)) if toks else ""

    def expand_word(self, w, split=True):
        p = w.plain()
        if p is not None:
            out = []
            for t in self.braces(p):
                out.extend(self.glob(self.tilde(t)) if split else [self.tilde(t)])
            return out
        fields, keep = [[]], [False]

        def split_into(value):
            if not value:
                return
            pieces = value.split()
            if not pieces:
                if fields[-1]:
                    fields.append([])
                    keep.append(False)
                return
            if value[0].isspace() and fields[-1]:
                fields.append([])
                keep.append(False)
            fields[-1].append((pieces[0], True))
            for piece in pieces[1:]:
                fields.append([(piece, True)])
                keep.append(False)
            if value[-1].isspace():
                fields.append([])
                keep.append(False)

        for index, (kind, value, quoted) in enumerate(w.parts):
            if kind == "lit":
                if index == 0 and not quoted:
                    value = self.tilde(value) if value in ("~",) or value.startswith("~/") else value
                fields[-1].append((value, not quoted))
                keep[-1] = keep[-1] or quoted
            elif kind == "var" and value == "@":
                if quoted:
                    for k, item in enumerate(self.args):
                        if k:
                            fields.append([])
                            keep.append(True)
                        fields[-1].append((item, False))
                        keep[-1] = True
                else:
                    for item in self.args:
                        split_into(" " + item + " ")
            else:
                text = self.expand_part(kind, value)
                if quoted or not split:
                    fields[-1].append((text, False))
                    keep[-1] = True
                else:
                    split_into(text)
        result = []
        for segs, k in zip(fields, keep):
            text = "".join(s for s, _ in segs)
            if not text and not k:
                continue
            if split and any(g and any(ch in s for ch in "*?[") for s, g in segs):
                result.extend(self.glob(text))
            else:
                result.append(text)
        if not split:
            return ["".join(result)] if result else [""]
        return result

    def substitute(self, source):
        """$(commands): their output, without the newlines at the end."""
        buf = []
        saved = (self.out, dict(self.vars), self.cwd)
        self.out = buf
        try:
            code = self.run_text(source)
        except _ScriptExit as e:
            code = e.code
        finally:
            self.out = saved[0]
            self.vars, self.cwd = saved[1], saved[2]
        self.last = code
        return "".join(buf).rstrip("\n")

    def arith(self, expr):
        text = re.sub(r"\$\{?([A-Za-z_][A-Za-z0-9_]*|[0-9#?])\}?", lambda m: self.getvar(m.group(1)) or "0", expr)
        text = text.replace("&&", " and ").replace("||", " or ")
        text = re.sub(r"!(?!=)", " not ", text)
        try:
            tree = ast.parse(text.strip() or "0", mode="eval")
        except SyntaxError:
            raise _Exit(f"bash: {expr.strip()}: syntax error in expression", 1)
        return self._num(tree.body, expr.strip())

    def _num(self, node, expr):
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, int):
                raise _Exit(f"bash: {expr}: syntax error: invalid arithmetic operator (bash knows only whole numbers)", 1)
            return node.value
        if isinstance(node, ast.Name):
            value = self.getvar(node.id).strip()
            return int(value) if re.fullmatch(r"-?\d+", value) else 0
        if isinstance(node, ast.UnaryOp):
            v = self._num(node.operand, expr)
            if isinstance(node.op, ast.USub):
                return -v
            if isinstance(node.op, ast.UAdd):
                return v
            if isinstance(node.op, ast.Not):
                return int(not v)
        if isinstance(node, ast.BinOp):
            a, b = self._num(node.left, expr), self._num(node.right, expr)
            if isinstance(node.op, ast.Add):
                return a + b
            if isinstance(node.op, ast.Sub):
                return a - b
            if isinstance(node.op, ast.Mult):
                return a * b
            if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
                if b == 0:
                    raise _Exit(f"bash: {expr}: division by 0", 1)
                q = abs(a) // abs(b) * (1 if (a >= 0) == (b >= 0) else -1)
                return q if not isinstance(node.op, ast.Mod) else a - b * q
            if isinstance(node.op, ast.Pow) and 0 <= b <= 64:
                return a ** b
        if isinstance(node, ast.Compare):
            left = self._num(node.left, expr)
            ok = True
            for op, right_node in zip(node.ops, node.comparators):
                right = self._num(right_node, expr)
                ok = ok and {ast.Lt: left < right, ast.Gt: left > right, ast.LtE: left <= right,
                             ast.GtE: left >= right, ast.Eq: left == right, ast.NotEq: left != right}.get(type(op), False)
                left = right
            return int(ok)
        if isinstance(node, ast.BoolOp):
            values = [self._num(v, expr) for v in node.values]
            return int(all(values) if isinstance(node.op, ast.And) else any(values))
        raise _Exit(f"bash: {expr}: syntax error in expression", 1)

    # ---- running ---------------------------------------------------------------
    def tick(self):
        self.steps += 1
        if self.steps > _MAX_STEPS or self.steps % 100 == 0 and sum(len(t) for t in self.screen) > _MAX_OUT:
            raise _Stop()

    def error(self, message, line=None):
        if self.frames and message.startswith("bash: "):
            message = f"{self.frames[-1]}: line {line or 1}: {message[6:]}"
        self.err.append(message.rstrip("\n") + "\n")

    def run_top(self, line):
        """A line typed at the prompt. Returns (screen text, exit code)."""
        self.screen = []
        self.out = self.err = self.screen
        self.steps = 0
        try:
            code = self.run_text(line, prompt=True)
        except _Stop:
            self.screen.append("^C\n(The commands did not end, so this terminal stopped them, like Ctrl+C on a real Pi.)\n")
            code = 130
        except _ScriptExit as e:
            code = e.code
        except (_Break, _Continue):
            code = 0
        except RecursionError:
            self.screen.append("bash: too deep\n")
            code = 1
        self.last = code
        return "".join(self.screen), code

    def run_text(self, text, prompt=False):
        try:
            parser = Parser(tokenize(text))
        except _Exit as e:
            self.error(e.message, None)
            return e.code
        code = 0
        while True:
            try:
                node = parser.next_top()
            except _Syntax as e:
                if prompt and not self.frames and e.end:
                    need = f" (`{e.end}` is missing)" if e.end != "?" else ""
                    self.error(f"bash: syntax error: the line ends too early{need}. "
                               "At this prompt, type the whole command on one line, or write it in a script.")
                else:
                    self.error(e.message, e.line)
                return 2
            except _Exit as e:
                self.error(e.message, None)
                return e.code
            if node is None:
                return code
            code = self.exec_andor(node)

    def exec_list(self, items):
        code = 0
        for node in items:
            code = self.exec_andor(node)
        return code

    def exec_andor(self, node):
        code = self.exec_pipeline(node.first)
        for op, pipe in node.rest:
            if (op == "&&") == (code == 0):
                code = self.exec_pipeline(pipe)
        return code

    def exec_pipeline(self, pipe):
        if len(pipe.cmds) == 1:
            code = self.exec_cmd(pipe.cmds[0], None)
        else:
            data = None
            for cmd in pipe.cmds[:-1]:
                buf = []
                saved = self.out
                self.out = buf
                try:
                    self.exec_cmd(cmd, data)
                finally:
                    self.out = saved
                data = "".join(buf)
            code = self.exec_cmd(pipe.cmds[-1], data)
        if pipe.neg:
            code = 0 if code else 1
        self.last = code
        return code

    def exec_cmd(self, node, stdin):
        self.tick()
        if isinstance(node, Simple):
            return self.exec_simple(node, stdin)
        return self.redirected(node.redirs, node.line, lambda _in: self.exec_compound(node))

    def exec_compound(self, node):
        if isinstance(node, If):
            for cond, body in node.branches:
                if self.exec_list(cond) == 0:
                    return self.exec_list(body)
            return self.exec_list(node.other) if node.other else 0
        if isinstance(node, For):
            if node.items is None:
                items = list(self.args)
            else:
                items = []
                for w in node.items:
                    items.extend(self.expand_word(w))
            code = 0
            for value in items[:_MAX_ROUNDS]:
                self.tick()
                self.setvar(node.name, value)
                try:
                    code = self.exec_list(node.body)
                except _Break:
                    break
                except _Continue:
                    continue
            return code
        if isinstance(node, While):
            code = 0
            rounds = 0
            while True:
                self.tick()
                if (self.exec_list(node.cond) == 0) == node.until:
                    break
                try:
                    code = self.exec_list(node.body)
                except _Break:
                    break
                except _Continue:
                    pass
                rounds += 1
                if rounds > _MAX_ROUNDS:
                    raise _Stop()
            return code
        return 0

    def redirected(self, redirs, line, run):
        """Runs run(stdin) with the redirects of a command: > >> < 2> 2>&1 &> >&2."""
        if not redirs:
            return run(None)
        saved = (self.out, self.err)
        plan = []
        stdin = None
        try:
            for op, word in redirs:
                if op == "2>&1":
                    self.err = self.out
                    continue
                if op == ">&2":
                    self.out = self.err
                    continue
                targets = self.expand_word(word)
                if len(targets) != 1 or not targets[0]:
                    raise _Exit(f"bash: {word.text()}: ambiguous redirect")
                target = targets[0]
                if op == "<":
                    stdin = self.read(target, "bash")
                    continue
                path = self.abs(target)
                if path != "/dev/null":
                    if path in self.dirs:
                        raise _Exit(f"bash: {target}: Is a directory")
                    if posixpath.dirname(path) not in self.dirs:
                        raise _Exit(f"bash: {target}: No such file or directory")
                    if not self.may_write(path):
                        raise _Exit(f"bash: {target}: Permission denied")
                append = op in (">>", "2>>")
                if not append:
                    self.write(target, "")  # bash empties the file before the command runs
                buf = []
                if op in (">", ">>", "&>"):
                    self.out = buf
                if op in ("2>", "2>>", "&>"):
                    self.err = buf
                plan.append((target, buf))
        except _Exit as e:
            self.out, self.err = saved
            self.error(e.message, line)
            return e.code
        try:
            code = run(stdin)
        finally:
            self.out, self.err = saved
            for target, buf in plan:
                self.write(target, "".join(buf), append=True)
        return code

    def exec_simple(self, node, stdin):
        words = node.words
        assigns = []
        i = 0
        while i < len(words):
            first = words[i].parts[0] if words[i].parts else None
            m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", first[1], re.S) if first and first[0] == "lit" and not first[2] else None
            if not m:
                break
            value = Word(words[i].line)
            if m.group(2):
                value.add("lit", m.group(2), False)
            for part in words[i].parts[1:]:
                value.add(*part)
            assigns.append((m.group(1), value))
            i += 1
        try:
            fields = []
            for w in words[i:]:
                fields.extend(self.expand_word(w))
            values = [(name, self.tilde("".join(self.expand_word(v, split=False))) if v.parts else "") for name, v in assigns]
        except _Exit as e:
            self.error(e.message, node.line)
            return e.code
        if not fields:
            for name, value in values:
                self.setvar(name, value)
            return self.redirected(node.redirs, node.line, lambda _in: 0)
        old = {name: self.vars.get(name) for name, _ in values}
        for name, value in values:
            self.setvar(name, value)

        def call(redirected_in):
            piped = self.out is not self.screen
            try:
                result = self.command(fields, redirected_in if redirected_in is not None else stdin, piped)
            except _Exit as stop:
                if stop.message:
                    self.error(stop.message, node.line)
                return stop.code
            except (_Stop, _ScriptExit, _Break, _Continue, RecursionError):
                raise
            except Exception as problem:  # a gap of the pretend shell must not break the terminal
                self.error(f"bash: {fields[0]}: this terminal cannot do that ({type(problem).__name__}). Try it another way.", node.line)
                return 1
            if isinstance(result, int):
                return result
            if result:
                self.out.append(result)
            return 0

        try:
            return self.redirected(node.redirs, node.line, call)
        finally:
            for name, value in old.items():
                if value is None:
                    self.vars.pop(name, None)
                else:
                    self.vars[name] = value

    def command(self, argv, stdin, piped):
        if not argv:
            return ""
        name, args = argv[0], argv[1:]
        if "/" in name:
            return self.script(name, args, needs_x=True)
        if name == "[" or name == "[[":
            close = "]" if name == "[" else "]]"
            if not args or args[-1] != close:
                raise _Exit(f"bash: {name}: missing `{close}'", 2)
            return 0 if self._test(args[:-1], name) else 1
        if name == ".":
            return self.c_source(args, stdin, piped)
        if name == ":":
            return 0
        fn = getattr(self, "c_" + name.replace("-", "_"), None) if re.fullmatch(r"[a-z0-9_-]+", name) else None
        if fn is None:
            raise _Exit(f"bash: {name}: command not found", 127)
        return fn(args, stdin, piped)

    # ---- options -------------------------------------------------------------
    @staticmethod
    def flags(args, allowed, cmd):
        """Splits -la into l and a. Returns (set of flags, other arguments)."""
        found, rest = set(), []
        for a in args:
            if a.startswith("-") and len(a) > 1 and not a[1:].isdigit():
                for ch in a[1:]:
                    if ch not in allowed:
                        raise _Exit(f"{cmd}: invalid option -- '{ch}'\nTry '{cmd} --help' for more information.")
                    found.add(ch)
            else:
                rest.append(a)
        return found, rest

    # ---- shell builtins ----------------------------------------------------------
    def _test(self, a, cmd="["):
        if not a:
            return False
        if a[0] == "!":
            return not self._test(a[1:], cmd)
        for joiner in ("-o", "-a"):
            if joiner in a[1:-1]:
                at = a.index(joiner, 1)
                left, right = self._test(a[:at], cmd), self._test(a[at + 1:], cmd)
                return (left or right) if joiner == "-o" else (left and right)
        if len(a) == 1:
            return a[0] != ""
        if len(a) == 2:
            op, x = a
            link = self.abs(x) if x else ""
            path = self.real(link) if x else ""
            unary = {
                "-L": lambda: link in self.links, "-h": lambda: link in self.links,
                "-e": lambda: path in self.files or path in self.dirs or self.virtual(path) is not None,
                "-f": lambda: path in self.files or self.virtual(path) is not None, "-d": lambda: path in self.dirs,
                "-s": lambda: bool(self.files.get(path)), "-x": lambda: self.exists(path) and bool(int(self.mode(path)[0]) & 1),
                "-r": lambda: self.exists(path), "-w": lambda: self.exists(path) and self.may_write(path),
                "-z": lambda: x == "", "-n": lambda: x != "",
            }
            if op not in unary:
                raise _Exit(f"bash: {cmd}: {op}: unary operator expected", 2)
            return unary[op]()
        if len(a) == 3:
            x, op, y = a
            if op in ("=", "=="):
                return x == y
            if op == "!=":
                return x != y
            if op in ("-eq", "-ne", "-lt", "-le", "-gt", "-ge"):
                for v in (x, y):
                    if not re.fullmatch(r"\s*-?\d+\s*", v):
                        raise _Exit(f"bash: {cmd}: {v}: integer expression expected", 2)
                xi, yi = int(x), int(y)
                return {"-eq": xi == yi, "-ne": xi != yi, "-lt": xi < yi, "-le": xi <= yi, "-gt": xi > yi, "-ge": xi >= yi}[op]
            if op in ("<", ">"):
                return x < y if op == "<" else x > y
            raise _Exit(f"bash: {cmd}: {op}: binary operator expected", 2)
        raise _Exit(f"bash: {cmd}: too many arguments", 2)

    def c_test(self, args, stdin, piped):
        return 0 if self._test(args, "test") else 1

    def c_true(self, args, stdin, piped):
        return 0

    def c_false(self, args, stdin, piped):
        return 1

    def c_break(self, args, stdin, piped):
        raise _Break()

    def c_continue(self, args, stdin, piped):
        raise _Continue()

    def c_export(self, args, stdin, piped):
        if not args:
            names = sorted(self.exported)
            return "".join(f'declare -x {n}="{self.vars.get(n, "")}"\n' for n in names)
        for a in args:
            name, eq, value = a.partition("=")
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
                raise _Exit(f"bash: export: `{a}': not a valid identifier")
            if eq:
                self.setvar(name, value)
            self.exported.add(name)
        return ""

    def c_unset(self, args, stdin, piped):
        for a in args:
            self.vars.pop(a, None)
            self.exported.discard(a)
        return ""

    def c_env(self, args, stdin, piped):
        names = {"HOME", "USER", "LOGNAME", "SHELL", "PWD", "PATH", "LANG"} | self.exported
        return "".join(f"{n}={self.getvar(n)}\n" for n in sorted(names))

    c_printenv = c_env

    def c_read(self, args, stdin, piped):
        raise _Exit("bash: read: this terminal cannot type answers into a command. Give the value as an argument instead, like ./greet.sh Ana")

    def c_source(self, args, stdin, piped):
        if not args:
            raise _Exit("bash: source: filename argument required", 2)
        return self.script(args[0], args[1:], needs_x=False, source=True)

    def c_exit(self, args, stdin, piped):
        code = self.last
        if args:
            if not re.fullmatch(r"-?\d+", args[0]):
                self.error(f"bash: exit: {args[0]}: numeric argument required")
                code = 2
            else:
                code = int(args[0]) % 256
        if not self.frames:
            if self.via:
                self.at = "pc"
                self.via = False
                return "logout\nConnection to raspberrypi.local closed.\n"
            return "logout: close the lesson to leave the terminal.\n"
        raise _ScriptExit(code)

    def c_type(self, args, stdin, piped):
        out, code = [], 0
        for a in args:
            if a in _KEYWORDS:
                out.append(f"{a} is a shell keyword")
            elif a in _BUILTINS:
                out.append(f"{a} is a shell builtin")
            elif a in _PROGRAMS or a in self.packages:
                out.append(f"{a} is /usr/bin/{a}")
            else:
                self.error(f"bash: type: {a}: not found")
                code = 1
        if out:
            self.out.append("\n".join(out) + "\n")
        return code

    def c_which(self, args, stdin, piped):
        out = [f"/usr/bin/{a}" for a in args if a in _PROGRAMS or a in self.packages or a in ("echo", "test", "pwd", "kill", "true", "false")]
        if out:
            self.out.append("\n".join(out) + "\n")
        return 0 if len(out) == len(args) and args else 1

    # ---- commands ------------------------------------------------------------
    def c_pwd(self, args, stdin, piped):
        return self.cwd + "\n"

    def c_cd(self, args, stdin, piped):
        if len(args) > 1:
            raise _Exit("bash: cd: too many arguments")
        target = self.real(self.abs(args[0])) if args else HOME
        if target in self.files:
            raise _Exit(f"bash: cd: {args[0]}: Not a directory")
        if target not in self.dirs:
            raise _Exit(f"bash: cd: {args[0]}: No such file or directory")
        self.cwd = target
        return ""

    def _long(self, path, name):
        user, group = self.owner_of(path)
        if path in self.links:
            return f"lrwxrwxrwx 1 {user} {group} {len(self.links[path]):>5} Nov 21 10:00 {name} -> {self.links[path]}"
        if path.startswith("/dev/") and path[5:] in self._DEV:
            kind, mode, owner, grp, nums = self._DEV[path[5:]]
            rwx = "".join(("r" if int(d) & 4 else "-") + ("w" if int(d) & 2 else "-") + ("x" if int(d) & 1 else "-") for d in mode)
            return f"{kind}{rwx} 1 {owner} {grp} {nums:>7} Nov 21 07:46 {name}"
        if self.virtual(path) is not None:
            return f"-r--r--r-- 1 root root     0 Nov 21 10:00 {name}"
        is_dir = path in self.dirs
        mode = self.mode(path)
        rwx = "".join(("r" if int(d) & 4 else "-") + ("w" if int(d) & 2 else "-") + ("x" if int(d) & 1 else "-") for d in mode)
        text = self.files.get(path, "")
        arc = self.archive(text) if not is_dir else None
        size = 4096 if is_dir else arc["size"] if arc else len(text.encode("utf-8"))
        return f"{'d' if is_dir else '-'}{rwx} 1 {user} {group} {size:>5} Nov 21 10:00 {name}"

    def c_ls(self, args, stdin, piped):
        flags, paths = self.flags(args, "la1", "ls")
        paths = paths or ["."]
        blocks = []
        missing = [p for p in paths if not self.exists(self.abs(p))]
        many = len(paths) > 1
        paths = [p for p in paths if p not in missing]
        def as_file(p):
            path = self.abs(p)
            # A link is shown as itself with -l, or when it does not lead to a folder.
            if path in self.links:
                return "l" in flags or not self.is_dir(path)
            return not self.is_dir(path)

        loose = [(self.abs(p), p) for p in paths if as_file(p)]
        if loose:
            blocks.append((None, loose))
        for p in paths:
            path = self.abs(p)
            if as_file(p):
                continue
            path = self.real(path)
            names = [n for n in self.children(path) if "a" in flags or not n.startswith(".")]
            if "a" in flags:
                names = [".", ".."] + names
            entries = [(path if n == "." else posixpath.dirname(path) if n == ".." else posixpath.join(path, n), n) for n in names]
            blocks.append((p, entries))
        # Like ls: the errors first (on the error stream), then what exists.
        for p in missing:
            self.error(f"ls: cannot access '{p}': No such file or directory")
        if missing and not blocks:
            return 2
        if many and len(blocks) == 1 and blocks[0][0] is not None:
            blocks = [blocks[0], (None, [])]
        out = []
        for title, entries in blocks:
            if len(blocks) > 1 and title is not None:
                out.append(f"{title}:")
            if "l" in flags:
                out.extend(self._long(path, name) for path, name in entries)
            elif entries:
                sep = "\n" if piped or "1" in flags else "  "
                out.append(sep.join(name for _, name in entries))
            if len(blocks) > 1:
                out.append("")
        text = "\n".join(out).rstrip("\n")
        text = text + "\n" if text else ""
        if missing:
            self.out.append(text)
            return 2
        return text

    def c_mkdir(self, args, stdin, piped):
        flags, names = self.flags(args, "p", "mkdir")
        if not names:
            raise _Exit("mkdir: missing operand")
        errors = []
        for n in names:
            path = self.abs(n)
            if self.exists(path):
                if "p" not in flags:
                    errors.append(f"mkdir: cannot create directory '{n}': File exists")
                continue
            if posixpath.dirname(path) not in self.dirs and "p" not in flags:
                errors.append(f"mkdir: cannot create directory '{n}': No such file or directory")
                continue
            if not self.may_write(path):
                errors.append(f"mkdir: cannot create directory '{n}': Permission denied")
                continue
            self._mkdirs(path)
        if errors:
            raise _Exit("\n".join(errors))
        return ""

    def c_touch(self, args, stdin, piped):
        if not args:
            raise _Exit("touch: missing file operand")
        for n in args:
            path = self.abs(n)
            if path in self.dirs or path in self.files:
                continue
            if posixpath.dirname(path) not in self.dirs:
                raise _Exit(f"touch: cannot touch '{n}': No such file or directory")
            if not self.may_write(path):
                raise _Exit(f"touch: cannot touch '{n}': Permission denied")
            self.files[path] = ""
        return ""

    def c_cat(self, args, stdin, piped):
        if not args:
            return stdin or ""
        parts = []
        for n in args:
            text = self.read(n, "cat")
            if self.archive(text):
                text = f"(binary data: {n} is an archive, not text. On a real terminal this is a mess of signs. Look inside with tar -tf, or unzip -l.)\n"
            parts.append(text)
        return "".join(parts)

    def c_echo(self, args, stdin, piped):
        newline, escapes = True, False
        while args and re.fullmatch(r"-[ne]+", args[0]):
            newline = newline and "n" not in args[0]
            escapes = escapes or "e" in args[0]
            args = args[1:]
        text = " ".join(args)
        if escapes:
            text = text.replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
        return text + ("\n" if newline else "")

    def c_printf(self, args, stdin, piped):
        if not args:
            raise _Exit("printf: usage: printf format [arguments]", 2)
        fmt, values = args[0], list(args[1:])
        fmt = fmt.replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
        specs = re.findall(r"%[-0-9.]*[sdif]", fmt)
        out = []
        bad = []

        def one(vals):
            k = [0]

            def sub(m):
                spec = m.group(0)
                if spec == "%%":
                    return "%"
                v = vals[k[0]] if k[0] < len(vals) else ""
                k[0] += 1
                if spec[-1] in "di":
                    if v and not re.fullmatch(r"-?\d+", v):
                        bad.append(v)
                        v = "0"
                    return (spec[:-1] + "d") % int(v or 0)
                if spec[-1] == "f":
                    try:
                        return spec % float(v or 0)
                    except ValueError:
                        bad.append(v)
                        return spec % 0.0
                return spec % v
            return re.sub(r"%%|%[-0-9.]*[sdif]", sub, fmt)

        if not specs:
            out.append(one([]))
        else:
            step = len(specs)
            chunks = [values[k:k + step] for k in range(0, len(values), step)] or [[]]
            out.extend(one(c) for c in chunks)
        self.out.append("".join(out))
        for v in bad:
            self.error(f"bash: printf: {v}: invalid number")
        return 1 if bad else 0

    def c_tee(self, args, stdin, piped):
        flags, names = self.flags(args, "a", "tee")
        text = stdin or ""
        code = 0
        for n in names:
            path = self.abs(n)
            if path == "/dev/null":
                continue
            if path in self.dirs:
                self.error(f"tee: {n}: Is a directory")
                code = 1
            elif posixpath.dirname(path) not in self.dirs:
                self.error(f"tee: {n}: No such file or directory")
                code = 1
            elif not self.may_write(path):
                self.error(f"tee: {n}: Permission denied")
                code = 1
            else:
                self.files[path] = (self.files.get(path, "") if "a" in flags else "") + text
        self.out.append(text)
        return code

    def c_rm(self, args, stdin, piped):
        flags, names = self.flags(args, "rfR", "rm")
        if not names:
            raise _Exit("rm: missing operand")
        recursive = "r" in flags or "R" in flags
        errors = []
        for n in names:
            path = self.abs(n)
            if path in ("/", HOME):
                errors.append(f"rm: refusing to remove '{n}': it is a protected directory in this course")
                continue
            if path in self.links:
                if not self.may_write(path):
                    errors.append(f"rm: cannot remove '{n}': Permission denied")
                else:
                    del self.links[path]
                continue
            if self.virtual(path) is not None:
                errors.append(f"rm: cannot remove '{n}': Permission denied")
                continue
            if self.exists(path) and not self.may_write(path):
                errors.append(f"rm: cannot remove '{n}': Permission denied")
                continue
            if path in self.dirs:
                if not recursive:
                    errors.append(f"rm: cannot remove '{n}': Is a directory")
                    continue
                if self.cwd == path or self.cwd.startswith(path + "/"):
                    self.cwd = posixpath.dirname(path)
                self.remove(path)
            elif path in self.files:
                self.remove(path)
            elif "f" not in flags:
                errors.append(f"rm: cannot remove '{n}': No such file or directory")
        if errors:
            raise _Exit("\n".join(errors))
        return ""

    def c_rmdir(self, args, stdin, piped):
        if not args:
            raise _Exit("rmdir: missing operand")
        for n in args:
            path = self.abs(n)
            if path not in self.dirs:
                raise _Exit(f"rmdir: failed to remove '{n}': No such file or directory")
            if self.children(path):
                raise _Exit(f"rmdir: failed to remove '{n}': Directory not empty")
            self.remove(path)
        return ""

    def _copy_or_move(self, args, cmd, move):
        flags, names = self.flags(args, "rR" if not move else "", cmd)
        if len(names) < 2:
            raise _Exit(f"{cmd}: missing destination file operand after '{names[0] if names else ''}'" if names else f"{cmd}: missing file operand")
        *sources, dest = names
        dest_path = self.abs(dest)
        into = dest_path in self.dirs
        if len(sources) > 1 and not into:
            raise _Exit(f"{cmd}: target '{dest}' is not a directory")
        for s in sources:
            src = self.abs(s)
            if not self.exists(src):
                raise _Exit(f"{cmd}: cannot stat '{s}': No such file or directory")
            target = posixpath.join(dest_path, posixpath.basename(src)) if into else dest_path
            if posixpath.dirname(target) not in self.dirs:
                raise _Exit(f"{cmd}: cannot create regular file '{dest}': No such file or directory")
            if not self.may_write(target):
                raise _Exit(f"{cmd}: cannot create regular file '{dest}': Permission denied")
            if src in self.dirs:
                if not move and not ({"r", "R"} & flags):
                    raise _Exit(f"cp: -r not specified; omitting directory '{s}'")
                if target == src or target.startswith(src + "/"):
                    raise _Exit(f"{cmd}: cannot {'move' if move else 'copy'} a directory, '{s}', into itself, '{dest}'")
                for p in sorted(self.tree_under(src)):
                    new = target + p[len(src):]
                    if p in self.dirs:
                        self.dirs.add(new)
                    else:
                        self.files[new] = self.files[p]
                    if p in self.modes:
                        self.modes[new] = self.modes[p]
                if move:
                    self.remove(src)
            else:
                if target in self.dirs:
                    raise _Exit(f"{cmd}: cannot overwrite directory '{dest}' with non-directory")
                self.files[target] = self.files[src]
                if src in self.modes:
                    self.modes[target] = self.modes[src]
                if move and target != src:
                    self.remove(src)
        return ""

    def c_cp(self, args, stdin, piped):
        return self._copy_or_move(args, "cp", move=False)

    def c_mv(self, args, stdin, piped):
        return self._copy_or_move(args, "mv", move=True)

    def _count_arg(self, args, cmd):
        n, rest = 10, []
        i = 0
        while i < len(args):
            a = args[i]
            if a == "-n" and i + 1 < len(args):
                if not args[i + 1].isdigit():
                    raise _Exit(f"{cmd}: invalid number of lines: '{args[i + 1]}'")
                n, i = int(args[i + 1]), i + 2
                continue
            if re.fullmatch(r"-\d+", a):
                n = int(a[1:])
            elif a.startswith("-n") and a[2:].isdigit():
                n = int(a[2:])
            else:
                rest.append(a)
            i += 1
        return n, rest

    def _text_of(self, files, stdin, cmd):
        if files:
            return "".join(self.read(f, cmd) for f in files)
        return stdin or ""

    def c_head(self, args, stdin, piped):
        n, files = self._count_arg(args, "head")
        lines = self._text_of(files, stdin, "head").splitlines(True)
        return "".join(lines[:n])

    def c_tail(self, args, stdin, piped):
        n, files = self._count_arg(args, "tail")
        lines = self._text_of(files, stdin, "tail").splitlines(True)
        return "".join(lines[-n:] if n else [])

    def c_wc(self, args, stdin, piped):
        flags, files = self.flags(args, "lwc", "wc")
        flags = flags or {"l", "w", "c"}
        rows = []
        sources = [(f, self.read(f, "wc")) for f in files] if files else [(None, stdin or "")]
        for name, text in sources:
            parts = []
            if "l" in flags:
                parts.append(str(text.count("\n")))
            if "w" in flags:
                parts.append(str(len(text.split())))
            if "c" in flags:
                parts.append(str(len(text.encode("utf-8"))))
            rows.append(" ".join(parts) + (f" {name}" if name else ""))
        return "\n".join(rows) + "\n"

    def c_grep(self, args, stdin, piped):
        flags, rest = self.flags(args, "invcrEq", "grep")
        if not rest:
            raise _Exit("Usage: grep [OPTION]... PATTERNS [FILE]...", 2)
        pattern, files = rest[0], rest[1:]
        try:
            rx = re.compile(pattern, re.IGNORECASE if "i" in flags else 0)
        except re.error:
            rx = re.compile(re.escape(pattern), re.IGNORECASE if "i" in flags else 0)
        sources = []
        if files:
            for f in files:
                path = self.abs(f)
                if path in self.dirs:
                    if "r" not in flags:
                        sources.append((f, None))
                        continue
                    for p in sorted(self.tree_under(path)):
                        if p in self.files:
                            sources.append((p[len(path.rstrip("/")) + 1:] if path != "/" else p, self.files[p]))
                else:
                    sources.append((f, self.read(f, "grep")))
        else:
            sources = [(None, stdin or "")]
        show_name = len(sources) > 1 or "r" in flags
        out = []
        found = False
        for name, text in sources:
            if text is None:
                out.append(f"grep: {name}: Is a directory")
                continue
            count = 0
            for i, line in enumerate(text.splitlines(), 1):
                if bool(rx.search(line)) != ("v" in flags):
                    count += 1
                    found = True
                    if "c" not in flags:
                        prefix = (f"{name}:" if show_name else "") + (f"{i}:" if "n" in flags else "")
                        out.append(prefix + line)
            if "c" in flags:
                out.append((f"{name}:" if show_name else "") + str(count))
        if "q" in flags:
            return 0 if found else 1
        text = "\n".join(out) + ("\n" if out else "")
        if not found and "c" not in flags:
            # No line matches: grep prints nothing and fails (exit code 1).
            raise _Exit(text.rstrip("\n"), 1)
        if not found:
            self.out.append(text)
            return 1
        return text

    def c_sort(self, args, stdin, piped):
        flags, files = self.flags(args, "rnu", "sort")
        lines = self._text_of(files, stdin, "sort").splitlines()
        if "n" in flags:
            def key(s):
                m = re.match(r"\s*(-?\d+(\.\d+)?)", s)
                return (float(m.group(1)) if m else 0.0, s)
            lines.sort(key=key, reverse="r" in flags)
        else:
            lines.sort(reverse="r" in flags)
        if "u" in flags:
            lines = list(dict.fromkeys(lines))
        return "".join(l + "\n" for l in lines)

    def c_uniq(self, args, stdin, piped):
        flags, files = self.flags(args, "c", "uniq")
        out, prev, count = [], None, 0
        for line in self._text_of(files, stdin, "uniq").splitlines() + [None]:
            if line == prev:
                count += 1
                continue
            if prev is not None:
                out.append(f"{count:>7} {prev}" if "c" in flags else prev)
            prev, count = line, 1
        return "".join(l + "\n" for l in out)

    def c_find(self, args, stdin, piped):
        start = "."
        if args and not args[0].startswith("-"):
            start, args = args[0], args[1:]
        name = kind = None
        i = 0
        while i < len(args):
            if args[i] == "-name" and i + 1 < len(args):
                name, i = args[i + 1], i + 2
            elif args[i] == "-type" and i + 1 < len(args):
                kind, i = args[i + 1], i + 2
            else:
                raise _Exit(f"find: unknown predicate '{args[i]}'")
        root = self.abs(start)
        if not self.exists(root):
            raise _Exit(f"find: '{start}': No such file or directory")
        out = []
        for p in sorted(self.tree_under(root)):
            if kind == "f" and p not in self.files or kind == "d" and p not in self.dirs:
                continue
            if name and not fnmatch.fnmatchcase(posixpath.basename(p), name):
                continue
            shown = start.rstrip("/") + p[len(root):] if p != root else start
            out.append(shown)
        return "".join(l + "\n" for l in out)

    def c_chmod(self, args, stdin, piped):
        if len(args) < 2:
            raise _Exit("chmod: missing operand")
        spec, names = args[0], args[1:]
        for n in names:
            path = self.abs(n)
            if not self.exists(path):
                raise _Exit(f"chmod: cannot access '{n}': No such file or directory")
            if not self.may_write(path):
                raise _Exit(f"chmod: changing permissions of '{n}': Operation not permitted")
            if re.fullmatch(r"[0-7]{3}", spec):
                self.modes[path] = spec
                continue
            m = re.fullmatch(r"([ugoa]*)([+-=])([rwx]+)", spec)
            if not m:
                raise _Exit(f"chmod: invalid mode: '{spec}'")
            who, op, perms = m.groups()
            who = who or "a"
            digits = [int(d) for d in self.mode(path)]
            bit = sum({"r": 4, "w": 2, "x": 1}[p] for p in perms)
            for i, w in enumerate("ugo"):
                if "a" in who or w in who:
                    digits[i] = digits[i] | bit if op == "+" else digits[i] & ~bit if op == "-" else bit
            self.modes[path] = "".join(str(d) for d in digits)
        return ""

    def c_whoami(self, args, stdin, piped):
        return ("root" if self.root else USER) + "\n"

    def c_hostname(self, args, stdin, piped):
        if "-I" in args:
            return "192.168.1.42 \n"
        return HOST + "\n"

    def clock_text(self, seconds=None, fmt="%H:%M:%S"):
        t = (36000 + (self.clock if seconds is None else seconds)) % 86400
        h, m, s = t // 3600, t % 3600 // 60, t % 60
        return fmt.replace("%H", f"{h:02d}").replace("%M", f"{m:02d}").replace("%S", f"{s:02d}")

    def c_date(self, args, stdin, piped):
        if args and args[0].startswith("+"):
            fmt = args[0][1:].replace("%Y", "2026").replace("%m", "11").replace("%d", "21").replace("%F", "2026-11-21")
            fmt = fmt.replace("%T", "%H:%M:%S")
            return self.clock_text(fmt=fmt) + "\n"
        return f"Sat Nov 21 {self.clock_text()} UTC 2026\n"

    def c_history(self, args, stdin, piped):
        return "".join(f"{i:>5}  {c}\n" for i, c in enumerate(self.history, 1))

    def c_clear(self, args, stdin, piped):
        self.cleared = True
        return ""

    def c_man(self, args, stdin, piped):
        if not args:
            raise _Exit("What manual page do you want?\nFor example, try 'man ls'.")
        text = _HELP.get(args[0])
        if not text:
            raise _Exit(f"No manual entry for {args[0]}", 16)
        return text + "\n"

    c_help = c_man

    def c_nano(self, args, stdin, piped):
        if not args:
            raise _Exit("nano: this course needs a file name: nano notes.txt")
        path = self.abs(args[0])
        if path in self.dirs:
            raise _Exit(f"nano: {args[0]}: Is a directory")
        if posixpath.dirname(path) not in self.dirs:
            raise _Exit(f"nano: {args[0]}: No such file or directory")
        self.editor = {"path": path, "name": args[0], "text": self.files.get(path, ""), "root": self.root}
        return ""

    def c_sudo(self, args, stdin, piped):
        if not args:
            raise _Exit("usage: sudo command")
        was = self.root
        self.root = True
        try:
            return self.command(args, stdin, piped)
        finally:
            self.root = was

    def c_apt(self, args, stdin, piped):
        if not args:
            raise _Exit("apt: tell apt what to do, for example: sudo apt install tree")
        action, names = args[0], [a for a in args[1:] if not a.startswith("-")]
        if action in ("install", "remove", "update", "upgrade", "full-upgrade") and not self.root:
            raise _Exit(
                "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n"
                "E: Unable to acquire the dpkg frontend lock, are you root?",
                100,
            )
        if action == "update":
            self.updates["listed"] = True
            hits = ("Hit:1 http://deb.debian.org/debian trixie InRelease\n"
                    "Hit:2 http://deb.debian.org/debian-security trixie-security InRelease\n"
                    "Hit:3 http://deb.debian.org/debian trixie-updates InRelease\n"
                    "Hit:4 http://archive.raspberrypi.com/debian trixie InRelease\n")
            if self.updates.get("done") or self.updates.get("none"):
                return hits + "All packages are up to date.\n"
            return hits + f"{len(_UPGRADES)} packages can be upgraded. Run 'apt list --upgradable' to see them.\n"
        if action in ("upgrade", "full-upgrade"):
            return self.apt_upgrade(args)
        if action == "list" and "--upgradable" in args:
            if not self.updates.get("listed") or self.updates.get("done") or self.updates.get("none"):
                return "Listing... Done\n"
            return "Listing... Done\n" + "".join(f"{n}/stable [upgradable]\n" for n in _UPGRADES)
        if action == "install":
            if not names:
                raise _Exit("E: tell apt which package to install", 100)
            out = ["Reading package lists... Done"]
            for n in names:
                if n in self.packages:
                    out.append(f"{n} is already the newest version.")
                else:
                    self.packages.append(n)
                    out.append(f"Setting up {n} ...")
            return "\n".join(out) + "\n"
        if action == "remove":
            for n in names:
                if n in self.packages:
                    self.packages.remove(n)
            return "Reading package lists... Done\n"
        if action == "list":
            return "".join(f"{n}/stable [installed]\n" for n in self.packages)
        raise _Exit(f"E: Invalid operation {action}", 100)

    c_apt_get = c_apt

    def apt_upgrade(self, args):
        lists = "Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n"
        if not self.updates.get("listed") or self.updates.get("done") or self.updates.get("none"):
            # Without `apt update`, apt does not know the new versions yet.
            return lists + "Calculating upgrade... Done\nSummary:\n  Upgrading: 0, Installing: 0, Removing: 0, Not Upgrading: 0\n"
        summary = (lists + "Calculating upgrade... Done\nUpgrading:\n  " + "  ".join(_UPGRADES[:6]) + "\n  " + "  ".join(_UPGRADES[6:]) + "\n\n"
                   f"Summary:\n  Upgrading: {len(_UPGRADES)}, Installing: 0, Removing: 0, Not Upgrading: 0\n"
                   "  Download size: 187 MB\n  Space needed: 41.6 MB / 23.4 GB available\n\n")
        if "-y" in args or "--yes" in args:
            return summary + self.apt_upgrade_run()
        if self.frames:
            raise _Exit("E: apt asks Continue? [Y/n] here, but a script cannot answer. Use apt full-upgrade -y in a script.", 1)
        self.out.append(summary)
        self.ask_user("confirm", "Continue? [Y/n] ")
        return 0

    def apt_upgrade_run(self):
        self.updates["done"] = True
        gets = "".join(f"Get:{k + 1} http://archive.raspberrypi.com/debian trixie/main arm64 {n} arm64 [upgrade]\n" for k, n in enumerate(_UPGRADES[:4]))
        sets = "".join(f"Setting up {n} ...\n" for n in _UPGRADES)
        return (gets + f"... (and {len(_UPGRADES) - 4} more)\nFetched 187 MB in 21s (8,904 kB/s)\n" + sets
                + "Processing triggers for man-db ...\n")

    def c_tree(self, args, stdin, piped):
        if "tree" not in self.packages:
            raise _Exit("bash: tree: command not found", 127)
        root = self.abs(args[0]) if args else self.cwd
        lines = [args[0] if args else "."]

        def walk(d, indent):
            names = [n for n in self.children(d) if not n.startswith(".")]
            for i, n in enumerate(names):
                last = i == len(names) - 1
                lines.append(indent + ("└── " if last else "├── ") + n)
                p = posixpath.join(d, n)
                if p in self.dirs:
                    walk(p, indent + ("    " if last else "│   "))

        walk(root, "")
        return "\n".join(lines) + "\n"

    def c_seq(self, args, stdin, piped):
        if not args or len(args) > 3 or not all(re.fullmatch(r"-?\d+", a) for a in args):
            raise _Exit("seq: this course knows: seq LAST, seq FIRST LAST, seq FIRST STEP LAST")
        nums = [int(a) for a in args]
        first, step, last = (1, 1, nums[0]) if len(nums) == 1 else (nums[0], 1, nums[1]) if len(nums) == 2 else tuple(nums)
        if step == 0:
            raise _Exit("seq: invalid Zero increment value: '0'")
        values = range(first, last + (1 if step > 0 else -1), step)
        return "".join(f"{v}\n" for v in list(values)[:10000])

    def c_sleep(self, args, stdin, piped):
        if not args or not re.fullmatch(r"\d+(\.\d+)?", args[0]):
            raise _Exit("sleep: missing operand" if not args else f"sleep: invalid time interval '{args[0]}'")
        self.clock += int(float(args[0]))
        return ""

    def c_basename(self, args, stdin, piped):
        if not args:
            raise _Exit("basename: missing operand")
        name = posixpath.basename(args[0].rstrip("/")) or "/"
        if len(args) > 1 and name.endswith(args[1]) and name != args[1]:
            name = name[: -len(args[1])]
        return name + "\n"

    def c_dirname(self, args, stdin, piped):
        if not args:
            raise _Exit("dirname: missing operand")
        return (posixpath.dirname(args[0].rstrip("/")) or ".") + "\n"

    def c_bash(self, args, stdin, piped):
        if not args:
            raise _Exit("bash: this course runs bash only with a script: bash script.sh")
        return self.script(args[0], args[1:], needs_x=False)

    c_sh = c_bash

    def script(self, name, args, needs_x, source=False):
        path = self.real(self.abs(name))
        if path in self.dirs:
            raise _Exit(f"bash: {name}: Is a directory", 126)
        if path not in self.files:
            raise _Exit(f"bash: {name}: No such file or directory", 127)
        if needs_x and not int(self.mode(path)[0]) & 1:
            raise _Exit(f"bash: {name}: Permission denied", 126)
        text = self.files[path]
        first = text.split("\n", 1)[0]
        if first.startswith("#!") and "python" in first and not source:
            return self.c_python3([name] + list(args), None, False)
        if self.depth >= _MAX_DEPTH:
            raise _Exit("bash: too many scripts inside scripts")
        saved = (self.vars, self.args, self.cwd, self.exported)
        if not source:
            # A script is a new program: it sees only the exported variables,
            # and its variables and cd end with it.
            self.vars = {k: v for k, v in self.vars.items() if k in self.exported}
            self.exported = set(self.exported)
        if args or not source:
            self.args = list(args)
        self.frames.append(name)
        self.depth += 1
        try:
            code = self.run_text(text)
        except _ScriptExit as e:
            code = e.code
        except (_Break, _Continue):
            code = 0
        finally:
            self.frames.pop()
            self.depth -= 1
            if not source:
                self.vars, self.args, self.cwd, self.exported = saved
            else:
                self.args = saved[1]
        return code

    # ---- Python ----------------------------------------------------------------
    def run_python(self, code, cwd):
        """Runs a Python program with the files of cwd. Returns (stdout, error, still running).
        time.sleep only moves a pretend clock: after _PY_SECONDS, the program counts as running."""
        import time

        prefix = cwd.rstrip("/") + "/"
        here = {p[len(prefix):]: t for p, t in self.files.items() if p.startswith(prefix)}
        slept = [0.0]
        real_sleep = time.sleep

        def pretend_sleep(seconds):
            slept[0] += max(0.0, float(seconds))
            if slept[0] > _PY_SECONDS:
                raise _SleptEnough()

        time.sleep = pretend_sleep
        try:
            result = json.loads(run(json.dumps({"code": code, "cases": [{"files": here}]})))  # noqa: F821 (harness.py)
        finally:
            time.sleep = real_sleep
        for rel, text in (result.get("files") or {}).items():
            if rel.startswith("home/"):
                continue
            target = prefix + rel
            self._mkdirs(posixpath.dirname(target))
            self.files[target] = text
        error = result.get("error")
        # gpio.py runs every program on its pretend clock (also without a part),
        # and ends it quietly after 30 seconds ("cap") or when it waits for ever.
        board = globals().get("_board")
        ended = (getattr(board, "end", None) or {}).get("why") if board is not None else None
        running = slept[0] > _PY_SECONDS or ended in ("cap", "waiting") or bool(error and error.get("type") == "Timeout")
        if error and error.get("type") == "Timeout":
            error = None
        return result.get("stdout") or "", error, running

    def c_python3(self, args, stdin, piped):
        args = [a for a in args if a != "-u"]
        if not args:
            raise _Exit("Python 3 is here, but this terminal cannot type into Python itself.\nWrite a file, and run it: python3 hello.py")
        if args[0] in ("--version", "-V"):
            return "Python 3.13.5\n"
        name = args[0]
        if args[0] == "-c":
            if len(args) < 2:
                raise _Exit("Argument expected for the -c option", 2)
            code = args[1]
        else:
            path = self.abs(name)
            if self.real(path) not in self.files:
                raise _Exit(f"python3: can't open file '{path}': [Errno 2] No such file or directory", 2)
            code = self.files[self.real(path)]
        out, error, running = self.run_python(code, self.cwd)
        if out:
            self.out.append(out)
        if error:
            if error.get("needsInput"):
                self.out.append("This terminal cannot answer input() yet. Give the program its values in the file.\n")
                return 1
            raise _Exit(error["traceback"].rstrip("\n"), 1)
        if running:
            raise _Exit("^C\n(The program was still running after 30 seconds. This terminal stopped it, like Ctrl+C on a real Pi.)", 130)
        return 0

    c_python = c_python3

    # ---- processes -------------------------------------------------------------
    def new_pid(self):
        self.next_pid += 1
        return self.next_pid

    def all_procs(self):
        """Every process: (pid, user, cpu, mem, command, tty, service or None)."""
        rows = [(pid, user, cpu, mem, cmd, "?", None) for pid, user, cpu, mem, cmd in _BASE_PROCS]
        for name in sorted(set(_UNITS) | set(self.services)):
            s = self.svc(name)
            if s.get("state") == "active" and s.get("pid"):
                unit = self.unit(name, quiet=True) or {}
                rows.append((s["pid"], unit.get("user", "root"), float(s.get("cpu", 0.0)), float(s.get("mem", 0.3)), unit.get("proc") or unit.get("exec", name), "?", name))
        rows.append((SHELL_PID, USER, 0.0, 0.1, "-bash", "pts/0", None))
        for p in self.procs:
            rows.append((int(p["pid"]), p.get("user", USER), float(p.get("cpu", 0.0)), float(p.get("mem", 0.5)), p["cmd"], p.get("tty", "?"), None))
        return sorted(rows)

    def c_ps(self, args, stdin, piped):
        wide = any(a.lstrip("-") in ("aux", "ax", "e", "ef", "A", "eF") for a in args)
        rows = self.all_procs()
        if not wide:
            mine = [r for r in rows if r[5] == "pts/0"]
            lines = ["    PID TTY          TIME CMD"] + [f"{r[0]:>7} {r[5]:<8} 00:00:00 {r[4].split()[0].lstrip('-').split('/')[-1]}" for r in mine]
            lines.append(f"{self.new_pid():>7} pts/0    00:00:00 ps")
            return "\n".join(lines) + "\n"
        if any("f" in a for a in args if a.startswith("-")):
            lines = ["UID          PID    PPID  C STIME TTY          TIME CMD"]
            for pid, user, cpu, mem, cmd, tty, _ in rows:
                lines.append(f"{user:<8} {pid:>7} {1 if pid > 2 else 0:>7} {int(cpu):>2} 07:46 {tty:<8} 00:00:{int(cpu) % 60:02d} {cmd}")
            return "\n".join(lines) + "\n"
        lines = ["USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND"]
        for pid, user, cpu, mem, cmd, tty, _ in rows:
            rss = int(mem * _MEM_MB * 10.24)
            stat = "R" if cpu >= 50 else "Ss" if pid < 1000 else "S"
            lines.append(f"{user:<10} {pid:>6} {cpu:>4.1f} {mem:>4.1f} {rss * 3:>6} {rss:>5} {tty:<8} {stat:<4} 07:46 {int(cpu) // 10:>3}:{int(cpu * 7) % 60:02d} {cmd}")
        return "\n".join(lines) + "\n"

    def load(self):
        busy = sum(r[2] for r in self.all_procs()) / 100
        return busy + 0.02, busy * 0.8 + 0.05, busy * 0.4 + 0.08

    def mem_used(self):
        return 380.0 + sum(r[3] for r in self.all_procs()) * _MEM_MB / 100

    def uptime_text(self):
        up = _BOOT_SECONDS + self.clock if self.boots == 1 else self.clock - self.boot_at + 30
        up = max(up, 30)
        return f"{up // 3600}:{up % 3600 // 60:02d}" if up >= 3600 else f"{up // 60} min"

    def c_uptime(self, args, stdin, piped):
        a, b, c = self.load()
        return f" {self.clock_text()} up {self.uptime_text()},  1 user,  load average: {a:.2f}, {b:.2f}, {c:.2f}\n"

    def c_top(self, args, stdin, piped):
        rows = self.all_procs()
        a, b, c = self.load()
        used = self.mem_used()
        busy = min(100.0, sum(r[2] for r in rows) / 4)
        out = [
            f"top - {self.clock_text()} up {self.uptime_text()},  1 user,  load average: {a:.2f}, {b:.2f}, {c:.2f}",
            f"Tasks: {len(rows) + 130} total,   {1 + sum(1 for r in rows if r[2] >= 50)} running, {len(rows) + 129 - sum(1 for r in rows if r[2] >= 50)} sleeping,   0 stopped,   0 zombie",
            f"%Cpu(s): {busy:4.1f} us,  0.5 sy,  0.0 ni, {100 - busy - 0.5:4.1f} id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st",
            f"MiB Mem :   {_MEM_MB:.1f} total,   {_MEM_MB - used - 431.5:.1f} free,    {used:.1f} used,    431.5 buff/cache",
            f"MiB Swap:    200.0 total,    200.0 free,      0.0 used.   {_MEM_MB - used:.1f} avail Mem",
            "",
            "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND",
        ]
        for pid, user, cpu, mem, cmd, tty, _ in sorted(rows, key=lambda r: (-r[2], -r[3], r[0]))[:12]:
            res = int(mem * _MEM_MB * 10.24)
            comm = cmd.split()[0].lstrip("-").split("/")[-1].rstrip(":")
            out.append(f"{pid:>7} {user:<9} 20   0 {res * 3:>7} {res:>6} {res // 2:>6} {'R' if cpu >= 50 else 'S'} {cpu:>5.1f} {mem:>5.1f}   0:{int(cpu) % 60:02d}.00 {comm}")
        out.append("")
        out.append("(A real top updates every few seconds until you press q. Here it shows one picture.)")
        return "\n".join(out) + "\n"

    def c_htop(self, args, stdin, piped):
        if "htop" not in self.packages:
            raise _Exit("bash: htop: command not found", 127)
        return self.c_top(args, stdin, piped)

    def c_free(self, args, stdin, piped):
        used = self.mem_used()
        human = any(a in ("-h", "--human") for a in args)
        mega = any(a in ("-m", "--mega") for a in args)

        def size(mb):
            if human:
                return f"{mb / 1024:.1f}Gi" if mb >= 1024 else f"{mb:.0f}Mi" if mb >= 1 else "0B"
            return str(int(mb)) if mega else str(int(mb * 1024))

        free = _MEM_MB - used - 431.5
        return (
            "               total        used        free      shared  buff/cache   available\n"
            f"Mem:    {size(_MEM_MB):>12} {size(used):>11} {size(free):>11} {size(12):>11} {size(431.5):>11} {size(_MEM_MB - used):>11}\n"
            f"Swap:   {size(199.9):>12} {size(0):>11} {size(199.9):>11}\n"
        )

    def c_df(self, args, stdin, piped):
        if any(a == "-h" for a in args):
            return (
                "Filesystem      Size  Used Avail Use% Mounted on\n"
                "/dev/mmcblk0p2   29G  5.1G   23G  19% /\n"
                "tmpfs           1.9G     0  1.9G   0% /dev/shm\n"
                "/dev/mmcblk0p1  510M   64M  447M  13% /boot/firmware\n"
            )
        return (
            "Filesystem     1K-blocks    Used Available Use% Mounted on\n"
            "/dev/mmcblk0p2  30358348 5321212  23746468  19% /\n"
            "tmpfs            1942624       0   1942624   0% /dev/shm\n"
            "/dev/mmcblk0p1    522230   65110    457120  13% /boot/firmware\n"
        )

    def _signal(self, args, cmd):
        sig = "TERM"
        rest = []
        i = 0
        while i < len(args):
            a = args[i]
            if a == "-s" and i + 1 < len(args):
                sig, i = args[i + 1].upper().removeprefix("SIG"), i + 2
                continue
            if re.fullmatch(r"-\d+", a):
                sig = {"9": "KILL", "15": "TERM", "2": "INT", "1": "HUP"}.get(a[1:], a[1:])
            elif re.fullmatch(r"-[A-Za-z]+", a):
                sig = a[1:].upper().removeprefix("SIG")
            else:
                rest.append(a)
            i += 1
        if sig not in ("KILL", "TERM", "INT", "HUP"):
            raise _Exit(f"bash: {cmd}: {sig}: invalid signal specification")
        return sig, rest

    def kill_pid(self, pid, sig):
        """Sends a signal. Returns an error text, or None."""
        rows = {r[0]: r for r in self.all_procs()}
        if pid not in rows:
            return "No such process"
        _, user, _, _, _, _, service = rows[pid]
        if user != USER and not self.root:
            return "Operation not permitted"
        if pid in (1, 2, SHELL_PID) or pid < 1000 and service is None:
            return None  # the system ignores it (and the course keeps your terminal)
        if service:
            s = self.svc(service)
            unit = self.unit(service, quiet=True) or {}
            name = f"{service}.service"
            if sig == "KILL":
                self.log(name, "systemd[1]", f"{name}: Main process exited, code=killed, status=9/KILL")
                self.log(name, "systemd[1]", f"{name}: Failed with result 'signal'.", prio=3)
                failed = True
            else:
                self.log(name, "systemd[1]", f"{name}: Deactivated successfully.")
                failed = False
            restart = unit.get("restart", "no")
            if restart == "always" or restart == "on-failure" and failed:
                self.log(name, "systemd[1]", f"{name}: Scheduled restart job, restart counter is at 1.")
                s["state"] = "inactive"
                self.start_service(service, quiet=True)
            else:
                s.update(state="failed" if failed else "inactive", pid=None, result="signal" if failed else None)
            return None
        for p in self.procs:
            if int(p["pid"]) == pid:
                if sig != "KILL" and p.get("stubborn"):
                    return None  # this program does not stop when it is asked
                self.procs.remove(p)
                break
        return None

    def c_kill(self, args, stdin, piped):
        if args == ["-l"]:
            return " 1) SIGHUP\t 2) SIGINT\t 9) SIGKILL\t15) SIGTERM\n"
        sig, rest = self._signal(args, "kill")
        if not rest:
            raise _Exit("kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]", 2)
        code = 0
        for a in rest:
            if not re.fullmatch(r"\d+", a):
                self.error(f"bash: kill: {a}: arguments must be process or job IDs")
                code = 1
                continue
            problem = self.kill_pid(int(a), sig)
            if problem:
                self.error(f"bash: kill: ({a}) - {problem}")
                code = 1
        return code

    def c_pkill(self, args, stdin, piped, cmd="pkill"):
        sig, rest = self._signal([a for a in args if a != "-f"], cmd)
        full = "-f" in args
        if not rest:
            raise _Exit(f"{cmd}: no process selection criteria" if cmd == "pkill" else "Usage: killall [OPTION]... NAME...", 2)
        target = rest[0]
        found = False
        for pid, user, cpu, mem, command, tty, service in self.all_procs():
            comm = command.split()[0].lstrip("-").split("/")[-1].rstrip(":")
            if (target in command) if full else (comm == target if cmd == "killall" else target in comm):
                if pid == SHELL_PID:
                    continue
                found = True
                problem = self.kill_pid(pid, sig)
                if problem:
                    self.error(f"{cmd}: killing pid {pid} failed: {problem}")
        if not found:
            if cmd == "killall":
                self.error(f"{target}: no process found")
            return 1
        return 0

    def c_killall(self, args, stdin, piped):
        return self.c_pkill(args, stdin, piped, cmd="killall")

    # ---- services and the journal -------------------------------------------------
    def _boot_journal(self):
        start = -_BOOT_SECONDS
        entries = [[start, "kernel", "", "Booting Linux on physical CPU 0x0000000000 [0x410fd083]", 6]]
        for k, (name, u) in enumerate(sorted(_UNITS.items())):
            if u["enabled"]:
                t = start + 6 + k
                entries.append([t, "systemd[1]", f"{name}.service", f"Started {name}.service - {u['desc']}.", 6])
                for line in u["lines"]:
                    entries.append([t, f"{u['comm']}[{u.get('pid', 400)}]", f"{name}.service", line, 6])
        entries.append([start + 14, "systemd[1]", "", "Startup finished in 3.212s (kernel) + 9.804s (userspace) = 13.016s.", 6])
        if self.power == "weak":
            # A weak power supply: the kernel warns again and again.
            for k in range(5):
                entries.append([start + 20 + k * 1500, "kernel", "", "hwmon hwmon1: Undervoltage detected!", 4])
                entries.append([start + 25 + k * 1500, "kernel", "", "hwmon hwmon1: Voltage normalised", 6])
        return entries

    def log(self, unit, ident, text, prio=6):
        self.journal.append([self.clock, ident, unit, text, prio])
        del self.journal[:-400]

    def svc(self, name):
        """The run-time state of a service (made from the defaults the first time)."""
        if name not in self.services:
            u = _UNITS.get(name)
            self.services[name] = {
                "state": "active" if u and u["active"] else "inactive",
                "enabled": bool(u and u["enabled"]),
                "pid": u.get("pid") if u and u["active"] else None,
                "since": -_BOOT_SECONDS + 6,
            }
        return self.services[name]

    @staticmethod
    def parse_unit(text):
        unit = {"sections": set()}
        section = None
        for raw in text.splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or line.startswith(";"):
                continue
            if line.startswith("[") and line.endswith("]"):
                section = line[1:-1]
                unit["sections"].add(section)
                continue
            key, eq, value = line.partition("=")
            if not eq:
                continue
            key, value = key.strip(), value.strip()
            if section == "Unit" and key == "Description":
                unit["desc"] = value
            elif section == "Service" and key in ("ExecStart", "User", "WorkingDirectory", "Restart", "Environment"):
                unit[key.lower()] = value
            elif section == "Install" and key in ("WantedBy", "RequiredBy", "Alias", "Also"):
                unit["install"] = value
        return unit

    def unit(self, name, quiet=False):
        """The definition of a service: a built-in one, or a file in /etc/systemd/system."""
        if name in _UNITS:
            u = dict(_UNITS[name])
            u["path"] = f"/usr/lib/systemd/system/{name}.service"
            u["install"] = "multi-user.target"
            return u
        path = f"/etc/systemd/system/{name}.service"
        s = self.services.get(name)
        loaded = s.get("loaded") if s else None
        text = self.files.get(path)
        if text is None and loaded is None:
            return None
        if loaded is None:
            loaded = text
            self.svc(name)["loaded"] = text
        elif text != loaded and not quiet:
            self.warn_changed(name)
        u = self.parse_unit(loaded)
        u["path"] = path
        u.setdefault("desc", f"{name}.service")
        u["custom"] = True
        u["user"] = u.get("user", "root")
        u["exec"] = u.get("execstart", "")
        u["proc"] = u["exec"]
        u["comm"] = (shlex.split(u["exec"])[0].split("/")[-1] if u["exec"] else name)
        return u

    def warn_changed(self, name):
        self.error(f"Warning: The unit file, source configuration file or drop-ins of {name}.service changed on disk. "
                   "Run 'systemctl daemon-reload' to reload units.")

    def service_name(self, word):
        return word[:-8] if word.endswith(".service") else word

    def start_service(self, name, quiet=False):
        unit = self.unit(name, quiet=quiet)
        s = self.svc(name)
        if unit is None:
            raise _Exit(f"Failed to start {name}.service: Unit {name}.service not found.", 5)
        if s.get("state") == "active":
            return
        full = f"{name}.service"
        pid = self.new_pid()
        s.update(state="active", pid=pid, since=self.clock, result=None, status=None, cpu=0.0, mem=0.3)
        if not unit.get("custom"):
            self.log(full, "systemd[1]", f"Starting {full} - {unit['desc']}...")
            for line in unit["lines"]:
                self.log(full, f"{unit['comm']}[{pid}]", line)
            self.log(full, "systemd[1]", f"Started {full} - {unit['desc']}.")
            return
        if not unit["exec"]:
            s.update(state="inactive", pid=None)
            self.log(full, "systemd[1]", f"{full}: Service has no ExecStart=, ExecStop=, or SuccessAction=. Refusing.", prio=3)
            raise _Exit(f"Failed to start {full}: Unit {full} has a bad unit file setting.\nSee system logs and 'systemctl status {full}' for details.", 1)
        self.log(full, "systemd[1]", f"Started {full} - {unit['desc']}.")
        self.run_service(name, unit, pid)

    def fail_service(self, name, unit, pid, status, why, ident, lines):
        full = f"{name}.service"
        for line in lines:
            self.log(full, ident, line, prio=3)
        self.log(full, "systemd[1]", f"{full}: Main process exited, code=exited, status={status}/{why}")
        self.log(full, "systemd[1]", f"{full}: Failed with result 'exit-code'.", prio=3)
        s = self.svc(name)
        if unit.get("restart") in ("always", "on-failure"):
            for k in range(1, 6):
                self.log(full, "systemd[1]", f"{full}: Scheduled restart job, restart counter is at {k}.")
            self.log(full, "systemd[1]", f"{full}: Start request repeated too quickly.", prio=3)
        s.update(state="failed", pid=None, result="exit-code", status=f"{status}/{why}", exit_pid=pid)

    def run_service(self, name, unit, pid):
        """Runs the ExecStart= of a service file, as systemd would."""
        full = f"{name}.service"
        try:
            argv = shlex.split(unit["exec"])
        except ValueError:
            argv = unit["exec"].split()
        exe = argv[0].lstrip("-@")
        base = exe.split("/")[-1]
        workdir = unit.get("workingdirectory") or "/"
        known = {"python3": "/usr/bin/python3", "python": "/usr/bin/python3", "bash": "/usr/bin/bash", "sh": "/usr/bin/sh"}
        if exe.startswith("/"):
            if exe in ("/usr/bin/python3", "/usr/bin/python", "/bin/python3", "/usr/bin/bash", "/bin/bash", "/bin/sh", "/usr/bin/sh"):
                kind = "python" if "python" in base else "shell"
            elif exe in self.files:
                if not int(self.mode(exe)[0]) & 1:
                    self.log(full, f"({base})[{pid}]", f"{full}: Unable to locate executable '{exe}': Permission denied", prio=3)
                    self.fail_service(name, unit, pid, 203, "EXEC", f"({base})[{pid}]", [])
                    return
                kind = "script"
            else:
                self.log(full, f"({base})[{pid}]", f"{full}: Unable to locate executable '{exe}': No such file or directory", prio=3)
                self.fail_service(name, unit, pid, 203, "EXEC", f"({base})[{pid}]", [])
                return
        elif base in known:
            kind = "python" if "python" in base else "shell"
        else:
            self.log(full, f"({base})[{pid}]", f"{full}: Unable to locate executable '{exe}': No such file or directory", prio=3)
            self.fail_service(name, unit, pid, 203, "EXEC", f"({base})[{pid}]", [])
            return
        rest = argv[1:]
        unbuffered = "-u" in rest or "PYTHONUNBUFFERED" in (unit.get("environment") or "")
        rest = [a for a in rest if not a.startswith("-")]
        if kind == "script":
            target = exe
        elif not rest:
            self.fail_service(name, unit, pid, 1, "FAILURE", f"{base}[{pid}]", [f"{base}: this course needs a file to run, like {exe} /home/pi/app.py"])
            return
        else:
            target = posixpath.normpath(posixpath.join(workdir, rest[0])) if not rest[0].startswith("/") else rest[0]
        if target not in self.files:
            if kind == "python":
                self.fail_service(name, unit, pid, 2, "INVALIDARGUMENT", f"python3[{pid}]",
                                  [f"/usr/bin/python3: can't open file '{target}': [Errno 2] No such file or directory"])
            else:
                self.fail_service(name, unit, pid, 127, "n/a", f"{base}[{pid}]", [f"{base}: {target}: No such file or directory"])
            return
        if kind == "python" or kind == "script" and "python" in self.files[target].split("\n", 1)[0]:
            source = self.files[target]
            out, error, running = self.run_python(source, workdir if workdir != "/" else posixpath.dirname(target))
            ident = f"python3[{pid}]"
            show_out = unbuffered or not running or "flush=True" in source
            lines = out.splitlines()[-40:] if show_out else []
            for line in lines:
                self.log(full, ident, line)
            if error:
                self.fail_service(name, unit, pid, 1, "FAILURE", ident, error["traceback"].rstrip("\n").splitlines())
                return
            self.svc(name)["cpu"] = 1.2 if running else 0.0
            if not running:
                self.finish_service(name, unit)
            return
        # A shell script as the service.
        clone = Shell(self.state())
        clone.frames.append(target)
        text, code = clone.run_top_script(self.files[target])
        for line in text.splitlines()[-40:]:
            self.log(full, f"{base}[{pid}]", line)
        if code:
            self.fail_service(name, unit, pid, code, "FAILURE", f"{base}[{pid}]", [])
        else:
            self.finish_service(name, unit)

    def run_top_script(self, text):
        self.screen = []
        self.out = self.err = self.screen
        try:
            code = self.run_text(text)
        except (_Stop, _ScriptExit, _Break, _Continue) as e:
            code = getattr(e, "code", 0)
        return "".join(self.screen), code

    def finish_service(self, name, unit):
        full = f"{name}.service"
        s = self.svc(name)
        if unit.get("restart") == "always":
            for k in range(1, 6):
                self.log(full, "systemd[1]", f"{full}: Scheduled restart job, restart counter is at {k}.")
            self.log(full, "systemd[1]", f"{full}: Start request repeated too quickly.", prio=3)
            self.log(full, "systemd[1]", f"{full}: Failed with result 'start-limit-hit'.", prio=3)
            s.update(state="failed", pid=None, result="start-limit-hit")
            return
        self.log(full, "systemd[1]", f"{full}: Deactivated successfully.")
        s.update(state="inactive", pid=None, result=None)

    def stop_service(self, name):
        unit = self.unit(name)
        if unit is None:
            raise _Exit(f"Failed to stop {name}.service: Unit {name}.service not loaded.", 5)
        s = self.svc(name)
        full = f"{name}.service"
        if s.get("state") == "active":
            self.log(full, "systemd[1]", f"Stopping {full} - {unit['desc']}...")
            self.log(full, "systemd[1]", f"{full}: Deactivated successfully.")
            self.log(full, "systemd[1]", f"Stopped {full} - {unit['desc']}.")
        s.update(state="inactive", pid=None, result=None, status=None)

    def ago(self, since):
        seconds = max(0, self.clock - int(since or 0))
        if seconds < 60:
            return f"{seconds}s ago"
        if seconds < 3600:
            return f"{seconds // 60}min {seconds % 60}s ago"
        return f"{seconds // 3600}h {seconds % 3600 // 60}min ago"

    def journal_lines(self, unit=None, boot=False, prio=None):
        rows = []
        for t, ident, u, text, p in self.journal:
            if ident == "--boot--":
                if not unit and not boot:
                    rows.append("-- Boot --")
                elif boot:
                    rows = []
                continue
            if unit == "-kernel-":
                if ident != "kernel":
                    continue
            elif unit and u != unit:
                continue
            if prio is not None and p > prio:
                continue
            rows.append(f"Nov 21 {self.clock_text(t)} {HOST} {ident}: {text}")
        return rows

    def c_systemctl(self, args, stdin, piped):
        flags = [a for a in args if a.startswith("-")]
        words = [a for a in args if not a.startswith("-")]
        action = words[0] if words else "list-units"
        names = [self.service_name(w) for w in words[1:]]
        now = "--now" in flags
        changes = ("start", "stop", "restart", "enable", "disable", "daemon-reload", "reload")
        if action in changes and not self.root:
            if action in ("enable", "disable"):
                raise _Exit(f"Failed to {action} unit: Interactive authentication required.", 1)
            if action == "daemon-reload":
                raise _Exit("Failed to reload daemon: Interactive authentication required.", 1)
            target = f"{names[0]}.service" if names else "unit"
            raise _Exit(f"Failed to {action} {target}: Interactive authentication required.\n"
                        f"See system logs and 'systemctl status {target}' for details.", 1)
        if action in ("status", "start", "stop", "restart", "enable", "disable", "is-active", "is-enabled", "is-failed", "reload") and not names:
            raise _Exit(f"Too few arguments.", 1)
        if action == "daemon-reload":
            for name, s in self.services.items():
                if name in _UNITS:
                    continue
                path = f"/etc/systemd/system/{name}.service"
                if path in self.files:
                    s["loaded"] = self.files[path]
                else:
                    s.pop("loaded", None)
            return 0
        if action in ("start", "restart", "reload"):
            for name in names:
                if action != "start":
                    if self.unit(name) is None:
                        raise _Exit(f"Failed to {action} {name}.service: Unit {name}.service not found.", 5)
                    self.stop_service(name)
                self.start_service(name)
            return 0
        if action == "stop":
            for name in names:
                self.stop_service(name)
            return 0
        if action in ("enable", "disable"):
            out = []
            for name in names:
                unit = self.unit(name)
                if unit is None:
                    raise _Exit(f"Failed to {action} unit: Unit file {name}.service does not exist.", 1)
                s = self.svc(name)
                link = f"/etc/systemd/system/multi-user.target.wants/{name}.service"
                if action == "enable":
                    if not unit.get("install"):
                        out.append(
                            "The unit files have no installation config (WantedBy=, RequiredBy=, UpheldBy=,\n"
                            "Also=, or Alias= settings in the [Install] section, and DefaultInstance= for\n"
                            "template units). This means they are not meant to be enabled or disabled using systemctl."
                        )
                        continue
                    if not s.get("enabled"):
                        out.append(f"Created symlink {link} → {unit['path']}.")
                    s["enabled"] = True
                    if now:
                        self.start_service(name)
                else:
                    if s.get("enabled"):
                        out.append(f"Removed \"{link}\".")
                    s["enabled"] = False
                    if now:
                        self.stop_service(name)
            if out:
                self.out.append("\n".join(out) + "\n")
            return 0
        if action in ("is-active", "is-enabled", "is-failed"):
            code = 0
            out = []
            for name in names:
                unit = self.unit(name, quiet=True)
                s = self.svc(name) if unit else {}
                if action == "is-active":
                    state = s.get("state", "inactive")
                    out.append(state)
                    code = code or (0 if state == "active" else 3)
                elif action == "is-failed":
                    state = s.get("state", "inactive")
                    out.append(state)
                    code = code or (0 if state == "failed" else 1)
                else:
                    state = "not-found" if not unit else "enabled" if s.get("enabled") else "static" if not unit.get("install") else "disabled"
                    out.append(state)
                    code = code or (0 if state == "enabled" else 1)
            self.out.append("\n".join(out) + "\n")
            return code
        if action == "status":
            blocks = []
            code = 0
            for name in names:
                unit = self.unit(name)
                if unit is None:
                    self.error(f"Unit {name}.service could not be found.")
                    code = 4
                    continue
                s = self.svc(name)
                full = f"{name}.service"
                state = s.get("state", "inactive")
                mark = {"active": "●", "failed": "×"}.get(state, "○")
                enabled = "enabled" if s.get("enabled") else "static" if not unit.get("install") else "disabled"
                lines = [f"{mark} {full} - {unit['desc']}",
                         f"     Loaded: loaded ({unit['path']}; {enabled}; preset: enabled)"]
                when = f"since Sat 2026-11-21 {self.clock_text(s.get('since'))} UTC; {self.ago(s.get('since'))}"
                if state == "active":
                    lines.append(f"     Active: active (running) {when}")
                    lines.append(f"   Main PID: {s['pid']} ({unit['comm']})")
                    lines.append(f"     CGroup: /system.slice/{full}")
                    lines.append(f"             └─{s['pid']} {unit['proc']}")
                elif state == "failed":
                    lines.append(f"     Active: failed (Result: {s.get('result') or 'exit-code'}) {when}")
                    if s.get("status"):
                        lines.append(f"    Process: {s.get('exit_pid', '')} ExecStart={unit['exec']} (code=exited, status={s['status']})")
                    code = 3
                else:
                    lines.append("     Active: inactive (dead)")
                    code = code or 3
                log = self.journal_lines(unit=full, boot=True)[-10:]
                if log:
                    lines.append("")
                    lines.extend(log)
                blocks.append("\n".join(lines))
            if blocks:
                self.out.append("\n\n".join(blocks) + "\n")
            return code
        if action in ("list-units", "list-unit-files"):
            only_failed = "--failed" in flags or "--state=failed" in flags
            rows = ["  UNIT                      LOAD   ACTIVE SUB     DESCRIPTION"]
            names = sorted(set(_UNITS) | {n for n in self.services if self.unit(n, quiet=True)})
            for name in names:
                s = self.svc(name)
                unit = self.unit(name, quiet=True)
                state = s.get("state", "inactive")
                if only_failed and state != "failed" or not only_failed and state == "inactive":
                    continue
                sub = {"active": "running", "failed": "failed"}.get(state, "dead")
                rows.append(f"{'●' if state == 'failed' else ' '} {name + '.service':<25} loaded {state:<6} {sub:<7} {unit['desc']}")
            rows.append("")
            rows.append(f"{len(rows) - 2} loaded units listed.")
            return "\n".join(rows) + "\n"
        if action in ("reboot", "poweroff"):
            return self.c_reboot([], stdin, piped) if action == "reboot" else self.c_poweroff([], stdin, piped)
        raise _Exit(f"Unknown command verb '{action}'.", 1)

    def c_journalctl(self, args, stdin, piped):
        unit = None
        n = None
        prio = None
        follow = False
        boot = False
        i = 0
        while i < len(args):
            a = args[i]
            if a in ("-u", "--unit") and i + 1 < len(args):
                unit, i = args[i + 1], i + 2
                continue
            if a.startswith("--unit="):
                unit = a.split("=", 1)[1]
            elif a == "-n" and i + 1 < len(args):
                if not args[i + 1].isdigit():
                    raise _Exit(f"Failed to parse lines '{args[i + 1]}'.", 1)
                n, i = int(args[i + 1]), i + 2
                continue
            elif re.fullmatch(r"-n\d+", a):
                n = int(a[2:])
            elif a in ("-p", "--priority") and i + 1 < len(args):
                level = args[i + 1]
                prio = {"emerg": 0, "alert": 1, "crit": 2, "err": 3, "warning": 4, "notice": 5, "info": 6, "debug": 7}.get(level, int(level) if level.isdigit() else None)
                if prio is None:
                    raise _Exit(f"Unknown log level {level}", 1)
                i += 2
                continue
            elif a == "-f" or a == "--follow":
                follow = True
            elif a == "-k" or a == "--dmesg":
                unit = "-kernel-"
                boot = True
            elif a == "-b" or a == "--boot":
                boot = True
            elif a == "-e":
                n = n or 1000
            elif a in ("--no-pager", "-x", "-xe"):
                pass
            else:
                raise _Exit(f"journalctl: this course knows -u NAME, -n N, -p err, -b, -e and -f, not '{a}'.", 1)
            i += 1
        if unit and unit != "-kernel-" and not unit.endswith(".service"):
            unit += ".service"
        lines = self.journal_lines(unit=unit, boot=boot, prio=prio)
        if follow and n is None:
            n = 10
        if n is not None:
            lines = lines[-n:] if n else []
        if not lines:
            return "-- No entries --\n"
        text = "\n".join(lines) + "\n"
        if follow:
            text += "(-f waits for new lines until you press Ctrl+C. Here it shows the last ones.)\n"
        return text

    def c_reboot(self, args, stdin, piped):
        if not self.root:
            raise _Exit("Call to Reboot failed: Interactive authentication required.", 1)
        self.clock += 45
        self.journal.append([self.clock, "--boot--", "", "", 6])
        self.boots += 1
        self.boot_at = self.clock
        self.vars = {}
        self.exported = set()
        self.procs = []
        self.cwd = HOME
        self.log("", "kernel", "Booting Linux on physical CPU 0x0000000000 [0x410fd083]")
        if self.power == "weak":
            self.log("", "kernel", "hwmon hwmon1: Undervoltage detected!", prio=4)
        self.next_pid = 1000
        for name in sorted(set(_UNITS) | set(self.services)):
            s = self.svc(name)
            s.update(state="inactive", pid=None, result=None, status=None)
            if s.get("enabled") and self.unit(name, quiet=True):
                if name not in _UNITS:
                    path = f"/etc/systemd/system/{name}.service"
                    if path in self.files:
                        s["loaded"] = self.files[path]
                try:
                    self.start_service(name, quiet=True)
                except _Exit:
                    pass
        self.log("", "systemd[1]", "Startup finished in 3.198s (kernel) + 9.611s (userspace) = 12.809s.")
        self.clock += 15
        self.cleared = False
        self.last = 0
        return "Connection to raspberrypi closed.\n(The Pi restarts. A real one needs about 30 seconds. Here it is back at once, and you are logged in again.)\n"

    def c_shutdown(self, args, stdin, piped):
        if "-r" in args:
            return self.c_reboot(args, stdin, piped)
        return self.c_poweroff(args, stdin, piped)

    def c_poweroff(self, args, stdin, piped):
        if not self.root:
            raise _Exit("Call to PowerOff failed: Interactive authentication required.", 1)
        return "(A real Pi turns off now. Unplug it only when the green light has stopped. This course keeps it on.)\n"

    # ---- the real Pi: hardware, OS, updates, password ----------------------------
    def c_uname(self, args, stdin, piped):
        release = "6.18.0+rpt-rpi-v8"
        if "-a" in args:
            return f"Linux {HOST} {release} #1 SMP PREEMPT Debian 1:6.18.0-1+rpt1 (2026-09-30) aarch64 GNU/Linux\n"
        if "-r" in args:
            return release + "\n"
        if "-m" in args:
            return "aarch64\n"
        return "Linux\n"

    def c_vcgencmd(self, args, stdin, piped):
        what = args[0] if args else ""
        weak = self.power == "weak"
        if what == "measure_temp":
            busy = sum(r[2] for r in self.all_procs()) / 100
            return f"temp={self.temp + busy * 9:.1f}'C\n"
        if what == "get_throttled":
            return "throttled=0x50005\n" if weak else "throttled=0x0\n"
        if what == "measure_volts":
            return "volt=0.8350V\n" if not weak else "volt=0.8000V\n"
        if what == "pmic_read_adc":
            raise _Exit("vcgencmd pmic_read_adc works only on a Raspberry Pi 5. This is a Pi 4.", 1)
        raise _Exit("vcgencmd: this course knows measure_temp, get_throttled and measure_volts.", 1)

    def c_dmesg(self, args, stdin, piped):
        if not self.root:
            raise _Exit("dmesg: read kernel buffer failed: Operation not permitted", 1)
        boot = self.boot_at if self.boots > 1 else -_BOOT_SECONDS
        rows = [e for e in self.journal if e[1] == "kernel" and e[0] >= boot]
        return "".join(f"[{max(0, t - boot) + 0.000001 * (k + 1):12.6f}] {text}\n" for k, (t, _, _, text, _) in enumerate(rows))

    def c_raspi_config(self, args, stdin, piped):
        if not self.root:
            raise _Exit("Script must be run as root. Try 'sudo raspi-config'", 1)
        return ("(On a real Pi, raspi-config opens a menu: 1 System Options, 2 Display Options, 3 Interface Options,\n"
                " 4 Performance Options, 5 Localisation Options, 6 Advanced Options. Move with the arrow keys,\n"
                " choose with Enter. This terminal cannot draw menus: use the commands of the lesson instead.)\n")

    def ask_user(self, kind, text, secret=False, **data):
        """The command waits for an answer: the next line the learner types."""
        self.pending = dict(data, kind=kind, ask=text, secret=secret)

    def c_passwd(self, args, stdin, piped):
        if self.frames or piped:
            raise _Exit("passwd: this terminal can ask for passwords only at the prompt.", 1)
        if args and args[0] != USER:
            if not self.root:
                raise _Exit(f"passwd: You may not view or modify password information for {args[0]}.", 1)
            if self.user(args[0]) is None:
                raise _Exit(f"passwd: user '{args[0]}' does not exist", 1)
            self.ask_user("passwd-other", "New password: ", secret=True, step="new", name=args[0])
            return 0
        self.out.append(f"Changing password for {USER}.\n")
        self.ask_user("passwd", "Current password: ", secret=True, step="current")
        return 0

    def c_ping(self, args, stdin, piped):
        count = None
        rest = []
        i = 0
        while i < len(args):
            if args[i] == "-c" and i + 1 < len(args) and args[i + 1].isdigit():
                count, i = int(args[i + 1]), i + 2
                continue
            rest.append(args[i])
            i += 1
        if not rest:
            raise _Exit("ping: usage error: Destination address required", 1)
        host = rest[0]
        ip = self.lookup(host)
        if ip is None:
            raise _Exit(f"ping: {host}: Name or service not known", 2)
        n = count or 4
        times = [round(0.05 + 0.01 * (k % 3), 3) if ip.startswith(("127.", "192.168.1.42")) else round(11.8 + 0.4 * (k % 3), 1) for k in range(n)]
        lines = [f"PING {host} ({ip}) 56(84) bytes of data."]
        lines += [f"64 bytes from {ip}: icmp_seq={k + 1} ttl={64 if ip.startswith(('127.', '192.168.')) else 117} time={t} ms" for k, t in enumerate(times)]
        if count is None:
            lines.append("^C")
        lines += ["", f"--- {host} ping statistics ---", f"{n} packets transmitted, {n} received, 0% packet loss, time {(n - 1) * 1001}ms",
                  f"rtt min/avg/max/mdev = {min(times)}/{round(sum(times) / n, 3)}/{max(times)}/{round((max(times) - min(times)) / 2, 3)} ms"]
        if count is None:
            lines.append("(A real ping goes on until you press Ctrl+C. Here it stops after 4. ping -c 4 stops by itself.)")
        return "\n".join(lines) + "\n"

    def lookup(self, host, pc=False):
        name = host.lower()
        if not pc:
            listed = self.hosts_entry(name)
            if listed:
                return listed
        if name in (HOST, f"{HOST}.local", f"{HOST}.lan", "192.168.1.42"):
            return "192.168.1.42"
        if name in ("localhost", "127.0.0.1"):
            return "127.0.0.1"
        if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", name):
            return name
        tlds = ("com", "org", "net", "io", "dev", "uk", "de", "it", "fr", "es", "nl", "eu", "us", "edu", "gov", "info")
        if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}", name) and name.rsplit(".", 1)[1] in tlds:
            return f"203.0.113.{sum(map(ord, name)) % 200 + 20}"
        return None

    def c_ssh(self, args, stdin, piped):
        return "(You are on the Pi already. Run ssh in the terminal of your PC, to come here.)\n"

    def c_scp(self, args, stdin, piped):
        return "(Run scp on your PC, not on the Pi: log out with exit first.)\n"

    def c_logout(self, args, stdin, piped):
        if not self.via:
            raise _Exit("bash: logout: not login shell: use `exit'", 1)
        return self.c_exit([], stdin, piped)

    def answer(self, text):
        """The learner answered a question (yes/no, a password, Y/n). Returns (output, code)."""
        p = self.pending
        self.pending = None
        kind = p["kind"]
        if kind == "hostkey":
            word = text.strip().lower()
            if word == "yes":
                self.known.append(p["host"].lower())
                out = f"Warning: Permanently added '{p['host']}' (ED25519) to the list of known hosts.\n"
                self.ask_user("password", f"{p['user']}@{p['host']}'s password: ", secret=True, host=p["host"], user=p["user"], then=p["then"], tries=0)
                return out, 0
            if word == "no":
                return "Host key verification failed.\n", 255
            self.pending = dict(p, ask="Please type 'yes', 'no' or the fingerprint: ")
            return "", 0
        if kind == "password":
            good = p["user"] == USER and (text == self.password if self.password else bool(text))
            if not good:
                tries = p.get("tries", 0) + 1
                if tries >= 3:
                    return f"{p['user']}@{p['host']}: Permission denied (publickey,password).\n", 255
                self.pending = dict(p, tries=tries)
                return "Permission denied, please try again.\n", 0
            then = p["then"]
            if then["op"] == "login":
                return self.login(p["host"]), 0
            if then["op"] == "cmd":
                self.at = "pi"
                text_out, code = self.run_top(then["line"])
                self.at = "pc"
                return text_out, code
            return self.scp_do(p["host"], then)
        if kind == "passwd-other":
            if p["step"] == "new":
                self.ask_user("passwd-other", "Retype new password: ", secret=True, step="retype", name=p["name"], new=text)
                return "", 0
            if text != p["new"]:
                return "Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\n", 10
            self.user(p["name"])["password"] = text
            return "passwd: password updated successfully\n", 0
        if kind == "adduser":
            fields = ["Full Name", "Room Number", "Work Phone", "Home Phone", "Other"]
            step = p["step"]
            if step == "password":
                self.ask_user("adduser", "Retype new password: ", secret=True, step="retype", name=p["name"], new=text)
                return "", 0
            if step == "retype":
                if text != p["new"]:
                    self.ask_user("adduser", "Try again? [y/N] ", step="again", name=p["name"])
                    return "Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\n", 0
                self.user(p["name"])["password"] = text
                self.ask_user("adduser", f"\t{fields[0]} []: ", step=0, name=p["name"])
                return (f"passwd: password updated successfully\nChanging the user information for {p['name']}\n"
                        "Enter the new value, or press ENTER for the default\n"), 0
            if step == "again":
                if text.strip().lower() in ("y", "yes"):
                    self.ask_user("adduser", "New password: ", secret=True, step="password", name=p["name"])
                    return "", 0
                self.ask_user("adduser", f"\t{fields[0]} []: ", step=0, name=p["name"])
                return f"Changing the user information for {p['name']}\nEnter the new value, or press ENTER for the default\n", 0
            if isinstance(step, int):
                if step == 0 and text.strip():
                    self.user(p["name"])["full"] = text.strip()
                if step + 1 < len(fields):
                    self.ask_user("adduser", f"\t{fields[step + 1]} []: ", step=step + 1, name=p["name"])
                else:
                    self.ask_user("adduser", "Is the information correct? [Y/n] ", step="ok", name=p["name"])
                return "", 0
            if step == "ok":
                if text.strip().lower() in ("", "y", "yes"):
                    return (f"info: Adding new user `{p['name']}' to supplemental / extra groups `users' ...\n"
                            f"info: Adding user `{p['name']}' to group `users' ...\n"), 0
                self.ask_user("adduser", f"\t{fields[0]} []: ", step=0, name=p["name"])
                return "", 0
        if kind == "unzip":
            word = text.strip()
            members, target = p["members"], p["target"]
            keep = word in ("n", "N", "r")
            shown = []
            for m, t in members.items():
                full = posixpath.join(target, m)
                if t is None:
                    self._mkdirs(full)
                    shown.append(f"   creating: {m}")
                elif full in self.files and keep:
                    continue
                else:
                    self._mkdirs(posixpath.dirname(full))
                    self.files[full] = t
                    shown.append(f"  inflating: {m}")
            note = "(rename is not in this course: the file is kept)\n" if word == "r" else ""
            return note + "".join(line + "\n" for line in shown), 0
        if kind == "confirm":
            if text.strip().lower() in ("", "y", "yes"):
                return self.apt_upgrade_run(), 0
            return "Abort.\n", 1
        if kind == "passwd":
            step = p["step"]
            if step == "current":
                if self.password and text != self.password:
                    return "passwd: Authentication token manipulation error\npasswd: password unchanged\n", 10
                self.ask_user("passwd", "New password: ", secret=True, step="new")
                return "", 0
            if step == "new":
                if len(text) < 8:
                    self.ask_user("passwd", "New password: ", secret=True, step="new")
                    return "Bad: new password is too short (this course asks for at least 8 characters)\n", 0
                if self.password and text == self.password:
                    self.ask_user("passwd", "New password: ", secret=True, step="new")
                    return "The password has not been changed.\n", 0
                self.ask_user("passwd", "Retype new password: ", secret=True, step="retype", new=text)
                return "", 0
            if text != p.get("new"):
                return "Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\n", 10
            self.password = text
            self.pw_changed = True
            return "passwd: password updated successfully\n", 0
        return "", 0

    # ---- your PC: Windows PowerShell -------------------------------------------------
    def pc_prompt(self):
        return "PS C:\\Users\\you" + ("\\" + self.pc_cwd if self.pc_cwd else "") + ">"

    def pc_path(self, name):
        n = name.replace("/", "\\")
        low = n.lower()
        if low.startswith("c:\\users\\you"):
            n = n[len("c:\\users\\you"):]
        elif n.startswith("~"):
            n = n[1:]
        else:
            n = self.pc_cwd + "\\" + n
        parts = []
        for part in n.split("\\"):
            if part in ("", "."):
                continue
            if part == "..":
                if parts:
                    parts.pop()
                continue
            parts.append(part)
        return "\\".join(parts)

    def pc_is_dir(self, rel):
        return rel == "" or rel in self.pc_dirs or any(k.startswith(rel + "\\") for k in self.pc_files)

    def pc_children(self, rel):
        prefix = rel + "\\" if rel else ""
        names = {}
        for k in list(self.pc_files) + list(self.pc_dirs):
            if k.startswith(prefix) and k != rel:
                rest = k[len(prefix):]
                first = rest.split("\\")[0]
                names[first] = "\\" in rest or (prefix + first) in self.pc_dirs
        return sorted(names.items(), key=lambda kv: (not kv[1], kv[0].lower()))

    def pc_full(self, rel):
        return "C:\\Users\\you" + ("\\" + rel if rel else "")

    def pc_run(self, line):
        words = [w[1:-1] if len(w) >= 2 and w[0] == w[-1] and w[0] in "\"'" else w
                 for w in re.findall(r'"[^"]*"|\'[^\']*\'|\S+', line)]
        if not words:
            return "", 0
        cmd, args = words[0], words[1:]
        low = cmd.lower()
        if low in ("ssh", "ssh.exe"):
            return self.pc_ssh(args)
        if low in ("scp", "scp.exe"):
            return self.pc_scp(args)
        if low in ("ping", "ping.exe"):
            return self.pc_ping(args)
        if low in ("ls", "dir", "gci", "get-childitem"):
            rel = self.pc_path(args[0]) if args else self.pc_cwd
            if not self.pc_is_dir(rel):
                if rel in self.pc_files:
                    return self.pc_listing(rel.rsplit("\\", 1)[0] if "\\" in rel else "", [(rel.split("\\")[-1], False)]), 0
                return (f"{cmd} : Cannot find path '{self.pc_full(rel)}' because it does not exist.\n", 1)
            return self.pc_listing(rel, self.pc_children(rel)), 0
        if low in ("cd", "chdir", "sl", "set-location"):
            if not args:
                return "", 0
            rel = self.pc_path(args[0])
            if not self.pc_is_dir(rel):
                return f"{cmd} : Cannot find path '{self.pc_full(rel)}' because it does not exist.\n", 1
            self.pc_cwd = rel
            return "", 0
        if low in ("cat", "type", "gc", "get-content"):
            if not args:
                return "cmdlet Get-Content at command pipeline position 1\n(Give the name of a file: cat notes.txt)\n", 1
            rel = self.pc_path(args[0])
            if rel not in self.pc_files:
                return f"Get-Content : Cannot find path '{self.pc_full(rel)}' because it does not exist.\n", 1
            text = self.pc_files[rel]
            return text if text.endswith("\n") or not text else text + "\n", 0
        if low in ("pwd", "gl", "get-location"):
            return f"\nPath\n----\n{self.pc_full(self.pc_cwd)}\n\n", 0
        if low in ("mkdir", "md"):
            if not args:
                return "(Give a name: mkdir pi-code)\n", 1
            rel = self.pc_path(args[0])
            self.pc_dirs.add(rel)
            return self.pc_listing(rel.rsplit("\\", 1)[0] if "\\" in rel else "", [(rel.split("\\")[-1], True)]), 0
        if low in ("cls", "clear", "clear-host"):
            self.cleared = True
            return "", 0
        if low == "exit":
            return "(This is the terminal of your PC. Close the lesson to leave it.)\n", 0
        if low in ("hostname", "whoami"):
            return ("YOUR-PC\n" if low == "hostname" else "your-pc\\you\n"), 0
        if low == "ipconfig":
            return ("\nWindows IP Configuration\n\n\nWireless LAN adapter Wi-Fi:\n\n"
                    "   IPv4 Address. . . . . . . . . . . : 192.168.1.20\n"
                    "   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n"
                    "   Default Gateway . . . . . . . . . : 192.168.1.1\n\n"), 0
        return (f"{cmd} : The term '{cmd}' is not recognized as the name of a cmdlet, function, script file, or operable program.\n"
                "(This is PowerShell on your PC. Linux commands work after you log in to the Pi with ssh.)\n", 1)

    def pc_listing(self, rel, entries):
        if not entries:
            return ""
        rows = ["", f"    Directory: {self.pc_full(rel)}", "", "",
                "Mode                 LastWriteTime         Length Name",
                "----                 -------------         ------ ----"]
        for name, is_dir in entries:
            key = (rel + "\\" if rel else "") + name
            size = "" if is_dir else str(len(self.pc_files.get(key, "").encode("utf-8")))
            rows.append(f"{'d-----' if is_dir else '-a----'}        11/21/2026   9:58 AM {size:>14} {name}")
        return "\n".join(rows) + "\n\n"

    def pc_ping(self, args):
        count = 4
        rest = []
        i = 0
        while i < len(args):
            if args[i].lower() == "-n" and i + 1 < len(args) and args[i + 1].isdigit():
                count, i = int(args[i + 1]), i + 2
                continue
            rest.append(args[i])
            i += 1
        if not rest:
            return "Usage: ping [-n count] target_name\n", 1
        host = rest[0]
        ip = self.lookup(host, pc=True)
        if ip is None:
            return f"Ping request could not find host {host}. Please check the name and try again.\n", 1
        times = [3, 2, 4, 2, 3, 2][:count] if ip.startswith("192.168.") or ip.startswith("127.") else [12, 13, 12, 14][:count]
        shown = f"{host} [{ip}]" if host != ip else ip
        lines = ["", f"Pinging {shown} with 32 bytes of data:"]
        lines += [f"Reply from {ip}: bytes=32 time={t}ms TTL={64 if ip.startswith('192.168.') else 117}" for t in times]
        lines += ["", f"Ping statistics for {ip}:", f"    Packets: Sent = {len(times)}, Received = {len(times)}, Lost = 0 (0% loss),",
                  "Approximate round trip times in milli-seconds:",
                  f"    Minimum = {min(times)}ms, Maximum = {max(times)}ms, Average = {sum(times) // len(times)}ms"]
        return "\n".join(lines) + "\n", 0

    def reach(self, host):
        """Can the PC open an SSH connection to this name? Returns an error text, or None."""
        ip = self.lookup(host, pc=True)
        if ip is None or host.lower().endswith(".local") and ip != "192.168.1.42":
            return f"ssh: Could not resolve hostname {host.lower()}: No such host is known. "
        if ip != "192.168.1.42":
            return f"ssh: connect to host {host} port 22: Connection timed out"
        if self.svc("ssh").get("state") != "active":
            return f"ssh: connect to host {host} port 22: Connection refused"
        return None

    def start_auth(self, host, user, then):
        """The host key question (the first time), then the password."""
        if host.lower() not in self.known:
            out = (f"The authenticity of host '{host} (192.168.1.42)' can't be established.\n"
                   "ED25519 key fingerprint is SHA256:Qm7c3vX2bW9nK4tYp1LrE8sFz6uJ0aHdG5oCiNxVwBk.\n")
            out += "This host key is known by the following other names/addresses:\n    ~/.ssh/known_hosts:1: " + self.known[0] + "\n" if self.known else "This key is not known by any other names.\n"
            self.ask_user("hostkey", "Are you sure you want to continue connecting (yes/no/[fingerprint])? ", host=host, user=user, then=then)
            return out, 0
        self.ask_user("password", f"{user}@{host}'s password: ", secret=True, host=host, user=user, then=then, tries=0)
        return "", 0

    def pc_ssh(self, args):
        target, rest = None, []
        i = 0
        while i < len(args):
            a = args[i]
            if target is None and a in ("-p", "-i", "-o", "-l") and i + 1 < len(args):
                i += 2
                continue
            if target is None and a.startswith("-"):
                i += 1
                continue
            if target is None:
                target = a
            else:
                rest.append(a)
            i += 1
        if not target:
            return "usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] destination [command [argument ...]]\n", 255
        user, _, host = target.rpartition("@")
        user = user or "you"
        problem = self.reach(host)
        if problem:
            return problem + "\n", 255
        then = {"op": "cmd", "line": " ".join(rest)} if rest else {"op": "login"}
        return self.start_auth(host, user, then)

    def login(self, host):
        self.at = "pi"
        self.via = True
        self.cwd = HOME
        self.vars = {}
        self.logins += 1
        if self.pw_changed:
            self.logins_after += 1
        out = (f"Linux {HOST} 6.18.0+rpt-rpi-v8 #1 SMP PREEMPT Debian 1:6.18.0-1+rpt1 (2026-09-30) aarch64\n\n"
               "The programs included with the Debian GNU/Linux system are free software;\n"
               "the exact distribution terms for each program are described in the\n"
               "individual files in /usr/share/doc/*/copyright.\n\n"
               "Debian GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent\n"
               "permitted by applicable law.\n")
        if self.logins > 1:
            out += f"Last login: Sat Nov 21 {self.clock_text(self.clock - 300)} 2026 from 192.168.1.20\n"
        return out

    @staticmethod
    def remote_part(word):
        m = re.fullmatch(r"(?:([^@\s]+)@)?([^:\\/\s]{2,}):(.*)", word)
        return (m.group(1) or "you", m.group(2), m.group(3)) if m else None

    def pc_scp(self, args):
        recursive = "-r" in args
        names = [a for a in args if not a.startswith("-")]
        if len(names) < 2:
            return "usage: scp [-346ABCOpqRrsTv] source ... target\n", 1
        *sources, dest = names
        remote_dest = self.remote_part(dest)
        remote_src = [self.remote_part(s) for s in sources]
        if not remote_dest and not any(remote_src):
            # No colon: scp copies on the PC, like cp. A common mistake.
            for s in sources:
                rel = self.pc_path(s)
                if rel not in self.pc_files:
                    return f"{s}: No such file or directory\n", 1
                target = self.pc_path(dest)
                if self.pc_is_dir(target):
                    target = (target + "\\" if target else "") + rel.split("\\")[-1]
                self.pc_files[target] = self.pc_files[rel]
            return "", 0
        user, host, _ = remote_dest or next(r for r in remote_src if r)
        problem = self.reach(host)
        if problem:
            return problem.replace("ssh:", "ssh:", 1) + "\nscp: Connection closed\n", 255
        for s, remote in zip(sources, remote_src):
            if not remote and self.pc_path(s) not in self.pc_files and not self.pc_is_dir(self.pc_path(s)):
                return f"{s}: No such file or directory\n", 1
        return self.start_auth(host, user, {"op": "scp", "sources": sources, "dest": dest, "r": recursive})

    def scp_do(self, host, then):
        out = []
        dest = then["dest"]
        remote_dest = self.remote_part(dest)
        for s in then["sources"]:
            remote_src = self.remote_part(s)
            if remote_dest and not remote_src:
                rel = self.pc_path(s)
                path = self.abs(remote_dest[2] or ".", HOME)
                items = [(rel, self.pc_files[rel])] if rel in self.pc_files else None
                if items is None:
                    if not then["r"]:
                        out.append(f"scp: {s}: not a regular file\n")
                        return "".join(out), 1
                    items = [(k, v) for k, v in self.pc_files.items() if k.startswith(rel + "\\")]
                    base = posixpath.join(path, rel.split("\\")[-1]) if path in self.dirs else path
                    if not self.may_write(base):
                        out.append(f'scp: dest open "{base}": Permission denied\nscp: failed to upload directory {s} to {remote_dest[2]}\n')
                        return "".join(out), 1
                    for k, v in items:
                        target = posixpath.join(base, *k[len(rel) + 1:].split("\\"))
                        self._mkdirs(posixpath.dirname(target))
                        self.files[target] = v
                        out.append(self.progress(k.split("\\")[-1], v))
                    continue
                target = posixpath.join(path, rel.split("\\")[-1]) if path in self.dirs else path
                if posixpath.dirname(target) not in self.dirs:
                    out.append(f'scp: dest open "{target}": No such file or directory\nscp: failed to upload file {s} to {remote_dest[2]}\n')
                    return "".join(out), 1
                if not self.may_write(target):
                    out.append(f'scp: dest open "{target}": Permission denied\nscp: failed to upload file {s} to {remote_dest[2]}\n')
                    return "".join(out), 1
                self.files[target] = items[0][1]
                out.append(self.progress(rel.split("\\")[-1], items[0][1]))
            elif remote_src and not remote_dest:
                path = self.abs(remote_src[2] or ".", HOME)
                local = self.pc_path(dest)
                if path in self.dirs:
                    if not then["r"]:
                        out.append(f"scp: download {path}: not a regular file\n")
                        return "".join(out), 1
                    name = posixpath.basename(path)
                    base = (local + "\\" if local else "") + name if self.pc_is_dir(local) else local
                    self.pc_dirs.add(base)
                    for p in sorted(self.tree_under(path)):
                        if p in self.files:
                            key = base + "\\" + "\\".join(p[len(path) + 1:].split("/"))
                            self.pc_files[key] = self.files[p]
                            out.append(self.progress(posixpath.basename(p), self.files[p]))
                    continue
                if path not in self.files:
                    out.append(f"scp: {path}: No such file or directory\n")
                    return "".join(out), 1
                key = (local + "\\" if local else "") + posixpath.basename(path) if self.pc_is_dir(local) else local
                self.pc_files[key] = self.files[path]
                out.append(self.progress(posixpath.basename(path), self.files[path]))
            else:
                out.append("(This course copies between your PC and the Pi only.)\n")
                return "".join(out), 1
        return "".join(out), 0

    @staticmethod
    def progress(name, text):
        size = len(text.encode("utf-8"))
        return f"{name:<48}100% {size:>5}    {max(size, 1) / 1024 * 8:5.1f}KB/s   00:00\n"

    # ---- links, special files and owners -------------------------------------------
    def real(self, path, depth=0):
        """The path with every symbolic link in it followed (like the kernel does)."""
        if depth > 8:
            return path
        parts = [p for p in path.split("/") if p]
        cur = ""
        for i, part in enumerate(parts):
            cur = cur + "/" + part
            if cur in self.links:
                target = self.links[cur]
                base = posixpath.dirname(cur)
                cur = posixpath.normpath(target if target.startswith("/") else posixpath.join(base, target))
                rest = "/".join(parts[i + 1:])
                return self.real(posixpath.join(cur, rest) if rest else cur, depth + 1)
        return cur or "/"

    def is_file(self, path):
        p = self.real(path)
        return p in self.files or self.virtual(p) is not None

    def is_dir(self, path):
        return self.real(path) in self.dirs

    _DEV = {
        "console": ("c", "600", "root", "tty", "5, 1"), "gpiochip0": ("c", "660", "root", "gpio", "254, 0"),
        "gpiomem": ("c", "660", "root", "gpio", "236, 0"), "mmcblk0": ("b", "660", "root", "disk", "179, 0"),
        "mmcblk0p1": ("b", "660", "root", "disk", "179, 1"), "mmcblk0p2": ("b", "660", "root", "disk", "179, 2"),
        "null": ("c", "666", "root", "root", "1, 3"), "random": ("c", "666", "root", "root", "1, 8"),
        "tty": ("c", "666", "root", "tty", "5, 0"), "ttyAMA0": ("c", "660", "root", "dialout", "204, 64"),
        "urandom": ("c", "666", "root", "root", "1, 9"), "zero": ("c", "666", "root", "root", "1, 5"),
    }

    def virtual(self, path):
        """The text of a file that the system makes when you read it (/proc, /dev, users), or None."""
        if path.startswith("/dev/") and path[5:] in self._DEV:
            return ""
        if path == "/proc/cpuinfo":
            core = ("processor\t: {n}\nBogoMIPS\t: 108.00\nFeatures\t: fp asimd evtstrm crc32 cpuid\nCPU implementer\t: 0x41\n"
                    "CPU architecture: 8\nCPU variant\t: 0x0\nCPU part\t: 0xd08\nCPU revision\t: 3\n\n")
            return "".join(core.format(n=n) for n in range(4)) + "Revision\t: c03115\nSerial\t\t: 100000001a2b3c4d\nModel\t\t: Raspberry Pi 4 Model B Rev 1.5\n"
        if path == "/proc/meminfo":
            used = self.mem_used()
            return (f"MemTotal:        {int(_MEM_MB * 1024)} kB\nMemFree:         {int((_MEM_MB - used - 431.5) * 1024)} kB\n"
                    f"MemAvailable:    {int((_MEM_MB - used) * 1024)} kB\nBuffers:           38912 kB\nCached:           402944 kB\n")
        if path == "/proc/uptime":
            up = _BOOT_SECONDS + self.clock if self.boots == 1 else self.clock - self.boot_at + 30
            return f"{up}.57 {up * 3.9:.2f}\n"
        if path == "/proc/version":
            return "Linux version 6.18.0+rpt-rpi-v8 (serge@raspberrypi.com) (gcc (Debian 14.2.0) 14.2.0) #1 SMP PREEMPT Debian 1:6.18.0-1+rpt1 (2026-09-30)\n"
        if path == "/etc/passwd":
            base = ["root:x:0:0:root:/root:/bin/bash", "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin",
                    "bin:x:2:2:bin:/bin:/usr/sbin/nologin", "sys:x:3:3:sys:/dev:/usr/sbin/nologin",
                    "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin", "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin",
                    "systemd-network:x:998:998:systemd Network Management:/:/usr/sbin/nologin", "sshd:x:100:65534::/run/sshd:/usr/sbin/nologin"]
            return "\n".join(base + [f"{u['name']}:x:{u['uid']}:{u['uid']}:{u.get('full', '')},,,:/home/{u['name']}:{u.get('shell', '/bin/bash')}" for u in self.users]) + "\n"
        if path == "/etc/group":
            lines = ["root:x:0:"]
            for g, gid in _GROUPS:
                members = [u["name"] for u in self.users if g in u["groups"]]
                lines.append(f"{g}:x:{gid}:{','.join(members)}")
            for u in self.users:
                lines.append(f"{u['name']}:x:{u['uid']}:")
            return "\n".join(lines) + "\n"
        return None

    def owner_of(self, path):
        if path in self.owners:
            user, _, group = self.owners[path].partition(":")
            return user, group or user
        if path == HOME or path.startswith(HOME + "/") or path.startswith("/tmp/"):
            return USER, USER
        for u in self.users:
            home = f"/home/{u['name']}"
            if path == home or path.startswith(home + "/"):
                return u["name"], u["name"]
        return "root", "root"

    def c_ln(self, args, stdin, piped):
        flags, names = self.flags(args, "sfn", "ln")
        if "s" not in flags:
            raise _Exit("ln: this course makes symbolic links only: ln -s TARGET NAME (a hard link shares the same data)")
        if len(names) < 2:
            raise _Exit(f"ln: missing destination file operand after '{names[0]}'" if names else "ln: missing file operand")
        target, name = names[0], names[1]
        path = self.abs(name)
        if self.is_dir(path) and path not in self.links:
            path = posixpath.join(path, posixpath.basename(target.rstrip("/")))
        if (path in self.links or path in self.files or path in self.dirs) and "f" not in flags:
            raise _Exit(f"ln: failed to create symbolic link '{name}': File exists")
        if posixpath.dirname(path) not in self.dirs:
            raise _Exit(f"ln: failed to create symbolic link '{name}': No such file or directory")
        if not self.may_write(path):
            raise _Exit(f"ln: failed to create symbolic link '{name}': Permission denied")
        self.files.pop(path, None)
        self.links[path] = target
        return ""

    def c_readlink(self, args, stdin, piped):
        flags, names = self.flags(args, "f", "readlink")
        out = []
        for n in names:
            path = self.abs(n)
            if "f" in flags:
                out.append(self.real(path))
            elif path in self.links:
                out.append(self.links[path])
            else:
                return 1
        return "".join(o + "\n" for o in out)

    def c_file(self, args, stdin, piped):
        if not args:
            raise _Exit("Usage: file [-bcEhikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding]\n            [--mime-type] [-e <testname>] [-F <separator>]  [-f <namefile>]\n            [-m <magicfiles>] [-P <parameter=value>] [--exclude-quiet]\n            <file> ...", 1)
        out = []
        for n in args:
            path = self.abs(n)
            if path in self.links:
                out.append(f"{n}: symbolic link to {self.links[path]}")
                continue
            if path in self.dirs:
                out.append(f"{n}: directory")
                continue
            if path.startswith("/dev/") and path[5:] in self._DEV:
                kind, _, _, _, nums = self._DEV[path[5:]]
                out.append(f"{n}: {'character' if kind == 'c' else 'block'} special ({nums.replace(', ', '/')})")
                continue
            text = self.files.get(path) if path in self.files else self.virtual(path)
            if text is None:
                out.append(f"{n}: cannot open `{n}' (No such file or directory)")
                continue
            arc = self.archive(text)
            if arc:
                kinds = {"tar": "POSIX tar archive (GNU)", "tar.gz": "gzip compressed data, from Unix",
                         "gzip": f"gzip compressed data, was \"{arc.get('name', '')}\", from Unix",
                         "zip": "Zip archive data, at least v2.0 to extract, compression method=deflate"}
                out.append(f"{n}: " + kinds[arc["kind"]])
            elif text == "":
                out.append(f"{n}: empty")
            elif text.startswith("#!/bin/bash") or text.startswith("#!/bin/sh"):
                out.append(f"{n}: Bourne-Again shell script, ASCII text executable")
            elif text.startswith("#!") and "python" in text.split("\n", 1)[0]:
                out.append(f"{n}: Python script, ASCII text executable")
            elif n.endswith(".py"):
                out.append(f"{n}: Python script, ASCII text")
            else:
                out.append(f"{n}: {'UTF-8 Unicode' if any(ord(c) > 127 for c in text) else 'ASCII'} text")
        return "\n".join(out) + "\n"

    # ---- archives --------------------------------------------------------------------
    @staticmethod
    def archive(text):
        """The content of an archive file, or None for a normal file."""
        if not text.startswith("ZPARCHIVE "):
            return None
        head, _, body = text.partition("\n")
        _, kind, size = head.split(" ")
        try:
            data = json.loads(body)
        except ValueError:
            return None
        data.update(kind=kind, size=int(size))
        return data

    @staticmethod
    def make_archive(kind, data, size):
        return f"ZPARCHIVE {kind} {int(size)}\n" + json.dumps(data, sort_keys=True)

    def members_of(self, names, cmd):
        """The files and folders under the given names, as {path in the archive: text or None (a folder)}."""
        members, errors = {}, []
        for n in names:
            path = self.abs(n)
            rel = n.rstrip("/") if not n.startswith("/") else n.lstrip("/").rstrip("/")
            if n.startswith("/") and cmd == "tar":
                errors.append("tar: Removing leading `/' from member names")
            if path in self.dirs:
                members[rel + "/"] = None
                for p in sorted(self.tree_under(path)):
                    if p == path:
                        continue
                    sub = rel + "/" + p[len(path) + 1:]
                    members[sub + ("/" if p in self.dirs else "")] = None if p in self.dirs else self.files[p]
            elif self.is_file(path):
                members[rel] = self.files.get(self.real(path), "")
            else:
                errors.append(f"tar: {n}: Cannot stat: No such file or directory" if cmd == "tar" else f"\tzip warning: name not matched: {n}")
        return members, errors

    def unpack(self, members, into):
        for rel, text in members.items():
            target = posixpath.normpath(posixpath.join(into, rel))
            if text is None:
                self._mkdirs(target)
            else:
                self._mkdirs(posixpath.dirname(target))
                self.files[target] = text

    def c_tar(self, args, stdin, piped):
        if not args:
            raise _Exit("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.", 2)
        flags, rest = set(), []
        name = None
        into = None
        i = 0
        first = True
        while i < len(args):
            a = args[i]
            if a == "-C" and i + 1 < len(args):
                into, i = args[i + 1], i + 2
                continue
            if (a.startswith("-") and len(a) > 1) or (first and re.fullmatch(r"[cxtvzfj]+", a)):
                letters = a.lstrip("-")
                for k, ch in enumerate(letters):
                    if ch == "f":
                        if k + 1 < len(letters):
                            name = letters[k + 1:]
                        elif i + 1 < len(args):
                            name, i = args[i + 1], i + 1
                        break
                    if ch not in "cxtvzj":
                        raise _Exit(f"tar: invalid option -- '{ch}'\nTry 'tar --help' or 'tar --usage' for more information.", 2)
                    flags.add(ch)
            else:
                rest.append(a)
            first = False
            i += 1
        modes = flags & {"c", "x", "t"}
        if len(modes) != 1:
            raise _Exit("tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information.", 2)
        if name is None:
            raise _Exit("tar: Refusing to read archive contents from terminal (missing -f option?)\ntar: Error is not recoverable: exiting now", 2)
        verbose = "v" in flags
        if "c" in flags:
            if not rest:
                raise _Exit("tar: Cowardly refusing to create an empty archive\nTry 'tar --help' or 'tar --usage' for more information.", 2)
            archive_path = self.abs(name)
            saved_cwd = self.cwd
            if into:
                # -C: take the names from that folder (the archive name stays where it was).
                if self.abs(into) not in self.dirs:
                    raise _Exit(f"tar: {into}: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now", 2)
                self.cwd = self.abs(into)
            try:
                members, errors = self.members_of(rest, "tar")
            finally:
                self.cwd = saved_cwd
            name = archive_path
            raw = sum(len((t or "").encode("utf-8")) + 512 for t in members.values()) + 1024
            size = max(10240, -(-raw // 10240) * 10240)
            kind = "tar.gz" if "z" in flags else "tar"
            if kind == "tar.gz":
                size = 45 + sum(len((t or "").encode("utf-8")) for t in members.values()) * 0.35 + 30 * len(members)
            self.write(name, self.make_archive(kind, {"members": members}, size))
            if verbose:
                self.out.append("".join(m + "\n" for m in members))
            for e in errors:
                self.error(e)
            if any("Cannot stat" in e for e in errors):
                self.error("tar: Exiting with failure status due to previous errors")
                return 2
            return 0
        text = self.read(name, "tar")
        arc = self.archive(text)
        if not arc or arc["kind"] not in ("tar", "tar.gz"):
            if "z" in flags and arc is None:
                raise _Exit("gzip: stdin: not in gzip format\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now", 2)
            raise _Exit("tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors", 2)
        members = arc["members"]
        if "t" in flags:
            if verbose:
                lines = []
                for m, t in members.items():
                    size = 0 if t is None else len(t.encode("utf-8"))
                    lines.append(f"{'d' if t is None else '-'}rw{'x' if t is None else '-'}r-{'x' if t is None else '-'}r-{'x' if t is None else '-'} {USER}/{USER} {size:>8} 2026-11-21 10:00 {m}")
                return "\n".join(lines) + "\n"
            return "".join(m + "\n" for m in members)
        target = self.abs(into) if into else self.cwd
        if target not in self.dirs:
            raise _Exit(f"tar: {into}: Cannot open: No such file or directory\ntar: Error is not recoverable: exiting now", 2)
        if not self.may_write(posixpath.join(target, "x")):
            raise _Exit(f"tar: {next(iter(members))}: Cannot open: Permission denied\ntar: Exiting with failure status due to previous errors", 2)
        self.unpack(members, target)
        return "".join(m + "\n" for m in members) if verbose else ""

    def c_gzip(self, args, stdin, piped, decompress=False):
        flags, names = self.flags(args, "kdlvf", "gzip")
        decompress = decompress or "d" in flags
        if not names:
            raise _Exit("gzip: compressed data not written to a terminal. Use -f to force compression.\nFor help, type: gzip -h", 1)
        out = []
        for n in names:
            path = self.abs(n)
            if path in self.dirs:
                self.error(f"gzip: {n} is a directory -- ignored")
                continue
            if path not in self.files:
                self.error(f"gzip: {n}: No such file or directory")
                continue
            if decompress:
                arc = self.archive(self.files[path])
                if not n.endswith(".gz"):
                    self.error(f"gzip: {n}: unknown suffix -- ignored")
                    continue
                if not arc or arc["kind"] not in ("gzip", "tar.gz"):
                    self.error(f"gzip: {n}: not in gzip format")
                    continue
                new = path[:-3]
                if arc["kind"] == "gzip":
                    self.write(new, arc["text"])
                else:
                    raw = sum(len((t or "").encode("utf-8")) + 512 for t in arc["members"].values()) + 1024
                    self.write(new, self.make_archive("tar", {"members": arc["members"]}, max(10240, -(-raw // 10240) * 10240)))
            else:
                if n.endswith(".gz"):
                    self.error(f"gzip: {n} already has .gz suffix -- unchanged")
                    continue
                text = self.files[path]
                arc = self.archive(text)
                if arc and arc["kind"] == "tar":
                    blob = self.make_archive("tar.gz", {"members": arc["members"]}, 45 + sum(len((t or "").encode()) for t in arc["members"].values()) * 0.35 + 30 * len(arc["members"]))
                else:
                    blob = self.make_archive("gzip", {"name": posixpath.basename(path), "text": text}, 30 + len(text.encode("utf-8")) * 0.4)
                new = path + ".gz"
                self.write(new, blob)
                if "v" in flags:
                    out.append(f"{n}:\t {60 if text else 0}.0% -- replaced with {n}.gz")
            if "k" not in flags:
                self.remove(path)
        if out:
            self.out.append("\n".join(out) + "\n")
        return 0

    def c_gunzip(self, args, stdin, piped):
        return self.c_gzip(args, stdin, piped, decompress=True)

    def c_zip(self, args, stdin, piped):
        flags, names = self.flags(args, "rq", "zip")
        if not names:
            raise _Exit("zip error: Nothing to do! (try: zip -r name.zip folder)", 12)
        name, paths = names[0], names[1:]
        if not name.endswith(".zip"):
            name += ".zip"
        out, members = [], {}
        for p in paths:
            path = self.abs(p)
            if path in self.dirs and "r" not in flags:
                members[p.rstrip("/") + "/"] = None
                out.append(f"  adding: {p.rstrip('/')}/ (stored 0%)")
                continue
            found, errors = self.members_of([p], "zip")
            for e in errors:
                self.out.append(e + "\n")
            for m, t in found.items():
                members[m] = t
                out.append(f"  adding: {m} ({'stored 0%' if t is None or len(t) < 40 else 'deflated 41%'})")
        if not members:
            raise _Exit("\nzip error: Nothing to do! (" + name + ")", 12)
        size = 22 + sum(80 + len((t or "").encode("utf-8")) * 0.6 for t in members.values())
        self.write(name, self.make_archive("zip", {"members": members}, size))
        return "" if "q" in flags else "\n".join(out) + "\n"

    def c_unzip(self, args, stdin, piped):
        flags, names = self.flags(args, "lod", "unzip")
        into = None
        if "-d" in args:
            k = args.index("-d")
            into = args[k + 1] if k + 1 < len(args) else None
            names = [n for n in names if n != into]
        if not names:
            raise _Exit("UnZip 6.00 of 20 April 2009, by Debian. Usage: unzip [-Z] [-opts[modifiers]] file[.zip] [list] [-x xlist] [-d exdir]", 0)
        name = names[0]
        path = self.abs(name)
        if path not in self.files and path + ".zip" in self.files:
            path, name = path + ".zip", name + ".zip"
        if path not in self.files:
            raise _Exit(f"unzip:  cannot find or open {name}, {name}.zip or {name}.ZIP.", 9)
        arc = self.archive(self.files[path])
        if not arc or arc["kind"] != "zip":
            raise _Exit(f"Archive:  {name}\n  End-of-central-directory signature not found.  Either this file is not\n  a zipfile, or it constitutes one disk of a multi-part archive.", 9)
        members = arc["members"]
        if "l" in flags:
            rows = [f"Archive:  {name}", "  Length      Date    Time    Name", "---------  ---------- -----   ----"]
            total = 0
            for m, t in members.items():
                size = 0 if t is None else len(t.encode("utf-8"))
                total += size
                rows.append(f"{size:>9}  2026-11-21 10:00   {m}")
            rows += ["---------                     -------", f"{total:>9}                     {len(members)} file{'s' if len(members) != 1 else ''}"]
            return "\n".join(rows) + "\n"
        target = self.abs(into) if into else self.cwd
        self._mkdirs(target) if into else None
        if not self.may_write(posixpath.join(target, "x")):
            raise _Exit(f"checkdir error:  cannot create {name}\n                 Permission denied", 50)
        clash = [m for m, t in members.items() if t is not None and posixpath.join(target, m) in self.files]
        if clash and "o" not in flags:
            if self.frames:
                raise _Exit(f"replace {clash[0]}? (a script cannot answer: use unzip -o to replace)", 1)
            self.out.append(f"Archive:  {name}\n")
            self.ask_user("unzip", f"replace {clash[0]}? [y]es, [n]o, [A]ll, [N]one, [r]ename: ", members=members, target=target, clash=clash)
            return 0
        self.unpack(members, target)
        lines = [f"Archive:  {name}"] + [f"   creating: {m}" if t is None else f"  inflating: {m}" for m, t in members.items()]
        return "\n".join(lines) + "\n"

    def c_du(self, args, stdin, piped):
        flags, names = self.flags(args, "shc", "du")
        names = names or ["."]
        out = []
        for n in names:
            path = self.abs(n)
            if not self.exists(path):
                self.error(f"du: cannot access '{n}': No such file or directory")
                continue
            total = 0
            for p in self.tree_under(path) if path in self.dirs else [path]:
                text = self.files.get(p)
                if text is not None:
                    arc = self.archive(text)
                    total += arc["size"] if arc else len(text.encode("utf-8"))
            kb = max(4, -(-total // 4096) * 4)
            out.append(f"{(str(kb) + 'K') if 'h' in flags else kb}\t{n}")
        return "\n".join(out) + "\n" if out else 1

    # ---- text tools: cut and less ------------------------------------------------------
    def c_cut(self, args, stdin, piped):
        delim, fields, chars, files = "\t", None, None, []
        i = 0
        while i < len(args):
            a = args[i]
            if a.startswith("-d"):
                if len(a) > 2:
                    delim = a[2:]
                elif i + 1 < len(args):
                    delim, i = args[i + 1], i + 1
            elif a.startswith("-f"):
                fields = a[2:] or (args[i + 1] if i + 1 < len(args) else "")
                if len(a) == 2:
                    i += 1
            elif a.startswith("-c"):
                chars = a[2:] or (args[i + 1] if i + 1 < len(args) else "")
                if len(a) == 2:
                    i += 1
            else:
                files.append(a)
            i += 1
        if fields is None and chars is None:
            raise _Exit("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.")
        if len(delim) != 1:
            raise _Exit("cut: the delimiter must be a single character\nTry 'cut --help' for more information.")

        def picks(spec, n):
            got = []
            for part in spec.split(","):
                a, dash, b = part.partition("-")
                if not (a or b) or not (a.isdigit() or not a) or not (b.isdigit() or not b):
                    raise _Exit(f"cut: invalid field value '{part}'\nTry 'cut --help' for more information.")
                lo = int(a) if a else 1
                hi = int(b) if b else (n if dash else lo)
                got.extend(range(lo, hi + 1))
            return [k for k in sorted(set(got)) if 1 <= k <= n]

        out = []
        for line in self._text_of(files, stdin, "cut").splitlines():
            if chars is not None:
                out.append("".join(line[k - 1] for k in picks(chars, len(line))))
            elif delim not in line:
                out.append(line)
            else:
                parts = line.split(delim)
                out.append(delim.join(parts[k - 1] for k in picks(fields, len(parts))))
        return "".join(l + "\n" for l in out)

    def c_less(self, args, stdin, piped):
        text = self._text_of([a for a in args if not a.startswith("-")], stdin, "less")
        if piped:
            return text
        return text + "(less shows one screen at a time: Space for more, b back, /word to search, q to quit. Here it shows all.)\n"

    c_more = c_less

    # ---- the network ---------------------------------------------------------------------
    def hosts_entry(self, name):
        for line in (self.files.get("/etc/hosts") or "").splitlines():
            parts = line.split("#", 1)[0].split()
            if len(parts) >= 2 and name.lower() in (p.lower() for p in parts[1:]):
                return parts[0]
        return None

    def c_ip(self, args, stdin, piped):
        what = args[0] if args else ""
        if what in ("a", "addr", "address"):
            show = args[1:]
            blocks = [
                "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n"
                "    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n"
                "    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n"
                "    inet6 ::1/128 scope host noprefixroute \n       valid_lft forever preferred_lft forever",
                "2: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc mq state DOWN group default qlen 1000\n"
                "    link/ether dc:a6:32:4d:21:b6 brd ff:ff:ff:ff:ff:ff",
                "3: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc pfifo_fast state UP group default qlen 1000\n"
                "    link/ether dc:a6:32:4d:21:b7 brd ff:ff:ff:ff:ff:ff\n"
                "    inet 192.168.1.42/24 brd 192.168.1.255 scope global dynamic noprefixroute wlan0\n"
                "       valid_lft 86163sec preferred_lft 86163sec\n"
                "    inet6 fe80::8c2b:61ff:fe4d:21b7/64 scope link noprefixroute \n       valid_lft forever preferred_lft forever",
            ]
            if show[:1] == ["show"] and len(show) > 1:
                blocks = [b for b in blocks if b.split(":")[1].strip() == show[1]]
                if not blocks:
                    raise _Exit(f'Device "{show[1]}" does not exist.', 1)
            return "\n".join(blocks) + "\n"
        if what in ("r", "route"):
            return ("default via 192.168.1.1 dev wlan0 proto dhcp src 192.168.1.42 metric 600 \n"
                    "192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.42 metric 600 \n")
        if what in ("l", "link"):
            return ("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n"
                    "    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n"
                    "2: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc mq state DOWN mode DEFAULT group default qlen 1000\n"
                    "    link/ether dc:a6:32:4d:21:b6 brd ff:ff:ff:ff:ff:ff\n"
                    "3: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc pfifo_fast state UP mode DORMANT group default qlen 1000\n"
                    "    link/ether dc:a6:32:4d:21:b7 brd ff:ff:ff:ff:ff:ff\n")
        raise _Exit("Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\n(This course knows: ip addr, ip route, ip link.)", 1)

    def c_ss(self, args, stdin, piped):
        rows = ["State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process"]
        listening = self.svc("ssh").get("state") == "active"
        if listening:
            proc = '    users:(("sshd",pid=%d,fd=6))' % self.svc("ssh").get("pid", 0) if "p" in "".join(args) and self.root else ""
            rows.append(f"LISTEN 0      128          0.0.0.0:22         0.0.0.0:*{proc}")
            rows.append(f"LISTEN 0      128             [::]:22            [::]:*{proc}")
        return "\n".join(rows) + "\n"

    def c_getent(self, args, stdin, piped):
        if len(args) < 2:
            raise _Exit("getent: wrong number of arguments\nTry `getent --help' or `getent --usage' for more information.", 1)
        db, key = args[0], args[1]
        if db == "hosts":
            ip = self.lookup(key)
            if ip is None:
                return 2
            return f"{ip:<15} {key}\n"
        if db in ("passwd", "group"):
            for line in self.virtual(f"/etc/{db}").splitlines():
                if line.split(":")[0] == key:
                    return line + "\n"
            return 2
        raise _Exit(f"Unknown database: {db}\nTry `getent --help' or `getent --usage' for more information.", 1)

    # ---- users and groups ----------------------------------------------------------------
    def user(self, name):
        return next((u for u in self.users if u["name"] == name), None)

    def c_id(self, args, stdin, piped):
        name = args[0] if args else ("root" if self.root else USER)
        if name == "root":
            return "uid=0(root) gid=0(root) groups=0(root)\n"
        u = self.user(name)
        if u is None:
            raise _Exit(f"id: '{name}': no such user", 1)
        gids = dict(_GROUPS)
        groups = [f"{u['uid']}({u['name']})"] + [f"{gids[g]}({g})" for g, _ in _GROUPS if g in u["groups"]]
        return f"uid={u['uid']}({u['name']}) gid={u['uid']}({u['name']}) groups={','.join(groups)}\n"

    def c_groups(self, args, stdin, piped):
        names = args or [USER]
        out = []
        for name in names:
            u = self.user(name)
            if u is None:
                raise _Exit(f"groups: '{name}': no such user", 1)
            groups = " ".join([u["name"]] + [g for g, _ in _GROUPS if g in u["groups"]])
            out.append(f"{name} : {groups}" if args else groups)
        return "\n".join(out) + "\n"

    def c_who(self, args, stdin, piped):
        source = " (192.168.1.20)" if self.via else ""
        return f"{USER:<8} {'pts/0' if self.via else 'tty1':<12} 2026-11-21 07:47{source}\n"

    def c_users(self, args, stdin, piped):
        return USER + "\n"

    def new_user(self, name, groups, shell="/bin/bash", home=True):
        uid = max([u["uid"] for u in self.users] + [1000]) + 1
        u = {"name": name, "uid": uid, "groups": list(groups), "shell": shell, "password": None}
        self.users.append(u)
        if home:
            self._mkdirs(f"/home/{name}")
            self.modes[f"/home/{name}"] = "700"
        return u

    def c_adduser(self, args, stdin, piped):
        if not self.root:
            raise _Exit("fatal: Only root may add a user or group to the system.", 1)
        names = [a for a in args if not a.startswith("-")]
        if len(names) == 2:
            # adduser USER GROUP: add an existing user to a group.
            u = self.user(names[0])
            if u is None:
                raise _Exit(f"fatal: The user `{names[0]}' does not exist.", 1)
            if names[1] not in dict(_GROUPS):
                raise _Exit(f"fatal: The group `{names[1]}' does not exist.", 1)
            if names[1] not in u["groups"]:
                u["groups"].append(names[1])
            return f"info: Adding user `{names[0]}' to group `{names[1]}' ...\n"
        if len(names) != 1:
            raise _Exit("fatal: Only one or two names allowed.", 1)
        name = names[0]
        if not re.fullmatch(r"[a-z][-a-z0-9_]*", name):
            raise _Exit(f"fatal: Please enter a username matching the regular expression\nconfigured via the NAME_REGEX configuration variable.  Use the `--allow-bad-names' option to\nrelax this check or reconfigure NAME_REGEX.", 1)
        if self.user(name):
            raise _Exit(f"fatal: The user `{name}' already exists.", 1)
        if self.frames or piped:
            raise _Exit("adduser: this terminal can answer the questions of adduser only at the prompt.", 1)
        u = self.new_user(name, ["users"])
        uid = u["uid"]
        self.out.append(
            f"info: Adding user `{name}' ...\ninfo: Selecting UID/GID from range 1000 to 59999 ...\n"
            f"info: Adding new group `{name}' ({uid}) ...\ninfo: Adding new user `{name}' ({uid}) with group `{name} ({uid})' ...\n"
            f"info: Creating home directory `/home/{name}' ...\ninfo: Copying files from `/etc/skel' ...\n")
        self.ask_user("adduser", "New password: ", secret=True, step="password", name=name)
        return 0

    def c_useradd(self, args, stdin, piped):
        if not self.root:
            raise _Exit("useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later.", 1)
        groups, shell, home, name = [], "/bin/sh", False, None
        i = 0
        while i < len(args):
            a = args[i]
            if a in ("-G", "--groups") and i + 1 < len(args):
                groups, i = args[i + 1].split(","), i + 2
                continue
            if a in ("-s", "--shell") and i + 1 < len(args):
                shell, i = args[i + 1], i + 2
                continue
            if a in ("-m", "--create-home"):
                home = True
            elif not a.startswith("-"):
                name = a
            i += 1
        if not name:
            raise _Exit("Usage: useradd [options] LOGIN", 2)
        if self.user(name):
            raise _Exit(f"useradd: user '{name}' already exists", 9)
        for g in groups:
            if g not in dict(_GROUPS):
                raise _Exit(f"useradd: group '{g}' does not exist", 6)
        self.new_user(name, groups, shell, home)
        return ""

    def c_usermod(self, args, stdin, piped):
        if not self.root:
            raise _Exit("usermod: Permission denied.\nusermod: cannot lock /etc/passwd; try again later.", 1)
        append, groups, name = False, None, None
        i = 0
        while i < len(args):
            a = args[i]
            if a in ("-aG", "-Ga"):
                append, groups, i = True, args[i + 1].split(",") if i + 1 < len(args) else [], i + 2
                continue
            if a == "-a":
                append = True
            elif a == "-G" and i + 1 < len(args):
                groups, i = args[i + 1].split(","), i + 2
                continue
            elif not a.startswith("-"):
                name = a
            i += 1
        if name is None or groups is None:
            raise _Exit("Usage: usermod [options] LOGIN\n(This course knows: usermod -aG GROUP USER.)", 2)
        u = self.user(name)
        if u is None:
            raise _Exit(f"usermod: user '{name}' does not exist", 6)
        for g in groups:
            if g not in dict(_GROUPS):
                raise _Exit(f"usermod: group '{g}' does not exist", 6)
        # Without -a, -G replaces every extra group: a common mistake.
        u["groups"] = (u["groups"] + [g for g in groups if g not in u["groups"]]) if append else list(groups)
        return ""

    def c_deluser(self, args, stdin, piped):
        if not self.root:
            raise _Exit("fatal: Only root may remove a user or group from the system.", 1)
        names = [a for a in args if not a.startswith("-")]
        if not names:
            raise _Exit("fatal: Specify a user to remove.", 1)
        name = names[0]
        if name == USER:
            raise _Exit(f"(This course does not remove {USER}: you are logged in as {USER}.)", 1)
        u = self.user(name)
        if u is None:
            raise _Exit(f"fatal: The user `{name}' does not exist.", 2)
        self.users.remove(u)
        if "--remove-home" in args:
            self.remove(f"/home/{name}")
        return f"info: Removing crontab ...\ninfo: Removing user `{name}' ...\ninfo: Done.\n"

    def c_userdel(self, args, stdin, piped):
        if not self.root:
            raise _Exit("userdel: Permission denied.\nuserdel: cannot lock /etc/passwd; try again later.", 1)
        names = [a for a in args if not a.startswith("-")]
        if not names or self.user(names[0]) is None:
            raise _Exit(f"userdel: user '{names[0] if names else ''}' does not exist", 6)
        if names[0] == USER:
            raise _Exit(f"(This course does not remove {USER}: you are logged in as {USER}.)", 1)
        self.users.remove(self.user(names[0]))
        if "-r" in args:
            self.remove(f"/home/{names[0]}")
        return ""

    def c_chown(self, args, stdin, piped, cmd="chown"):
        flags, names = self.flags(args, "R", cmd)
        if len(names) < 2:
            raise _Exit(f"{cmd}: missing operand")
        spec, paths = names[0], names[1:]
        user, _, group = spec.partition(":")
        if cmd == "chgrp":
            user, group = "", spec
        known = {u["name"] for u in self.users} | {"root"}
        if user and user not in known:
            raise _Exit(f"{cmd}: invalid user: '{spec}'")
        if group and group not in known | {g for g, _ in _GROUPS}:
            raise _Exit(f"{cmd}: invalid group: '{spec}'")
        for n in paths:
            path = self.abs(n)
            if not self.exists(path):
                raise _Exit(f"{cmd}: cannot access '{n}': No such file or directory")
            if not self.root:
                raise _Exit(f"{cmd}: changing ownership of '{n}': Operation not permitted")
            for p in (self.tree_under(path) if "R" in flags else [path]):
                old_user, old_group = self.owner_of(p)
                self.owners[p] = f"{user or old_user}:{group or old_group}"
        return ""

    def c_chgrp(self, args, stdin, piped):
        return self.c_chown(args, stdin, piped, cmd="chgrp")

    # ---- state ---------------------------------------------------------------
    def state(self):
        extra_dirs = sorted(d for d in self.dirs if d not in _BASE_DIRS)
        return {
            "files": dict(sorted(self.files.items())),
            "dirs": extra_dirs,
            "modes": dict(sorted(self.modes.items())),
            "cwd": self.cwd,
            "history": self.history[-200:],
            "packages": self.packages,
            "vars": dict(self.vars),
            "exported": sorted(self.exported),
            "last": self.last,
            "clock": self.clock,
            "boots": self.boots,
            "nextPid": self.next_pid,
            "bootAt": self.boot_at,
            "procs": self.procs,
            "services": self.services,
            "journal": self.journal,
            "power": self.power,
            "temp": self.temp,
            "password": self.password,
            "pwChanged": self.pw_changed,
            "updates": self.updates,
            "at": self.at,
            "via": self.via,
            "pc": {"files": dict(sorted(self.pc_files.items())), "dirs": sorted(self.pc_dirs), "cwd": self.pc_cwd,
                   "history": self.pc_history[-200:], "known": self.known},
            "logins": self.logins,
            "loginsAfter": self.logins_after,
            "links": dict(sorted(self.links.items())),
            "owners": dict(sorted(self.owners.items())),
            "users": self.users,
            "pending": self.pending,
        }

    def check_env(self, last_out):
        def resolve(p):
            return self.abs(p, HOME)

        def ran(name):
            for line in self.history:
                if name in self.starts(line):
                    return True
            return False

        def run_copy(line):
            """Runs a line in a copy of this computer: (output, exit code). Nothing here changes."""
            copy = Shell(self.state())
            return copy.run_top(line)

        def service(name):
            name = self.service_name(name)
            known = name in _UNITS or name in self.services or f"/etc/systemd/system/{name}.service" in self.files
            s = self.services.get(name) or ({} if not known else self.svc(name))
            return {"state": s.get("state", "inactive"), "active": s.get("state") == "active",
                    "enabled": bool(s.get("enabled")), "failed": s.get("state") == "failed", "known": known}

        def journal(unit=None):
            if unit and not unit.endswith(".service"):
                unit += ".service"
            return [text for t, ident, u, text, p in self.journal if ident != "--boot--" and (unit is None or u == unit)]

        return {
            "exists": lambda p: self.exists(resolve(p)),
            "isdir": lambda p: resolve(p) in self.dirs,
            "isfile": lambda p: resolve(p) in self.files,
            "read": lambda p: self.files.get(resolve(p)),
            "lines": lambda p: (self.files.get(resolve(p)) or "").splitlines(),
            "mode": lambda p: self.mode(resolve(p)),
            "executable": lambda p: bool(int(self.mode(resolve(p))[0]) & 1),
            "listdir": lambda p=".": [n for n in self.children(resolve(p))],
            "cwd": self.show(self.cwd),
            "history": list(self.history),
            "ran": ran,
            "out": last_out,
            "code": self.last,
            "packages": list(self.packages),
            "files": {self.show(p): t for p, t in self.files.items() if p.startswith(HOME + "/")},
            "vars": dict(self.vars),
            "run": run_copy,
            "service": service,
            "journal": journal,
            "procs": [r[4] for r in self.all_procs()],
            "boots": self.boots,
            "at": self.at,
            "via": self.via,
            "logins": self.logins,
            "logins_after_change": self.logins_after,
            "password_changed": self.pw_changed,
            "known_hosts": list(self.known),
            "pc_files": {k.replace("\\", "/"): v for k, v in self.pc_files.items()},
            "pc_history": list(self.pc_history),
            "pc_ran": lambda name: any(h.split()[:1] and h.split()[0].lower() == name.lower() for h in self.pc_history),
            "updated": bool(self.updates.get("done")),
            "link": lambda p: self.links.get(resolve(p)),
            "members": lambda p: sorted((self.archive(self.files.get(self.real(resolve(p)), "")) or {}).get("members", {}) or []) or None,
            "archive_kind": lambda p: (self.archive(self.files.get(self.real(resolve(p)), "")) or {}).get("kind"),
            "owner": lambda p: ":".join(self.owner_of(resolve(p))),
            "users": [u["name"] for u in self.users],
            "groups_of": lambda n: (self.user(n) or {}).get("groups"),
            "has_password": lambda n: bool((self.user(n) or {}).get("password")),
            "hosts": lambda n: self.hosts_entry(n),
            "lists_updated": bool(self.updates.get("listed")),
        }

    def starts(self, line):
        """The command names of a line: the first word, and the first word after | ; && || and keywords."""
        try:
            toks = tokenize(line)
        except _Exit:
            return []
        names = []
        start = True
        for tok in toks:
            if isinstance(tok, Op):
                start = tok.op in ("|", ";", "&&", "||", "\n", "&")
                continue
            text = tok.text()
            if start:
                names.append(text)
                start = text in ("sudo", "then", "do", "else", "if", "while", "until", "!", "time")
            elif re.match(r"[A-Za-z_][A-Za-z0-9_]*=", text) and not names:
                start = True
        return names

    # The history check of older lessons uses split().
    def split(self, line):
        return [t.text() if isinstance(t, Word) else t.op for t in tokenize(line)]


def shell(request_json):
    """One command. Request: state, line, checks; or write (from nano)."""
    req = json.loads(request_json)
    sh = Shell(req.get("state"))
    for line in sh.setup:
        # The start of a lesson: commands that set the scene, as root, unseen.
        sh.root = True
        sh.run_top(line)
        sh.root = False
    sh.setup = []
    sh.screen = []
    out, code = "", 0
    write = req.get("write")
    raw = req.get("line")
    line = (raw or "").strip()
    boots = sh.boots
    if sh.pending is not None and raw is not None:
        # The answer to a question: never kept in the history (it may be a password).
        out, code = sh.answer(raw)
    elif write:
        path = sh.abs(write["path"])
        sh.root = bool(write.get("root"))
        if not sh.may_write(path):
            out, code = f"[ Error writing {write['path']}: Permission denied ]\n", 1
        else:
            sh.files[path] = write["text"]
        sh.root = False
    elif line and sh.at == "pc":
        sh.pc_history.append(line)
        sh.clock += 2
        out, code = sh.pc_run(line)
    elif line:
        sh.history.append(line)
        sh.clock += 2
        out, code = sh.run_top(line)
        if sh.via and sh.boots != boots:
            # A reboot ends the SSH connection: back on the PC.
            out += "Connection to raspberrypi.local closed by remote host.\nConnection to raspberrypi.local closed.\n"
            out = out.replace("Connection to raspberrypi closed.\n(The Pi restarts. A real one needs about 30 seconds. Here it is back at once, and you are logged in again.)\n",
                              "(The Pi restarts. A real one needs about 30 seconds. Then log in again with ssh.)\n")
            sh.at, sh.via = "pc", False
    if len(out) > _MAX_OUT:
        out = out[:_MAX_OUT] + "\n... (the rest is cut)\n"
    env = sh.check_env(out)
    checks = []
    for check in req.get("checks") or []:
        try:
            checks.append(bool(eval(check, {"__builtins__": __builtins__}, env)))
        except Exception:
            checks.append(False)
    return json.dumps(
        {
            "out": out,
            "code": code,
            "state": sh.state(),
            "prompt": sh.pc_prompt() if sh.at == "pc" else f"{USER}@{HOST}:{sh.show(sh.cwd)} $",
            "clear": sh.cleared,
            "editor": sh.editor,
            "checks": checks,
            "ask": {"text": sh.pending["ask"], "secret": bool(sh.pending.get("secret"))} if sh.pending else None,
            "host": sh.at,
        }
    )
