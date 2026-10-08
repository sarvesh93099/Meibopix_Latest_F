// Catch undefined references in large UI modules, including rarely visited tool tabs.
// Babel is already supplied by the project's Vite React build plugin.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from '@babel/core'
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default || traverseModule
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const globals = new Set(`
  undefined Infinity NaN arguments globalThis window self document navigator location screen
  localStorage sessionStorage console performance crypto history devicePixelRatio
  Object Function Boolean Symbol Error AggregateError EvalError RangeError ReferenceError
  SyntaxError TypeError URIError Number BigInt Math Date String RegExp Array JSON Promise
  Map Set WeakMap WeakSet WeakRef FinalizationRegistry Reflect Proxy Intl WebAssembly
  ArrayBuffer SharedArrayBuffer DataView Atomics Int8Array Uint8Array Uint8ClampedArray
  Int16Array Uint16Array Int32Array Uint32Array Float32Array Float64Array BigInt64Array BigUint64Array
  parseInt parseFloat isFinite isNaN decodeURI decodeURIComponent encodeURI encodeURIComponent
  eval escape unescape setTimeout clearTimeout setInterval clearInterval queueMicrotask
  requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
  atob btoa structuredClone fetch alert confirm prompt matchMedia addEventListener removeEventListener
  File Blob FormData FileReader Image ImageData Path2D URL URLSearchParams Audio
  HTMLElement HTMLCanvasElement HTMLVideoElement HTMLImageElement CanvasRenderingContext2D
  ResizeObserver MutationObserver IntersectionObserver MediaRecorder MediaStream ImageCapture
  AbortController AbortSignal DOMException CustomEvent Event EventTarget EventSource WebSocket Worker
  TextEncoder TextDecoder OffscreenCanvas createImageBitmap Option
`.trim().split(/\s+/))

const findSourceFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const absolutePath = path.join(directory, entry.name)
  return entry.isDirectory() ? findSourceFiles(absolutePath) : /\.(js|jsx|mjs)$/.test(entry.name) ? [absolutePath] : []
})

const findings = []
const files = findSourceFiles(sourceRoot)
for (const file of files) {
  let ast
  try {
    ast = parseSync(fs.readFileSync(file, 'utf8'), { filename: file, sourceType: 'module', configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } })
  } catch (error) {
    findings.push(`${path.relative(sourceRoot, file)}: ${error.message}`)
    continue
  }
  const reported = new Set()
  traverse(ast, {
    ReferencedIdentifier(reference) {
      const name = reference.node.name
      if (globals.has(name) || reference.scope.hasBinding(name, true)) return
      // Lowercase JSX names represent native HTML elements, not JavaScript variables.
      if (reference.isJSXIdentifier() && /^[a-z]/.test(name)) return
      const key = `${name}:${reference.node.loc?.start.line}`
      if (reported.has(key)) return
      reported.add(key)
      findings.push(`${path.relative(sourceRoot, file)}:${reference.node.loc?.start.line || '?'}: undefined reference "${name}"`)
    }
  })
}

if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Checked ${files.length} frontend source files: no undefined references.\n`)
}
