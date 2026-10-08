// End-to-end checks using the installed Chrome DevTools protocol; no new runtime dependency.
// Run: node scripts/browser-smoke.mjs. CHROME_PATH may override the Windows default.
import { createServer, preview } from 'vite'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { EXAM_LAYOUT_VIEWPORTS, examGeometryExpression, assertExamGeometry } from './check-exam-layout.mjs'
import { GUEST_DATA_KEY } from '../src/features/demo/session.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, '..', 'artifacts')
const profile = await mkdtemp(path.join(tmpdir(), 'meibopix-browser-'))
const port = Number(process.env.SMOKE_PORT || 3004)
const production = process.env.SMOKE_PRODUCTION === '1'
const server = production
  ? await preview({ root, logLevel: 'silent', preview: { host: '127.0.0.1', port, strictPort: true } })
  : await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port, strictPort: true } })
let chrome, socket
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const pending = new Map()
const exceptions = []
const apiRequests = []
const resourceRequests = []
const downloads = []
const guestNetworkPaths = new Set([
  '/api/guest/meibography/status',
  '/api/guest/meibography/warmup',
  '/api/guest/meibography/analyze',
  '/api/guest/meibography/enhance',
  '/api/guest/meibography/tear-meniscus'
])
let nextId = 0

async function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result) }, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result?.value
}
async function until(expression, description, timeout = 12000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return
    await pause(100)
  }
  throw new Error(`Page did not show ${description}: ${await evaluate('document.body.innerText')}`)
}
async function navigate(route) {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}${route}` })
  await until('document.readyState === "complete"', route)
}
async function screenshot(name) {
  await pause(200)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(path.join(output, name), Buffer.from(data, 'base64'))
}
async function clickText(text) {
  await evaluate(`(() => { const control = [...document.querySelectorAll('button,a')].find(el => el.textContent.includes(${JSON.stringify(text)})); if (!control) throw new Error('Missing control'); control.click(); })()`)
}
async function fillControl(selector, value) {
  await evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    if (!control) throw new Error('Missing input: ' + ${JSON.stringify(selector)});
    const prototype = control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, ${JSON.stringify(value)});
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
  })()`)
}
async function pressEnter() {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
}
const guestReportExpression = `JSON.parse(sessionStorage.getItem(${JSON.stringify(GUEST_DATA_KEY)}) || '{}').results?.filter(report => report.kind === 'report') || []`
async function selectSamplePatient() {
  await until('document.querySelector("#patient-select")?.options.length > 1', 'sample patient selection')
  await evaluate('(() => { const select = document.querySelector("#patient-select"); select.value = select.options[1].value; select.dispatchEvent(new Event("change", {bubbles:true})); })()')
  await until('!!document.querySelector(".meibography-patient-name")', 'selected patient details')
  // Patient selection intentionally resets the previous person's unsaved answers.
  await pause(100)
}
async function saveGuestReport(testType, selector = '#save-report-btn') {
  const previousCount = await evaluate(`(${guestReportExpression}).length`)
  await until(`document.querySelector(${JSON.stringify(selector)})?.disabled === false`, `${testType} report save action`)
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  await until(`(${guestReportExpression}).length === ${previousCount + 1}`, `${testType} report persisted`)
  await until('document.body.innerText.includes("Report saved to dashboard.")', `${testType} saved confirmation`)
  const report = await evaluate(`(${guestReportExpression})[0]`)
  assert.ok(report.completed_tests.includes(testType), `${testType} must be listed in saved results`)
  assert.equal(report.guest_session, true, 'Entered guest results must retain the guest session marker')
  assert.equal(report.demo_sample, false, 'Entered guest results must be distinguished from fictional seed reports')
  return report
}
function assertGuestNetworkIsolation(requests) {
  for (const request of requests) {
    const url = new URL(request)
    assert.equal(url.origin, `http://127.0.0.1:${port}`, 'Guest image requests must stay on the website origin')
    assert.ok(guestNetworkPaths.has(url.pathname), `Guest network request escaped image-analysis allowlist: ${url.pathname}`)
  }
}
async function checkNoOverflow(label) {
  const sizes = await evaluate('({width:innerWidth, document:document.documentElement.scrollWidth})')
  assert.ok(sizes.document <= sizes.width + 1, `${label} horizontal overflow: ${JSON.stringify(sizes)}`)
}

