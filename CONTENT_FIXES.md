# Content fixes: tracking

Work on branch `content-fixes`. Nothing is pushed, published or deployed.
A new session: read this file first, then `git status` and `git log`.

**Numbering.** The audit used the export of 1.3.0. Lesson 48 "Many things
at once" was added in 1.4.0, so **audit lesson N, for N >= 48, is lesson
N+1 now** (audit 48.7 = 49.7, audit 64.6 = 65.6). Python modules now:
M1 = L1-4, M2 = L5-10, M3 = L11-18, M4 = L19-30, M5 = L31-41, M6 = L42-49,
M7 = L50-61, M8 = L62-65. Below, refs use the **current** numbering, with
the audit's in brackets where it differs.

**Tools (Phase 0).**
- `.local/tools/course-index.mjs` writes `.local/docs/course-index.json`:
  every step in course order with its ref and learner-visible text (check
  expressions are left out).
- `.local/tools/find.py PATTERN [--py]`: search it in course order.
  `.local/tools/firstuse.py`: first use and first Learn step of concepts.
- `scripts/quiz-bias.mjs`: quiz option length bias by path; fails when a
  question does not have exactly one correct option.

Status: CONFIRMED, WRONG, ALREADY FIXED, NEEDS DECISION, NEW (found in
Phase 0, not in the audit), and **FIXED (phase N)** once done.

## Decisions (owner, 2026-11-26)
1. Data path: rename to **"Data and machine learning"** (done, phase 1).
2. Optional lessons: **do not build them**. Items proposed as "extra"
   stay in the core (walrus, L17, L24, L25, L33, L37-L39, parts of L54-L55).
3-8. Left to me, with the best quality for the cost:
   - Debugger L59: move right after L42 (VS Code is installed there), and
     remove 24.1's reference to it (phase 3).
   - Pi 6 motor board: a **DRV8833** board with jumpers: fits
     `Motor(forward, backward)` with no enable pin (done, phase 1).
   - References by lesson id, with a build check: yes, small (phase 2).
   - L46 "Working with others": move after L58, so CI comes after pytest
     (phase 3).
   - Pi 8.1: add the Zero 2 W (phase 2, specs from raspberrypi.com).
   - CSRF: decide in phase 5, after checking Flask-WTF in Pyodide.

## App facts that matter for the fixes

- **Options are shuffled** in the app (`src/engine/steps/item.ts:33`,
  `shuffle(item.options)`); it is the only place that renders options.
  "Correct always first" is the export only.
- **Progress is keyed by lesson id**, not number (`src/engine/store.ts`):
  `lessons[id] = { reached, done }`. Moving a lesson keeps `done`.
  `reached` is a **step index**: adding or moving steps inside a lesson
  shifts where "continue" lands (no reset, no crash).
- **Review cards** are keyed `lessonId:itemId` (`registry.ts:97`). Moving a
  card to another lesson, or changing its id, starts it new (its box is
  lost). Knowledge is keyed `lessonId:objectiveId`; moving an objective to
  another lesson resets its estimate. Saved code and mistakes are keyed by
  lesson id and step id.
- `pickReview` mixes in due cards of lessons with a smaller `order`, so a
  move changes which old cards a lesson's review step can show. Harmless.
- **No optional lessons.** `course.yaml` entries have `kind: lesson |
  project` only. A learner can skip a lesson by hand (knowledge page).
  What an "extra" track would take: a `kind: extra` in course.yaml and
  types.ts; home chips with a label and their own style; the progress
  and hours totals, "next lesson" on the done screen, module practice and
  `pickReview` skipping extras; validate.ts refusing a core lesson that
  needs an extra (a forward-dependency check). About one focused session,
  engine and CSS only, no content.
