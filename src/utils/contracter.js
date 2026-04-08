// utils/contracter.js

const settings = {
  keys: {
    serverMap: "BB_SERVER_MAP",
  },
}

const RETRY_DELAY_MS = 25

function getItem(key) {
  const item = localStorage.getItem(key)
  return item ? JSON.parse(item) : undefined
}

function localeHHMMSS(ms = 0) {
  if (!ms) ms = Date.now()
  return new Date(ms).toLocaleTimeString()
}

function safeStringify(obj) {
  return JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
}

function convert2DArrayToString(arr) {
  return arr.map(e => `[${e}]`).join(",").replace(/\s/g, "")
}

const codingContractTypesMetadata = [

  // --- EXISTING ONES (shortened for clarity, keep yours intact) ---

  {
    name: "Total Ways to Sum II",
    solver: function (data) {
      const target = data[0]
      const nums = data[1]

      const dp = Array(target + 1).fill(0)
      dp[0] = 1

      for (const num of nums) {
        for (let i = num; i <= target; i++) {
          dp[i] += dp[i - num]
        }
      }

      return dp[target]
    },
  },

  {
    name: "Compression III: LZ Compression",
    solver: function (data) {

      function compress(input) {
        let best = null

        function dfs(pos, out, literal) {
          if (pos >= input.length) {
            if (!best || out.length < best.length) best = out
            return
          }

          if (best && out.length >= best.length) return

          if (literal) {
            for (let len = 1; len <= 9 && pos + len <= input.length; len++) {
              dfs(pos + len, out + len + input.slice(pos, pos + len), false)
            }
          } else {
            for (let len = 1; len <= 9 && pos + len <= input.length; len++) {
              for (let offset = 1; offset <= Math.min(9, pos); offset++) {
                let valid = true
                for (let k = 0; k < len; k++) {
                  if (input[pos + k] !== input[pos - offset + k]) {
                    valid = false
                    break
                  }
                }
                if (valid) {
                  dfs(pos + len, out + len + offset, true)
                }
              }
            }
          }
        }

        dfs(0, "", true)
        return best || ""
      }

      return compress(data)
    },
  },

  // --- KEEP ALL YOUR OTHER SOLVERS BELOW THIS LINE ---

]

const knownContractTypes = new Set(codingContractTypesMetadata.map(x => x.name))

function findSolver(type) {
  return codingContractTypesMetadata.find(entry => entry.name === type)
}

function findAnswer(contract) {
  const solverEntry = findSolver(contract.type)
  if (!solverEntry) return null
  return solverEntry.solver(contract.data)
}

function getAttemptVariants(answer) {
  const variants = []
  const seen = new Set()

  function addVariant(value) {
    const key = safeStringify(value)
    if (!seen.has(key)) {
      seen.add(key)
      variants.push(value)
    }
  }

  addVariant(answer)

  if (Array.isArray(answer)) {
    addVariant(JSON.stringify(answer))
    if (answer.length > 0 && Array.isArray(answer[0])) {
      addVariant(convert2DArrayToString(answer))
    }
  } else if (typeof answer === "number") {
    addVariant(answer.toString())
  } else if (typeof answer === "bigint") {
    addVariant(answer.toString())
  }

  return variants
}

async function attemptWithRetry(ns, contract, answer) {
  const variants = getAttemptVariants(answer)

  for (let i = 0; i < variants.length; i++) {
    const candidate = variants[i]
    const reward = ns.codingcontract.attempt(
      candidate,
      contract.contract,
      contract.hostname,
      { returnReward: true }
    )

    if (reward) {
      return {
        success: true,
        reward,
        attemptIndex: i,
        answerUsed: candidate,
      }
    }

    if (i < variants.length - 1) {
      await ns.sleep(RETRY_DELAY_MS)
    }
  }

  return { success: false }
}

export async function main(ns) {
  ns.tprint(`[${localeHHMMSS()}] Starting contracter.js`)

  const hostname = ns.getHostname()
  if (hostname !== "home") {
    throw new Error("Run the script from home")
  }

  const serverMap = getItem(settings.keys.serverMap)
  if (!serverMap || !serverMap.servers) {
    ns.tprint(`[${localeHHMMSS()}] ERROR: Missing server map`)
    return
  }

  const contractsDb = []
  const skippedUnknown = []

  for (const targetHost of Object.keys(serverMap.servers)) {
    const files = ns.ls(targetHost)
    const contracts = files.filter(f => f.endsWith(".cct"))

    for (const contractFile of contracts) {
      const type = ns.codingcontract.getContractType(contractFile, targetHost)

      if (!knownContractTypes.has(type)) {
        skippedUnknown.push({ contractFile, targetHost, type })
        continue
      }

      contractsDb.push({
        contract: contractFile,
        hostname: targetHost,
        type,
        data: ns.codingcontract.getData(contractFile, targetHost),
      })
    }
  }

  for (const skipped of skippedUnknown) {
    ns.tprint(`[${localeHHMMSS()}] Skipping unsupported "${skipped.type}"`)
  }

  for (const contract of contractsDb) {
    let answer = null

    try {
      answer = findAnswer(contract)
    } catch (err) {
      ns.tprint(`Solver crash: ${contract.type}`)
      continue
    }

    if (answer == null) continue

    const result = await attemptWithRetry(ns, contract, answer)

    if (result.success) {
      ns.tprint(`Solved ${contract.contract} -> ${result.reward}`)
    } else {
      ns.tprint(`Failed ${contract.contract}`)
    }
  }
}