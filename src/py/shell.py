# A pretend Linux shell for the terminal steps. Loaded after harness.py.
#
# The page keeps the whole state (files, folders, the working folder, the
# history) and sends it with each command; shell() gives back the output and
# the new state. Nothing here touches a real disk or the learner's computer:
# the file system is a dictionary. The commands behave like their Linux
# versions (output and error messages), for the cases a beginner meets.
import fnmatch
import json
import posixpath
import re
import shlex

HOME = "/home/pi"
USER = "pi"
HOST = "raspberrypi"
_MAX_OUT = 20_000
_MAX_DEPTH = 8  # scripts that run scripts

_HELP = {
    "pwd": "pwd: print the working directory (where you are).",
    "ls": "ls [-l] [-a] [path]: list what is in a directory.",
    "cd": "cd [path]: change the working directory. cd alone goes home (~).",
    "mkdir": "mkdir [-p] name: make a directory. -p makes the parents too.",
    "touch": "touch file: make an empty file, or update the time of a file.",
    "cat": "cat file...: print the content of files.",
    "echo": "echo text: print the text. echo text > file writes it to a file.",
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
    "python3": "python3 file.py: run a Python program.",
    "nano": "nano file: a small text editor.",
    "sudo": "sudo command: run a command as the administrator (root).",
    "apt": "apt install name: install a program (needs sudo).",
    "whoami": "whoami: your user name.",
    "hostname": "hostname: the name of this computer.",
    "date": "date: the date and the time.",
    "history": "history: the commands you typed.",
    "clear": "clear: empty the screen.",
    "man": "man command: help for a command.",
}


class Quoted(str):
    """A word that was in quotes: no * expansion, no ~."""


class _Exit(Exception):
    """A command failed: message for the screen, and its exit code."""

    def __init__(self, message, code=1):
        super().__init__(message)
        self.message = message
        self.code = code


