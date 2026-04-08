/** @param {NS} ns **/
export async function main(ns) {
  const xpHackPct = Number(ns.args[0] ?? 0.03)
  const moneyHackPct = Number(ns.args[1] ?? 0.08)
  const homeReserveRam = Number(ns.args[2] ?? 1024)
  const xpSpacing = Number(ns.args[3] ?? 30)
  const moneySpacing = Number(ns.args[4] ?? 80)
  const switchHackLevel = Number(ns.args[5] ?? 750)
  const pollMs = Math.max(5000, Number(ns.args[6] ?? 15000))

  const spreadHack = "hacking/spread-hack.js"
  const xpGrind = "xp/xpGrind.js"
  const xpDistributor = "xp/xpDistributor.js"
  const controller = "hacking/batch/overlapBatchController.js"
  const playerServers = "hacking/playerServers.js"

  ns.disableLog("ALL")
  ns.clearLog()

  killDuplicateSelf(ns)

  let lastPhase = ""
  let lastControllerArgsKey = ""

  while (true) {
    try {
      killDuplicateSelf(ns)

      const hackLevel = ns.getHackingLevel()
      const phase = hackLevel < switchHackLevel ? "XP" : "MONEY"

      if (ns.fileExists(withSlash(playerServers), "home")) {
        forceSingleOnHome(ns, playerServers, [])
      }

      if (phase === "XP") {
        forceSingleOnHome(ns, spreadHack, [])
        forceSingleOnHome(ns, xpGrind, [])
        forceSingleOnHome(ns, xpDistributor, ["n00dles", 256, false])

        const desiredControllerArgs = [xpHackPct, xpSpacing, homeReserveRam, 30]
        const controllerArgsKey = JSON.stringify(desiredControllerArgs)
        forceSingleOnHome(ns, controller, desiredControllerArgs)

        if (lastPhase !== phase || lastControllerArgsKey !== controllerArgsKey) {
          ns.tprint(`[orchestrator] XP phase active at hack ${hackLevel}.`)
        }

        lastControllerArgsKey = controllerArgsKey
      } else {
        killAllByScriptOnHome(ns, spreadHack)
        killAllByScriptOnHome(ns, xpGrind)
        killAllByScriptOnHome(ns, xpDistributor)

        const desiredControllerArgs = [moneyHackPct, moneySpacing, homeReserveRam, 25]
        const controllerArgsKey = JSON.stringify(desiredControllerArgs)
        forceSingleOnHome(ns, controller, desiredControllerArgs)

        if (lastPhase !== phase || lastControllerArgsKey !== controllerArgsKey) {
          ns.tprint(`[orchestrator] MONEY phase active at hack ${hackLevel}.`)
        }

        lastControllerArgsKey = controllerArgsKey
      }

      lastPhase = phase

      ns.clearLog()
      ns.print(`[orchestrator] phase=${phase}`)
      ns.print(`[orchestrator] hack=${hackLevel}`)
      ns.print(`[orchestrator] switch=${switchHackLevel}`)
      ns.print(`[orchestrator] spreadHack=${describeScriptOnHome(ns, spreadHack)}`)
      ns.print(`[orchestrator] xpGrind=${describeScriptOnHome(ns, xpGrind)}`)
      ns.print(`[orchestrator] xpDistributor=${describeScriptOnHome(ns, xpDistributor)}`)
      ns.print(`[orchestrator] controller=${describeScriptOnHome(ns, controller)}`)
      ns.print(`[orchestrator] playerServers=${describeScriptOnHome(ns, playerServers)}`)
    } catch (err) {
      ns.print(`[orchestrator] ERROR: ${String(err)}`)
    }

    await ns.sleep(pollMs)
  }
}

function forceSingleOnHome(ns, script, args = []) {
  if (!ns.fileExists(withSlash(script), "home")) return false

  for (const proc of ns.ps("home")) {
    if (sameScript(proc.filename, script)) {
      try { ns.kill(proc.pid) } catch {}
    }
  }

  return ns.run(withSlash(script), 1, ...args) !== 0
}

function killAllByScriptOnHome(ns, script) {
  for (const proc of ns.ps("home")) {
    if (sameScript(proc.filename, script)) {
      try { ns.kill(proc.pid) } catch {}
    }
  }
}

function describeScriptOnHome(ns, script) {
  const matches = ns.ps("home").filter((p) => sameScript(p.filename, script))
  if (matches.length === 0) return "off"

  const first = matches[0]
  const args = first.args.length ? ` ${first.args.join(" ")}` : ""
  return `on x${matches.length}${args}`
}

function killDuplicateSelf(ns) {
  const self = normalizeScript(ns.getScriptName())
  const me = ns.pid

  for (const proc of ns.ps("home")) {
    if (normalizeScript(proc.filename) === self && proc.pid !== me) {
      try { ns.kill(proc.pid) } catch {}
    }
  }
}

function sameScript(a, b) {
  return normalizeScript(a) === normalizeScript(b)
}

function normalizeScript(path) {
  return String(path).replace(/^\/+/, "")
}

function withSlash(path) {
  return path.startsWith("/") ? path : `/${path}`
}