import assert from 'node:assert'
import { buildReviewPackage, parseReviewPackage, planImport, serializeReviewPackage } from '../src/services/reviewPackage'
import type { Comment, Paragraph, Version } from '../src/types'

const paragraphs: Paragraph[] = [
  { id: 'p-01', section: '摘要', number: '1.', text: '本地正文 A', original: '本地正文 A', status: 'open', highlighted: false },
  { id: 'p-02', section: '引言', number: '2.', text: '本地正文 B', original: '本地正文 B', status: 'locked', highlighted: true },
]
const comments: Comment[] = [
  { id: 'c-01', paragraphId: 'p-01', author: '审稿人 A', role: 'reviewer', type: 'comment', quote: 'A', body: '本地意见', status: 'merged', replies: [{ id: 'r-01', author: '作者', role: 'author', body: '已讨论', createdAt: 2 }], createdAt: 1, mergedInto: 'c-02' },
  { id: 'c-02', paragraphId: 'p-02', author: '审稿人 B', role: 'reviewer', type: 'comment', quote: 'B', body: '合并目标', status: 'open', replies: [], createdAt: 1 },
]
const versions: Version[] = [{ id: 'v-01', label: '初稿', createdAt: 1, paragraphs: JSON.parse(JSON.stringify(paragraphs)) }]
const current = { paragraphs, comments, versions }
const refs = { paragraphs: paragraphs.map((p) => ({ id: p.id })), comments: comments.map((c) => ({ id: c.id })) }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

// 1. 导出的包可被原样解析
const pkg = buildReviewPackage(current)
const roundTrip = parseReviewPackage(serializeReviewPackage(pkg), refs)
assert.ok(roundTrip.ok, roundTrip.errors.join('; '))
assert.equal(roundTrip.pkg!.packageVersion, 1)

// 2. 全量重复导入：全部 skip-identical，无新增、无冲突
let plan = planImport(current, roundTrip.pkg!)
assert.equal(plan.items.length, 5)
assert.ok(plan.items.every((item) => item.decision === 'skip-identical'))

// 3. 缺段补齐：包内只有一个新段落 + 一条新意见（含回复与合并指向已存在意见）
const incomingData = {
  paragraphs: [{ id: 'p-03', section: '方法', number: '3.', text: '新段落', original: '新段落', status: 'locked', highlighted: false }],
  comments: [{ id: 'c-03', paragraphId: 'p-03', author: '审稿人 C', role: 'reviewer', type: 'suggestion', quote: '新', body: '新意见', suggestion: '建议 X', status: 'open', replies: [{ id: 'r-02', author: '编辑', role: 'editor', body: '回复保留', createdAt: 9 }], createdAt: 8, mergedInto: 'c-02' }],
  versions: [{ id: 'v-02', label: '交接版本', createdAt: 7, paragraphs: [] }],
}
const parsed3 = parseReviewPackage(JSON.stringify({ format: 'sologsb-1002-review-package', packageVersion: 1, exportedAt: 5, source: 't', data: incomingData }), refs)
assert.ok(parsed3.ok, parsed3.errors.join('; '))
plan = planImport(current, parsed3.pkg!)
assert.deepEqual(plan.items.filter((i) => i.decision === 'add').map((i) => i.id), ['p-03', 'c-03', 'v-02'])
assert.deepEqual(plan.items.filter((i) => i.decision === 'conflict'), [])

// 模拟 store applyImportPlan 的补齐结果
const merged = {
  paragraphs: [...current.paragraphs, ...(incomingData.paragraphs as Paragraph[])],
  comments: [...current.comments, ...(incomingData.comments as Comment[])],
  versions: [...current.versions, ...(incomingData.versions as Version[])],
}
const locked = merged.paragraphs.find((p) => p.id === 'p-03')!
assert.equal(locked.status, 'locked') // 锁定状态随新增条目保留
const c03 = merged.comments.find((c) => c.id === 'c-03')!
assert.equal(c03.replies[0].body, '回复保留') // 回复保留
assert.equal(c03.mergedInto, 'c-02') // 合并关系保留

