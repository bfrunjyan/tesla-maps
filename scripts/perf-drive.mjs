// Performance check: drives a simulated route in real Chrome and reports frame rate
// (normal CPU and slowed down, full and lite map) and memory over a whole drive.
//
//   npm run build && PORT=8899 APP_URL=http://localhost:8899 node server/index.ts &
//   npm run perf                      # frame rate: full/lite × CPU 1x/4x
//   npm run perf -- --memory          # memory over one complete simulated drive
//   npm run perf -- --memory --map=google --to=Zvartnots --minutes=20 [--detail=lite]
//                                     # a longer drive, on the Google map (needs the key in the build)
//
// Limits: CPU throttling imitates a slower processor, not a slower GPU; real
// older-car numbers need the car itself.
import puppeteer from 'puppeteer-core'

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']))
const URL = args.get('url') ?? 'http://localhost:8899/?dev'
const SECONDS = Number(args.get('seconds') ?? 15)
const CHROME = args.get('chrome') ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const REPUBLIC_SQUARE = { latitude: 40.1777, longitude: 44.5126, accuracy: 10 }
const MAP = args.get('map') ?? 'standard'
const TO = args.get('to') ?? 'Cascade'
const MINUTES = Number(args.get('minutes') ?? 6)
const DETAIL = args.get('detail') ?? 'full' // memory drive only: full or lite

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // --gpu=software renders WebGL on the CPU (SwiftShader): a harsh stand-in for a weak car GPU.
  args: ['--window-size=1440,900', '--enable-precise-memory-info', ...(args.get('gpu') === 'software' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'])],
  defaultViewport: { width: 1440, height: 900 },
})

async function startDrive(detail) {
  const ctx = await browser.createBrowserContext()
  await ctx.overridePermissions(new globalThis.URL(URL).origin, ['geolocation'])
  const page = await ctx.newPage()
  await page.setGeolocation(REPUBLIC_SQUARE)
  await page.evaluateOnNewDocument((d, m) => {
    localStorage.setItem('carnav:mapDetail', JSON.stringify(d))
    localStorage.setItem('carnav:themeSetting', '"dark"')
    localStorage.setItem('carnav:mapProvider', JSON.stringify(m))
  }, detail, MAP)
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await page.waitForSelector(MAP === 'google' ? '.gm-style' : 'canvas.maplibregl-canvas', { timeout: 30000 })
  await page.click('.search-pill__trigger')
  await page.type('.search-pill__input', TO)
  // Cascade: the one on Tamanyan Street. Anything else: the first result that names it.
  const pick = TO === 'Cascade' ? 'Tamanyan' : TO
  await page.waitForFunction((t) => [...document.querySelectorAll('.row')].some((r) => r.textContent?.includes(t)), { timeout: 20000 }, pick)
  await page.evaluate((t) => [...document.querySelectorAll('.row')].find((r) => r.textContent?.includes(t))?.click(), pick)
  // Route preview: start the pre-selected (fastest) route.
  // Wait until the routes are in: a tap on the still-disabled button would only stop the countdown.
  await page.waitForSelector('.route-preview__go:not([disabled])', { timeout: 30000 })
  await page.click('.route-preview__go').catch(() => {})
  await page.waitForSelector('.guide__next', { timeout: 60000 }).catch(async (err) => {
    // Say what was on screen instead, so a failed setup is easy to read.
    console.log('Trip did not start. On screen:', await page.evaluate(() => document.querySelector('.left-column')?.textContent?.slice(0, 300)))
    throw err
  }) // or the preview's own countdown starts it
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Simulate drive'))?.click())
  await new Promise((r) => setTimeout(r, 3000)) // let the camera settle into follow mode
  return { ctx, page, cdp: await page.createCDPSession() }
}

async function measureFrames(page, seconds) {
  return page.evaluate(async (ms) => {
    const t = []
    let long = 0
    const po = new PerformanceObserver((l) => (long += l.getEntries().length))
    try {
      po.observe({ type: 'long-animation-frame', buffered: false })
    } catch {}
    await new Promise((done) => {
      const end = performance.now() + ms
      const tick = (now) => (t.push(now), now < end ? requestAnimationFrame(tick) : done())
      requestAnimationFrame(tick)
    })
    po.disconnect()
    const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b)
    const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))]
    return {
      fps: Math.round(1000 / pct(0.5)),
      p95ms: Math.round(pct(0.95)),
      jankPct: Math.round((gaps.filter((g) => g > 50).length / gaps.length) * 100),
      longFrames: long,
    }
  }, seconds * 1000)
}

