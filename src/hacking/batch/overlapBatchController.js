/** @param {NS} ns **/
export async function main(ns) {
  const hackPct = clamp(Number(ns.args[0] ?? 0.03), 0.01, 0.9)
  const spacingArg = Number(ns.args[1] ?? -1)
  const reserveHome = Number(ns.args[2] ?? 1024)
  const scanTop = Number(ns.args[3] ?? 25)

  ns.disableLog("ALL")

  const me = ns.pid
  const self = ns.getScriptName()

  const others = ns.ps("home").filter(
    (p) => p.filename === self && p.pid !== me
  )
  if (others.length > 0) {
    ns.print("[overlap] Another controller is already running, exiting")
    return
  }

  const hackScript = "/hacking/main/hack.js"
  const growScript = "/hacking/main/grow.js"
  const weakenScript = "/hacking/main/weaken.js"

  let currentTarget = null
  let lastTargetChangeAt = 0

  while (true) {
    try {
      if (!iAmPrimary(ns, self, me)) {
        ns.print("[overlap] Duplicate controller detected, exiting")
        return
      }

      let target = pickBestTarget(ns, scanTop)

      if (!target) {
        ns.print("[overlap] No valid target")
        await ns.sleep(3000)
        continue
      }

      if (currentTarget && currentTarget !== target) {
        const keepCurrent = shouldKeepCurrentTarget(ns, currentTarget, target)
        if (keepCurrent) {
          target = currentTarget
        }
      }

      if (target !== currentTarget) {
        ns.print(`[overlap] Switching target -> ${target}`)
        killWorkers(ns, hackScript, growScript, weakenScript)
        currentTarget = target
        lastTargetChangeAt = Date.now()
      }

      await deployFiles(ns, [hackScript, growScript, weakenScript], reserveHome)

      const ready = await prepIfNeeded(
        ns,
        currentTarget,
        reserveHome,
        growScript,
        weakenScript
      )

      if (!ready) {
        await ns.sleep(2000)
        continue
      }

      const weakenTime = ns.getWeakenTime(currentTarget)
      const hackTime = ns.getHackTime(currentTarget)
      const growTime = ns.getGrowTime(currentTarget)

      const spacing =
        spacingArg > 0
          ? Math.max(20, Math.floor(spacingArg))
          : Math.max(60, Math.floor(weakenTime / 18))

      const batchPlan = computeBatchPlan(ns, currentTarget, hackPct)

      if (!batchPlan) {
        ns.print(`[overlap] Could not compute batch plan for ${currentTarget}`)
        await ns.sleep(3000)
        continue
      }

      const launched = launchBatches(
        ns,
        currentTarget,
        spacing,
        reserveHome,
        hackScript,
        growScript,
        weakenScript,
        batchPlan
      )

      ns.clearLog()
      ns.print(`[overlap] target=${currentTarget}`)
      ns.print(`[overlap] hackPct=${(hackPct * 100).toFixed(2)}%`)
      ns.print(`[overlap] spacing=${spacing}ms`)
      ns.print(
        `[overlap] plan h=${batchPlan.hackThreads} g=${batchPlan.growThreads} w=${batchPlan.weakenThreads}`
      )
      ns.print(
        `[overlap] times h=${formatMs(hackTime)} g=${formatMs(growTime)} w=${formatMs(weakenTime)}`
      )
      ns.print(`[overlap] launched=${launched}`)
      ns.print(
        `[overlap] targetAge=${formatMs(Date.now() - lastTargetChangeAt)}`
      )

      const cycleSleep = Math.max(
        3000,
        Math.min(
          weakenTime + spacing * 6,
          Math.max(6000, Math.floor(weakenTime * 0.5))
        )
      )

      await ns.sleep(cycleSleep)
    } catch (err) {
      ns.print(`[overlap] ERROR: ${String(err)}`)
      await ns.sleep(3000)
    }
  }
}

async function deployFiles(ns, files, reserveHome) {
  for (const host of getHosts(ns, reserveHome)) {
    if (host === "home") continue
    try {
      await ns.scp(files, host, "home")
    } catch {}
  }
}