// 再次导入同一个包 => 幂等
const planAgain = planImport(merged, parsed3.pkg!)
assert.deepEqual(planAgain.items.map((i) => i.decision), ['skip-identical', 'skip-identical', 'skip-identical'])

// 4. 同编号内容不同（正文、意见回复、版本三处）=> 列出两边并全部标为冲突
const tampered = clone(parsed3.pkg!)
tampered.data.paragraphs[0].status = 'open'
tampered.data.comments[0].replies[0].body = '被改过的回复'
tampered.data.versions[0].label = '改名版本'
// 先把 p-03/c-03/v-02 放进本地（冲突检测场景：已存在编号但内容不同）
const baseWithIncoming = { paragraphs: [...paragraphs, ...(incomingData.paragraphs as Paragraph[])], comments: [...comments, ...(incomingData.comments as Comment[])], versions: [...versions, ...(incomingData.versions as Version[])] }
const conflictPlan = planImport(baseWithIncoming, tampered)
assert.deepEqual(conflictPlan.items.map((i) => `${i.kind}:${i.decision}`), ['paragraph:conflict', 'comment:conflict', 'version:conflict'])
assert.equal((conflictPlan.items[0].local as Paragraph).status, 'locked')
assert.equal((conflictPlan.items[0].incoming as Paragraph).status, 'open')

// 5. 格式标识错误 / 版本号不支持 => 停止并报错
assert.equal(parseReviewPackage(JSON.stringify({ ...pkg, format: 'wrong' }), refs).errors[0].includes('格式标识不符'), true)
assert.equal(parseReviewPackage(JSON.stringify({ ...pkg, packageVersion: 99 }), refs).errors.some((e) => e.includes('版本号不兼容')), true)
assert.equal(parseReviewPackage('not json', refs).errors[0].startsWith('无法解析为 JSON'), true)
assert.equal(parseReviewPackage(JSON.stringify({ format: 'x' }), refs).ok, false)

// 6. 引用缺失（意见指向不存在的段落 / 合并目标缺失）=> 报错
const dangling = {
  paragraphs: [],
  comments: [{ id: 'c-99', paragraphId: 'p-x', author: 'A', role: 'reviewer', type: 'comment', quote: '', body: '', status: 'open', replies: [], createdAt: 1 }],
  versions: [],
}
const danglingErrors = parseReviewPackage(JSON.stringify({ format: 'sologsb-1002-review-package', packageVersion: 1, exportedAt: 5, data: dangling }), refs).errors
assert.ok(danglingErrors.some((e) => e.includes('p-x')), danglingErrors.join(';'))
const danglingMerge = {
  paragraphs: [],
  comments: [{ id: 'c-10', paragraphId: 'p-01', author: 'A', role: 'reviewer', type: 'comment', quote: '', body: '', status: 'merged', replies: [], createdAt: 1, mergedInto: 'c-gone' }],
  versions: [],
}
assert.ok(parseReviewPackage(JSON.stringify({ format: 'sologsb-1002-review-package', packageVersion: 1, exportedAt: 5, data: danglingMerge }), refs).errors.some((e) => e.includes('c-gone')))

// 7. 包内重复编号 => 报错
const dupPkg = { ...incomingData, paragraphs: [incomingData.paragraphs[0], { ...incomingData.paragraphs[0], text: '重复' }] }
assert.ok(parseReviewPackage(JSON.stringify({ format: 'sologsb-1002-review-package', packageVersion: 1, exportedAt: 5, data: dupPkg }), refs).errors.some((e) => e.includes('p-03')))

// 8. 键顺序不同但内容相同 => 视为一致
const reordered = JSON.parse(`{
  "format": "sologsb-1002-review-package",
  "packageVersion": 1,
  "exportedAt": 5,
  "source": "t",
  "data": {
    "versions": ${JSON.stringify(versions)},
    "comments": ${JSON.stringify(comments)},
    "paragraphs": ${JSON.stringify(paragraphs)}
  }
}`)
const reorderedParsed = parseReviewPackage(JSON.stringify(reordered), refs)
assert.ok(reorderedParsed.ok)
assert.ok(planImport(current, reorderedParsed.pkg!).items.every((i) => i.decision === 'skip-identical'))

console.log('全部审阅包导入/导出逻辑校验通过 ✔')