class Shell:
    def __init__(self, state):
        state = state or {}
        self.files = {}
        self.dirs = {"/", "/home", HOME, "/tmp", "/etc"}
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
        if self.cwd not in self.dirs:
            self.cwd = HOME
        self.editor = None
        self.cleared = False
        self.depth = 0

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
        return path in self.files or path in self.dirs

    def children(self, d):
        prefix = d.rstrip("/") + "/"
        names = set()
        for p in list(self.files) + list(self.dirs):
            if p != d and p.startswith(prefix):
                rest = p[len(prefix):]
                if rest and "/" not in rest:
                    names.add(rest)
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

    def read(self, name, cmd):
        path = self.abs(name)
        if path in self.dirs:
            raise _Exit(f"{cmd}: {name}: Is a directory")
        if path not in self.files:
            raise _Exit(f"{cmd}: {name}: No such file or directory")
        return self.files[path]

    def write(self, name, text, append=False):
        path = self.abs(name)
        if path in self.dirs:
            raise _Exit(f"bash: {name}: Is a directory")
        parent = posixpath.dirname(path)
        if parent not in self.dirs:
            raise _Exit(f"bash: {name}: No such file or directory")
        self.files[path] = (self.files.get(path, "") if append else "") + text

    # ---- parsing -------------------------------------------------------------
    def expand(self, tokens):
        out = []
        for tok in tokens:
            if isinstance(tok, Quoted):
                out.append(str(tok).replace("$HOME", HOME).replace("$USER", USER) if '"' not in tok else str(tok))
                continue
            if tok.startswith("~"):
                tok = HOME + tok[1:] if tok == "~" or tok.startswith("~/") else tok
            tok = tok.replace("$HOME", HOME).replace("$USER", USER)
            if any(ch in tok for ch in "*?[") and not tok.startswith("-"):
                base = posixpath.dirname(tok)
                pattern = posixpath.basename(tok)
                folder = self.abs(base) if base else self.cwd
                if folder in self.dirs:
                    hits = [n for n in self.children(folder) if fnmatch.fnmatchcase(n, pattern) and not n.startswith(".")]
                    if hits:
                        out.extend(posixpath.join(base, n) if base else n for n in hits)
                        continue
            out.append(tok)
        return out

    def split(self, line):
        """Words and operators. A word in quotes stays one word, and is marked."""
        lexer = shlex.shlex(line, posix=False, punctuation_chars="|&;>")
        lexer.whitespace_split = True
        try:
            raw = list(lexer)
        except ValueError:
            raise _Exit("bash: syntax error: a quote is not closed", 2)
        words = []
        for tok in raw:
            if len(tok) >= 2 and tok[0] == tok[-1] and tok[0] in "'\"":
                words.append(Quoted(tok[1:-1]))
            elif tok.count("'") % 2 or tok.count('"') % 2:
                raise _Exit("bash: syntax error: a quote is not closed", 2)
            else:
                words.append(tok.replace("'", "").replace('"', ""))
        return words

    # ---- running ---------------------------------------------------------------
    def run_line(self, line):
        """Runs a whole line: commands joined by ; && ||, with pipes and redirects."""
        tokens = self.split(line)
        out = []
        code = 0
        chain = []
        current = []
        for tok in tokens:
            if tok in (";", "&&", "||"):
                chain.append((current, tok))
                current = []
            else:
                current.append(tok)
        chain.append((current, None))
        skip = False
        for part, joiner in chain:
            if part and not skip:
                text, code = self.run_pipeline(part)
                if text:
                    out.append(text)
            elif skip:
                skip = False
            if joiner == "&&" and code != 0:
                skip = True
            elif joiner == "||" and code == 0:
                skip = True
        return "".join(out), code

    def run_pipeline(self, tokens):
        stages = [[]]
        for tok in tokens:
            if tok == "|":
                stages.append([])
            else:
                stages[-1].append(tok)
        if any(not s for s in stages):
            return "bash: syntax error near unexpected token `|'\n", 2
        # Redirect on the last command: > file or >> file.
        last = stages[-1]
        target = None
        append = False
        for op in (">>", ">"):
            if op in last:
                at = last.index(op)
                if at + 1 >= len(last):
                    return "bash: syntax error near unexpected token `newline'\n", 2
                target = last[at + 1]
                append = op == ">>"
                stages[-1] = last[:at] + last[at + 2:]
                break
        data = None
        code = 0
        errors = []
        for i, stage in enumerate(stages):
            argv = self.expand(stage)
            piped = i < len(stages) - 1 or target is not None
            try:
                data = self.command(argv, data, piped)
                code = 0
            except _Exit as stop:
                if stop.message:
                    errors.append(stop.message + "\n")
                data = ""
                code = stop.code
        text = "".join(errors)
        if target is not None:
            try:
                self.write(target, data or "", append)
            except _Exit as stop:
                return text + stop.message + "\n", 1
            return text, code
        return text + (data or ""), code

    def command(self, argv, stdin, piped):
        if not argv:
            return ""
        name, args = argv[0], argv[1:]
        if name.startswith("./") or name.startswith("/") and name.endswith(".sh"):
            return self.script(name, needs_x=True)
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

    # ---- commands ------------------------------------------------------------
    def c_pwd(self, args, stdin, piped):
        return self.cwd + "\n"

    def c_cd(self, args, stdin, piped):
        if len(args) > 1:
            raise _Exit("bash: cd: too many arguments")
        target = self.abs(args[0]) if args else HOME
        if target in self.files:
            raise _Exit(f"bash: cd: {args[0]}: Not a directory")
        if target not in self.dirs:
            raise _Exit(f"bash: cd: {args[0]}: No such file or directory")
        self.cwd = target
        return ""

    def _long(self, path, name):
        is_dir = path in self.dirs
        mode = self.mode(path)
        rwx = "".join(("r" if int(d) & 4 else "-") + ("w" if int(d) & 2 else "-") + ("x" if int(d) & 1 else "-") for d in mode)
        size = 4096 if is_dir else len(self.files.get(path, "").encode("utf-8"))
        return f"{'d' if is_dir else '-'}{rwx} 1 {USER} {USER} {size:>5} Nov 21 10:00 {name}"

    def c_ls(self, args, stdin, piped):
        flags, paths = self.flags(args, "la1", "ls")
        paths = paths or ["."]
        blocks = []
        loose = [(self.abs(p), p) for p in paths if self.abs(p) in self.files]
        if loose:
            blocks.append((None, loose))
        for p in paths:
            path = self.abs(p)
            if path in self.files:
                continue
            elif path in self.dirs:
                names = [n for n in self.children(path) if "a" in flags or not n.startswith(".")]
                if "a" in flags:
                    names = [".", ".."] + names
                entries = [(path if n == "." else posixpath.dirname(path) if n == ".." else posixpath.join(path, n), n) for n in names]
                blocks.append((p, entries))
            else:
                raise _Exit(f"ls: cannot access '{p}': No such file or directory", 2)
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
        return text + "\n" if text else ""

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
            self.files[path] = ""
        return ""

    def c_cat(self, args, stdin, piped):
        if not args:
            return stdin or ""
        return "".join(self.read(n, "cat") for n in args)

    def c_echo(self, args, stdin, piped):
        newline = True
        if args and args[0] == "-n":
            newline, args = False, args[1:]
        return " ".join(args) + ("\n" if newline else "")

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
        flags, rest = self.flags(args, "invcrE", "grep")
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
        text = "\n".join(out) + ("\n" if out else "")
        if not found and "c" not in flags:
            # No line matches: grep prints nothing and fails (exit code 1).
            raise _Exit(text.rstrip("\n"), 1)
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
        return USER + "\n"

    def c_hostname(self, args, stdin, piped):
        return HOST + "\n"

    def c_date(self, args, stdin, piped):
        return "Sat Nov 21 10:00:00 UTC 2026\n"

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
        self.editor = {"path": path, "name": args[0], "text": self.files.get(path, "")}
        return ""

    def c_sudo(self, args, stdin, piped):
        if not args:
            raise _Exit("usage: sudo command")
        self.root = True
        try:
            return self.command(self.expand(args), stdin, piped)
        finally:
            self.root = False

    def c_apt(self, args, stdin, piped):
        if not args:
            raise _Exit("apt: tell apt what to do, for example: sudo apt install tree")
        action, names = args[0], [a for a in args[1:] if not a.startswith("-")]
        if action in ("install", "remove", "update", "upgrade") and not getattr(self, "root", False):
            raise _Exit(
                "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n"
                "E: Unable to acquire the dpkg frontend lock, are you root?",
                100,
            )
        if action == "update":
            return "Reading package lists... Done\nAll packages are up to date.\n"
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

    def c_bash(self, args, stdin, piped):
        if not args:
            raise _Exit("bash: this course runs bash only with a script: bash script.sh")
        return self.script(args[0], needs_x=False)

    c_sh = c_bash

    def script(self, name, needs_x):
        path = self.abs(name)
        if path not in self.files:
            raise _Exit(f"bash: {name}: No such file or directory", 127)
        if needs_x and not int(self.mode(path)[0]) & 1:
            raise _Exit(f"bash: {name}: Permission denied", 126)
        if self.depth >= _MAX_DEPTH:
            raise _Exit("bash: too many scripts inside scripts")
        self.depth += 1
        out = []
        try:
            for line in self.files[path].splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                text, _ = self.run_line(line)
                out.append(text)
        finally:
            self.depth -= 1
        return "".join(out)

    def c_python3(self, args, stdin, piped):
        if not args:
            raise _Exit("Python 3 is here, but this terminal cannot type into Python itself.\nWrite a file, and run it: python3 hello.py")
        if args[0] in ("--version", "-V"):
            return "Python 3.14.2\n"
        name = args[0]
        code = self.read(name, "python3")
        # The program runs in a folder with the files of the working directory.
        prefix = self.cwd.rstrip("/") + "/"
        here = {p[len(prefix):]: t for p, t in self.files.items() if p.startswith(prefix)}
        result = json.loads(run(json.dumps({"code": code, "cases": [{"files": here}]})))  # noqa: F821 (harness.py)
        for rel, text in (result.get("files") or {}).items():
            if rel.startswith("home/"):
                continue
            target = prefix + rel
            self._mkdirs(posixpath.dirname(target))
            self.files[target] = text
        out = result.get("stdout") or ""
        error = result.get("error")
        if error:
            if error.get("needsInput"):
                return out + "This terminal cannot answer input() yet. Give the program its values in the file.\n"
            raise _Exit(out + error["traceback"].rstrip("\n"), 1)
        return out

    c_python = c_python3

    def c_exit(self, args, stdin, piped):
        return "logout: close the lesson to leave the terminal.\n"

    # ---- state ---------------------------------------------------------------
    def state(self):
        home_dirs = sorted(d for d in self.dirs if d not in ("/", "/home", HOME, "/tmp", "/etc"))
        return {
            "files": dict(sorted(self.files.items())),
            "dirs": home_dirs,
            "modes": dict(sorted(self.modes.items())),
            "cwd": self.cwd,
            "history": self.history[-200:],
            "packages": self.packages,
        }

    def check_env(self, last_out):
        def resolve(p):
            return self.abs(p, HOME)

        def ran(name):
            for line in self.history:
                try:
                    tokens = self.split(line)
                except _Exit:
                    continue
                if not tokens:
                    continue
                starts = [tokens[0]] + [tokens[i + 1] for i, t in enumerate(tokens[:-1]) if t in ("|", ";", "&&", "||", "sudo")]
                if name in starts:
                    return True
            return False

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
            "packages": list(self.packages),
            "files": {self.show(p): t for p, t in self.files.items() if p.startswith(HOME + "/")},
        }


def shell(request_json):
    """One command. Request: state, line, checks; or write (from nano)."""
    req = json.loads(request_json)
    sh = Shell(req.get("state"))
    out, code = "", 0
    write = req.get("write")
    line = (req.get("line") or "").strip()
    if write:
        sh.files[sh.abs(write["path"])] = write["text"]
    elif line:
        sh.history.append(line)
        try:
            out, code = sh.run_line(line)
        except _Exit as stop:
            out, code = (stop.message + "\n" if stop.message else ""), stop.code
        except RecursionError:
            out, code = "bash: too deep\n", 1
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
            "prompt": f"{USER}@{HOST}:{sh.show(sh.cwd)} $",
            "clear": sh.cleared,
            "editor": sh.editor,
            "checks": checks,
        }
    )