async function prepIfNeeded(ns, target, reserveHome, growScript, weakenScript) {
  while (true) {
    const money = ns.getServerMoneyAvailable(target)
    const maxMoney = ns.getServerMaxMoney(target)
    const sec = ns.getServerSecurityLevel(target)
    const minSec = ns.getServerMinSecurityLevel(target)

    const moneyReady = maxMoney > 0 && money >= maxMoney * 0.985
    const secReady = sec <= minSec + 0.25

    if (moneyReady && secReady) {
      ns.print(`[prep] ${target} READY`)
      return true
    }

    ns.print(
      `[prep] ${target} money=${
        maxMoney > 0 ? ((money / maxMoney) * 100).toFixed(1) : "0.0"
      }% sec+${(sec - minSec).toFixed(2)}`
    )

    let launched = 0

    for (const host of getHosts(ns, reserveHome)) {
      const free = freeRam(ns, host, reserveHome)
      if (free < 2) continue

      if (!secReady) {
        const weakenRam = ns.getScriptRam(weakenScript, host) || 1.75
        const threads = Math.floor(free / weakenRam)
        if (threads > 0) {
          const pid = ns.exec(weakenScript, host, threads, target, 0)
          if (pid !== 0) launched++
        }
      } else if (!moneyReady) {
        const growRam = ns.getScriptRam(growScript, host) || 1.75
        const threads = Math.floor(free / growRam)
        if (threads > 0) {
          const pid = ns.exec(growScript, host, threads, target, 0)
          if (pid !== 0) launched++
        }
      }
    }

    ns.print(`[prep] launched jobs=${launched}`)

    const waitMs = !secReady
      ? Math.max(4000, Math.min(15000, Math.floor(ns.getWeakenTime(target) * 0.25)))
      : Math.max(4000, Math.min(15000, Math.floor(ns.getGrowTime(target) * 0.25)))

    await ns.sleep(waitMs)
  }
}

function launchBatches(
  ns,
  target,
  spacing,
  reserveHome,
  hackScript,
  growScript,
  weakenScript,
  batchPlan
) {
  let launched = 0

  const hackThreadsPerSet = batchPlan.hackThreads
  const growThreadsPerSet = batchPlan.growThreads
  const weakenThreadsPerSet = batchPlan.weakenThreads

  for (const host of getHosts(ns, reserveHome)) {
    const free = freeRam(ns, host, reserveHome)
    if (free < 6) continue

    const hackRam = ns.getScriptRam(hackScript, host) || 1.7
    const growRam = ns.getScriptRam(growScript, host) || 1.75
    const weakenRam = ns.getScriptRam(weakenScript, host) || 1.75

    const oneSetRam =
      hackThreadsPerSet * hackRam +
      growThreadsPerSet * growRam +
      weakenThreadsPerSet * weakenRam

    if (oneSetRam <= 0) continue

    const sets = Math.floor(free / oneSetRam)
    if (sets <= 0) continue

    for (let i = 0; i < sets; i++) {
      const baseDelay = i * spacing * 4

      const h = ns.exec(hackScript, host, hackThreadsPerSet, target, baseDelay)
      const g = ns.exec(
        growScript,
        host,
        growThreadsPerSet,
        target,
        baseDelay + spacing
      )
      const w = ns.exec(
        weakenScript,
        host,
        weakenThreadsPerSet,
        target,
        baseDelay + spacing * 2
      )

      if (h !== 0 && g !== 0 && w !== 0) {
        launched++
      } else {
        if (h !== 0) try { ns.kill(h) } catch {}
        if (g !== 0) try { ns.kill(g) } catch {}
        if (w !== 0) try { ns.kill(w) } catch {}
        break
      }
    }
  }

  return launched
}

function computeBatchPlan(ns, target, hackPct) {
  const maxMoney = ns.getServerMaxMoney(target)
  if (maxMoney <= 0) return null

  let hackThreads = Math.max(1, Math.floor(ns.hackAnalyzeThreads(target, maxMoney * hackPct)))
  if (!Number.isFinite(hackThreads) || hackThreads < 1) {
    const perThreadFraction = Math.max(0.000001, ns.hackAnalyze(target))
    hackThreads = Math.max(1, Math.floor(hackPct / perThreadFraction))
  }

  hackThreads = clampInt(hackThreads, 1, 1000000)

  const hackedFraction = Math.max(0.000001, ns.hackAnalyze(target) * hackThreads)
  const postHackMoneyFraction = Math.max(0.0001, 1 - hackedFraction)

  let growThreads
  try {
    growThreads = Math.ceil(ns.growthAnalyze(target, 1 / postHackMoneyFraction))
  } catch {
    growThreads = Math.ceil(hackThreads * 2.0)
  }

  if (!Number.isFinite(growThreads) || growThreads < 1) {
    growThreads = Math.ceil(hackThreads * 2.0)
  }

  growThreads = clampInt(growThreads, 1, 1000000)

  const hackSec = hackThreads * 0.002
  const growSec = growThreads * 0.004
  const totalSec = hackSec + growSec
  const weakenThreads = clampInt(Math.ceil(totalSec / 0.05), 1, 1000000)

  return {
    hackThreads,
    growThreads,
    weakenThreads,
  }
}

