/**
 * Automated test suite for All Deputations deep-link URL parameter support (?myPayLevel=10, ?myPayLevel=11).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appJsPath = join(__dirname, '../app.js')
const vacanciesPath = join(__dirname, '../data/vacancies.json')

const appJsCode = readFileSync(appJsPath, 'utf8')
const vacanciesData = JSON.parse(readFileSync(vacanciesPath, 'utf8'))

/**
 * Creates a simulated browser environment to run app.js functions and verify behavior.
 */
function createSimulatedEnv(searchQuery = '') {
  const optionsMap = new Map()
  for (let i = 18; i >= 1; i--) {
    optionsMap.set(String(i), `Level ${i}`)
  }

  const selectElement = {
    value: '',
    options: [
      { value: '', textContent: 'Any Level' },
      ...Array.from(optionsMap.entries()).map(([val, text]) => ({ value: val, textContent: text }))
    ]
  }

  const windowObj = {
    location: {
      search: searchQuery
    }
  }

  // Extract and evaluate applyUrlParameters in this scope
  const fnMatch = appJsCode.match(/function applyUrlParameters\(\)\s*\{[\s\S]*?\n\}/)
  if (!fnMatch) {
    throw new Error('applyUrlParameters function not found in app.js')
  }

  const applyUrlParameters = new Function('window', 'filterMyPayLevel', 'URLSearchParams', `
    ${fnMatch[0]}
    applyUrlParameters();
    return filterMyPayLevel.value;
  `)

  const resultValue = applyUrlParameters(windowObj, selectElement, URLSearchParams)

  return {
    selectValue: resultValue,
    selectElement
  }
}

// Replicate exact filtering from app.js
function parseLevelValue(value) {
  if (value == null) return null
  const str = String(value).trim()
  if (!str) return null
  const match = str.match(/\d+/)
  return match ? Number(match[0]) : null
}

function filterByMyPayLevel(data, levelStr) {
  return data.filter(item => {
    if (item.Status !== 'Active') return false
    const daysLeft = parseInt(item.Days_Left, 10)
    if (!Number.isNaN(daysLeft) && daysLeft < 0) return false

    if (!levelStr) return true

    const userLevel = Number(levelStr)
    const req1 = parseLevelValue(item.Req_Level1)
    const req2 = parseLevelValue(item.Req_Level2)

    if (req1 !== null && req2 !== null) {
      const minReq = Math.min(req1, req2)
      const maxReq = Math.max(req1, req2)
      if (userLevel < minReq || userLevel > maxReq) return false
      return true
    } else if (req1 !== null) {
      return userLevel === req1
    } else if (req2 !== null) {
      return userLevel === req2
    }
    return false
  })
}

test('1. Query parameter ?myPayLevel=10 initializes filter to "10"', () => {
  const env = createSimulatedEnv('?myPayLevel=10')
  assert.equal(env.selectValue, '10')
})

test('2. Query parameter ?myPayLevel=11 initializes filter to "11"', () => {
  const env = createSimulatedEnv('?myPayLevel=11')
  assert.equal(env.selectValue, '11')
})

test('3. Invalid query parameters are safely ignored and leave filter at default ("")', () => {
  const testCases = [
    '',
    '?',
    '?myPayLevel=',
    '?myPayLevel=abc',
    '?myPayLevel=-1',
    '?myPayLevel=0',
    '?myPayLevel=19',
    '?myPayLevel=999',
    '?myPayLevel=%3Cscript%3E',
    '?myPayLevel=10.5',
    '?otherParam=10',
  ]

  for (const qs of testCases) {
    const env = createSimulatedEnv(qs)
    assert.equal(env.selectValue, '', `Failed for query string: "${qs}"`)
  }
})

test('4. No query parameter preserves existing default ("")', () => {
  const env = createSimulatedEnv('')
  assert.equal(env.selectValue, '')
})

test('5. Deep-linked Level 10 results equal manual Level 10 results (exact vacancy IDs)', () => {
  const env = createSimulatedEnv('?myPayLevel=10')
  const deepLinkedVacancies = filterByMyPayLevel(vacanciesData, env.selectValue)
  const manualVacancies = filterByMyPayLevel(vacanciesData, '10')

  assert.ok(deepLinkedVacancies.length > 0, 'Must have Level 10 vacancies')
  assert.equal(deepLinkedVacancies.length, manualVacancies.length)

  const deepLinkedIds = deepLinkedVacancies.map(v => v.Vacancy_ID)
  const manualIds = manualVacancies.map(v => v.Vacancy_ID)

  assert.deepEqual(deepLinkedIds, manualIds)
})

test('6. Deep-linked Level 11 results equal manual Level 11 results (exact vacancy IDs)', () => {
  const env = createSimulatedEnv('?myPayLevel=11')
  const deepLinkedVacancies = filterByMyPayLevel(vacanciesData, env.selectValue)
  const manualVacancies = filterByMyPayLevel(vacanciesData, '11')

  assert.ok(deepLinkedVacancies.length > 0, 'Must have Level 11 vacancies')
  assert.equal(deepLinkedVacancies.length, manualVacancies.length)

  const deepLinkedIds = deepLinkedVacancies.map(v => v.Vacancy_ID)
  const manualIds = manualVacancies.map(v => v.Vacancy_ID)

  assert.deepEqual(deepLinkedIds, manualIds)
})

test('7. Existing manual selection works independently of URL', () => {
  // Even if URL is empty, manual selection of 10 or 11 yields the expected records
  const l10 = filterByMyPayLevel(vacanciesData, '10')
  const l11 = filterByMyPayLevel(vacanciesData, '11')
  assert.ok(l10.length > 0)
  assert.ok(l11.length > 0)
})

test('8. Feeder eligibility preserves cross-eligibility for multi-level posts', () => {
  const l10 = filterByMyPayLevel(vacanciesData, '10')
  const l11 = filterByMyPayLevel(vacanciesData, '11')
  const l10Ids = l10.map(v => v.Vacancy_ID)
  const l11Ids = l11.map(v => v.Vacancy_ID)

  // Find posts in dataset where both 10 and 11 are eligible
  const cross = l10.filter(v10 => l11Ids.includes(v10.Vacancy_ID))
  assert.ok(cross.length > 0, 'Must have posts eligible for both Level 10 and Level 11')
  assert.ok(l10Ids.includes(cross[0].Vacancy_ID))
  assert.ok(l11Ids.includes(cross[0].Vacancy_ID))
})
