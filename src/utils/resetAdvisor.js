/** @param {NS} ns **/
export async function main(ns) {
  const reserve = Number(ns.args[0] ?? 110e9)
  const daedalusMoneyGate = Number(ns.args[1] ?? 100e9)
  const daedalusHackGate = Number(ns.args[2] ?? 2500)
  const minPending = Math.max(1, Number(ns.args[3] ?? 5))
  const maxFutureBuysToSim = Math.max(1, Number(ns.args[4] ?? 5))
  const augPriceMultiplier = Number(ns.args[5] ?? 1.9)
  const gangKarmaTarget = Number(ns.args[6] ?? -54000)
  const gangKarmaGuard = Math.max(0, Number(ns.args[7] ?? 15000))

  const player = ns.getPlayer()
  const factions = player.factions || []
  const hasDaedalus = factions.includes("Daedalus")
  const homeMoney = ns.getServerMoneyAvailable("home")
  const hack = ns.getHackingLevel()
  const karma = safeHeartBreak(ns)
  const inGang = safeInGang(ns)
  const closeToGangUnlock =
    !inGang &&
    karma > gangKarmaTarget &&
    karma <= gangKarmaTarget + gangKarmaGuard

  const lines = []
  lines.push("=== Reset Advisor ===")
  lines.push(`Home money:        ${fmtMoney(ns, homeMoney)}`)
  lines.push(`Reserve target:    ${fmtMoney(ns, reserve)}`)
  lines.push(`Daedalus money:    ${fmtMoney(ns, daedalusMoneyGate)}`)
  lines.push(`Hacking level:     ${ns.formatNumber(hack, 3)}`)
  lines.push(`Hack target:       ${ns.formatNumber(daedalusHackGate, 3)}`)
  lines.push(`Daedalus joined:   ${hasDaedalus ? "yes" : "no"}`)
  lines.push(`Min pending target ${minPending}`)
  lines.push(`Price multiplier:  x${augPriceMultiplier.toFixed(2)}`)
  lines.push(`In gang:           ${inGang ? "yes" : "no"}`)
  lines.push(`Karma:             ${ns.formatNumber(karma, 3)}`)
  lines.push(`Gang target:       ${ns.formatNumber(gangKarmaTarget, 3)}`)
  lines.push(`Gang guard:        ${ns.formatNumber(gangKarmaGuard, 3)}`)
  lines.push(`Close to gang:     ${closeToGangUnlock ? "yes" : "no"}`)

  const augSummary = getAugSummary(ns)
  lines.push("")
  lines.push("Augments:")
  lines.push(`  owned installed: ${augSummary.ownedInstalled.length}`)
  lines.push(`  owned total:     ${augSummary.ownedWithPending.length}`)
  lines.push(`  pending queued:  ${augSummary.pending.length}`)
  lines.push(`  pending cost:    ${fmtMoney(ns, augSummary.pendingCost)}`)
  lines.push(`  red pill queued: ${augSummary.hasRedPillPending ? "yes" : "no"}`)

  const future = simulateFutureBuys(ns, {
    ownedWithPending: new Set(augSummary.ownedWithPending),
    factions,
    availableMoney: Math.max(0, homeMoney - reserve),
    maxBuys: maxFutureBuysToSim,
    priceMultiplier: augPriceMultiplier,
  })

  lines.push("")
  lines.push("Future buy simulation:")
  lines.push(`  money after reserve: ${fmtMoney(ns, Math.max(0, homeMoney - reserve))}`)
  lines.push(`  simulated buys:      ${future.buys.length}`)
  lines.push(`  simulated cost:      ${fmtMoney(ns, future.totalCost)}`)

  if (future.buys.length > 0) {
    for (const buy of future.buys) {
      lines.push(
        `  - ${buy.aug} | faction=${buy.faction} | cost=${fmtMoney(ns, buy.simulatedPrice)} | repReq=${ns.formatNumber(buy.repReq, 3)}`
      )
    }
  } else {
    lines.push("  - none affordable / eligible right now")
  }

  if (ns.gang && ns.gang.inGang()) {
    const gang = ns.gang.getGangInformation()
    const members = ns.gang.getMemberNames()
    lines.push("")
    lines.push("Gang:")
    lines.push(`  faction:         ${gang.faction}`)
    lines.push(`  members:         ${members.length}`)
    lines.push(`  respect:         ${ns.formatNumber(gang.respect, 3)}`)
    lines.push(`  wanted penalty:  ${(gang.wantedPenalty * 100).toFixed(2)}%`)
    lines.push(`  territory:       ${(gang.territory * 100).toFixed(2)}%`)
  }

  lines.push("")
  lines.push("Recommendation:")

  if (homeMoney < daedalusMoneyGate) {
    lines.push("- Keep pushing money. Do not raise reserve too high yet.")
  } else if (homeMoney < reserve) {
    lines.push("- You crossed the Daedalus floor, but current reserve is higher than cash. Avoid spending.")
  } else {
    lines.push("- Money objective met. Protect reserve and push rep.")
  }

  if (hack < daedalusHackGate) {
    lines.push("- Favor XP-heavy hacking until hack is stable above the target.")
  } else {
    lines.push("- Hacking objective met. Favor stable money batches and faction work.")
  }

  if (!hasDaedalus) {
    lines.push("- Daedalus not joined yet. Keep checking invite conditions.")
  } else {
    lines.push("- Daedalus joined. Narrow focus to rep and the aug package you want.")
  }

  if (closeToGangUnlock) {
    lines.push("- Close to gang unlock. Favor finishing the karma grind before resetting.")
  }

  const recommendation = decideResetReadiness({
    hasDaedalus,
    homeMoney,
    reserve,
    hack,
    daedalusHackGate,
    pendingCount: augSummary.pending.length,
    hasRedPillPending: augSummary.hasRedPillPending,
    futureBuys: future.buys.length,
    minPending,
    closeToGangUnlock,
  })

  lines.push("")
  lines.push(`Reset-ready: ${recommendation.status}`)
  lines.push(`Why: ${recommendation.reason}`)

  ns.tprint(lines.join("\n"))
}

