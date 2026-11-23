// Plain-language explanations of Python errors. The real traceback is always
// shown next to these: the goal is to teach how to read it, not to hide it.
import type { PyError } from '@/engine/types';

interface Explanation {
  what: string;
  tryThis: string;
}

const BY_TYPE: Record<string, Explanation> = {
  NameError: {
    what: 'Python does not know this name.',
    tryThis: 'Check the spelling. Check that the variable is created on an earlier line.',
  },
  SyntaxError: {
    what: 'Python cannot read this line. The grammar of the code is wrong.',
    tryThis: 'Look at the marked line. Check quotes, brackets and missing symbols.',
  },
  IndentationError: {
    what: 'The spaces at the start of a line are wrong.',
    tryThis: 'Lines at the same level must start in the same column.',
  },
  TypeError: {
    what: 'An operation got a value of the wrong type.',
    tryThis: 'Check the types. For example, text and a number cannot be added.',
  },
  ValueError: {
    what: 'The type is right, but the value is not accepted.',
    tryThis: 'Check the value that goes into the function on this line.',
  },
  ZeroDivisionError: {
    what: 'The code divides by zero.',
    tryThis: 'Check the value on the right side of the division.',
  },
  IndexError: {
    what: 'The position does not exist in this sequence.',
    tryThis: 'Positions start at 0. The last one is the length minus 1.',
  },
  KeyError: {
    what: 'This key does not exist in the dictionary.',
    tryThis: 'Check the spelling of the key and the keys that exist.',
  },
  AttributeError: {
    what: 'This value does not have that attribute or method.',
    tryThis: 'Check the type of the value and the spelling after the dot.',
  },
  JSONDecodeError: {
    what: 'This text is not correct JSON, so json cannot read it.',
    tryThis: 'JSON needs double quotes, and true, false and null in small letters. The message names the line and the column. Make JSON text with json.dumps, not with str().',
  },
  FileNotFoundError: {
    what: 'There is no file with this name in this place.',
    tryThis: 'Check the name and the folder in the message. path.exists() tells you if the file is there.',
  },
  IsADirectoryError: {
    what: 'This path is a folder, not a file.',
    tryThis: 'Add the name of a file to the path, for example folder / "notes.txt".',
  },
  ModuleNotFoundError: {
    what: 'Python cannot find a module with this name.',
    tryThis: 'Check the spelling, for example math, random, datetime. A module that is not part of Python must be installed first.',
  },
  AssertionError: {
    what: 'A test with assert found a wrong result.',
    tryThis: 'The marked line is the test. Call the function it tests with the same values and look at the result.',
  },
  EOFError: {
    what: 'The program asked for input, but there was none.',
    tryThis: 'Call input() only as many times as the task needs.',
  },
  Timeout: {
    what: 'The program did not stop.',
    tryThis: 'Look for a loop that never ends.',
  },
  TclError: {
    what: 'tkinter does not know this option or value.',
    tryThis: 'Check the name of the option in the message: for example text, fg, bg, font, width, command.',
  },
  // requests (the real one on a computer, and the pretend web in the page)
  ConnectionError: {
    what: 'The request reached no server: no internet, or a wrong address.',
    tryThis: 'Check the address in the message. In a program, catch requests.ConnectionError and tell the user that the server cannot be reached.',
  },
  ReadTimeout: {
    what: 'The server did not answer in time.',
    tryThis: 'Catch requests.Timeout and tell the user to try again later. Always give requests.get a timeout.',
  },
  HTTPError: {
    what: 'The server answered with an error code, for example 404 (not found) or 500 (server error).',
    tryThis: 'raise_for_status() raised it. Check the address and the parameters, or catch requests.HTTPError and show a clear message.',
  },
};

