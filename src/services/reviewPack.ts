import type { Comment, Paragraph, Role, Version } from '../types'

export const PACKAGE_FORMAT = 'sologsb-review-pack'
export const PACKAGE_VERSION = 1

export interface ReviewPack {
  format: typeof PACKAGE_FORMAT
  formatVersion: number
  exportedAt: number
  exportedBy: string
  paragraphs: Paragraph[]
  comments: Comment[]
  versions: Version[]
}

export type PackItemKind = 'paragraph' | 'comment' | 'version'

export interface ItemRef {
  kind: PackItemKind
  id: string
  label: string
}

export interface SkippedItem extends ItemRef {
  reason: 'identical' | 'different'
}

export interface PackConflict {
  kind: PackItemKind
  id: string
  label: string
  local: Paragraph | Comment | Version
  incoming: Paragraph | Comment | Version
}

export interface ImportPlan {
  paragraphs: Paragraph[]
  comments: Comment[]
  versions: Version[]
  added: ItemRef[]
  skipped: SkippedItem[]
  conflicts: PackConflict[]
}

export interface ImportReport {
  added: ItemRef[]
  skipped: SkippedItem[]
}

export type ImportOutcome =
  | { ok: true; report: ImportReport }
  | { ok: false; plan: ImportPlan }