function getAugSummary(ns) {
  const ownedInstalled = getOwnedAugsSafe(ns, false)
  const ownedWithPending = getOwnedAugsSafe(ns, true)
  const installedSet = new Set(ownedInstalled)
  const pending = ownedWithPending.filter((aug) => !installedSet.has(aug))

  let pendingCost = 0
  for (const aug of pending) {
    pendingCost += getAugPriceSafe(ns, aug)
  }

  return {
    ownedInstalled,
    ownedWithPending,
    pending,
    pendingCost,
    hasRedPillPending: pending.includes("The Red Pill"),
  }
}

function simulateFutureBuys(ns, opts) {
  const ownedWithPending = opts.ownedWithPending
  const factions = opts.factions || []
  const availableMoney = Math.max(0, Number(opts.availableMoney ?? 0))
  const maxBuys = Math.max(1, Number(opts.maxBuys ?? 5))
  const priceMultiplier = Number(opts.priceMultiplier ?? 1.9)

  const market = buildMarket(ns, factions, ownedWithPending)
    .filter((x) => scoreCandidate(ns, x) > 0)
    .sort((a, b) => {
      const aScore = scoreCandidate(ns, a)
      const bScore = scoreCandidate(ns, b)
      if (bScore !== aScore) return bScore - aScore
      if (a.price !== b.price) return a.price - b.price
      return a.aug.localeCompare(b.aug)
    })

  let moneyLeft = availableMoney
  let multiplierPow = 0
  const buys = []
  const purchased = new Set()

  while (buys.length < maxBuys) {
    let picked = null

    for (const candidate of market) {
      if (ownedWithPending.has(candidate.aug) || purchased.has(candidate.aug)) continue
      if (getFactionRepSafe(ns, candidate.faction) < candidate.repReq) continue

      const prereqsMet = candidate.prereqs.every((p) => ownedWithPending.has(p) || purchased.has(p))
      if (!prereqsMet) continue

      const simulatedPrice = candidate.price * Math.pow(priceMultiplier, multiplierPow)
      if (simulatedPrice > moneyLeft) continue

      picked = {
        ...candidate,
        simulatedPrice,
      }
      break
    }

    if (!picked) break

    buys.push(picked)
    purchased.add(picked.aug)
    moneyLeft -= picked.simulatedPrice
    multiplierPow++
  }

  return {
    buys,
    totalCost: buys.reduce((sum, x) => sum + x.simulatedPrice, 0),
    moneyLeft,
  }
}

function decideResetReadiness(ctx) {
  if (ctx.closeToGangUnlock) {
    return {
      status: "not yet",
      reason: "Close to gang unlock. Finish the karma grind first.",
    }
  }

  if (!ctx.hasDaedalus) {
    return {
      status: "not yet",
      reason: "Daedalus not joined.",
    }
  }

  if (ctx.homeMoney < ctx.reserve) {
    return {
      status: "not yet",
      reason: "Reserve target not met.",
    }
  }

  if (ctx.hack < ctx.daedalusHackGate) {
    return {
      status: "not yet",
      reason: "Hacking target not met.",
    }
  }

  if (ctx.hasRedPillPending) {
    return {
      status: "INSTALL NOW",
      reason: "The Red Pill is queued.",
    }
  }

  if (ctx.pendingCount >= ctx.minPending && ctx.futureBuys === 0) {
    return {
      status: "INSTALL NOW",
      reason: "You have a solid queued package and cannot cheaply extend it further.",
    }
  }

  if (ctx.pendingCount >= ctx.minPending) {
    return {
      status: "probably yes",
      reason: "Queued package is decent, but you may still be able to add another good augmentation.",
    }
  }

  if (ctx.pendingCount >= Math.max(1, ctx.minPending - 1) && ctx.futureBuys === 0) {
    return {
      status: "PUSH FOR 1 MORE",
      reason: "You are close to threshold, but the package is still a bit thin.",
    }
  }

  return {
    status: "not yet",
    reason: "Build a stronger augmentation queue first.",
  }
}

