// Splits a command line from a setting (EDITOR, BROWSER, a config key) into words; double or
// single quotes keep a path with spaces together, like "C:\Program Files\…\chrome.exe".
// There are no escapes, so Windows backslashes pass through untouched.
export function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "")
}