function pickBestTarget(ns, topN) {
  const hackLevel = ns.getHackingLevel()

  let minMoney = 0
  if (hackLevel >= 500) minMoney = 1e9
  if (hackLevel >= 1200) minMoney = 5e9
  if (hackLevel >= 2500) minMoney = 1e10
  if (hackLevel >= 4000) minMoney = 2e10
  if (hackLevel >= 5500) minMoney = 4e10

  let maxReqHackRatio = 1.0
  if (hackLevel >= 2500) maxReqHackRatio = 0.95
  if (hackLevel >= 4000) maxReqHackRatio = 0.9
  if (hackLevel >= 5500) maxReqHackRatio = 0.85

  const maxAllowedReqHack = hackLevel * maxReqHackRatio

  const rootedMoneyServers = scanAll(ns)
    .filter((s) => s !== "home")
    .filter((s) => ns.hasRootAccess(s))
    .filter((s) => ns.getServerMaxMoney(s) > 0)
    .filter((s) => ns.getServerRequiredHackingLevel(s) <= maxAllowedReqHack)
    .filter((s) => ns.getServerMaxMoney(s) >= minMoney)

  const candidates =
    rootedMoneyServers.length > 0
      ? rootedMoneyServers
      : scanAll(ns)
          .filter((s) => s !== "home")
          .filter((s) => ns.hasRootAccess(s))
          .filter((s) => ns.getServerMaxMoney(s) > 0)
          .filter((s) => ns.getServerRequiredHackingLevel(s) <= hackLevel)

  if (candidates.length === 0) return null

  const scored = candidates.map((s) => {
    const maxMoney = ns.getServerMaxMoney(s)
    const moneyNow = ns.getServerMoneyAvailable(s)
    const moneyRatio = maxMoney > 0 ? moneyNow / maxMoney : 0

    const minSec = ns.getServerMinSecurityLevel(s)
    const secNow = ns.getServerSecurityLevel(s)
    const secPenalty = Math.max(1, secNow - minSec + 1)

    const weakenTime = ns.getWeakenTime(s)
    const chance = Math.max(0.01, ns.hackAnalyzeChance(s))
    const reqHack = ns.getServerRequiredHackingLevel(s)

    const valueScore = Math.pow(maxMoney, 1.0)
    const efficiencyScore =
      (chance * valueScore) /
      (Math.pow(weakenTime, 0.45) * Math.pow(Math.max(1, minSec), 0.3))

    const prepScore = Math.max(0.35, moneyRatio) / Math.pow(secPenalty, 0.55)
    const levelFit = 1 + Math.min(0.25, reqHack / Math.max(1, hackLevel))

    return {
      server: s,
      score: efficiencyScore * prepScore * levelFit,
      maxMoney,
    }
  })

  scored.sort((a, b) => b.score - a.score)

  const finalists = scored.slice(0, Math.max(1, topN))

  finalists.sort((a, b) => {
    const scoreDiff =
      Math.abs(a.score - b.score) / Math.max(1e-9, Math.max(a.score, b.score))
    if (scoreDiff < 0.2) {
      return b.maxMoney - a.maxMoney
    }
    return b.score - a.score
  })

  return finalists[0]?.server ?? null
}

function shouldKeepCurrentTarget(ns, currentTarget, proposedTarget) {
  if (currentTarget === proposedTarget) return true
  if (!ns.serverExists(currentTarget)) return false
  if (!ns.hasRootAccess(currentTarget)) return false
  if (ns.getServerMaxMoney(currentTarget) <= 0) return false

  const currentMoney = ns.getServerMoneyAvailable(currentTarget)
  const currentMaxMoney = ns.getServerMaxMoney(currentTarget)
  const currentSec = ns.getServerSecurityLevel(currentTarget)
  const currentMinSec = ns.getServerMinSecurityLevel(currentTarget)

  const currentStillGood =
    currentMoney >= currentMaxMoney * 0.8 &&
    currentSec <= currentMinSec + 3

  return currentStillGood
}

function getHosts(ns, reserveHome) {
  return scanAll(ns)
    .filter((s) => ns.hasRootAccess(s))
    .filter((s) => ns.getServerMaxRam(s) > 0)
    .filter((s) => s !== "home" || freeRam(ns, "home", reserveHome) > 8)
    .sort((a, b) => freeRam(ns, b, reserveHome) - freeRam(ns, a, reserveHome))
}

function freeRam(ns, host, reserveHome = 0) {
  const max = ns.getServerMaxRam(host)
  const used = ns.getServerUsedRam(host)
  const reserve = host === "home" ? reserveHome : 0
  return Math.max(0, max - used - reserve)
}

function killWorkers(ns, hackScript, growScript, weakenScript) {
  for (const host of scanAll(ns)) {
    ns.scriptKill(hackScript, host)
    ns.scriptKill(growScript, host)
    ns.scriptKill(weakenScript, host)
  }
}

function scanAll(ns) {
  const seen = new Set()
  const stack = ["home"]

  while (stack.length) {
    const node = stack.pop()
    if (seen.has(node)) continue
    seen.add(node)

    for (const next of ns.scan(node)) {
      if (!seen.has(next)) stack.push(next)
    }
  }

  return [...seen]
}

function iAmPrimary(ns, scriptName, myPid) {
  const all = ns.ps("home")
    .filter((p) => p.filename === scriptName)
    .map((p) => p.pid)
    .sort((a, b) => a - b)

  return all.length === 0 || all[0] === myPid
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) return "n/a"
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  return `${m}m ${rem}s`
}