/** @param {NS} ns **/
export async function main(ns) {
    ns.disableLog("sleep");
    ns.clearLog();

    const factionName = String(ns.args[0] ?? "Slum Snakes");
    const pollMs = Math.max(1000, Number(ns.args[1] ?? 5000));
    const karmaTarget = Number(ns.args[2] ?? -54000);

    const gangManager = "/gang/gangManager_v2.js";
    const stopCrime = "/crime/stop-crime.js";

    ns.tprint(`[autoGangStarter] watching faction=${factionName} karmaTarget=${karmaTarget}`);

    while (true) {
        try {
            const player = ns.getPlayer();
            const factions = player.factions || [];
            const inGang = safeInGang(ns);
            const karma = safeHeartBreak(ns);
            const joinedFaction = factions.includes(factionName);

            if (inGang) {
                ns.tprint("[autoGangStarter] Gang already active.");

                if (ns.fileExists(stopCrime, "home")) {
                    ns.run(stopCrime, 1);
                }

                startGangManagerIfMissing(ns, gangManager);
                return;
            }

            if (!joinedFaction) {
                ns.print(`[autoGangStarter] Waiting for faction join: ${factionName}`);
                await ns.sleep(pollMs);
                continue;
            }

            if (karma > karmaTarget) {
                ns.print(
                    `[autoGangStarter] Waiting for karma. current=${ns.formatNumber(karma, 3)} target=${ns.formatNumber(karmaTarget, 3)}`
                );
                await ns.sleep(pollMs);
                continue;
            }

            const created = tryCreateGang(ns, factionName);

            if (created || safeInGang(ns)) {
                ns.tprint(`[autoGangStarter] Gang created for ${factionName}.`);

                if (ns.fileExists(stopCrime, "home")) {
                    ns.run(stopCrime, 1);
                }

                startGangManagerIfMissing(ns, gangManager);
                return;
            }

            ns.tprint(`[autoGangStarter] Tried to create gang for ${factionName}, but it did not activate yet.`);
        } catch (err) {
            ns.tprint(`[autoGangStarter] ERROR: ${String(err)}`);
        }

        await ns.sleep(pollMs);
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

function tryCreateGang(ns, factionName) {
    try {
        return !!ns.gang.createGang(factionName);
    } catch {
        return false;
    }
}

function startGangManagerIfMissing(ns, script) {
    if (!ns.fileExists(script, "home")) {
        ns.tprint(`[autoGangStarter] Missing ${script}`);
        return false;
    }

    const running = ns.ps("home").some((p) => p.filename === script);
    if (running) {
        ns.tprint("[autoGangStarter] gangManager already running.");
        return true;
    }

    const pid = ns.run(script, 1, 150e9, "money", "rep");
    if (pid === 0) {
        ns.tprint("[autoGangStarter] Failed to start gangManager.");
        return false;
    }

    ns.tprint("[autoGangStarter] Started gangManager_v2.js");
    return true;
}