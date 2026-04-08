/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("sleep")
  ns.tprint(`[${ts()}] Starting initHacking.js`)

  const killAllScript = "/hacking/main/killAll.js"
  const xpDistributor = "/xp/xpDistributor.js"
  const stopXp = "/xp/stopXpGrind.js"
  const hackOrchestrator = "/bootstrap/hackOrchestrator.js"
  const gangManager = "/gang/gangManager_v2.js"
  const crimeManager = "/crime/crimeManager.js"
  const autoGangStarter = "/gang/autoGangStarter.js"
  const playerServers = "/hacking/playerServers.js"

  const xpTarget = "n00dles"
  const xpReserveRam = 256
  const xpAllowSpread = false

  const orchestratorHackThreshold = 150
  const orchestratorSwitchHackLevel = 175
  const orchestratorXpScanTop = 30
  const orchestratorMoneyScanTop = 25
  const pollMs = 15000

  if (!ns.fileExists(killAllScript, "home")) {
    ns.tprint(`[${ts()}] ERROR: Missing ${killAllScript}`)
    return
  }

  if (!ns.fileExists(xpDistributor, "home")) {
    ns.tprint(`[${ts()}] ERROR: Missing ${xpDistributor}`)
    return
  }

  ns.tprint(`[${ts()}] Running cleanup with ${killAllScript}`)
  const killPid = ns.run(killAllScript, 1, ns.pid)
  if (killPid === 0) {
    ns.tprint(`[${ts()}] ERROR: Failed to start ${killAllScript}`)
    return
  }

  await ns.sleep(1000)

  startIfMissing(ns, xpDistributor, [xpTarget, xpReserveRam, xpAllowSpread])
  await ns.sleep(250)

  if (hasGang(ns)) {
    startSingleton(ns, gangManager, [150e9, "money", "rep"])
  } else {
    startIfMissing(ns, crimeManager, ["karma"])
    await ns.sleep(250)
    startIfMissing(ns, autoGangStarter, ["Slum Snakes", 5000, -54000])
  }

  if (ns.fileExists(playerServers, "home")) {
    startSingleton(ns, playerServers, [])
  }

  while (true) {
    try {
      if (hasGang(ns)) {
        startSingleton(ns, gangManager, [150e9, "money", "rep"])
      }

      if (ns.fileExists(playerServers, "home")) {
        startSingleton(ns, playerServers, [])
      }

      const shouldRunOrchestrator = ns.getHackingLevel() >= orchestratorHackThreshold
      const orchestratorRunning = isRunningAnywhere(ns, hackOrchestrator)
      const xpRunning =
        isRunningAnywhere(ns, "/xp/xpGrind.js") ||
        isRunningAnywhere(ns, xpDistributor)

      if (shouldRunOrchestrator) {
        if (!orchestratorRunning && ns.fileExists(hackOrchestrator, "home")) {
          ns.tprint(`[${ts()}] Switching to orchestrator mode.`)
          stopXpEverywhere(ns, stopXp, xpDistributor)
          await ns.sleep(500)
          startIfMissing(ns, hackOrchestrator, [
            0.03,
            0.08,
            1024,
            orchestratorXpScanTop,
            orchestratorMoneyScanTop,
            orchestratorSwitchHackLevel,
            5000
          ])
        }
      } else {
        if (!xpRunning) {
          ns.tprint(`[${ts()}] Staying in XP mode.`)
          startIfMissing(ns, xpDistributor, [xpTarget, xpReserveRam, xpAllowSpread])
        }
      }
    } catch (err) {
      ns.tprint(`[${ts()}] ERROR: ${String(err)}`)
    }

    await ns.sleep(pollMs)
  }
}

function hasGang(ns) {
  try {
    return !!ns.gang && ns.gang.inGang()
  } catch {
    return false
  }
}

function startIfMissing(ns, script, args = []) {
  if (!ns.fileExists(script, "home")) return false
  if (isRunningWithArgsAnywhere(ns, script, args)) return true
  return ns.run(script, 1, ...args) !== 0
}

function startSingleton(ns, script, args = []) {
  if (!ns.fileExists(script, "home")) return false

  const allHosts = scanAll(ns)
  for (const host of allHosts) {
    const matches = ns.ps(host).filter((p) => p.filename === script)
    if (host === "home") {
      matches
        .sort((a, b) => a.pid - b.pid)
        .slice(1)
        .forEach((p) => {
          try { ns.kill(p.pid) } catch {}
        })
    } else {
      for (const proc of matches) {
        try { ns.kill(proc.pid) } catch {}
      }
    }
  }

  const homeHasOne = ns.ps("home").some((p) => p.filename === script)
  if (homeHasOne) return true

  return ns.run(script, 1, ...args) !== 0
}

function stopXpEverywhere(ns, stopXpScript, xpDistributor) {
  if (ns.fileExists(stopXpScript, "home")) {
    ns.run(stopXpScript, 1)
  }

  for (const host of scanAll(ns)) {
    ns.scriptKill("/xp/xpGrind.js", host)
    ns.scriptKill(xpDistributor, host)
    ns.scriptKill("/hacking/spread-hack.js", host)
  }
}

function isRunningAnywhere(ns, script) {
  for (const host of scanAll(ns)) {
    if (ns.ps(host).some((p) => p.filename === script)) return true
  }
  return false
}

function isRunningWithArgsAnywhere(ns, script, args = []) {
  for (const host of scanAll(ns)) {
    for (const proc of ns.ps(host)) {
      if (proc.filename !== script) continue
      if (sameArgs(proc.args, args)) return true
    }
  }
  return false
}

function sameArgs(actual, desired) {
  if (actual.length !== desired.length) return false
  for (let i = 0; i < actual.length; i++) {
    if (String(actual[i]) !== String(desired[i])) return false
  }
  return true
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

function ts() {
  return new Date().toLocaleTimeString()
}