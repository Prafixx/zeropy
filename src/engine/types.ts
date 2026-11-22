// Data model of a lesson. Lessons are YAML files that match these types.

export interface Objective {
  id: string;
  text: string;
}

export interface McqOption {
  text: string;
  correct?: boolean;
  /** Explains why this option is right or wrong. Always shown after a choice. */
  why: string;
}

export interface McqItem {
  kind: 'mcq';
  id: string;
  objective: string;
  prompt: string;
  code?: string;
  options: McqOption[];
}

export interface PredictItem {
  kind: 'predict';
  id: string;
  objective: string;
  prompt?: string;
  code: string;
  /** Files in the folder before the code runs. */
  files?: Record<string, string>;
  /** Answers of the pretend web for `requests` (see harness.py). */
  web?: Web;
  /** Shown after the answer. Explains the real output. */
  explain: string;
  /** Targeted feedback for known wrong answers. */
  misconceptions?: { answer: string; say: string }[];
}

/** Find the error: click the line, name the kind of error, choose the fix. */
export interface DiagnoseItem {
  kind: 'diagnose';
  id: string;
  objective: string;
  /** read: the message of Python is shown. predict: decide before the run. */
  mode: 'read' | 'predict';
  prompt?: string;
  /** A program that stops with an error. Python gives the answer key. */
  code: string;
  /** Files in the folder before the code runs. */
  files?: Record<string, string>;
  /** Answers of the pretend web for `requests` (see harness.py). */
  web?: Web;
  /** Wrong kinds of error to offer. Default: other common ones. */
  distractors?: string[];
  /** Optional last question: how to fix it. */
  fix?: McqOption[];
  explain: string;
}

/**
 * Put the lines in order (a Parsons problem). Python is the judge: an order
 * that prints the same and ends with the same values is right, too.
 */
export interface OrderItem {
  kind: 'order';
  id: string;
  objective: string;
  prompt?: string;
  /** The program in a right order. Each line is one card; its indent is part of it. */
  code: string;
  /** Answers for input(), one list per run. Default: one run without input. */
  stdin?: string[][];
  /** Shown after the right order. */
  explain: string;
}

/**
 * Trace the code by hand: one row for each line that changes a value of
 * `names` or prints. The learner writes each new value. The real run is
 * the answer key.
 */
export interface TraceItem {
  kind: 'trace';
  id: string;
  objective: string;
  prompt?: string;
  code: string;
  /** The variables to follow: the columns of the table. Global names only. */
  names: string[];
  /** Answers for input(). */
  stdin?: string[];
  /** Shown after the table is right. */
  explain: string;
}

/** Click the line that does something ("Which line changes `total`?"). */
export interface SpotItem {
  kind: 'spot';
  id: string;
  objective: string;
  prompt: string;
  code: string;
  /** The right line (1 is the first line). */
  line: number;
  /** Targeted feedback for wrong lines. */
  wrong?: { line: number; say: string }[];
  explain: string;
}

export type Item = McqItem | PredictItem | DiagnoseItem | OrderItem | TraceItem | SpotItem;

export interface Check {
  /** Python expression. True means the requirement is met. */
  expr: string;
  /** The requirement in plain words (shown in the check list). */
  pass: string;
  /** What to try when the check fails. */
  hint: string;
  misconceptions?: { when: string; say: string }[];
}

/**
 * One answer of the pretend web. `requests` in the page reaches no real
 * server: each URL gets the answer that the lesson gives here.
 */
export interface WebRoute {
  status?: number;
  json?: unknown;
  text?: string;
  /** The request fails before an answer comes. */
  error?: 'Timeout' | 'ConnectionError';
}

/** URL (with or without its query, for example "...?city=Oslo") → answer. */
export type Web = Record<string, WebRoute>;

export interface Case {
  label?: string;
  setup?: string;
  set?: Record<string, unknown>;
  stdin?: string[];
  /** Makes random numbers repeat for this case. */
  seed?: number;
  /** Files in the folder before the run: {"notes.txt": "..."}. */
  files?: Record<string, string>;
  /** Answers of the pretend web for `requests` (see harness.py). */
  web?: Web;
  /** The pretend Raspberry Pi (gpio.py): inputs with their time, and the CPU temperature. */
  gpio?: GpioCase;
}

