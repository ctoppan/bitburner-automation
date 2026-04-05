/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");
    ns.clearLog();

    const mode = String(ns.args[0] ?? "auto").toLowerCase();
    const pollMs = Math.max(1000, Number(ns.args[1] ?? 1500));

    const crimeStats = [
        "shoplift",
        "rob store",
        "mug",
        "larceny",
        "deal drugs",
        "bond forgery",
        "traffick illegal arms",
        "homicide",
        "grand theft auto",
        "kidnap",
        "assassination",
        "heist",
    ];

    ns.tprint(`[${ts()}] Starting crimeManager.js in mode: ${mode}`);

    if (!hasSingularityCrime(ns)) {
        ns.tprint(`[${ts()}] WARNING: Singularity crime functions unavailable. Exiting.`);
        return;
    }

    let lastCrime = "";
    let lastLog = 0;

    while (true) {
        try {
            const selectedMode = resolveMode(ns, mode);
            const bestCrime = pickBestCrime(ns, crimeStats, selectedMode);

            if (!bestCrime) {
                ns.print(`[crimeManager] No viable crime found for mode=${selectedMode}`);
                await ns.sleep(pollMs);
                continue;
            }

            const currentWork = getCurrentWorkSafe(ns);
            const alreadyDoingCrime =
                currentWork &&
                currentWork.type === "CRIME" &&
                normalizeCrimeName(currentWork.crimeType) === normalizeCrimeName(bestCrime.name);

            const now = Date.now();
            const shouldLog =
                bestCrime.name !== lastCrime ||
                now - lastLog > 15000;

            if (shouldLog) {
                ns.tprint(
                    `[${ts()}] Crime: ${bestCrime.name} | chance=${(bestCrime.chance * 100).toFixed(1)}% | ` +
                    `money=${ns.formatNumber(bestCrime.moneyPerSecond, 2)} | karma=${bestCrime.karmaPerSecond.toFixed(2)} | ` +
                    `mode=${selectedMode}`
                );
                lastCrime = bestCrime.name;
                lastLog = now;
            }

            if (!alreadyDoingCrime) {
                tryCommitCrime(ns, bestCrime.name);
            }

            await ns.sleep(pollMs);
        } catch (err) {
            ns.tprint(`[${ts()}] ERROR: ${String(err)}`);
            await ns.sleep(pollMs);
        }
    }
}

function hasSingularityCrime(ns) {
    try {
        return !!ns.singularity &&
            typeof ns.singularity.commitCrime === "function" &&
            typeof ns.singularity.getCrimeChance === "function" &&
            typeof ns.singularity.getCrimeStats === "function";
    } catch {
        return false;
    }
}

function resolveMode(ns, requestedMode) {
    if (requestedMode === "money" || requestedMode === "karma") {
        return requestedMode;
    }

    const player = safeGetPlayer(ns);
    const karma = safeHeartBreak(ns);

    const hasGang = safeInGang(ns);
    if (hasGang) {
        return "money";
    }

    if (karma > -54000) {
        return "karma";
    }

    if ((player?.money ?? 0) < 5e6) {
        return "money";
    }

    return "karma";
}

function pickBestCrime(ns, crimes, mode) {
    const scored = [];

    for (const crime of crimes) {
        const stats = getCrimeStatsSafe(ns, crime);
        if (!stats) continue;

        const chance = clamp01(getCrimeChanceSafe(ns, crime));
        if (chance <= 0) continue;

        const time = Math.max(1, Number(stats.time ?? 0));
        const money = Number(stats.money ?? 0);
        const karma = Math.abs(Number(stats.karma ?? 0));

        const moneyPerSecond = (money * chance) / (time / 1000);
        const karmaPerSecond = (karma * chance) / (time / 1000);

        let score = 0;

        if (mode === "money") {
            if (chance < 0.6) continue;
            score = moneyPerSecond;
        } else {
            if (chance < 0.4) continue;
            score = karmaPerSecond;
        }

        scored.push({
            name: crime,
            chance,
            moneyPerSecond,
            karmaPerSecond,
            score,
        });
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.chance !== a.chance) return b.chance - a.chance;
        return a.name.localeCompare(b.name);
    });

    return scored[0] || null;
}

function tryCommitCrime(ns, crime) {
    try {
        ns.singularity.commitCrime(crime, false);
        return true;
    } catch {
        return false;
    }
}

function getCrimeStatsSafe(ns, crime) {
    try {
        return ns.singularity.getCrimeStats(crime);
    } catch {
        return null;
    }
}

function getCrimeChanceSafe(ns, crime) {
    try {
        return ns.singularity.getCrimeChance(crime);
    } catch {
        return 0;
    }
}

function getCurrentWorkSafe(ns) {
    try {
        if (!ns.singularity?.getCurrentWork) return null;
        return ns.singularity.getCurrentWork();
    } catch {
        return null;
    }
}

function safeGetPlayer(ns) {
    try {
        return ns.getPlayer();
    } catch {
        return null;
    }
}

function safeHeartBreak(ns) {
    try {
        return ns.heart.break();
    } catch {
        return 0;
    }
}

function safeInGang(ns) {
    try {
        return !!ns.gang && ns.gang.inGang();
    } catch {
        return false;
    }
}

function normalizeCrimeName(name) {
    return String(name || "").trim().toLowerCase();
}

function clamp01(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function ts() {
    return new Date().toLocaleTimeString();
}