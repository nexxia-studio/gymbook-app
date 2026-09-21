export interface TestResult {
  name: string
  passed: boolean
  expected: string
  actual: string
  critical: boolean
  /**
   * GYM-350 — vrai quand l'assertion est passée SANS RIEN POUVOIR PROUVER : la cible ne
   * contenait aucune ligne, donc « 0 ligne visible » aurait été obtenu RLS ou pas.
   *
   * C'est le défaut qui a rendu ce banc inerte pendant des mois. Un vert à vide n'est plus
   * silencieux : il est marqué dans le rapport et compté à part.
   */
  vacuous?: boolean
}

export function printReport(results: TestResult[]) {
  console.log('\n' + '='.repeat(72))
  console.log('  RLS ISOLATION TEST REPORT')
  console.log('='.repeat(72) + '\n')

  for (const r of results) {
    const icon = r.passed ? '\x1b[32m PASS\x1b[0m' : '\x1b[31m FAIL\x1b[0m'
    const crit = !r.passed && r.critical ? ' \x1b[31m<< CRITIQUE\x1b[0m' : ''
    const vac = r.passed && r.vacuous ? ' \x1b[33m<< À VIDE — ne prouve rien\x1b[0m' : ''
    console.log(`${icon} - ${r.name}${crit}${vac}`)
    if (!r.passed) {
      console.log(`       Expected: ${r.expected}`)
      console.log(`       Actual:   ${r.actual}`)
    } else if (r.vacuous) {
      console.log(`       ${r.actual}`)
    }
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const criticalFailed = results.filter((r) => !r.passed && r.critical).length
  const vacuous = results.filter((r) => r.passed && r.vacuous).length
  const proving = passed - vacuous

  console.log('\n' + '-'.repeat(72))
  console.log(
    `  ${passed}/${results.length} tests passed` +
      (failed > 0 ? ` | \x1b[31m${failed} failed\x1b[0m` : '') +
      (criticalFailed > 0 ? ` | \x1b[31m${criticalFailed} CRITICAL\x1b[0m` : '') +
      (failed === 0 ? ' | \x1b[32mALL CLEAR\x1b[0m' : ''),
  )
  console.log(`  dont \x1b[32m${proving} qui prouvent quelque chose\x1b[0m` +
    (vacuous > 0 ? ` | \x1b[33m${vacuous} à vide (cible sans données)\x1b[0m` : ''))
  console.log('-'.repeat(72) + '\n')

  return failed === 0
}
