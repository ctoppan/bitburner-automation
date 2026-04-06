import { buyDarkwebPrograms } from "/utils/buyDarkwebPrograms.js";

/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");
    ns.clearLog();

    const xpDistributor = "/xp/xpDistributor.js";
    const gangManager = "/gang/gangManager_v2.js";
    const crimeManager = "/crime/crimeManager.js";

    startIfMissing(ns, xpDistributor, ["n00dles", 512, true]);

    while (true) {
        try {
            const darkweb = buyDarkwebPrograms(ns, [
                "BruteSSH.exe",
                "FTPCrack.exe",
                "relaySMTP.exe",
                "HTTPWorm.exe",
                "SQLInject.exe",
            ]);

            if (darkweb.boughtTor) {
                ns.print("[starter] Purchased TOR router");
            }

            if (darkweb.bought.length > 0) {
                ns.print(`[starter] Bought programs: ${darkweb.bought.join(", ")}`);
            }

            if (hasGang(ns)) {
                stopCrimeIfRunning(ns);
                startIfMissing(ns, gangManager, [150e9, "money", "rep"]);
            } else {
                startIfMissing(ns, crimeManager, ["karma"]);
            }
        } catch (err) {
            ns.print(`[starter] ERROR: ${String(err)}`);
        }

        await ns.sleep(15000);
    }
}

function hasGang(ns) {
    try {
        return !!ns.gang && ns.gang.inGang();
    } catch {
        return false;
    }
}

function stopCrimeIfRunning(ns) {
    const stopCrime = "/crime/stop-crime.js";
    if (!ns.fileExists(stopCrime, "home")) return;
    ns.run(stopCrime, 1);
}

function startIfMissing(ns, script, args = []) {
    if (!ns.fileExists(script, "home")) return false;

    const running = ns.ps("home").some(
        (p) => p.filename === script && sameArgs(p.args, args)
    );
    if (running) return true;

    return ns.run(script, 1, ...args) !== 0;
}

function sameArgs(actual, desired) {
    if (actual.length !== desired.length) return false;
    for (let i = 0; i < actual.length; i++) {
        if (String(actual[i]) !== String(desired[i])) return false;
    }
    return true;
}