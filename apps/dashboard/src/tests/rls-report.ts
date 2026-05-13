export interface TestResult {
  name: string
  passed: boolean
  expected: string
  actual: string
  critical: boolean
}

export function printReport(results: TestResult[]) {
  console.log('\n' + '='.repeat(64))
  console.log('  RLS ISOLATION TEST REPORT')
  console.log('='.repeat(64) + '\n')

  for (const r of results) {
    const icon = r.passed ? '\x1b[32m PASS\x1b[0m' : '\x1b[31m FAIL\x1b[0m'
    const crit = !r.passed && r.critical ? ' \x1b[31m<< CRITIQUE\x1b[0m' : ''
    console.log(`${icon} - ${r.name}${crit}`)
    if (!r.passed) {
      console.log(`       Expected: ${r.expected}`)
      console.log(`       Actual:   ${r.actual}`)
    }
  }

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const criticalFailed = results.filter((r) => !r.passed && r.critical).length

  console.log('\n' + '-'.repeat(64))
  console.log(
    `  ${passed}/${results.length} tests passed` +
      (failed > 0 ? ` | \x1b[31m${failed} failed\x1b[0m` : '') +
      (criticalFailed > 0 ? ` | \x1b[31m${criticalFailed} CRITICAL\x1b[0m` : '') +
      (failed === 0 ? ' | \x1b[32mALL CLEAR\x1b[0m' : ''),
  )
  console.log('-'.repeat(64) + '\n')

  return failed === 0
}