/** An input on the pretend Raspberry Pi, at a time in seconds. */
export interface GpioInput {
  at: number;
  /** A button or a motion sensor on this GPIO pin. */
  pin?: number;
  press?: boolean;
  motion?: boolean;
  /** A distance sensor (its echo pin), in meters. */
  echo?: number;
  distance?: number;
  /** A light sensor (on `pin`): 0 dark to 1 light. */
  light?: number;
  /** A knob on an MCP3008 channel: 0 to 1. */
  channel?: number;
  analog?: number;
}

export interface GpioCase {
  events?: GpioInput[];
  cpu?: number;
  /** The light on a light sensor at the start (0.6 if not given). */
  light?: number;
  /** The knob of each MCP3008 channel at the start, by channel (0.5 if not given). */
  analog?: Record<string, number>;
}

export interface GpioDevice {
  id: number;
  kind: 'LED' | 'PWMLED' | 'Buzzer' | 'Button' | 'MotionSensor' | 'DistanceSensor' | 'CPUTemperature' | string;
  pins: Record<string, number | null>;
  /** For the LEDs of TrafficLights. */
  color?: string;
  /** MCP3008: the channel. Robot: the ids of its left and right motors. */
  channel?: number;
  left?: number;
  right?: number;
}

/** What a Pi program did, with times: the page plays it back. */
export interface GpioRun {
  devices: GpioDevice[];
  timeline: { t: number; id: number; value: number }[];
  /** The length of the output at a time: what was printed until then. */
  outs: { t: number; pos: number }[];
  inputs: GpioInput[];
  /** done: the program ended. waiting: it waits for an input. cap: stopped after 30 s. */
  end: { t: number; why: 'done' | 'waiting' | 'cap' };
}

interface StepBase {
  id: string;
  objective: string;
  title: string;
}

export interface HookStep extends StepBase {
  type: 'hook';
  question: string;
  code: string;
  beats: { beat: string; line?: number; caption: string }[];
  /** Show the value color legend under the scene. Default: true. */
  legend?: boolean;
}

export interface TheoryStep extends StepBase {
  type: 'theory';
  body: string;
  /** Short facts shown as cards next to the text. */
  keys?: { code: string; means: string }[];
}

export interface PredictStep extends StepBase {
  type: 'predict';
  item: PredictItem;
}

export interface DemoStep extends StepBase {
  type: 'demo';
  /** Which picture the run drives. Default: variables. "none": no picture. "board": a Raspberry Pi. */
  visual?: 'variables' | 'output' | 'none' | 'board';
  /** The code is hidden: the learner only plays the program. */
  sealed?: boolean;
  intro: string;
  code: string;
  /** Files in the folder before each run. */
  files?: Record<string, string>;
  /** Answers of the pretend web for `requests` (see harness.py). */
  web?: Web;
  /** Run the test functions after the program, like pytest, and print the report. */
  pytest?: boolean;
  experiments: { text: string; expr: string }[];
  /**
   * Questions about how the code works. The registry turns them into an
   * "investigate" step right after the demo.
   */
  investigate?: Item[];
}

/** Made by the registry from `DemoStep.investigate`. */
export interface InvestigateStep extends StepBase {
  type: 'investigate';
  items: Item[];
}

export interface WorkedStep extends StepBase {
  type: 'worked';
  problem: string;
  /**
   * `goal` starts a group of lines with a short label ("Get the data").
   * The same labels come back in many examples, so the plan becomes a habit.
   */
  lines: { code: string; note: string; goal?: string }[];
  check: McqItem;
}