- Lesson mentions are plain text ("lesson 45"). `.local/tools/renumber.mjs`
  shifts mentions of moved lessons but cannot fix mentions that were
  already wrong (that is how the drift below happened). Proposal: a
  reference syntax by id (for example `[[git]]`, rendered as "lesson 45,
  Git"), resolved in the Markdown renderer, and a check in validate.ts that
  fails on an unknown id or a reference to a later lesson.
- The pretend shell already reads `User=` and `WorkingDirectory=` in
  service files (`src/py/shell.py:2527`).
- Paths already have prerequisites in `course.yaml` (`needs:`): Linux
  [functions, files], Pi [classes-and-objects, linux-terminal], Data
  [csv-and-comprehensions], Web [web-apis], Computer [functions,
  dictionaries].

## P1. Wrong or unsafe

| # | Item | Status | Evidence |
|---|---|---|---|
| 1.1 | Pi 1.2 rule 2 vs Pi 3.1 button to GND | FIXED (phase 1) | Pi 1.2: "Never connect a pin straight to another pin or to ground". Pi 3.1: button between GPIO and GND, "No resistor is needed". |
| 1.2 | Pi 4.4 HC-SR04 divider | FIXED (phase 1) | "it needs two resistors (a voltage divider)", no values, no VCC. gpiozero docs (api_input.html, DistanceSensor): 330 Ω from ECHO, 470 Ω from sensor GND, joined at a GPIO; VCC to 5V; TRIG to a GPIO; HC-SR04P needs no divider. |
| 1.3 | Pi 5.6 MCP3008 chip wiring | FIXED (phase 1) | Only "talks over SPI, on GPIO 8, 9, 10 and 11" and the knob legs. Pinout to add (MCP3008 datasheet; Pi SPI0): 16 VDD and 15 VREF to 3V3, 14 AGND and 9 DGND to GND, 13 CLK to GPIO11 (SCLK), 12 DOUT to GPIO9 (MISO), 11 DIN to GPIO10 (MOSI), 10 CS/SHDN to GPIO8 (CE0); pins 1-8 are CH0-CH7; notch = pin 1 side. Datasheet to be re-read when writing. |
| 1.4 | Pi 6 ground and board | FIXED (phase 1) | Pi 6.1: "Put the board on the Pi" (implies a HAT), no ground, no named board, no motor power wiring. NEEDS DECISION: which board. |
| 1.5 | Pi 4.1 active buzzer | FIXED (phase 1) | "A buzzer beeps while its pin is on." gpiozero `Buzzer` is on/off only ("not capable of playing a variety of tones (see TonalBuzzer)"), so the part must be an **active** buzzer. |
| 1.6 | Pi 5.1 capacitor polarity | FIXED (phase 1) | "a small capacitor (1 µF)", legs wired without polarity. 1 µF is usually electrolytic. |
| 2 | Linux services as root | FIXED (phase 1) | Linux 6.7, 6.8 and also **6.9** have `[Service]` with `ExecStart=` only; no `User=` anywhere (find.py "User=": 0). |
| 3.1 | Data 5 chooses k on the test set | FIXED (phase 1) | Data 5.5 "Compare a few values of k on the test set"; Data 5.7 prints test accuracy for k = 1, 3, 5. |
| 3.2 | Data 5 no feature scaling | FIXED (phase 1) | Data 5.7 distance `np.sqrt(((train - new) ** 2).sum(axis=1))` on [bill mm, flipper mm]. |

## P2. Quizzes

| # | Item | Status | Evidence |
|---|---|---|---|
| P2.1 | Correct option is the longest | CONFIRMED | `node scripts/quiz-bias.mjs`: 1,063 questions; correct strictly longest: Python 73%, Linux 61%, Pi 81%, Data 76%, Web 78%, Computer 73% (all 73%); at least 1.5x: 51%; correct strictly shortest: 5%. |
| P2.2 | Exactly one correct option | CONFIRMED OK | quiz-bias.mjs finds no question with 0 or 2+ correct. |
| P2.3 | Correct option always first | WRONG (export only) | Shuffled in `item.ts:33`. |

## P3. Order and prerequisites

First use = first learner-visible text; Learn = first theory, hook or
worked step (firstuse.py), then read by hand.

| # | Concept | Status | Evidence |
|---|---|---|---|
| 3.1 | try/except before L35 | CONFIRMED | First at 33.7 (theory), 33.9 (exercise), 34.4, 34.5, 34.10. L35 depends only on `Path` (L31) and JSON (L32): moving L35 after L32 works. |
| 3.2 | break / continue | CONFIRMED | No Learn step in L7 or L8. `break` first in code at 25.4 (demo), needed in 30.7; first explained in 33.7. `continue` first in 31.6 (worked). |
| 3.3 | `#` comments | CONFIRMED | Starters from 1.8 use `# ...`; first Learn mention 23.2 ("write the steps as comments"). |
| 3.4 | type() | CONFIRMED (minor) | L3 names int, float and str (3.2, 3.7) but never shows `type()`; first use 32.5. |
| 3.5 | round() | CONFIRMED | 4.E3, 4.E5, 9.E1, 22.E1; explained in 27.1. |
| 3.6 | split / join | CONFIRMED | split in 14.E2, then drills 16.6, 16.8; no L16 Learn step; Learn mentions at 36.5 and 31.4. |
| 3.7 | .sort() | CONFIRMED | Only 60.4 [59.4]. |
| 3.8 | .insert() / .index() / .extend() | CONFIRMED | insert first 25.10; index first 16.R11 (a card); extend only in extras 46.E2, 49.E2. |
| 3.9 | enumerate | CONFIRMED | 25.R5 (card), then 27.7. |
| 3.10 | Comprehensions before L36 | CONFIRMED | 22.5 shows `[n * 2 for n in nums]` as known. **Disagree with moving L36** (it also needs CSV and files): proposal, teach the plain list comprehension in L12 (loop patterns), keep L36 for the rest. |
| 3.11 | `if __name__ == "__main__"` | CONFIRMED | L29 objective; shown in demo 29.2, needed in 29.6; no Learn step explains it (29.1, 29.5, 29.7, 29.9). |
| 3.12 | super().__init__ | CONFIRMED (narrower) | 54.3 [53.3] is a demo (See it before Learn is the course style), but drill 54.4 and exercise 54.5 need it before theory 54.6. |
| 3.13 | pytest.raises in 46.3 | CONFIRMED | Also 46.4 runs pytest in CI; pytest is taught in L57 [56]. |
| 3.14 | global | CONFIRMED | 0 uses in the Python course; used in Pi 3.4 and Pi 5.E2. |
| 3.15 | externally-managed-environment | CONFIRMED | 43.0 objective; only in drill 43.4, not in 43.2's known problems. |

### Cross-references

| Step | Status | Note |
|---|---|---|
| 20.2 sep= | CONFIRMED | "You already know one: `print("a", "b", sep="-")`": first appearance. |
| 11.5 L8 for over text | CONFIRMED | In L8 only in quiz 8.12. |
| 24.1 stack, debugger | CONFIRMED | Debugger is L59 [58]. |
| 39.1 decorators used | CONFIRMED | `@dataclass` L52, `@property` L55, `@app.route` Web path. |
| 41.6 CSV in L32 | ALREADY FIXED | Fixed in 1.4.0 (now "Lesson 36"). |
| 49.7 [48.7], 51.x [50.2], 53.x [52.6], 63.x [62.3], 65.3, 65.4, 65.5 [64.3-64.5], 65.7 [64.7] | ALREADY FIXED | Fixed in 1.4.0 (45, 35, 52, 57, 63/64, 63, 45, 27). |
| 65.6 [64.6] lesson list | CONFIRMED | "30 venv, 31 git, 37 pytest, 39 and 40 the window, 41 the build" → 43, 45, 57, 62-63, 64. |
| 44.4 terminal lessons | CONFIRMED | Linux is a path the learner may not have done. |
| 49.2, 49.3 "the last lesson" | NEW (my 1.4.0 regression) | Means Web APIs (47); since 1.4.0 the last lesson is 48. |
| 29.E1 numpy | NEW | "You know it from `import numpy as np`": numpy is only in the Data path. |
| 55.3 dict.fromkeys | NEW | "You know a classmethod already: `dict.fromkeys(...)`": never shown before. |

## P4. By area

### Python
| Item | Status | Evidence / note |
|---|---|---|
| Box vs label (2.1 vs 13.2) | CONFIRMED | 2.1 "makes a box with the label `age`"; 13.2 "Labels, not boxes". Also the 3D actor is `variableBoxes` (crates): a visual change too. |
| Walrus 7.11 | CONFIRMED | 7.11, 7.12, 7.R6. NEEDS DECISION (extra or remove). |
| L17, L24, L25 as extra | NEEDS DECISION | Needs optional lessons (see app facts). |
| 28.2, 29.5 math.py | CONFIRMED (minor) | Tested: Windows Python 3.14, `math` is built in, a local `math.py` is ignored; `random.py` shadows. 28.2's sentence is about `random` (true) but names `math.py` too; 29.5's search order puts the standard library after the program folder, wrong for built-in modules. |
| M5 extras (L33, L37, L38, L39) | NEEDS DECISION | |
| L40 con.close() | CONFIRMED | 0 uses; `with con:` commits or rolls back, it does not close. |
| 46.4 action versions | CONFIRMED | v4 / v5 in 46.4; READMEs now show `actions/checkout@v7` (release v7.0.1) and `actions/setup-python@v7` (v7.1.0). |
| L45 clone, revert, time | CONFIRMED | `git clone` only as text in 45.11 (local step); `git revert` 0; 55 minutes. |
| Debugger earlier | NEEDS DECISION | L59 [58] needs only functions for its in-app part; O4 needs VS Code (L42). It cannot move before L42 whole. |
| L54 [53] advanced, Enum | NEEDS DECISION | |
| tkinter after() | CONFIRMED | 0 uses in L62-63 [61-62]. |
| PyInstaller antivirus | CONFIRMED | 0 mentions in L64 [63]. |
| 31.4 UTF-8, 42.1 install manager | KEEP | As the audit says. |

### Linux
| Item | Status | Evidence |
|---|---|---|
| man, --help, less, q | CONFIRMED | 0 matches. |
| apt update before first install | CONFIRMED | Linux 4.3 installs with `sudo apt install tree`; `sudo apt update` first appears in Pi 8.5. |
| ls -a, find in main path | CONFIRMED | `ls -a` only Linux 1.E2; find only extras. |
| Shebang after ./ | CONFIRMED (minor) | Scripts run with `./` in Linux 4; `#!/bin/bash` first in Linux 5.4. |
| nano Ctrl+O | CONFIRMED (minor) | Linux 4.3 teaches Ctrl+X (then save). |
| PATH, history, cron | LATER | Additions. |

### Raspberry Pi
| Item | Status | Evidence |
|---|---|---|
| Lesson before the first LED | CONFIRMED | Missing; Pi 2.1 has 220-330 Ω (keep). |
| Running code on a real Pi | CONFIRMED | No procedure in Pi 1-7; 0 matches for venv/`--system-site-packages`. gpiozero docs: `python3 -m venv gpiozero-env --system-site-packages`. |
| Real setup comes last | CONFIRMED | Pi 8-9 after all circuits. |
| Button on GPIO 2 | **DISAGREE** | gpiozero's own recipes use `Button(2)`; it works (the fixed pull-up and the internal one pull the same way). Only an I2C conflict, and the Pi lessons use no I2C. Proposal: keep, add one sentence; change only if you prefer. |
| Servo, camera, I2C, RGB | LATER | |
| Pi 8.1 Zero 2 W | NEEDS DECISION | Table has Pi 5, 4, 3 only. |
| Pi 9 Windows key install | CONFIRMED | Pi 9.7 gives `ssh-copy-id` only (not on Windows). PowerShell command → NEEDS HUMAN TEST. |

### Data, Web, Computer
| Item | Status | Evidence |
|---|---|---|
| Data scope | FIXED (phase 1): renamed | Only linear regression and kNN. |
| HTML lesson before Web 2 | CONFIRMED | Web 1 shows HTML in responses but no Learn step on tags. |
| CSS / static files | CONFIRMED | 0 matches. |
| Flask + SQLite | CONFIRMED | `sqlite3` only in L40, L41. |
| CSRF | CONFIRMED | 0 matches. Library (Flask-WTF) must run in Pyodide: to check. |
| Web 2.1 `__main__` guard | CONFIRMED | Web 2.1 ends with a bare `app.run()`. The guard is in L29 (needs a Learn step, 3.11). |
| Web prerequisites | ALREADY THERE | Web needs `web-apis` (L47) in course.yaml; the path page could say "and basic HTML is taught in Web 1". |
| Computer: OS, bytecode | CONFIRMED | "operating system" only in passing (34.5, 34.8); bytecode 0. |
| Recommended path order | TO DO | `needs:` exists; no shown order. |

## Phase 1: what changed
- **Pi 1.2** rule 2: an output never goes straight to 3V3, 5V, GND or
  another pin; an input button may go to GND. **Pi 3.1**: why the button
  is safe (input, pull-up), and that GPIO 2's board pull-up works the same.
- **Pi 4.1**: an active buzzer, + leg to the pin, 15 mA or less (a bigger
  one needs a transistor); passive needs `TonalBuzzer`.
- **Pi 4.4**: VCC 5V, GND, TRIG GPIO 23, ECHO through 330 Ω to GPIO 24 and
  470 Ω from GPIO 24 to GND (about 2.9 V); HC-SR04P needs none. New card
  `r-divider`.
- **Pi 5.1**: electrolytic polarity (- leg, stripe, to GND).
- **Pi 5.6**: the MCP3008 notch, leg numbers and a full table (datasheet
  21295d, package drawing; VDD 2.7-5.5 V), the breadboard groove, GPIO vs
  physical numbers.
- **Pi 6.1, 6.4**: a DRV8833 board: VIN to battery +, GND to battery - and
  a Pi GND (shared ground), AIN1/AIN2 GPIO 4/14, BIN1/BIN2 GPIO 17/18,
  2.7-10.8 V, about 1.2 A per motor (Pololu 2130), SLP to 3V3 if the motor
  never moves. New card `r-ground`.
- **Linux 6.7**: `User=pi`, `WorkingDirectory=/home/pi`, why root is a
  risk, and that the user name is the one chosen in Raspberry Pi Imager.
  **6.8, 6.9**: prompts, hints, solutions and a new check `User=pi`. New
  card `r-user`.
- **Data 5**: goals O4 (validation, test once) and O5 (standardize); new
  Learn steps "Three sets, not two" and "The same scale for every
  feature"; a drill; ex-k chooses k on `val` and measures `test` once; a
  new completion exercise ex-scale (raw neighbours vote Gentoo, scaled
  Adelie); quiz `q-choose`; cards `r-validation`, `r-scale`. All expected
  outputs come from real runs (local numpy 2.5.3 and the course's
  Pyodide). Time 40 → 55 min.
- **Data path** renamed "Data and machine learning" (course.yaml, README,
  plot.py comment). Lesson texts that say "data and AI tools" stay: they
  name the field, not the path.
- Lesson times: Pi 4 35 → 40, Pi 5 and Pi 6 40 → 45.
- Verified: check:content (all pass), quiz-bias.mjs (every new question
  has one correct option), the audit (no long sentences, every goal
  practised, practice ≥ 60%), the robot on Data 5, Linux 6 and Pi 1, 3-6
  (no issues, no page errors), the MCP3008 table in the app.
- Independent review (a separate reviewer, as expert and as beginner): no
  factual errors; its 5 points were applied (buzzer current, SLP pin,
  "absorbs the spikes", label and groove explanations, "leak"). Not
  applied: GPIO 14 is the serial TX pin and could twitch at boot if the
  serial console is on. It is off by default, and gpiozero's own examples
  use `Motor(4, 14)`; noted, no change.

## NEEDS HUMAN TEST
Never marked as tested. Each with steps and the expected result.
1. **Button (Pi 3)**: button between GPIO 2 and GND, `Button(2)`,
   `button.wait_for_press(); print("ok")`. Expected: "ok" on the press.
2. **Active buzzer (Pi 4.1)**: + leg to GPIO 17, - to GND,
   `Buzzer(17).beep(n=3, background=False)`. Expected: 3 beeps; the Pi
   stays stable. Measure the buzzer current if possible (≤ 15 mA).
3. **HC-SR04 (Pi 4.4)**: wiring as in the lesson. Before connecting ECHO,
   measure GPIO 24's side of the divider with a multimeter while the
   sensor runs: about 2.9 V, never above 3.3 V. Then
   `print(DistanceSensor(echo=24, trigger=23).distance)` with a hand at
   20 cm. Expected: about 0.2.
4. **LDR (Pi 5.1)**: electrolytic 1 µF, - to GND. `LightSensor(4).value`
   in light and with the LDR covered. Expected: clearly higher in light.
5. **MCP3008 (Pi 5.6)**: SPI on in raspi-config, wiring by the table.
   `MCP3008(0).value` with the knob at both ends. Expected: about 0 and
   about 1; the chip stays cool.
6. **DRV8833 (Pi 6)**: 4 AA batteries, wiring by the table, shared GND.
   `Motor(4, 14).forward(0.5)`, then `backward(0.5)`. Expected: the motor
   turns both ways. Without the shared GND it should not run reliably.
7. **Service (Linux 6.7)**: on Raspberry Pi OS, the logger service with
   `User=<your user>` and `WorkingDirectory=/home/<your user>`.
   `systemctl status logger` and `ps -o user= -p <PID>`. Expected:
   active, and the user is yours, not root.
8. (Later phases) The PowerShell key install for Pi 9, on real Windows;
   the updated GitHub Actions workflow of 46.4 on GitHub.

## Progress
- 2026-11-25 Phase 0 done: all findings checked, this file written. No
  lesson content changed.
- 2026-11-26 Phase 1 done (P1: Pi wiring, services, Data 5, path name).