/** Errors whose meaning depends on the message, not only on the type. */
const BY_MESSAGE: { type: string; pattern: RegExp; explain: Explanation }[] = [
  {
    // A method without self: Python passes the object, the def takes nothing.
    type: 'TypeError',
    pattern: /takes 0 positional arguments but 1 was given/,
    explain: {
      what: 'A method was called on an object, but its def line has no self. Python always passes the object as the first value.',
      tryThis: 'Write self first in the def line of the method, for example def click(self):',
    },
  },
  {
    // A dataclass field with a list (or dict, set) as its default.
    type: 'ValueError',
    pattern: /mutable default .* use default_factory/,
    explain: {
      what: 'A dataclass cannot use a list, dictionary or set as a default: all objects would share it.',
      tryThis: 'Write field(default_factory=list), and import field: from dataclasses import dataclass, field',
    },
  },
  {
    // __str__ printed the text instead of returning it.
    type: 'TypeError',
    pattern: /__str__ returned non-string/,
    explain: {
      what: '__str__ must give back a text, but it gave back something else, often None.',
      tryThis: 'In __str__, write return f"..." instead of print(...). A function without return gives back None.',
    },
  },
  {
    // A class without __init__ (often a typo like __int__ or _init_).
    type: 'TypeError',
    pattern: /\(\) takes no arguments/,
    explain: {
      what: 'The class has no __init__, so it cannot take values when you make an object.',
      tryThis: 'Check the name of __init__: two underscores, init, two underscores.',
    },
  },
  {
    // missing 1 required positional argument / takes 1 positional argument
    // but 2 were given / got an unexpected keyword argument /
    // sorted expected 1 argument, got 2 / len() takes exactly one argument
    type: 'TypeError',
    pattern: /positional argument|keyword argument|expected (at most )?\d+ arguments?, got|takes (exactly )?(no|one|\d+) arguments?/,
    explain: {
      what: 'The call does not match the function. The number or the names of the values are wrong.',
      tryThis: 'Compare the call with the def line: one value for each parameter, and the same names.',
    },
  },
  {
    // Often a name of a built-in function was used for a value: sum = 0, list = [...].
    type: 'TypeError',
    pattern: /object is not callable/,
    explain: {
      what: 'The code calls a value with ( ), but the value is not a function. Often a variable has the name of a function, like sum = 0 or list = [...]: then the name points at the value, not at the function.',
      tryThis: 'Look at the name before the ( . If your code gives that name a value, choose another name, like total instead of sum. Also check for a missing * : 3(x + 1) must be 3 * (x + 1).',
    },
  },
  {
    type: 'TypeError',
    pattern: /is not JSON serializable/,
    explain: {
      what: 'JSON cannot hold a value of this type.',
      tryThis: 'JSON knows dictionaries, lists, texts, numbers, True, False and None. Turn other values into one of these first, for example a set into a list.',
    },
  },
  {
    type: 'JSONDecodeError',
    pattern: /requests\.exceptions\.JSONDecodeError/,
    explain: {
      what: 'The answer of the server is not JSON, so .json() cannot read it.',
      tryThis: 'Check status_code first: an error page is often HTML. print(response.text) shows what came back.',
    },
  },
  {
    type: 'NameError',
    pattern: /forget to import/,
    explain: {
      what: 'This name is a module, but the program never imported it.',
      tryThis: 'Add the import at the top of the program, for example import math.',
    },
  },
  {
    type: 'UnboundLocalError',
    pattern: /./,
    explain: {
      what: 'The function changes a name that it also reads. So Python treats the name as a name of the call, and it has no value yet.',
      tryThis: 'Give the value to the function as a parameter, and give the new value back with return.',
    },
  },
];

export function explainError(error: PyError): Explanation & { where: string } {
  // Python adds hints such as "Did you forget to import 'math'?" only to the traceback.
  const text = `${error.message}
${error.traceback}`;
  const special = BY_MESSAGE.find((m) => m.type === error.type && m.pattern.test(text));
  const base = special?.explain ?? BY_TYPE[error.type] ?? {
    what: 'Python stopped because of an error.',
    tryThis: 'Read the last line of the message. It names the problem.',
  };
  // An error in another file of the learner (a module of a project) names that file.
  const where =
    error.at && error.at.file !== 'main.py'
      ? `${error.at.file}, line ${error.at.line}`
      : error.line
        ? `Line ${error.line}`
        : 'Your code';
  return { ...base, where };
}