export interface ExerciseStep extends StepBase {
  type: 'exercise';
  fade: 'completion' | 'debug' | 'independent' | 'milestone';
  /**
   * Project step: the editor starts with the learner's own code from the
   * step before, so one program grows over several steps.
   */
  carry?: boolean;
  /** Set by the registry for carry steps: id and solution of the step before. */
  prev?: string;
  base?: string;
  prompt: string;
  /** Code that already ran before the learner's code. Shown read-only. */
  given?: string;
  /** Files in the folder before each run (a case can have its own). */
  files?: Record<string, string>;
  /** The pretend web for each run (a case can have its own). */
  web?: Web;
  /** Run the test functions after the program, like pytest, and print the report. */
  pytest?: boolean;
  /** A Raspberry Pi program: show the board, and play the run on it. */
  board?: boolean;
  starter: string;
  solution: string;
  /** Shown after success: why the solution works. */
  after?: string;
  cases?: Case[];
  checks: Check[];
  hints: string[];
}

export interface QuizStep extends StepBase {
  type: 'quiz';
  items: Item[];
}

/** A fast series of items in the middle of a lesson. */
export interface DrillStep extends StepBase {
  type: 'drill';
  items: Item[];
}

/**
 * Work on the learner's own computer. The learner runs public/check.py for
 * a task and pastes its sealed output; the checks are Python expressions
 * over `report` (the facts, all texts).
 */
export interface LocalStep extends StepBase {
  type: 'local';
  prompt: string;
  /** The task name for `python check.py <task>`. */
  task: string;
  /** The lowest version of check.py that knows this task. Default 1. */
  needs?: number;
  checks: Check[];
  hints: string[];
  after?: string;
  /** A passing report, for check-content: the checks must pass on it. */
  example: Record<string, string>;
}

/**
 * One task of a debugger step. With `name`: what is the value of `name` when
 * the program stops on `line` for the `hit`-th time? With `frame`: stop
 * inside a call of that function. With only `line`: stop on that line.
 */
export interface DebugTask {
  do: string;
  line?: number;
  hit?: number;
  name?: string;
  frame?: string;
}

/** A debugger like the one of VS Code, over the real run of `code`. */
export interface DebuggerStep extends StepBase {
  type: 'debugger';
  prompt: string;
  code: string;
  /** Answers for input(), typed by the debugger. */
  stdin?: string[];
  /** Breakpoints that are set at the start. */
  breakpoints?: number[];
  tasks: DebugTask[];
  hints: string[];
  after?: string;
}

/**
 * Work in a pretend Linux terminal (src/py/shell.py). The checks are Python
 * expressions over the shell: exists("notes"), isdir("p"), read("f"),
 * lines("f"), mode("f"), executable("f"), listdir("."), cwd ("~/p"),
 * history, ran("grep"), out (the output of the last command), packages,
 * code (its exit status), vars, run("./x.sh a") (output and exit status of a
 * line, run on a copy), service("ssh") (state, active, enabled, failed),
 * journal("ssh"), procs (the command of every process), boots.
 * Paths in checks are relative to the home directory, /home/pi.
 */
export interface TerminalStep extends StepBase {
  type: 'terminal';
  prompt: string;
  /** The files and folders at the start, and the working directory. */
  start?: ShellState;
  checks: Check[];
  hints: string[];
  /** Commands that solve it: shown on request, and run by check-content. */
  solution: string[];
  after?: string;
}

export interface ReviewStep extends StepBase {
  type: 'review';
  count: number;
}

export type Step =
  | DebuggerStep
  | HookStep
  | TheoryStep
  | PredictStep
  | DemoStep
  | WorkedStep
  | ExerciseStep
  | QuizStep
  | DrillStep
  | InvestigateStep
  | LocalStep
  | TerminalStep
  | ReviewStep;

export interface Lesson {
  id: string;
  order: number;
  title: string;
  summary: string;
  minutes: number;
  outcomes: string[];
  objectives: Objective[];
  steps: Step[];
  /** Cards that enter spaced review when the lesson is finished. */
  review: Item[];
}

export interface CourseLesson {
  id: string;
  title: string;
  kind?: 'lesson' | 'project';
}

export interface CourseModule {
  title: string;
  goal: string;
  lessons: CourseLesson[];
}

/**
 * A path after (or next to) the Python course, like Linux. Its lessons have
 * the order 100 × (place of the path) + their place: 101, 102, ...
 */
export interface CoursePath {
  id: string;
  title: string;
  /** The short name in labels: "Linux 3". */
  short: string;
  goal: string;
  /** Python lessons that must be done, and not weak, before the path opens. */
  needs: string[];
  modules: CourseModule[];
}

