/** @param {NS} ns **/
export async function main(ns) {
  const xpHackPct = Number(ns.args[0] ?? 0.03)
  const moneyHackPct = Number(ns.args[1] ?? 0.08)
  const homeReserveRam = Number(ns.args[2] ?? 1024)
  const xpScanTop = Number(ns.args[3] ?? 30)
  const moneyScanTop = Number(ns.args[4] ?? 25)
  const switchHackLevel = Number(ns.args[5] ?? 175)
  const pollMs = Math.max(3000, Number(ns.args[6] ?? 5000))

  const controller = "/hacking/batch/overlapBatchController.js"
  const xpDistributor = "/xp/xpDistributor.js"
  const xpGrind = "/xp/xpGrind.js"
  const spreadHack = "/hacking/spread-hack.js"
  const playerServers = "/hacking/playerServers.js"

  const CONTROLLER_RESTART_COOLDOWN_MS = 30000
  const TARGETED_XP_ARGS = ["n00dles", 256, false]

  ns.disableLog("ALL")
  ns.clearLog()

  killDuplicateOrchestrators(ns)

  let lastPhase = ""
  let lastDesiredArgsKey = ""
  let lastPurchasedCount = -1
  let lastPurchasedRamTotal = -1
  let lastControllerRestartAt = 0

  while (true) {
    try {
      killDuplicateOrchestrators(ns)

      const hackLevel = ns.getHackingLevel()
      const inXpPhase = hackLevel < switchHackLevel

      const desiredControllerArgs = inXpPhase
        ? [xpHackPct, -1, homeReserveRam, xpScanTop]
        : [moneyHackPct, 80, homeReserveRam, moneyScanTop]

      const desiredArgsKey = JSON.stringify(desiredControllerArgs)

      const purchasedServers = safeGetPurchasedServers(ns)
      const purchasedCount = purchasedServers.length
      const purchasedRamTotal = getPurchasedRamTotal(ns, purchasedServers)

      const phaseName = inXpPhase ? "XP" : "MONEY"
      const phaseChanged = lastPhase !== "" && lastPhase !== phaseName
      const argsChanged = lastDesiredArgsKey !== "" && lastDesiredArgsKey !== desiredArgsKey
      const infraChanged =
        purchasedCount !== lastPurchasedCount ||
        purchasedRamTotal !== lastPurchasedRamTotal

      let forceRestart = false
      let restartReason = ""

      if (phaseChanged) {
        forceRestart = true
        restartReason = "phase change"
      } else if (argsChanged) {
        forceRestart = true
        restartReason = "arg change"
      } else if (
        infraChanged &&
        Date.now() - lastControllerRestartAt >= CONTROLLER_RESTART_COOLDOWN_MS
      ) {
        forceRestart = true
        restartReason = "infrastructure change"
      }

      enforceController(ns, controller, desiredControllerArgs, forceRestart, restartReason)
      if (forceRestart) lastControllerRestartAt = Date.now()

      if (ns.fileExists(playerServers, "home")) {
        startIfMissingWithArgs(ns, playerServers, [])
      }

      if (inXpPhase) {
        startIfMissingWithArgs(ns, xpDistributor, TARGETED_XP_ARGS)
        stopAllByScript(ns, xpGrind)
        stopAllByScript(ns, spreadHack)
      } else {
        stopAllByScript(ns, xpDistributor)
        stopAllByScript(ns, xpGrind)
        stopAllByScript(ns, spreadHack)
      }

      const controllerProc = ns.ps("home").find((p) => p.filename === controller)
      const controllerPid = controllerProc ? controllerProc.pid : 0

      ns.clearLog()
      ns.print(`[orchestrator] phase=${phaseName}`)
      ns.print(`[orchestrator] hack=${ns.formatNumber(hackLevel, 3)} switch=${ns.formatNumber(switchHackLevel, 3)}`)
      ns.print(`[orchestrator] pservs=${purchasedCount} totalRam=${formatRam(ns, purchasedRamTotal)}`)
      ns.print(`[orchestrator] controllerPid=${controllerPid}`)
      ns.print(`[orchestrator] controllerArgs=${desiredControllerArgs.join(" ")}`)
      ns.print(`[orchestrator] xpDistributor=${isRunningAnywhere(ns, xpDistributor) ? "on" : "off"}`)
      ns.print(`[orchestrator] playerServers=${isRunningAnywhere(ns, playerServers) ? "on" : "off"}`)

      lastPhase = phaseName
      lastDesiredArgsKey = desiredArgsKey
      lastPurchasedCount = purchasedCount
      lastPurchasedRamTotal = purchasedRamTotal
    } catch (err) {
      ns.print(`[orchestrator] ERROR: ${String(err)}`)
    }

    await ns.sleep(pollMs)
  }
}

function safeGetPurchasedServers(ns) {
  try {
    return ns.getPurchasedServers()
  } catch {
    return []
  }
}

function getPurchasedRamTotal(ns, servers) {
  let total = 0
  for (const host of servers) {
    try {
      total += ns.getServerMaxRam(host)
    } catch {}
  }
  return total
}

function enforceController(ns, script, desiredArgs, forceRestart, restartReason = "") {
  if (!ns.fileExists(script, "home")) return

  let running = ns.ps("home").filter((p) => p.filename === script)

  if (running.length > 1) {
    running
      .sort((a, b) => a.pid - b.pid)
      .slice(1)
      .forEach((p) => {
        try { ns.kill(p.pid) } catch {}
      })
  }

  running = ns.ps("home").filter((p) => p.filename === script)

  if (running.length === 0) {
    ns.exec(script, "home", 1, ...desiredArgs)
    return
  }

  const proc = running[0]
  const argsMatch = sameArgs(proc.args, desiredArgs)

  if (forceRestart || !argsMatch) {
    try { ns.kill(proc.pid) } catch {}
    ns.exec(script, "home", 1, ...desiredArgs)
    if (restartReason) {
      ns.print(`[orchestrator] restarted controller reason=${restartReason}`)
    }
  }
}

function killDuplicateOrchestrators(ns) {
  const me = ns.pid
  const self = ns.getScriptName()

  for (const proc of ns.ps("home")) {
    if (proc.filename === self && proc.pid !== me) {
      try { ns.kill(proc.pid) } catch {}
    }
  }
}

function startIfMissingWithArgs(ns, script, args = []) {
  if (!ns.fileExists(script, "home")) return false

  const already = ns.ps("home").some((p) => p.filename === script && sameArgs(p.args, args))
  if (already) return true

  const pid = ns.exec(script, "home", 1, ...args)
  return pid !== 0
}

function stopAllByScript(ns, script) {
  for (const host of scanAll(ns)) {
    for (const proc of ns.ps(host)) {
      if (proc.filename === script) {
        try { ns.kill(proc.pid) } catch {}
      }
    }
  }
}

function isRunningAnywhere(ns, script) {
  for (const host of scanAll(ns)) {
    if (ns.ps(host).some((p) => p.filename === script)) return true
  }
  return false
}

function scanAll(ns) {
  const seen = new Set(["home"])
  const queue = ["home"]

  while (queue.length > 0) {
    const host = queue.shift()
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }

  return [...seen]
}

function sameArgs(actual, desired) {
  if (actual.length !== desired.length) return false
  for (let i = 0; i < actual.length; i++) {
    if (String(actual[i]) !== String(desired[i])) return false
  }
  return true
}

function formatRam(ns, value) {
  if (!Number.isFinite(value) || value < 0) return "n/a"
  try {
    return ns.formatRam(value)
  } catch {
    return `${value}GB`
  }
}