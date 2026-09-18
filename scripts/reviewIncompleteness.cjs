// Single source for the "this review was not complete" banner used by .github/workflows/review.yml.
//
// WHY this is a shared file and not two inline snippets in the workflow YAML: review.yml renders
// the PR comment and the Step Summary in two SEPARATE scripts, each of which independently parsed
// findings.json and read `result.findings` and nothing else. That is the same defect this project
// has now hit four times -- `toolAvailability` reached some surfaces and missed others,
// `locationCheck` missed SARIF and MCP, `timings` needed a rule written for it, and `earlyExit`
// reached no formatter at all. Two copies of an incompleteness gate WILL drift, and the drift is
// silent because both copies keep rendering something plausible. Same reasoning as
// `formatRunTiming`, which exists so stderr, the markdown footer and the MCP note cannot disagree.
//
// WHY CommonJS: `actions/github-script` evaluates its body with `require` available, and the Step
// Summary step runs `node -e`. Both resolve from the workspace root, and neither can `import`.
//
// This deliberately does NOT reimplement severity formatting or finding rendering -- the workflow
// keeps its own presentation. The only thing centralised is the question "may this run be
// described as complete", which is the question that was being answered inconsistently.

/**
 * Lines describing why a review is incomplete. Empty array means the run may be reported as-is.
 * @param {object} result A parsed findings.json (ReviewResult envelope).
 * @returns {string[]}
 */
function incompletenessLines(result) {
  const lines = []
  if (!result || typeof result !== 'object') return lines

  const agentStatus = result.agentStatus || {}
  const agentsRan = Object.keys(agentStatus).length
  const failed = Object.entries(agentStatus).filter(([, s]) => s !== 'ok')
  // agentsPlanned, not agentsRan: agentStatus holds only agents that actually ran, so using it as
  // the denominator claims full coverage of a roster the run abandoned. Absent on results produced
  // by an older agent binary, in which case no ratio is stated rather than a wrong one.
  const planned = typeof result.agentsPlanned === 'number' ? result.agentsPlanned : undefined

  // `notRun !== 0` rather than merely "earlyExit is set": shouldEarlyExit is evaluated after every
  // agent including the LAST, so a run can stop early having already executed its whole roster.
  // Claiming a partial review then is false, and this surface posts to a PR. Unknown (an older
  // envelope with no agentsPlanned) counts as lost coverage -- the safe direction.
  // `undefined || > 0`, NOT `!== 0`. A malformed envelope where more agents ran than were planned
  // makes this negative, and `!== 0` trips on that -- so this copy would post "partial review" to
  // a PR while schema.ts (which floors at 0) and the vscode copy (which checks `> 0`) both stayed
  // silent. Caught by an opposition reviewer running all three against one input. Unreachable
  // through the real pipeline today, because chunkRunner floors the denominator and a single run
  // can only produce a prefix of its own roster -- but "the three copies agree" is the property
  // this file's existence depends on, and it did not hold.
  const notRunEarly = planned !== undefined ? planned - agentsRan : undefined
  if (
    result.earlyExit &&
    result.earlyExit.stoppedAt &&
    (notRunEarly === undefined || notRunEarly > 0)
  ) {
    const notRun = notRunEarly
    lines.push(
      `⚠️ **Fail-fast: this is a partial review.** The swarm stopped after \`${result.earlyExit.stoppedAt}\`` +
        (notRun !== undefined && notRun > 0
          ? `, so ${notRun} of ${planned} agents never ran.`
          : ', so the remaining agents never ran.') +
        ' Absence of a finding below does not mean absence of a defect.'
    )
  }

  const chunking = result.chunking
  if (chunking && chunking.reviewed < chunking.total) {
    lines.push(
      `⚠️ **Chunked review stopped early** — ${chunking.reviewed} of ${chunking.total} chunks were analyzed; the rest of the diff was never reviewed.`
    )
  }

  const truncation = result.truncation
  if (truncation && truncation.truncated) {
    lines.push(
      `⚠️ **Diff truncated** — reviewed ${truncation.keptLines}/${truncation.originalLines} lines. Findings past that point were never analyzed.`
    )
  }

  if (failed.length > 0) {
    const detail = failed.map(([name, status]) => `${name}: ${status}`).join(', ')
    lines.push(
      `⚠️ **${failed.length}/${planned !== undefined ? planned : agentsRan} agent(s) failed** (${detail}) — results may be incomplete.`
    )
  }

  return lines
}

/**
 * The verdict line for a run that produced no findings. A green check is only correct when the
 * review actually completed; otherwise "no findings" describes the portion that was looked at.
 * @param {object} result
 * @returns {string}
 */
function noFindingsVerdict(result) {
  return incompletenessLines(result).length > 0
    ? '⚠️ No issues found **in the portion reviewed** — this was not a complete review.'
    : '✅ No issues found.'
}

module.exports = { incompletenessLines, noFindingsVerdict }
