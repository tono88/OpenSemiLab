import type { ProjectFile } from './projectStore'

const encoder = new TextEncoder()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function header(size: number, fields: [number, number, number][]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  for (const [offset, value, width] of fields) {
    if (width === 2) view.setUint16(offset, value, true)
    else view.setUint32(offset, value, true)
  }
  return bytes
}

/** Dependency-free ZIP (stored entries): exact UTF-8 source files, no secrets.
 * Reject path traversal and duplicate entries before users extract the ZIP.
 */
export function createProjectArchive(files: ProjectFile[]): Uint8Array<ArrayBuffer> {
  if (!files.length || files.length > 1000) throw new Error('Invalid archive file count')
  const entries: Uint8Array[] = [], directory: Uint8Array[] = []
  const paths = new Set<string>()
  let offset = 0, directorySize = 0
  for (const file of files) {
    if (typeof file.path !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(file.path) || file.path.startsWith('/') || file.path.split('/').some(part => ['', '.', '..'].includes(part)) || paths.has(file.path)) throw new Error('Unsafe or duplicate source path')
    if (typeof file.content !== 'string') throw new Error('Source content must be text')
    paths.add(file.path)
    const name = encoder.encode(file.path), data = encoder.encode(file.content), crc = crc32(data)
    if (name.length > 65535 || offset + data.length > 32_000_000) throw new Error('Source archive too large')
    // UTF-8 flag, STORE, fixed 1980-01-01 timestamp for reproducible exports.
    const local = header(30, [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [12, 33, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2]])
    const central = header(46, [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [14, 33, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, offset, 4]])
    entries.push(local, name, data)
    directory.push(central, name)
    offset += local.length + name.length + data.length
    directorySize += central.length + name.length
  }
  const end = header(22, [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, directorySize, 4], [16, offset, 4]])
  const archive = new Uint8Array(offset + directorySize + end.length)
  let cursor = 0
  for (const chunk of [...entries, ...directory, end]) { archive.set(chunk, cursor); cursor += chunk.length }
  return archive
}