/** Resident memory (MB) of Chrome's renderer and GPU processes: what the car's browser runs out of. */
async function processMB() {
  const { execSync } = await import('node:child_process')
  const root = browser.process()?.pid
  const rows = execSync('ps -A -o pid=,ppid=,rss=,command=', { encoding: 'utf8' }).trim().split('\n').map((l) => {
    const [pid, ppid, rss, ...cmd] = l.trim().split(/\s+/)
    return { pid: +pid, ppid: +ppid, rss: +rss, cmd: cmd.join(' ') }
  })
  const mine = new Set([root])
  for (let grew = true; grew; ) {
    grew = false
    for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) (mine.add(r.pid), (grew = true))
  }
  const sum = (type) => Math.round(rows.filter((r) => mine.has(r.pid) && r.cmd.includes(`--type=${type}`)).reduce((t, r) => t + r.rss, 0) / 1024)
  return { rendererMB: sum('renderer'), gpuMB: sum('gpu-process') }
}

async function metrics(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics: m } = await cdp.send('Performance.getMetrics')
  const get = (n) => m.find((x) => x.name === n)?.value ?? 0
  return { heapMB: +(get('JSHeapUsedSize') / 1048576).toFixed(1), nodes: get('Nodes'), listeners: get('JSEventListeners'), ...(await processMB()) }
}

const gpu = await (async () => {
  const p = await browser.newPage()
  const name = await p.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const i = gl?.getExtension('WEBGL_debug_renderer_info')
    return gl ? String(gl.getParameter(i ? i.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none'
  })
  await p.close()
  return name
})()
console.log(`GPU in this Chrome: ${gpu}\n`)

if (args.has('memory')) {
  const { ctx, page, cdp } = await startDrive(DETAIL)
  await cdp.send('Performance.enable')
  const start = await metrics(cdp)
  const samples = [start]
  // Drive until the trip ends (arrival clears the guidance card), sampling every 30 s.
  const t0 = Date.now()
  while (await page.$('.guide__next')) {
    await new Promise((r) => setTimeout(r, 30000))
    samples.push(await metrics(cdp))
    if (Date.now() - t0 > MINUTES * 60_000) break
  }
  const end = await metrics(cdp)
  console.log(`Memory over a ${Math.round((Date.now() - t0) / 1000)} s simulated drive on the ${MAP} map, ${DETAIL} detail (after garbage collection):`)
  samples.concat(end).forEach((s, i) => console.log(`  sample ${String(i).padStart(2)}: heap ${s.heapMB} MB, DOM nodes ${s.nodes}, listeners ${s.listeners}, renderer ${s.rendererMB} MB, GPU ${s.gpuMB} MB`))
  console.log(`  growth: heap ${(end.heapMB - start.heapMB).toFixed(1)} MB, nodes ${end.nodes - start.nodes}, listeners ${end.listeners - start.listeners}, renderer ${end.rendererMB - start.rendererMB} MB, GPU ${end.gpuMB - start.gpuMB} MB`)
  await ctx.close()
} else {
  console.log(`Frame rate during a simulated drive (${SECONDS} s each, heading-up 3D camera):`)
  console.log('  detail  CPU   fps  p95 frame  frames >50ms  long frames')
  for (const detail of ['full', 'lite']) {
    for (const cpu of [1, 4]) {
      const { ctx, page, cdp } = await startDrive(detail)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
      const r = await measureFrames(page, SECONDS)
      console.log(`  ${detail.padEnd(6)}  ${String(cpu).padStart(2)}x  ${String(r.fps).padStart(4)}  ${String(r.p95ms).padStart(6)} ms  ${String(r.jankPct).padStart(9)} %  ${String(r.longFrames).padStart(10)}`)
      await ctx.close()
    }
  }
}
await browser.close()
