/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");
    ns.tprint(`[${ts()}] Starting initHacking.js`);

    const killAllScript = "/hacking/main/killAll.js";
    const xpDistributor = "/xp/xpDistributor.js";
    const stopXp = "/xp/stopXpGrind.js";
    const hackOrchestrator = "/bootstrap/hackOrchestrator.js";
    const gangManager = "/gang/gangManager_v2.js";
    const crimeManager = "/crime/crimeManager.js";
    const autoGangStarter = "/gang/autoGangStarter.js";

    const xpTarget = "n00dles";
    const xpReserveRam = 512;
    const xpAllowSpread = true;

    const orchestratorHackThreshold = 150;
    const orchestratorMinRootedMoneyServers = 5;
    const orchestratorMinHomeRamGb = 128;
    const pollMs = 15000;

    if (!ns.fileExists(killAllScript, "home")) {
        ns.tprint(`[${ts()}] ERROR: Missing ${killAllScript}`);
        return;
    }

    if (!ns.fileExists(xpDistributor, "home")) {
        ns.tprint(`[${ts()}] ERROR: Missing ${xpDistributor}`);
        return;
    }

    ns.tprint(`[${ts()}] Running cleanup with ${killAllScript}`);
    const killPid = ns.run(killAllScript, 1, ns.pid);
    if (killPid === 0) {
        ns.tprint(`[${ts()}] ERROR: Failed to start ${killAllScript}`);
        return;
    }

    await ns.sleep(1000);

    startIfMissing(ns, xpDistributor, [xpTarget, xpReserveRam, xpAllowSpread]);
    await ns.sleep(250);

    if (hasGang(ns)) {
        startIfMissing(ns, gangManager, [150e9, "money", "rep"]);
    } else {
        startIfMissing(ns, crimeManager, ["karma"]);
        await ns.sleep(250);
        startIfMissing(ns, autoGangStarter, ["Slum Snakes", 5000, -54000]);
    }

    while (true) {
        try {
            if (hasGang(ns)) {
                startIfMissing(ns, gangManager, [150e9, "money", "rep"]);
            }

            const shouldRunOrchestrator = shouldSwitchToOrchestrator(
                ns,
                orchestratorHackThreshold,
                orchestratorMinRootedMoneyServers,
                orchestratorMinHomeRamGb
            );

            const orchestratorRunning = isRunning(ns, hackOrchestrator);
            const xpRunning = isRunning(ns, "/xp/xpGrind.js") || isRunning(ns, xpDistributor);

            if (shouldRunOrchestrator) {
                if (!orchestratorRunning && ns.fileExists(hackOrchestrator, "home")) {
                    ns.tprint(`[${ts()}] Switching to orchestrator mode.`);
                    const stopped = stopXpIfPossible(ns, stopXp);
                    if (!stopped) {
                        killScriptEverywhere(ns, "/xp/xpGrind.js");
                        killScriptEverywhere(ns, xpDistributor);
                    }
                    await ns.sleep(500);
                    startIfMissing(ns, hackOrchestrator, []);
                }
            } else {
                if (!xpRunning) {
                    ns.tprint(`[${ts()}] Staying in XP mode.`);
                    startIfMissing(ns, xpDistributor, [xpTarget, xpReserveRam, xpAllowSpread]);
                }
            }
        } catch (err) {
            ns.tprint(`[${ts()}] ERROR: ${String(err)}`);
        }

        await ns.sleep(pollMs);
    }
}

function shouldSwitchToOrchestrator(ns, hackThreshold, minRootedMoneyServers, minHomeRamGb) {
    const hack = ns.getHackingLevel();
    const homeRam = ns.getServerMaxRam("home");
    const rootedMoneyServers = countRootedMoneyServers(ns);

    return (
        hack >= hackThreshold &&
        homeRam >= minHomeRamGb &&
        rootedMoneyServers >= minRootedMoneyServers
    );
}

function countRootedMoneyServers(ns) {
    const all = getAllServers(ns);
    let count = 0;

    for (const host of all) {
        if (host === "home") continue;
        if (!ns.hasRootAccess(host)) continue;
        if (ns.getServerMaxMoney(host) <= 0) continue;
        count++;
    }

    return count;
}

function getAllServers(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];
    const out = ["home"];

    while (queue.length > 0) {
        const host = queue.shift();
        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
                out.push(next);
            }
        }
    }

    return out;
}

function hasGang(ns) {
    try {
        return !!ns.gang && ns.gang.inGang();
    } catch {
        return false;
    }
}

function startIfMissing(ns, script, args = []) {
    if (!ns.fileExists(script, "home")) return false;
    if (isRunningWithArgs(ns, script, args)) return true;
    return ns.run(script, 1, ...args) !== 0;
}

function isRunning(ns, script) {
    for (const host of getAllServers(ns)) {
        const procs = ns.ps(host);
        if (procs.some((p) => p.filename === script)) return true;
    }
    return false;
}

function isRunningWithArgs(ns, script, args = []) {
    for (const host of getAllServers(ns)) {
        const procs = ns.ps(host);
        for (const p of procs) {
            if (p.filename !== script) continue;
            if (sameArgs(p.args, args)) return true;
        }
    }
    return false;
}

function sameArgs(actual, desired) {
    if (actual.length !== desired.length) return false;
    for (let i = 0; i < actual.length; i++) {
        if (String(actual[i]) !== String(desired[i])) return false;
    }
    return true;
}

function stopXpIfPossible(ns, stopXpScript) {
    if (!ns.fileExists(stopXpScript, "home")) return false;
    return ns.run(stopXpScript, 1) !== 0;
}

function killScriptEverywhere(ns, script) {
    for (const host of getAllServers(ns)) {
        ns.scriptKill(script, host);
    }
}

function ts() {
    return new Date().toLocaleTimeString();
}