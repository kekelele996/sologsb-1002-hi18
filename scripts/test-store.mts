import assert from 'node:assert'

const storage = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
  setItem: (key: string, value: string) => { storage.set(key, String(value)) },
  removeItem: (key: string) => { storage.delete(key) },
  clear: () => storage.clear(),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() { return storage.size },
} as Storage

const { useReviewStore } = await import('../src/store/review.ts')
const { createReviewPack } = await import('../src/services/reviewPack.ts')

const state = () => useReviewStore.getState()

// 初始为种子数据：7 段正文、6 条意见、2 个版本
const start = state()
assert.equal(start.paragraphs.length, 7)
assert.equal(start.comments.length, 6)
assert.equal(start.versions.length, 2)

// 导出自己的包再导入：全部跳过，无新增
const ownPack = createReviewPack({ paragraphs: start.paragraphs, comments: start.comments, versions: start.versions })
const sameResult = start.importReviewPack(ownPack)
assert.equal(sameResult.ok, true)
if (sameResult.ok) {
  assert.equal(sameResult.report.added.length, 0)
  assert.equal(sameResult.report.skipped.length, 15)
}
assert.equal(state().paragraphs.length, 7)

// 构造来自另一台电脑的包：新增 1 段 + 1 条意见 + 1 个版本，且包含锁定、回复、合并关系
const incoming = createReviewPack({
  paragraphs: [
    ...start.paragraphs,
    { id: 'p-99', section: '5 结论', number: '8.', text: '结论新增段。', original: '结论新增段。', status: 'locked', highlighted: false },
  ],
  comments: [
    ...start.comments,
    {
      id: 'c-99', paragraphId: 'p-99', author: '审稿人 Z', role: 'reviewer', type: 'comment',
      quote: '结论新增段', body: '交接补充意见', status: 'merged', mergedInto: 'c-01',
      replies: [{ id: 'r-99', author: '编辑', role: 'editor', body: '已收到', createdAt: 5000 }],
      createdAt: 4000,
    },
  ],
  versions: [
    ...start.versions,
    { id: 'v-99', label: '交接版 v3', createdAt: 6000, paragraphs: [] },
  ],
})

const result = state().importReviewPack(incoming)
assert.equal(result.ok, true, '无冲突应导入成功')
if (result.ok) {
  assert.deepEqual(result.report.added.map((i) => i.id).sort(), ['c-99', 'p-99', 'v-99'])
  assert.equal(result.report.skipped.length, 15)
}
const after = state()
assert.equal(after.paragraphs.length, 8)
assert.equal(after.comments.length, 7)
assert.equal(after.versions.length, 3)
assert.equal(after.paragraphs.find((p) => p.id === 'p-99')!.status, 'locked', '锁定状态保留')
const importedComment = after.comments.find((c) => c.id === 'c-99')!
assert.equal(importedComment.mergedInto, 'c-01', '合并关系保留')
assert.equal(importedComment.replies[0].body, '已收到', '回复保留')

// localStorage 已持久化
const saved = JSON.parse(localStorage.getItem('sologsb-1002-draft-v1')!)
assert.equal(saved.paragraphs.length, 8)
assert.equal(saved.comments.length, 7)

// 同一包重复导入：不生成副本
const repeat = state().importReviewPack(incoming)
assert.equal(repeat.ok, true)
if (repeat.ok) assert.equal(repeat.report.added.length, 0)
assert.equal(state().paragraphs.length, 8)
assert.equal(state().comments.length, 7)
assert.equal(state().versions.length, 3)

// 同编号内容被对方改过：返回冲突且不写入（含新增条目也整体回滚）
const conflictPack = JSON.parse(JSON.stringify(incoming))
conflictPack.paragraphs = conflictPack.paragraphs.map((p: { id: string }) =>
  p.id === 'p-02' ? { ...p, text: '另一台电脑改了引言第二段。' } : p,
)
const blocked = state().importReviewPack(conflictPack)
assert.equal(blocked.ok, false, '同编号不同内容必须停下')
if (!blocked.ok) {
  assert.equal(blocked.plan.conflicts.length, 1)
  assert.equal(blocked.plan.conflicts[0].id, 'p-02')
  assert.ok(blocked.plan.conflicts[0].label.includes('p-02'))
}
assert.equal(state().paragraphs.find((p) => p.id === 'p-02')!.text.includes('另一台电脑'), false, '冲突内容不得写入')
assert.equal(state().paragraphs.length, 8, '冲突时整体不写入（不重复新增）')

// 撤销可以回到导入前，重做恢复
state().undo()
assert.equal(state().paragraphs.length, 7)
assert.equal(state().comments.length, 6)
state().redo()
assert.equal(state().paragraphs.length, 8)

console.log('store 导入/冲突/幂等/持久化/撤销测试全部通过 ✔')