export interface Course {
  title: string;
  outcomes: string[];
  modules: CourseModule[];
  paths?: CoursePath[];
}

// ---- Python runner protocol -------------------------------------------------

export interface VarState {
  name: string;
  type: string;
  repr: string;
  /** Only for lists: the first values and the full length. */
  items?: { repr: string; type: string; key?: string }[];
  size?: number;
  /** Only for lists: the identity of the object. Equal refs mean one list. */
  ref?: string;
  /** An object of a class of the learner: `items` are its attributes. */
  object?: boolean;
}

/** A function call that runs, with its own (local) names. */
export interface CallFrame {
  name: string;
  vars: VarState[];
  /** Number of the call: two calls of one function have different numbers. */
  call?: number;
  /** The line that made the call. */
  at?: number | null;
}

export interface TraceStep {
  line: number;
  vars: VarState[];
  /** Length of stdout after this line ran. */
  out: number;
  /** The function calls that run after this line, from the outside in. */
  stack?: CallFrame[];
  /** Set on the step where a function ends: the value it gives back. */
  ret?: { repr: string; type: string } | null;
}

export interface PyError {
  type: string;
  message: string;
  line: number | null;
  traceback: string;
  /** The program called input() and no answer was left. */
  needsInput?: boolean;
}

export interface CheckResult {
  pass: boolean;
  /** Label of the case that failed, if it was not the code as written. */
  case: string | null;
  note: string | null;
}

/** A for-loop started. `values` are what its variable will get, in order. */
export interface FeedEvent {
  /** Number of trace steps recorded when the loop started. */
  at: number;
  line: number;
  values: { repr: string; type: string }[];
}

export interface RunRequest {
  code: string;
  trace?: boolean;
  /** Run the test functions after the program and print a report like pytest. */
  pytest?: boolean;
  cases?: Case[];
  checks?: { expr: string; misconceptions?: { when: string; say: string }[] }[];
}

/** One widget of a window of the pretend tkinter (see harness.py). */
export interface GuiNode {
  id: number;
  kind: 'Frame' | 'Label' | 'Button' | 'Entry' | 'Listbox' | 'Checkbutton' | string;
  /** pack, grid or place; null: not placed, so not shown. */
  manager: 'pack' | 'grid' | 'place' | null;
  layout: Record<string, string | number | boolean | null>;
  style: Record<string, string | number | boolean | null>;
  /** Events with a handler, like "<Return>". */
  keys: string[];
  children: GuiNode[];
  text?: string;
  value?: string;
  secret?: boolean;
  checked?: boolean;
  items?: string[];
  selected?: number[];
}

export interface GuiTree {
  title: string;
  closed: boolean;
  /** mainloop() was called. Without it, a real window closes at once. */
  looping: boolean;
  children: GuiNode[];
  dialogs: { kind: string; title: string; message: string }[];
}

export interface GuiEvent {
  action: 'click' | 'key' | 'select' | 'close';
  id?: number;
  key?: string;
  /** The text of every Entry, by id: the learner may have typed. */
  values?: Record<string, string>;
  selections?: Record<string, number[]>;
}

export interface GuiResult {
  gui: GuiTree | null;
  stdout: string;
  error: PyError | null;
  files?: Record<string, string>;
}