try {
  await mkdir(output, { recursive: true })
  if (!production) await server.listen()
  chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=9229', `--user-data-dir=${profile}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' })
  chrome.on('error', error => { console.error(error.message) })
  let targets
  for (let attempt = 0; attempt < 100; attempt++) {
    try { targets = await fetch('http://127.0.0.1:9229/json/list').then(response => response.json()); if (targets.length) break } catch {}
    await pause(100)
  }
  assert.ok(targets?.length, 'Chrome remote debugging must start')
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const task = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) task?.reject(new Error(message.error.message)); else task?.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    else if (message.method === 'Browser.downloadWillBegin') downloads.push(message.params)
    else if (message.method === 'Network.requestWillBeSent') {
      resourceRequests.push(message.params.request.url)
      if (/\/api\//.test(message.params.request.url)) apiRequests.push(message.params.request.url)
    }
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  const downloadDirectory = path.join(output, 'downloads')
  await mkdir(downloadDirectory, { recursive: true })
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory, eventsEnabled: true })
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  await navigate('/login')
  await until('!!document.querySelector(".login-guest-btn")', 'guest sign-in')
  await pause(200)
  assert.deepEqual(resourceRequests.filter(url => /(?:reporting-|report-capture-|vision-|clinical-)/.test(url)), [], 'Login must not download optional vision, reporting, or clinical styles')
  assert.deepEqual(resourceRequests.filter(url => /(?:dashboard-|Layout-).*\.css/.test(url)), [], 'Login must not download dashboard or workspace styles')
  assert.deepEqual(resourceRequests.filter(url => /fonts\.googleapis|fonts\.gstatic/.test(url)), [], 'No external font downloads')
  await screenshot('login-desktop.png')
  const guestRequestsStart = apiRequests.length
  await clickText('Explore as a guest')
  await until('!!document.querySelector(".home-hero")', 'guest home')
  await checkNoOverflow('desktop home')
  await screenshot('home-desktop.png')

  await clickText('Try the blink test')
  await until('!!document.querySelector("#blink-manual-count")', 'blink test deep link')
  assert.match(await evaluate('document.querySelector(".exam-guide h2").textContent'), /Count my blinks/)
  await clickText('Show my blink rate')
  await until('document.querySelector(".ocular-analysis-metrics")?.textContent.includes("18")', '9 blinks in 30 seconds = 18 per minute')
  await screenshot('blink-desktop.png')
  console.log('PASS guest blink deep link and camera-free rate calculation')

  await selectSamplePatient()
  assert.match(await evaluate('document.querySelector(".exam-guide h2").textContent'), /Count my blinks/, 'Choosing a patient must preserve the selected test')
  await clickText('Show my blink rate')
  const blinkReport = await saveGuestReport('Blink Rate Evaluation')
  assert.match(blinkReport.left_analysis, /18\.0 blinks\/min/)
  // Keep SPA memory alive so the created PDF blob remains available.
  await evaluate('document.querySelector(".meibography-brand-chip").click()')
  await until('!!document.querySelector(".tool-library")', 'eye test library')
  await evaluate(`document.querySelector('a[href="/tests"]').click()`)
  await until('document.querySelectorAll(".tests-row:not(.tests-row-header)").length === 3', 'saved report in library')
  assert.ok(await evaluate(`!!document.querySelector('a[href^="blob:"]')`), 'Guest-generated report must open its local PDF')
  await clickText('View results')
  await until('document.querySelector(".report-result-detail")?.textContent.includes("18.0 blinks/min")', 'entered blink results displayed')
  assert.equal(await evaluate('document.querySelector(".tests-action-button[aria-expanded]").getAttribute("aria-expanded")'), 'true')
  await navigate('/tests')
  await until('document.querySelectorAll(".tests-row:not(.tests-row-header)").length === 3', 'guest report survives reload')
  await until('!![...document.querySelectorAll("button")].find(control => control.textContent.includes("Download PDF"))', 'guest PDF regeneration after reload')
  const previousDownloads = downloads.length
  await clickText('Download PDF')
  await until('!![...document.querySelectorAll("button")].find(control => control.textContent.includes("Download PDF") && !control.disabled)', 'guest PDF generation finishes')
  for (let attempt = 0; attempt < 30 && downloads.length === previousDownloads; attempt++) await pause(100)
  assert.ok(downloads.length > previousDownloads, 'Guest report PDF must download after page reload')
  assert.match(downloads.at(-1).suggestedFilename, /\.pdf$/i)
  await clickText('View results')
  await until('document.querySelector(".report-result-detail")?.textContent.includes("18.0 blinks/min")', 'reloaded guest result summary retained')
  await evaluate('document.querySelector(".guest-banner button").click()')
  await until('document.querySelectorAll(".tests-row:not(.tests-row-header)").length === 2', 'demo reset restores original reports')
  console.log('PASS guest report generation, expandable results, PDF regeneration after reload, test selection, and reset')

  await navigate('/tools')
  await until('document.querySelectorAll(".library-card").length === 8', '8 eye tests')
  await evaluate('([...document.querySelectorAll(".tools-filter")].find(control => control.textContent.includes("Questionnaires"))).focus()')
  await pressEnter()
  await until('document.querySelectorAll(".library-card").length === 2 && document.querySelector(".tools-filter.is-active")?.textContent.includes("Questionnaires")', 'keyboard questionnaire category selection')
  await clickText('Clinical records')
  await until('document.querySelectorAll(".library-card").length === 2 && document.querySelector(".tools-filter.is-active")?.textContent.includes("Clinical records")', 'clinical record category')
  await clickText('Camera & images')
  await until('document.querySelectorAll(".library-card").length === 4', 'four image and camera tests')
  await clickText('All tests')
  await evaluate(`document.querySelector('[aria-label="Search eye tests"]').focus()`)
  await send('Input.insertText', { text: 'blink' })
  await until('document.querySelectorAll(".library-card").length === 1 && document.querySelector(".library-card h2")?.textContent.includes("Count my blinks")', 'interactive eye test search')
  await evaluate('document.querySelector(".library-card").focus()')
  await pressEnter()
  await until('!!document.querySelector("#blink-manual-count") && location.search.includes("blink-rate")', 'keyboard test link navigation')
  await navigate('/tools')
  await until(`!!document.querySelector('[aria-label="Search eye tests"]')`, 'test search')
  await fillControl('[aria-label="Search eye tests"]', 'missing-test-example')
  await until('!!document.querySelector(".simple-empty") && !document.querySelector(".library-card")', 'test search empty state')
  await evaluate(`document.querySelector('[aria-label="Clear search"]').focus()`)
  await pressEnter()
  await until('document.querySelectorAll(".library-card").length === 8', 'keyboard clear search')
  console.log('PASS category filtering, responsive search, empty state, and keyboard test navigation')

  await navigate('/eye-test/meibography?section=deq')
  await until('document.querySelectorAll(".deq-question-block").length === 5', 'DEQ questionnaire')
  await selectSamplePatient()
  const zeroDeqReport = await saveGuestReport('DEQ')
  assert.match(zeroDeqReport.left_analysis, /DEQ:\s*0\b/, 'Completed zero-score questionnaires must appear in saved results')
  await navigate('/tests')
  await until('document.querySelectorAll(".tests-row:not(.tests-row-header)").length === 3', 'zero-score DEQ report')
  await clickText('View results')
  await until('document.querySelector(".report-result-detail")?.textContent.match(/DEQ:\\s*0\\b/)', 'zero-score DEQ readout')

  await navigate('/eye-test/meibography?section=deq')
  await until('document.querySelectorAll(".deq-question-block").length === 5', 'DEQ answers')
  await selectSamplePatient()
  for (const [index, value] of [1, 2, 3, 4, 0].entries()) {
    await evaluate(`(() => { const question = document.querySelectorAll('.deq-question-block')[${index}]; [...question.querySelectorAll('button')].find(control => control.querySelector('.deq-response-score').textContent === '${value}').click(); })()`)
  }
  await until('document.querySelector(".deq-summary-grid .clinical-test-summary-card strong")?.textContent === "10"', 'DEQ total 10')
  assert.equal(await evaluate('Number(document.querySelectorAll(".deq-summary-grid .clinical-test-summary-card strong")[1].textContent)'), 2)
  const deqReport = await saveGuestReport('DEQ')
  assert.match(deqReport.left_analysis, /DEQ:\s*10\b/)

  await navigate('/eye-test/meibography?section=osdi')
  await until('document.querySelectorAll(".osdi-row").length === 12', 'OSDI questionnaire')
  await selectSamplePatient()
  for (let index = 0; index < 12; index++) {
    const value = [5, 6].includes(index) ? 'NA' : '1'
    await evaluate(`(() => { const question = document.querySelectorAll('.osdi-row')[${index}]; [...question.querySelectorAll('button')].find(control => control.querySelector('.osdi-choice-value').textContent === '${value}').click(); })()`)
  }
  await until('Number(document.querySelector(".osdi-score-summary-card strong")?.textContent) === 25', 'OSDI score 25 excluding two NA answers')
  assert.equal(await evaluate('document.querySelectorAll(".osdi-formula-line .osdi-score-box")[1].textContent'), '10')
  const osdiReport = await saveGuestReport('OSDI')
  assert.match(osdiReport.left_analysis, /OSDI:\s*25\b/)

  await navigate('/eye-test/meibography?section=contrast-sensitivity')
  await until('!!document.querySelector(".contrast-setup-proceed")', 'contrast test setup')
  await selectSamplePatient()
  await clickText('Proceed')
  await until('document.querySelectorAll(".clinical-test-table-row").length === 4', 'contrast value table')
  for (const column of ['a', 'b', 'c', 'd']) await fillControl(`[name="contrast-od_pre-${column}"]`, '10')
  await until('document.querySelector(".clinical-test-table-metric")?.textContent === "0.778"', 'calculated AULCSF 0.778')
  const contrastReport = await saveGuestReport('Contrast Sensitivity')
  assert.match(contrastReport.right_analysis, /Contrast Sensitivity: pre 0\.778/)

  await navigate('/eye-test/meibography?section=posterior-segment')
  await until(`!!document.querySelector('[name="posterior-report"]')`, 'posterior report fields')
  await selectSamplePatient()
  await fillControl('[name="posterior-report"]', 'Guest smoke posterior observation')
  await fillControl('[name="posterior-impression"]', 'Reviewed findings')
  const posteriorReport = await saveGuestReport('Posterior Segment')
  assert.match(posteriorReport.left_analysis, /Guest smoke posterior observation/)
  assert.match(posteriorReport.left_analysis, /Reviewed findings/)

  await navigate('/eye-test/meibography?section=bulbar-redness')
  await until('!!document.querySelector(".bulbar-redness-gallery")', 'redness reference scale')
  await selectSamplePatient()
  await evaluate('document.querySelector(\'[role="radio"][aria-label="3. MODERATE"]\').click()')
  assert.equal(await evaluate('document.querySelector(\'[role="radio"][aria-label="3. MODERATE"]\').getAttribute("aria-checked")'), 'true')
  const rednessReport = await saveGuestReport('Bulbar Redness Analysis', '.bulbar-redness-save-btn')
  assert.match(rednessReport.left_analysis, /Bulbar Redness:\s*Moderate/i)
  await navigate('/tests')
  await until('!!document.querySelector(".tests-row:not(.tests-row-header)")', 'saved clinical reports')
  await clickText('View results')
  await until('document.querySelector(".report-result-detail")?.textContent.match(/Bulbar Redness:\\s*Moderate/i)', 'redness result displayed')
  await evaluate('document.querySelector(".guest-banner button").click()')
  await until('document.querySelectorAll(".tests-row:not(.tests-row-header)").length === 2', 'clinical test reset')
  console.log('PASS guest DEQ (including zero score), OSDI with NA, contrast calculations, posterior notes, redness grades, and saved results')

  for (const section of ['deq', 'osdi', 'contrast-sensitivity', 'posterior-segment', 'bulbar-redness', 'tear-meniscus', 'meibography']) {
    await navigate(`/eye-test/meibography?section=${section}`)
    await until(`!!document.querySelector('.exam-guide') && location.search.includes(${JSON.stringify(section)})`, `${section} test`)
    await pause(300)
    assert.ok(!(await evaluate('document.body.innerText')).includes('This page needs a fresh start.'), `${section} must render`)
  }
  console.log('PASS all 8 test sections render without runtime crashes')

  await navigate('/patients')
  await until('document.querySelectorAll(".table-row").length === 3', '3 fictional patients')
  await screenshot('patients-desktop.png')
  await clickText('See details')
  await until('!!document.querySelector(".patient-details-name")', 'sample patient details')
  await navigate('/tests')
  await until('document.querySelectorAll(".tests-row:not(.tests-row-header)").length === 2', 'sample reports')
  assert.ok(await evaluate('!![...document.querySelectorAll("button")].find(el => el.textContent.includes("Sample PDF"))'))
  await navigate('/settings')
  await until('document.body.innerText.includes("Fictional sample data")', 'guest account label')
  await navigate('/admin')
  await until('location.pathname === "/home"', 'guest admin redirect')
  assertGuestNetworkIsolation(apiRequests.slice(guestRequestsStart))
  console.log('PASS guest patient/report privacy and administrator isolation; only stateless image endpoints may reach the server')

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await navigate('/home')
  await until('!!document.querySelector(".home-hero")', 'mobile home')
  await checkNoOverflow('mobile home')
  await screenshot('home-mobile.png')
  await evaluate('document.querySelector(".workspace-menu").click()')
  await until('!!document.querySelector(".workspace-sidebar.is-open")', 'mobile navigation')
  await clickText('Eye tests')
  await until('!!document.querySelector(".tool-library") && !document.querySelector(".workspace-sidebar.is-open")', 'mobile navigation closes after route change')
  await checkNoOverflow('mobile test library')
  await screenshot('tools-mobile.png')
  await navigate('/eye-test/meibography?section=blink-rate')
  await until('!!document.querySelector("#blink-manual-count")', 'mobile blink calculator')
  await checkNoOverflow('mobile blink test')
  await screenshot('blink-mobile.png')
  for (const section of ['deq', 'osdi', 'contrast-sensitivity', 'posterior-segment', 'bulbar-redness', 'tear-meniscus', 'meibography']) {
    await navigate(`/eye-test/meibography?section=${section}`)
    await until('!!document.querySelector(".exam-guide")', `mobile ${section}`)
    await pause(200)
    await checkNoOverflow(`mobile ${section}`)
  }

  for (const viewport of EXAM_LAYOUT_VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 640 })
    for (const section of ['blink-rate', 'meibography', 'tear-meniscus', 'deq']) {
      await navigate(`/eye-test/meibography?section=${section}`)
      await until(`document.querySelector('.meibography-container')?.dataset.section === ${JSON.stringify(section)}`, `${viewport.label} ${section}`)
      await pause(200)
      await evaluate('window.scrollTo(0,0)')
      const geometry = await evaluate(examGeometryExpression)
      assertExamGeometry(geometry, { section, label: viewport.label })
    }
  }
  console.log('PASS 40 alignment checks across phones, tablets, desktops, and zoom sizes')

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await navigate('/eye-test/meibography?section=meibography')
  await until('document.querySelectorAll(".sample-image-card").length === 2', 'licensed image samples')
  await until('[...document.querySelectorAll(".sample-image-card img")].every(image => image.complete && image.naturalWidth > 0)', 'sample thumbnails')
  assert.ok(await evaluate('[...document.querySelectorAll(".sample-image-card img")].every(image => image.currentSrc.endsWith("-preview.webp") && image.naturalWidth <= 480)'), 'Gallery previews must use the small thumbnails')
  await screenshot('meibography-samples-desktop.png')
  await clickText('Load sample')
  await until('document.querySelector("#captured-review-image")?.naturalWidth > 0 && !!document.querySelector(".sample-gallery-active")', 'lower eyelid sample in the review stage')
  assert.match(await evaluate('document.querySelector(".sample-gallery-active").textContent'), /Lower eyelid sample/)
  assert.equal(await evaluate('document.querySelector("#captured-review-image").naturalWidth'), 1360, 'Analysis must load the original-resolution sample')
  await pause(1300)
  await evaluate('window.scrollTo(0,0)')
  assertExamGeometry(await evaluate(examGeometryExpression), { section: 'meibography', label: 'loaded sample' })
  await screenshot('meibography-sample-loaded.png')
  await clickText('Show samples')
  await evaluate('document.querySelectorAll(".sample-load-button")[1].click()')
  await until('document.querySelector(".sample-gallery-active")?.textContent.includes("Upper eyelid sample")', 'upper eyelid sample loads')
  assert.ok(await evaluate('document.querySelector("#captured-review-image").naturalWidth > 0'))
  console.log('PASS both real sample images load into review with correct eyelid selection')

  await navigate('/eye-test/meibography?section=blink-rate')
  await until('!!document.querySelector("#blink-manual-count")', 'aligned desktop blink page')
  await screenshot('blink-aligned-desktop.png')
  console.log('PASS mobile home, test library, blink layout, and navigation')
  assertGuestNetworkIsolation(apiRequests.slice(guestRequestsStart))
  console.log('PASS guest network isolation across all routes and sample uploads; real AI inference requires the backend and is not claimed by this UI smoke test')
  assert.deepEqual(exceptions, [], 'Browser must have no uncaught JavaScript exceptions')
  console.log(`PASS browser smoke checks; screenshots saved in ${output}`)
} finally {
  socket?.close()
  chrome?.kill()
  if (production) {
    const closed = new Promise(resolve => server.httpServer.close(resolve))
    server.httpServer.closeAllConnections?.()
    // Preview proxy keep-alives can outlive Chrome; keep cleanup bounded.
    await Promise.race([closed, pause(1000)])
  } else await server.close()
  await pause(300)
  const resolvedProfile = await realpath(profile).catch(() => null)
  const resolvedTemp = await realpath(tmpdir())
  if (resolvedProfile && path.dirname(resolvedProfile) === resolvedTemp && path.basename(resolvedProfile).startsWith('meibopix-browser-')) {
    await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {})
  }
}