export type ParseResult =
  | { ok: true; pack: ReviewPack }
  | { ok: false; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const roles: Role[] = ['author', 'reviewer', 'editor']
const paragraphStatuses: Paragraph['status'][] = ['open', 'accepted', 'locked']
const commentStatuses: Comment['status'][] = ['open', 'accepted', 'rejected', 'merged']
const commentTypes: Comment['type'][] = ['comment', 'suggestion']

const KIND_LABEL: Record<PackItemKind, string> = {
  paragraph: '正文',
  comment: '意见',
  version: '版本',
}

export const kindLabel = (kind: PackItemKind) => KIND_LABEL[kind]

export const itemLabel = (kind: PackItemKind, item: Paragraph | Comment | Version): string => {
  if (kind === 'paragraph') {
    const paragraph = item as Paragraph
    return `段落 ${paragraph.number}（${paragraph.id}）`
  }
  if (kind === 'comment') {
    const comment = item as Comment
    return `${comment.author} 的${comment.type === 'suggestion' ? '建议' : '批注'}（${comment.id}）`
  }
  const version = item as Version
  return `${version.label}（${version.id}）`
}

export const createReviewPack = (
  state: { paragraphs: Paragraph[]; comments: Comment[]; versions: Version[] },
  exportedBy = '',
): ReviewPack => ({
  format: PACKAGE_FORMAT,
  formatVersion: PACKAGE_VERSION,
  exportedAt: Date.now(),
  exportedBy,
  paragraphs: JSON.parse(JSON.stringify(state.paragraphs)) as Paragraph[],
  comments: JSON.parse(JSON.stringify(state.comments)) as Comment[],
  versions: JSON.parse(JSON.stringify(state.versions)) as Version[],
})

const readParagraph = (value: unknown, path: string, errors: string[]): Paragraph | null => {
  if (!isRecord(value)) { errors.push(`${path}：不是对象`); return null }
  const shape = value as Partial<Paragraph>
  if (typeof shape.id !== 'string' || !shape.id.trim()) errors.push(`${path}：缺少编号 id`)
  for (const key of ['section', 'number', 'text', 'original'] as const) {
    if (typeof shape[key] !== 'string') errors.push(`${path}：字段 ${key} 必须是文本`)
  }
  if (shape.status && !paragraphStatuses.includes(shape.status)) errors.push(`${path}：段落状态 ${String(shape.status)} 无效`)
  if (shape.highlighted !== undefined && typeof shape.highlighted !== 'boolean') errors.push(`${path}：highlighted 必须是布尔值`)
  if (errors.some((item) => item.startsWith(`${path}：`))) return null
  return {
    id: shape.id as string, section: shape.section as string, number: shape.number as string,
    text: shape.text as string, original: shape.original as string,
    status: (shape.status ?? 'open') as Paragraph['status'],
    highlighted: Boolean(shape.highlighted),
  }
}

const readReply = (value: unknown, path: string, errors: string[]) => {
  if (!isRecord(value)) { errors.push(`${path}：不是对象`); return null }
  const shape = value as Partial<Comment['replies'][number]>
  if (typeof shape.id !== 'string' || !shape.id.trim()) errors.push(`${path}：缺少回复编号`)
  if (typeof shape.author !== 'string') errors.push(`${path}：回复人 author 必须是文本`)
  if (shape.role && !roles.includes(shape.role)) errors.push(`${path}：回复角色无效`)
  if (typeof shape.body !== 'string') errors.push(`${path}：回复内容 body 必须是文本`)
  if (typeof shape.createdAt !== 'number') errors.push(`${path}：createdAt 必须是数字时间戳`)
  if (errors.some((item) => item.startsWith(`${path}：`))) return null
  return {
    id: shape.id as string, author: shape.author as string,
    role: (shape.role ?? 'reviewer') as Role, body: shape.body as string,
    createdAt: shape.createdAt as number,
  }
}

const readComment = (value: unknown, path: string, errors: string[]): Comment | null => {
  if (!isRecord(value)) { errors.push(`${path}：不是对象`); return null }
  const shape = value as Partial<Comment>
  if (typeof shape.id !== 'string' || !shape.id.trim()) errors.push(`${path}：缺少意见编号 id`)
  for (const key of ['paragraphId', 'author', 'quote', 'body'] as const) {
    if (typeof shape[key] !== 'string') errors.push(`${path}：字段 ${key} 必须是文本`)
  }
  if (shape.role && !roles.includes(shape.role)) errors.push(`${path}：角色 role 无效`)
  if (shape.type && !commentTypes.includes(shape.type)) errors.push(`${path}：意见类型 type 无效`)
  if (shape.suggestion !== undefined && typeof shape.suggestion !== 'string') {
    errors.push(`${path}：suggestion 必须是文本`)
  }
  if (shape.status && !commentStatuses.includes(shape.status)) errors.push(`${path}：意见状态 ${String(shape.status)} 无效`)
  if (shape.mergedInto !== undefined && typeof shape.mergedInto !== 'string') errors.push(`${path}：mergedInto 必须是文本`)
  if (!Array.isArray(shape.replies)) {
    errors.push(`${path}：replies 必须是数组`)
  }
  if (typeof shape.createdAt !== 'number') errors.push(`${path}：createdAt 必须是数字时间戳`)
  if (errors.some((item) => item.startsWith(`${path}：`))) return null
  const replies = (shape.replies as unknown[]).map((reply, index) => readReply(reply, `${path}.回复 ${index + 1}`, errors)).filter((item): item is NonNullable<typeof item> => item !== null)
  if (errors.some((item) => item.startsWith(`${path}.`))) return null
  return {
    id: shape.id as string, paragraphId: shape.paragraphId as string, author: shape.author as string,
    role: (shape.role ?? 'reviewer') as Role,
    type: (shape.type ?? 'comment') as Comment['type'],
    quote: shape.quote as string, body: shape.body as string,
    ...(typeof shape.suggestion === 'string' ? { suggestion: shape.suggestion } : {}),
    status: (shape.status ?? 'open') as Comment['status'],
    replies, createdAt: shape.createdAt as number,
    ...(typeof shape.mergedInto === 'string' ? { mergedInto: shape.mergedInto } : {}),
  }
}

const readVersion = (value: unknown, path: string, errors: string[]): Version | null => {
  if (!isRecord(value)) { errors.push(`${path}：不是对象`); return null }
  const shape = value as Partial<Version>
  if (typeof shape.id !== 'string' || !shape.id.trim()) errors.push(`${path}：缺少版本编号 id`)
  if (typeof shape.label !== 'string') errors.push(`${path}：版本名称 label 必须是文本`)
  if (typeof shape.createdAt !== 'number') errors.push(`${path}：createdAt 必须是数字时间戳`)
  if (!Array.isArray(shape.paragraphs)) errors.push(`${path}：paragraphs 必须是数组`)
  if (errors.some((item) => item.startsWith(`${path}：`))) return null
  const paragraphs = (shape.paragraphs as unknown[]).map((paragraph, index) =>
    readParagraph(paragraph, `${path}.快照段落 ${index + 1}`, errors),
  ).filter((item): item is Paragraph => item !== null)
  if (errors.some((item) => item.startsWith(`${path}.`))) return null
  return { id: shape.id as string, label: shape.label as string, createdAt: shape.createdAt as number, paragraphs }
}

const findDuplicateIds = (items: { id: string }[]) => {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id)
    seen.add(item.id)
  }
  return [...duplicates]
}