/** The whole pretend Linux: the page keeps it, shell.py changes it. */
export interface ShellState {
  /** Path → text. A path without a leading / is under the home directory (/home/pi). */
  files?: Record<string, string>;
  dirs?: string[];
  modes?: Record<string, string>;
  cwd?: string;
  history?: string[];
  packages?: string[];
  /** Shell variables, and the names that are exported. */
  vars?: Record<string, string>;
  exported?: string[];
  /** Exit status of the last command ($?). */
  last?: number;
  /** Extra processes (a program that uses the CPU, for example). */
  procs?: { pid: number; cmd: string; user?: string; cpu?: number; mem?: number; tty?: string; stubborn?: boolean }[];
  /** Services by name: state, enabled, pid, the loaded unit file... (shell.py owns the shape). */
  services?: Record<string, Record<string, unknown>>;
  /** The journal: [seconds, ident, unit, text, priority]. */
  journal?: unknown[][];
  clock?: number;
  boots?: number;
  nextPid?: number;
  bootAt?: number;
  /** Lesson start only: commands that set the scene, run as root before the first command. */
  setup?: string[];
  /** The real Pi: "weak" makes the power supply too weak (undervoltage). */
  power?: 'good' | 'weak';
  temp?: number;
  /** The password of the user pi (asked by ssh, scp and passwd). */
  password?: string;
  /** Where the commands go: the Pi, or PowerShell on your PC. via: logged in over SSH. */
  at?: 'pi' | 'pc';
  via?: boolean;
  /** Your PC: files (paths with \ under C:\Users\you), folders, the working folder, known SSH hosts. */
  pc?: { files?: Record<string, string>; dirs?: string[]; cwd?: string; history?: string[]; known?: string[] };
  /** A question that waits for the next line (shell.py owns the shape). */
  pending?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ShellRequest {
  state: ShellState;
  line?: string;
  /** Text saved in the editor (nano). root: nano was started with sudo. */
  write?: { path: string; text: string; root?: boolean };
  /** Python expressions over the state (see shell.py check_env). */
  checks?: string[];
}

export interface ShellResult {
  out: string;
  code: number;
  state: ShellState;
  prompt: string;
  clear: boolean;
  editor: { path: string; name: string; text: string; root?: boolean } | null;
  /** A question for the next line, like a password (secret: nothing is shown while typing). */
  ask?: { text: string; secret: boolean } | null;
  /** Where the next command goes: "pi" or "pc". */
  host?: string;
  checks: boolean[];
}

export interface RunResult {
  /** The window of the program (pretend tkinter), if it made one. */
  gui?: GuiTree | null;
  stdout: string;
  error: PyError | null;
  vars: VarState[];
  steps: TraceStep[];
  /** Only with trace: one event for each start of a for-loop. */
  feeds?: FeedEvent[];
  checks: CheckResult[];
  /** The text files in the folder after the run (first case). */
  files?: Record<string, string>;
  /** A program that used gpiozero: its devices and timeline (first case). */
  gpio?: GpioRun | null;
  /** A program that used matplotlib.pyplot: its figures (first case). */
  plot?: ChartFigure[] | null;
  /** The Flask app of the program (src/py/server.py), or null. */
  server?: ServerInfo | null;
}

/** A Flask app of a run. `served`: the program called app.run(). */
export interface ServerInfo {
  served: boolean;
  host: string;
  port: number;
  debug: boolean;
  name: string;
  routes: { rule: string; methods: string[] }[];
  key: number;
}

/** A request from the page's browser to the app of the last run. */
export interface WebRequest {
  method: string;
  /** Path and query, like "/hello?name=Ann". */
  path: string;
  form?: Record<string, string>;
  json?: unknown;
}

export interface WebResult {
  /** 0: there was no app to answer, or the request was stopped. */
  status: number;
  reason?: string;
  headers?: [string, string][];
  /** The type of the body without charset, like "text/html". */
  type?: string;
  body?: string;
  cut?: boolean;
  location?: string | null;
  /** What the app's own code printed while it answered. */
  stdout: string;
  /** The line of the server log for this request. */
  log: string;
  error: PyError | null;
}

/** One series of a chart (src/py/plot.py). */
export interface ChartSeries {
  kind: 'line' | 'scatter' | 'bar' | 'hist';
  /** Numbers, or the names of the bars. */
  x?: (number | string)[];
  y: number[];
  /** hist: the borders of the bins. */
  edges?: number[];
  color: string;
  /** scatter: one colour per point. */
  colors?: string[] | null;
  marker?: string | null;
  style?: string | null;
  label?: string | null;
}

/** One figure: what plt.show() draws. */
export interface ChartFigure {
  title: string;
  xlabel: string;
  ylabel: string;
  series: ChartSeries[];
  lines: { y: number; color: string; style?: string; label?: string | null }[];
  legend: boolean;
  grid: boolean;
  xlim: [number, number] | null;
  ylim: [number, number] | null;
  shown: boolean;
}
