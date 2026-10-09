// Change only the edited range so live output and external saves preserve the
// current cursor/selection. Echoes of the user's own edit need no transaction.
export function textChange(previous: string, next: string) {
  if (previous === next) return null
  let from = 0
  const length = Math.min(previous.length, next.length)
  while (from < length && previous[from] === next[from]) from++
  let oldEnd = previous.length, newEnd = next.length
  while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd-- }
  return { from, to: oldEnd, insert: next.slice(from, newEnd) }
}

// Logs are text, never HTML. Strip terminal control sequences (including OSC
// hyperlinks), while keeping printable output available for selection/copy.
export function readableLog(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}