/** 解析并检查审阅包的格式与版本号；不通过时返回逐条错误。 */
export const parseReviewPack = (raw: unknown): ParseResult => {
  const errors: string[] = []
  if (!isRecord(raw)) return { ok: false, errors: ['审阅包不是有效的 JSON 对象，请确认复制完整或文件未损坏'] }

  if (raw.format !== PACKAGE_FORMAT) {
    errors.push(`格式标识不正确（应为 ${PACKAGE_FORMAT}，实际为 ${raw.format === undefined ? '缺失' : String(raw.format)}），这不是本系统导出的审阅包`)
  }
  if (typeof raw.formatVersion !== 'number') {
    errors.push('缺少格式版本号 formatVersion，无法识别审阅包版本')
  } else if (raw.formatVersion !== PACKAGE_VERSION) {
    errors.push(`审阅包版本号 v${raw.formatVersion} 与当前支持的 v${PACKAGE_VERSION} 不一致，无法导入，请双方升级到同一版本后重试`)
  }
  if (raw.exportedAt !== undefined && typeof raw.exportedAt !== 'number') errors.push('exportedAt 必须是数字时间戳')

  for (const key of ['paragraphs', 'comments', 'versions'] as const) {
    if (!Array.isArray(raw[key])) errors.push(`字段 ${key} 必须是数组`)
  }
  if (errors.length) return { ok: false, errors }

  const paragraphs = (raw.paragraphs as unknown[]).map((item, index) => readParagraph(item, `正文第 ${index + 1} 条`, errors)).filter((item): item is Paragraph => item !== null)
  const comments = (raw.comments as unknown[]).map((item, index) => readComment(item, `意见第 ${index + 1} 条`, errors)).filter((item): item is Comment => item !== null)
  const versions = (raw.versions as unknown[]).map((item, index) => readVersion(item, `版本第 ${index + 1} 条`, errors)).filter((item): item is Version => item !== null)
  if (errors.length) return { ok: false, errors }

  for (const id of findDuplicateIds(paragraphs)) errors.push(`正文段落编号 ${id} 在包内重复`)
  for (const id of findDuplicateIds(comments)) errors.push(`意见编号 ${id} 在包内重复`)
  for (const id of findDuplicateIds(versions)) errors.push(`版本编号 ${id} 在包内重复`)
  for (const comment of comments) {
    const replyIds = findDuplicateIds(comment.replies)
    if (replyIds.length) errors.push(`意见 ${comment.id} 内回复编号重复：${replyIds.join('、')}`)
    if (!paragraphs.some((paragraph) => paragraph.id === comment.paragraphId)) {
      errors.push(`意见 ${comment.id} 引用的段落 ${comment.paragraphId} 不在审阅包内，关系不完整`)
    }
    if (comment.mergedInto !== undefined) {
      if (comment.mergedInto === comment.id) errors.push(`意见 ${comment.id} 的合并目标不能是自己`)
      else if (!comments.some((other) => other.id === comment.mergedInto)) {
        errors.push(`意见 ${comment.id} 的合并目标 ${comment.mergedInto} 不在审阅包内，合并关系不完整`)
      }
    }
  }
  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    pack: {
      format: PACKAGE_FORMAT,
      formatVersion: raw.formatVersion as number,
      exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
      exportedBy: typeof raw.exportedBy === 'string' ? raw.exportedBy : '',
      paragraphs, comments, versions,
    },
  }
}

/** 字段顺序无关的结构序列化，用于判断同编号内容是否一致。 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

const sameContent = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b)

/**
 * 按编号对照本机与审阅包：
 * - 本机没有的编号 → 新增；
 * - 同编号且内容一致 → 跳过（重复导入幂等）；
 * - 同编号但内容不同 → 冲突，列出两边，不写入任何内容。
 */
export const buildImportPlan = (
  state: { paragraphs: Paragraph[]; comments: Comment[]; versions: Version[] },
  pack: ReviewPack,
): ImportPlan => {
  const added: ItemRef[] = []
  const skipped: SkippedItem[] = []
  const conflicts: PackConflict[] = []

  const reconcile = <T extends Paragraph | Comment | Version>(
    kind: PackItemKind,
    localItems: T[],
    incomingItems: T[],
    merged: T[],
  ) => {
    const localById = new Map(localItems.map((item) => [item.id, item]))
    for (const incoming of incomingItems) {
      const label = itemLabel(kind, incoming)
      const local = localById.get(incoming.id)
      if (!local) {
        added.push({ kind, id: incoming.id, label })
        merged.push(incoming)
      } else if (sameContent(local, incoming)) {
        skipped.push({ kind, id: incoming.id, label, reason: 'identical' })
      } else {
        skipped.push({ kind, id: incoming.id, label, reason: 'different' })
        conflicts.push({ kind, id: incoming.id, label, local, incoming })
      }
    }
  }

  const paragraphs = [...state.paragraphs]
  const comments = [...state.comments]
  const versions = [...state.versions]
  reconcile('paragraph', state.paragraphs, pack.paragraphs, paragraphs)
  reconcile('comment', state.comments, pack.comments, comments)
  reconcile('version', state.versions, pack.versions, versions)

  return { paragraphs, comments, versions, added, skipped, conflicts }
}
