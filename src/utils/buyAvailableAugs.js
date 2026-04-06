/** @param {NS} ns **/
export async function main(ns) {
    const mode = String(ns.args[0] ?? "hacking").toLowerCase();
    const reserve = Math.max(0, Number(ns.args[1] ?? 0));
    const includeNeuroFlux = String(ns.args[2] ?? "false").toLowerCase() === "true";

    if (!hasAugApi(ns)) {
        ns.tprint("[buyAvailableAugs] Singularity augmentation API unavailable.");
        return;
    }

    const validModes = new Set(["hacking", "combat", "balanced"]);
    if (!validModes.has(mode)) {
        ns.tprint(`[buyAvailableAugs] Invalid mode: ${mode}`);
        ns.tprint("[buyAvailableAugs] Usage: run utils/buyAvailableAugs.js [hacking|combat|balanced] [reserve] [includeNeuroFlux]");
        return;
    }

    const result = buyAvailableAugs(ns, { mode, reserve, includeNeuroFlux });

    ns.tprint(`[buyAvailableAugs] mode=${mode} reserve=${ns.formatNumber(reserve)} includeNeuroFlux=${includeNeuroFlux}`);
    ns.tprint(`[buyAvailableAugs] Bought ${result.bought.length} augmentations.`);

    if (result.bought.length > 0) {
        for (const item of result.bought) {
            ns.tprint(
                `[buyAvailableAugs] BOUGHT ${item.aug} from ${item.faction} for ${ns.formatNumber(item.price)}`
            );
        }
    }

    if (result.skipped.length > 0) {
        ns.tprint(`[buyAvailableAugs] Skipped ${result.skipped.length} augmentations.`);
    }

    if (result.remainingTop.length > 0) {
        ns.tprint("[buyAvailableAugs] Top remaining candidates:");
        for (const item of result.remainingTop) {
            ns.tprint(
                `[buyAvailableAugs] ${item.aug} | faction=${item.faction} | price=${ns.formatNumber(item.price)} | repReq=${ns.formatNumber(item.repReq)} | score=${item.score.toFixed(2)}`
            );
        }
    }
}

export function buyAvailableAugs(ns, opts = {}) {
    const mode = String(opts.mode ?? "hacking").toLowerCase();
    const reserve = Math.max(0, Number(opts.reserve ?? 0));
    const includeNeuroFlux = !!opts.includeNeuroFlux;

    const player = ns.getPlayer();
    const joinedFactions = Array.isArray(player.factions) ? player.factions.slice() : [];
    const owned = new Set(getOwnedAugsSafe(ns, true));

    const market = buildFactionAugMarket(ns, joinedFactions, owned, includeNeuroFlux);
    const skipped = [];
    const bought = [];

    if (market.length === 0) {
        return { bought, skipped, remainingTop: [] };
    }

    const purchasedNow = new Set();

    while (true) {
        const moneyAvailable = Math.max(0, ns.getServerMoneyAvailable("home") - reserve);

        const candidates = [];

        for (const entry of market) {
            if (owned.has(entry.aug) || purchasedNow.has(entry.aug)) continue;

            const missingPrereqs = entry.prereqs.filter((p) => !owned.has(p) && !purchasedNow.has(p));
            const rep = getFactionRepSafe(ns, entry.faction);

            const score = scoreAug(ns, entry.aug, mode);

            candidates.push({
                ...entry,
                factionRep: rep,
                missingPrereqs,
                score,
            });
        }

        if (candidates.length === 0) break;

        candidates.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.price !== b.price) return a.price - b.price;
            return a.aug.localeCompare(b.aug);
        });

        let madeProgress = false;

        for (const candidate of candidates) {
            const chain = buildPurchaseChain(ns, candidate, market, owned, purchasedNow);
            if (!chain) {
                skipped.push({ aug: candidate.aug, faction: candidate.faction, reason: "missing-prereq-chain" });
                continue;
            }

            const chainCost = chain.reduce((sum, item) => sum + item.price, 0);
            if (chainCost > moneyAvailable) {
                skipped.push({ aug: candidate.aug, faction: candidate.faction, reason: "insufficient-money" });
                continue;
            }

            const repBlocked = chain.find((item) => getFactionRepSafe(ns, item.faction) < item.repReq);
            if (repBlocked) {
                skipped.push({ aug: candidate.aug, faction: candidate.faction, reason: `insufficient-rep:${repBlocked.aug}` });
                continue;
            }

            const chainBought = [];
            let chainOk = true;

            for (const item of chain) {
                if (owned.has(item.aug) || purchasedNow.has(item.aug)) continue;

                const ok = purchaseAugSafe(ns, item.faction, item.aug);
                if (!ok) {
                    chainOk = false;
                    skipped.push({ aug: item.aug, faction: item.faction, reason: "purchase-failed" });
                    break;
                }

                purchasedNow.add(item.aug);
                chainBought.push(item);
                bought.push(item);
            }

            if (chainOk && chainBought.length > 0) {
                madeProgress = true;
                break;
            }
        }

        if (!madeProgress) break;
    }

    const remainingTop = buildFactionAugMarket(ns, joinedFactions, new Set(getOwnedAugsSafe(ns, true)), includeNeuroFlux)
        .filter((x) => !owned.has(x.aug) && !purchasedNow.has(x.aug))
        .map((x) => ({
            ...x,
            score: scoreAug(ns, x.aug, mode),
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (a.price !== b.price) return a.price - b.price;
            return a.aug.localeCompare(b.aug);
        })
        .slice(0, 8);

    return { bought, skipped, remainingTop };
}

