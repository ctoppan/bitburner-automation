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

    const market = buildFactionAugMarket(ns, joinedFactions, owned, includeNeuroFlux, mode);
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

            const score = scoreAug(ns, entry, mode);
            if (score <= 0) {
                skipped.push({ aug: entry.aug, faction: entry.faction, reason: "filtered-by-mode" });
                continue;
            }

            candidates.push({
                ...entry,
                factionRep: getFactionRepSafe(ns, entry.faction),
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

            const chainWithScores = chain.map((item) => ({
                ...item,
                score: scoreAug(ns, item, mode),
            }));

            if (chainWithScores.some((item) => item.score <= 0)) {
                skipped.push({ aug: candidate.aug, faction: candidate.faction, reason: "chain-filtered-by-mode" });
                continue;
            }

            const chainCost = chainWithScores.reduce((sum, item) => sum + item.price, 0);
            if (chainCost > moneyAvailable) {
                skipped.push({ aug: candidate.aug, faction: candidate.faction, reason: "insufficient-money" });
                continue;
            }

            const repBlocked = chainWithScores.find((item) => getFactionRepSafe(ns, item.faction) < item.repReq);
            if (repBlocked) {
                skipped.push({ aug: candidate.aug, faction: candidate.faction, reason: `insufficient-rep:${repBlocked.aug}` });
                continue;
            }

            const chainBought = [];
            let chainOk = true;

            for (const item of chainWithScores) {
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

    const remainingTop = buildFactionAugMarket(
        ns,
        joinedFactions,
        new Set(getOwnedAugsSafe(ns, true)),
        includeNeuroFlux,
        mode
    )
        .filter((x) => !owned.has(x.aug) && !purchasedNow.has(x.aug))
        .map((x) => ({
            ...x,
            score: scoreAug(ns, x, mode),
        }))
        .filter((x) => x.score > 0)
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
        return ns.singularity.getOwnedAugmentations(includePending) || [];
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

function buildFactionAugMarket(ns, factions, owned, includeNeuroFlux, mode) {
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
                stats: getAugStatsSafe(ns, aug),
            };

            const score = scoreAug(ns, entry, mode);
            if (score <= 0) continue;

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

function scoreAug(ns, entry, mode) {
    const aug = entry.aug;
    const faction = entry.faction;
    const stats = entry.stats || getAugStatsSafe(ns, aug);

    const hackingScore =
        weight(stats.hacking, 18) +
        weight(stats.hacking_exp, 14) +
        weight(stats.hacking_chance, 12) +
        weight(stats.hacking_speed, 12) +
        weight(stats.hacking_money, 10) +
        weight(stats.hacking_grow, 8);

    const repScore =
        weight(stats.faction_rep, 10) +
        weight(stats.company_rep, 3);

    const combatScore =
        weight(stats.strength, 10) +
        weight(stats.strength_exp, 6) +
        weight(stats.defense, 10) +
        weight(stats.defense_exp, 6) +
        weight(stats.dexterity, 10) +
        weight(stats.dexterity_exp, 6) +
        weight(stats.agility, 10) +
        weight(stats.agility_exp, 6) +
        weight(stats.crime_money, 8) +
        weight(stats.crime_success, 10);

    const utilityScore =
        weight(stats.charisma, 2) +
        weight(stats.charisma_exp, 2) +
        weight(stats.work_money, 2) +
        weight(stats.hacknet_node_money, 1) +
        weight(stats.hacknet_node_purchase_cost, 0.5) +
        weight(stats.hacknet_node_level_cost, 0.5) +
        weight(stats.hacknet_node_ram_cost, 0.5) +
        weight(stats.hacknet_node_core_cost, 0.5);

    const hasMeaningfulHacking = hackingScore > 0;
    const hasMeaningfulRep = repScore > 0;
    const hasMeaningfulCombat = combatScore > 0;

    let score = 0;

    if (mode === "hacking") {
        if (!hasMeaningfulHacking && !hasMeaningfulRep && aug !== "The Red Pill") {
            return -1;
        }

        score = hackingScore + repScore * 0.9 + utilityScore * 0.15 - combatScore * 0.85;

        score += factionBias(mode, faction);

        if (hasMeaningfulCombat && !hasMeaningfulHacking && !hasMeaningfulRep) {
            score -= 1000;
        }

        if (aug === "The Red Pill") {
            score += 5000;
        }
    } else if (mode === "combat") {
        if (!hasMeaningfulCombat && !hasMeaningfulRep) {
            return -1;
        }

        score = combatScore + repScore * 0.4 + hackingScore * 0.1 + utilityScore * 0.2;
        score += factionBias(mode, faction);
    } else {
        score = hackingScore * 0.8 + combatScore * 0.6 + repScore * 0.8 + utilityScore * 0.4;
        score += factionBias(mode, faction) * 0.5;

        if (aug === "The Red Pill") {
            score += 2000;
        }
    }

    return score;
}

function factionBias(mode, faction) {
    const name = String(faction || "");

    const hackingFavored = new Map([
        ["CyberSec", 60],
        ["Tian Di Hui", 45],
        ["NiteSec", 70],
        ["The Black Hand", 75],
        ["BitRunners", 90],
        ["Daedalus", 100],
        ["Illuminati", 60],
        ["The Covenant", 50],
        ["Netburners", 40],
    ]);

    const hackingPenalized = new Map([
        ["Slum Snakes", -120],
        ["Tetrads", -120],
        ["Speakers for the Dead", -80],
        ["The Syndicate", -40],
    ]);

    const combatFavored = new Map([
        ["Slum Snakes", 80],
        ["Tetrads", 70],
        ["Speakers for the Dead", 65],
        ["The Syndicate", 50],
    ]);

    if (mode === "hacking") {
        return (hackingFavored.get(name) ?? 0) + (hackingPenalized.get(name) ?? 0);
    }

    if (mode === "combat") {
        return combatFavored.get(name) ?? 0;
    }

    return 0;
}

function weight(value, factor) {
    const n = Number(value ?? 1);
    if (!Number.isFinite(n) || n <= 1) return 0;
    return (n - 1) * factor;
}