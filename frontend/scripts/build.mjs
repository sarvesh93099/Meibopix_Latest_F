// Build without recursively deleting OneDrive directories, then prune stale generated chunks.
import { build } from 'vite'
import { chmod, readdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = await build({ root, build: { emptyOutDir: false } })
const generated = new Set((Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output.map(item => item.fileName)))
const resolvedRoot = await realpath(root)
const dist = await realpath(path.join(root, 'dist'))
if (path.relative(resolvedRoot, dist).startsWith('..')) throw new Error('Build output must be inside this frontend project.')
let originalBytes = 0, compressedBytes = 0
async function precompress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) { await precompress(target); continue }
    if (!entry.isFile() || !/\.(?:html|js|css|svg|json)$/.test(entry.name)) continue
    const relativeFile = path.relative(dist, target).split(path.sep).join('/')
    if (relativeFile.startsWith('assets/') && /-[a-f0-9]{8}\./.test(entry.name) && !generated.has(relativeFile)) continue
    const content = await readFile(target)
    if (content.length < 512) continue
    const compressed = gzipSync(content, { level: 9 })
    if (compressed.length >= content.length * 0.9) continue
    await writeFile(`${target}.gz`, compressed)
    generated.add(path.relative(dist, `${target}.gz`).split(path.sep).join('/'))
    originalBytes += content.length
    compressedBytes += compressed.length
  }
}
await precompress(dist)
console.log(`Precompressed text assets: ${originalBytes} bytes -> ${compressedBytes} bytes.`)
const assets = await realpath(path.join(root, 'dist', 'assets'))
const relative = path.relative(resolvedRoot, assets)
if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Build assets must be inside this frontend project.')
let removed = 0
for (const entry of await readdir(assets, { withFileTypes: true })) {
  // Preserve arbitrary files and directories; only old Vite hash-named outputs qualify.
  if (!entry.isFile() || !/-[a-f0-9]{8}\.(?:js|css|svg|png|jpg|webp)(?:\.gz)?$/.test(entry.name) || generated.has(`assets/${entry.name}`)) continue
  const target = path.resolve(assets, entry.name)
  if (path.dirname(target) !== assets) throw new Error('Invalid generated asset path.')
  try {
    try { await unlink(target) } catch (error) {
      if (!['EPERM', 'EACCES'].includes(error.code)) throw error
      await chmod(target, 0o666)
      await unlink(target)
    }
    removed++
  } catch (error) {
    console.warn(`Built successfully; locked old asset retained: ${entry.name} (${error.code})`)
  }
}
console.log(`Removed ${removed} obsolete build assets.`)
