import assert from 'node:assert'
import { buildImportPlan, createReviewPack, parseReviewPack, PACKAGE_FORMAT, PACKAGE_VERSION } from '../src/services/reviewPack.ts'
import type { Comment, Paragraph, Version } from '../src/types.ts'

const paragraph = (over: Partial<Paragraph> = {}): Paragraph => ({
  id: 'p-01', section: '摘要', number: '1.', text: '正文', original: '原稿', status: 'open', highlighted: false, ...over,
})
const comment = (over: Partial<Comment> = {}): Comment => ({
  id: 'c-01', paragraphId: 'p-01', author: '审稿人 A', role: 'reviewer', type: 'comment',
  quote: '正文', body: '有意见', status: 'open', replies: [], createdAt: 1000, ...over,
})
const version = (over: Partial<Version> = {}): Version => ({
  id: 'v-01', label: 'v1', createdAt: 2000, paragraphs: [paragraph()], ...over,
})

const base = { paragraphs: [paragraph()], comments: [comment()], versions: [version()] }

// 1. 正常打包再解析
const pack = createReviewPack(base, '编辑')
const parsed = parseReviewPack(JSON.parse(JSON.stringify(pack)))
assert.equal(parsed.ok, true, '合法包必须解析通过')
if (!parsed.ok) process.exit(1)

// 2. 空本地数据全量导入：3 条新增、0 跳过、0 冲突
const plan1 = buildImportPlan({ paragraphs: [], comments: [], versions: [] }, parsed.pack)
assert.deepEqual(plan1.added.map((i) => i.id), ['p-01', 'c-01', 'v-01'])
assert.equal(plan1.skipped.length, 0)
assert.equal(plan1.conflicts.length, 0)

// 3. 同一包重复导入：0 新增、3 跳过、0 冲突（幂等）
const plan2 = buildImportPlan(plan1, parsed.pack)
assert.equal(plan2.added.length, 0)
assert.equal(plan2.skipped.length, 3)
assert.ok(plan2.skipped.every((s) => s.reason === 'identical'))

// 4. 同编号正文内容不同：冲突，合并结果不包含修改
const divergent = JSON.parse(JSON.stringify(parsed.pack)) as typeof parsed.pack
divergent.paragraphs[0].text = '被对方改过的正文'
const plan3 = buildImportPlan(base, divergent)
assert.equal(plan3.conflicts.length, 1)
assert.equal(plan3.conflicts[0].kind, 'paragraph')
assert.equal((plan3.conflicts[0].incoming as Paragraph).text, '被对方改过的正文')
assert.equal(plan3.paragraphs.length, 1, '冲突时不写入任何正文条目')
assert.equal((plan3.paragraphs[0] as Paragraph).text, '正文')

// 5. 同编号但字段顺序不同仍判为一致
const reordered = JSON.parse(JSON.stringify(parsed.pack))
reordered.paragraphs[0] = JSON.parse(`{"highlighted":false,"status":"open","original":"原稿","text":"正文","number":"1.","section":"摘要","id":"p-01"}`)
const plan4 = buildImportPlan(base, reordered)
assert.equal(plan4.conflicts.length, 0)
assert.equal(plan4.added.length, 0, '字段顺序不同不应产生冲突或新增')

// 6. 格式标识错误
const badFormat = parseReviewPack({ ...JSON.parse(JSON.stringify(pack)), format: 'other' })
assert.equal(badFormat.ok, false)
if (!badFormat.ok) assert.ok(badFormat.errors.some((e) => e.includes('格式标识')))

// 7. 版本号不一致
const badVersion = parseReviewPack({ ...JSON.parse(JSON.stringify(pack)), formatVersion: 99 })
assert.equal(badVersion.ok, false)
if (!badVersion.ok) assert.ok(badVersion.errors.some((e) => e.includes('版本号 v99')))

// 8. 损坏的 JSON 内容由调用方捕获，非对象输入直接报错
assert.equal(parseReviewPack('not-json').ok, false)
assert.equal(parseReviewPack(null).ok, false)

// 9. 引用缺失段落 / 合并目标缺失：拒绝
const brokenRefs = JSON.parse(JSON.stringify(pack))
brokenRefs.comments[0].paragraphId = 'p-xx'
assert.equal(parseReviewPack(brokenRefs).ok, false)
const brokenMerge = JSON.parse(JSON.stringify(pack))
brokenMerge.comments[0].status = 'merged'
brokenMerge.comments[0].mergedInto = 'c-xx'
assert.equal(parseReviewPack(brokenMerge).ok, false)

// 10. 包内编号重复：拒绝
const duplicate = JSON.parse(JSON.stringify(pack))
duplicate.paragraphs.push(paragraph({ id: 'p-01', number: '2.' }))
assert.equal(parseReviewPack(duplicate).ok, false)

// 11. 锁定状态、回复与合并关系随新增条目完整保留
const locked = paragraph({ id: 'p-02', status: 'locked' })
const mergedComment = comment({
  id: 'c-02', status: 'merged', mergedInto: 'c-01',
  replies: [{ id: 'r-01', author: '作者', role: 'author', body: '已处理', createdAt: 3000 }],
})
const richPack = createReviewPack({ paragraphs: [paragraph(), locked], comments: [comment(), mergedComment], versions: [version()] })
const richParsed = parseReviewPack(JSON.parse(JSON.stringify(richPack)))
assert.equal(richParsed.ok, true)
if (richParsed.ok) {
  const plan = buildImportPlan({ paragraphs: [], comments: [], versions: [] }, richParsed.pack)
  const importedLock = plan.paragraphs.find((p) => p.id === 'p-02')!
  assert.equal(importedLock.status, 'locked')
  const importedMerged = plan.comments.find((c) => c.id === 'c-02')!
  assert.equal(importedMerged.status, 'merged')
  assert.equal(importedMerged.mergedInto, 'c-01')
  assert.equal(importedMerged.replies[0].body, '已处理')
}

// 12. 部分新增：已有编号保持本机版本与位置，新编号追加
const packExtra = createReviewPack({
  paragraphs: [paragraph({ text: '本机版本' }), paragraph({ id: 'p-03', number: '3.', text: '对方新增' })],
  comments: [], versions: [],
})
const localBase = { paragraphs: [paragraph({ text: '本机版本' })], comments: [] as Comment[], versions: [] as Version[] }
const extraParsed = parseReviewPack(JSON.parse(JSON.stringify(packExtra)))
assert.equal(extraParsed.ok, true)
if (extraParsed.ok) {
  const plan = buildImportPlan(localBase, extraParsed.pack)
  assert.equal(plan.added.length, 1)
  assert.equal(plan.added[0].id, 'p-03')
  assert.equal(plan.skipped.length, 1)
  assert.equal(plan.paragraphs[0].text, '本机版本')
  assert.equal(plan.paragraphs[1].id, 'p-03')
}

// 13. 包常量正确
assert.equal(PACKAGE_FORMAT, 'sologsb-review-pack')
assert.equal(PACKAGE_VERSION, 1)

console.log('全部审阅包逻辑测试通过 ✔')