function buildMarket(ns, factions, owned) {
  const bestByAug = new Map()

  for (const faction of factions) {
    const augs = getAugsFromFactionSafe(ns, faction)

    for (const aug of augs) {
      if (aug === "NeuroFlux Governor") continue
      if (owned.has(aug)) continue

      const entry = {
        aug,
        faction,
        price: getAugPriceSafe(ns, aug),
        repReq: getAugRepReqSafe(ns, aug),
        prereqs: getAugPrereqsSafe(ns, aug),
        stats: getAugStatsSafe(ns, aug),
      }

      const existing = bestByAug.get(aug)
      if (!existing) {
        bestByAug.set(aug, entry)
        continue
      }

      if (getFactionRepSafe(ns, faction) > getFactionRepSafe(ns, existing.faction)) {
        bestByAug.set(aug, entry)
      }
    }
  }

  return Array.from(bestByAug.values())
}

function scoreCandidate(ns, entry) {
  const stats = entry.stats || {}
  const faction = String(entry.faction || "")

  const hackingScore =
    weight(stats.hacking, 18) +
    weight(stats.hacking_exp, 14) +
    weight(stats.hacking_chance, 12) +
    weight(stats.hacking_speed, 12) +
    weight(stats.hacking_money, 10) +
    weight(stats.hacking_grow, 8)

  const repScore =
    weight(stats.faction_rep, 10) +
    weight(stats.company_rep, 3)

  const combatScore =
    weight(stats.strength, 10) +
    weight(stats.defense, 10) +
    weight(stats.dexterity, 10) +
    weight(stats.agility, 10) +
    weight(stats.crime_success, 10)

  let score = hackingScore + repScore * 0.9 - combatScore * 0.85

  const factionBoosts = new Map([
    ["CyberSec", 60],
    ["Tian Di Hui", 45],
    ["NiteSec", 70],
    ["The Black Hand", 75],
    ["BitRunners", 90],
    ["Daedalus", 100],
    ["Illuminati", 60],
    ["The Covenant", 50],
    ["Netburners", 40],
  ])

  const factionPenalties = new Map([
    ["Slum Snakes", -120],
    ["Tetrads", -120],
    ["Speakers for the Dead", -80],
    ["The Syndicate", -40],
  ])

  score += (factionBoosts.get(faction) ?? 0)
  score += (factionPenalties.get(faction) ?? 0)

  const hasMeaningfulHacking = hackingScore > 0
  const hasMeaningfulRep = repScore > 0

  if (!hasMeaningfulHacking && !hasMeaningfulRep && entry.aug !== "The Red Pill") {
    return -1
  }

  if (entry.aug === "The Red Pill") {
    score += 5000
  }

  return score
}

function getOwnedAugsSafe(ns, includePending) {
  try {
    return ns.singularity.getOwnedAugmentations(includePending) || []
  } catch {
    return []
  }
}

function getFactionRepSafe(ns, faction) {
  try {
    return ns.singularity.getFactionRep(faction)
  } catch {
    return 0
  }
}

function getAugsFromFactionSafe(ns, faction) {
  try {
    return ns.singularity.getAugmentationsFromFaction(faction) || []
  } catch {
    return []
  }
}

function getAugStatsSafe(ns, aug) {
  try {
    return ns.singularity.getAugmentationStats(aug) || {}
  } catch {
    return {}
  }
}

function getAugPriceSafe(ns, aug) {
  try {
    return Number(ns.singularity.getAugmentationPrice(aug) ?? 0)
  } catch {
    return 0
  }
}

function getAugRepReqSafe(ns, aug) {
  try {
    return Number(ns.singularity.getAugmentationRepReq(aug) ?? 0)
  } catch {
    return 0
  }
}

function getAugPrereqsSafe(ns, aug) {
  try {
    return ns.singularity.getAugmentationPrereq(aug) || []
  } catch {
    return []
  }
}

function safeHeartBreak(ns) {
  try {
    return ns.heart.break()
  } catch {
    return 0
  }
}

function safeInGang(ns) {
  try {
    return !!ns.gang && ns.gang.inGang()
  } catch {
    return false
  }
}

function fmtMoney(ns, value) {
  return "$" + ns.formatNumber(value, 3)
}

function weight(value, factor) {
  const n = Number(value ?? 1)
  if (!Number.isFinite(n) || n <= 1) return 0
  return (n - 1) * factor
}