function hasAugApi(ns) {
    try {
        return !!ns.singularity &&
            typeof ns.singularity.getAugmentationsFromFaction === "function" &&
            typeof ns.singularity.getAugmentationStats === "function" &&
            typeof ns.singularity.getAugmentationPrice === "function" &&
            typeof ns.singularity.getAugmentationRepReq === "function" &&
            typeof ns.singularity.getAugmentationPrereq === "function" &&
            typeof ns.singularity.purchaseAugmentation === "function";
    } catch {
        return false;
    }
}

function getOwnedAugsSafe(ns, includePending) {
    try {
        return ns.singularity.getOwnedAugmentations(includePending);
    } catch {
        return [];
    }
}

function getFactionRepSafe(ns, faction) {
    try {
        return ns.singularity.getFactionRep(faction);
    } catch {
        return 0;
    }
}

function getAugsFromFactionSafe(ns, faction) {
    try {
        return ns.singularity.getAugmentationsFromFaction(faction) || [];
    } catch {
        return [];
    }
}

function getAugStatsSafe(ns, aug) {
    try {
        return ns.singularity.getAugmentationStats(aug) || {};
    } catch {
        return {};
    }
}

function getAugPriceSafe(ns, aug) {
    try {
        return Number(ns.singularity.getAugmentationPrice(aug) ?? Infinity);
    } catch {
        return Infinity;
    }
}

function getAugRepReqSafe(ns, aug) {
    try {
        return Number(ns.singularity.getAugmentationRepReq(aug) ?? Infinity);
    } catch {
        return Infinity;
    }
}

function getAugPrereqsSafe(ns, aug) {
    try {
        return ns.singularity.getAugmentationPrereq(aug) || [];
    } catch {
        return [];
    }
}

function purchaseAugSafe(ns, faction, aug) {
    try {
        return !!ns.singularity.purchaseAugmentation(faction, aug);
    } catch {
        return false;
    }
}

function buildFactionAugMarket(ns, factions, owned, includeNeuroFlux) {
    const bestByAug = new Map();

    for (const faction of factions) {
        const augs = getAugsFromFactionSafe(ns, faction);

        for (const aug of augs) {
            if (!includeNeuroFlux && aug === "NeuroFlux Governor") continue;
            if (owned.has(aug)) continue;

            const entry = {
                aug,
                faction,
                price: getAugPriceSafe(ns, aug),
                repReq: getAugRepReqSafe(ns, aug),
                prereqs: getAugPrereqsSafe(ns, aug),
            };

            const existing = bestByAug.get(aug);
            if (!existing) {
                bestByAug.set(aug, entry);
                continue;
            }

            const existingRep = getFactionRepSafe(ns, existing.faction);
            const newRep = getFactionRepSafe(ns, faction);

            if (newRep > existingRep) {
                bestByAug.set(aug, entry);
            }
        }
    }

    return Array.from(bestByAug.values());
}

function buildPurchaseChain(ns, candidate, market, owned, purchasedNow) {
    const byAug = new Map(market.map((x) => [x.aug, x]));
    const visiting = new Set();
    const visited = new Set();
    const chain = [];

    function dfs(augName) {
        if (owned.has(augName) || purchasedNow.has(augName)) return true;
        if (visited.has(augName)) return true;
        if (visiting.has(augName)) return false;

        const entry = byAug.get(augName);
        if (!entry) return false;

        visiting.add(augName);

        for (const prereq of entry.prereqs) {
            if (!dfs(prereq)) return false;
        }

        visiting.delete(augName);
        visited.add(augName);
        chain.push(entry);
        return true;
    }

    if (!dfs(candidate.aug)) return null;
    return chain;
}

function scoreAug(ns, aug, mode) {
    const stats = getAugStatsSafe(ns, aug);

    const hackingScore =
        weight(stats.hacking, 12) +
        weight(stats.hacking_exp, 10) +
        weight(stats.hacking_chance, 8) +
        weight(stats.hacking_speed, 8) +
        weight(stats.hacking_money, 7) +
        weight(stats.hacking_grow, 6) +
        weight(stats.faction_rep, 6) +
        weight(stats.company_rep, 2) +
        weight(stats.charisma, 1) +
        weight(stats.charisma_exp, 1);

    const combatScore =
        weight(stats.strength, 8) +
        weight(stats.strength_exp, 5) +
        weight(stats.defense, 8) +
        weight(stats.defense_exp, 5) +
        weight(stats.dexterity, 8) +
        weight(stats.dexterity_exp, 5) +
        weight(stats.agility, 8) +
        weight(stats.agility_exp, 5) +
        weight(stats.crime_money, 6) +
        weight(stats.crime_success, 8);

    const utilityScore =
        weight(stats.faction_rep, 6) +
        weight(stats.company_rep, 5) +
        weight(stats.work_money, 3) +
        weight(stats.hacknet_node_money, 1) +
        weight(stats.hacknet_node_purchase_cost, 0.5) +
        weight(stats.hacknet_node_level_cost, 0.5) +
        weight(stats.hacknet_node_ram_cost, 0.5) +
        weight(stats.hacknet_node_core_cost, 0.5);

    let score = 0;

    if (mode === "hacking") {
        score = hackingScore + combatScore * 0.15 + utilityScore * 0.50;
    } else if (mode === "combat") {
        score = combatScore + hackingScore * 0.15 + utilityScore * 0.35;
    } else {
        score = hackingScore * 0.75 + combatScore * 0.55 + utilityScore * 0.80;
    }

    if (aug === "The Red Pill") {
        score += mode === "hacking" ? 1000 : 250;
    }

    return score;
}

function weight(value, factor) {
    const n = Number(value ?? 1);
    if (!Number.isFinite(n) || n <= 1) return 0;
    return (n - 1) * factor;
}