import type { Comment, Paragraph, Role, Version } from '../types'

export const PACKAGE_FORMAT = 'sologsb-1002-review-package'
export const PACKAGE_VERSION = 1

export interface ReviewPackageData {
  paragraphs: Paragraph[]
  comments: Comment[]
  versions: Version[]
}

export interface ReviewPackage {
  format: string
  packageVersion: number
  exportedAt: number
  source: string
  data: ReviewPackageData
}

export type EntityKind = 'paragraph' | 'comment' | 'version'
export type ImportDecision = 'add' | 'skip-identical' | 'conflict'

export interface PlanItem {
  kind: EntityKind
  id: string
  decision: ImportDecision
  local: unknown
  incoming: unknown
}

export interface ImportPlan {
  pkg: ReviewPackage
  items: PlanItem[]
}

export interface ParseResult {
  ok: boolean
  pkg?: ReviewPackage
  errors: string[]
}

export interface LocalRefs {
  paragraphs: { id: string }[]
  comments: { id: string }[]
}

export const kindLabel: Record<EntityKind, string> = {
  paragraph: '正文',
  comment: '意见',
  version: '历史版本',
}

const ROLES: Role[] = ['author', 'reviewer', 'editor']
const PARAGRAPH_STATUSES = ['open', 'accepted', 'locked']
const COMMENT_STATUSES = ['open', 'accepted', 'rejected', 'merged']
const COMMENT_TYPES = ['comment', 'suggestion']

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringFields = (value: Record<string, unknown>, fields: string[], where: string, errors: string[]) => {
  for (const field of fields) {
    if (typeof value[field] !== 'string') errors.push(`${where}：字段「${field}」必须是字符串`)
  }
}

const validateParagraph = (value: unknown, where: string, errors: string[]) => {
  if (!isObject(value)) { errors.push(`${where} 必须是对象`); return }
  const label = `${where}（编号 ${typeof value.id === 'string' ? value.id : '?'}）`
  stringFields(value, ['id', 'section', 'number', 'text', 'original'], where, errors)
  if (!PARAGRAPH_STATUSES.includes(value.status as string)) errors.push(`${label}：段落状态不合法`)
  if (typeof value.highlighted !== 'boolean') errors.push(`${label}：highlighted 必须是布尔值`)
}

const validateReply = (value: unknown, where: string, errors: string[]) => {
  if (!isObject(value)) { errors.push(`${where} 必须是对象`); return }
  stringFields(value, ['id', 'author', 'body'], where, errors)
  if (typeof value.role === 'string' && !ROLES.includes(value.role as Role)) errors.push(`${where}：回复人角色不合法`)
  if (typeof value.createdAt !== 'number') errors.push(`${where}：createdAt 必须是数字时间戳`)
}

const validateComment = (value: unknown, where: string, errors: string[]) => {
  if (!isObject(value)) { errors.push(`${where} 必须是对象`); return }
  const label = `${where}（编号 ${typeof value.id === 'string' ? value.id : '?'}）`
  stringFields(value, ['id', 'paragraphId', 'author', 'quote', 'body'], where, errors)
  if (typeof value.role === 'string' ? !ROLES.includes(value.role as Role) : true) errors.push(`${label}：role 必须是 author/reviewer/editor`)
  if (!COMMENT_TYPES.includes(value.type as string)) errors.push(`${label}：意见类型不合法`)
  if (!COMMENT_STATUSES.includes(value.status as string)) errors.push(`${label}：意见状态不合法`)
  if (typeof value.createdAt !== 'number') errors.push(`${label}：createdAt 必须是数字时间戳`)
  if (value.suggestion !== undefined && typeof value.suggestion !== 'string') errors.push(`${label}：suggestion 必须是字符串`)
  if (value.mergedInto !== undefined && typeof value.mergedInto !== 'string') errors.push(`${label}：mergedInto 必须是字符串编号`)
  if (!Array.isArray(value.replies)) {
    errors.push(`${label}：replies 必须是数组`)
  } else {
    value.replies.forEach((reply, index) => validateReply(reply, `${label} 的第 ${index + 1} 条回复`, errors))
  }
}

const validateVersion = (value: unknown, where: string, errors: string[]) => {
  if (!isObject(value)) { errors.push(`${where} 必须是对象`); return }
  const label = `${where}（编号 ${typeof value.id === 'string' ? value.id : '?'}）`
  stringFields(value, ['id', 'label'], where, errors)
  if (typeof value.createdAt !== 'number') errors.push(`${label}：createdAt 必须是数字时间戳`)
  if (!Array.isArray(value.paragraphs)) {
    errors.push(`${label}：paragraphs 必须是数组`)
  } else {
    value.paragraphs.forEach((paragraph, index) => validateParagraph(paragraph, `${label} 快照中的第 ${index + 1} 段`, errors))
  }
}

const findDuplicateIds = (list: unknown[], label: string, errors: string[]) => {
  const seen = new Set<string>()
  for (const item of list) {
    if (!isObject(item) || typeof item.id !== 'string') continue
    if (seen.has(item.id)) errors.push(`${label}编号 ${item.id} 在审阅包内重复出现`)
    seen.add(item.id)
  }
}

/** 组装可复制的审阅包：正文、意见（含回复与合并关系）、历史版本。 */
export const buildReviewPackage = (data: ReviewPackageData): ReviewPackage => ({
  format: PACKAGE_FORMAT,
  packageVersion: PACKAGE_VERSION,
  exportedAt: Date.now(),
  source: '学术论文协作审阅台',
  data: JSON.parse(JSON.stringify(data)) as ReviewPackageData,
})

export const serializeReviewPackage = (pkg: ReviewPackage): string => `${JSON.stringify(pkg, null, 2)}\n`

/** 导入第一步：检查 JSON 格式、格式标识、版本号与数据结构；引用完整性按本机 + 审阅包合并校验。 */
export const parseReviewPackage = (text: string, local: LocalRefs): ParseResult => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [`无法解析为 JSON：${(error as Error).message}`] }
  }
  if (!isObject(raw)) return { ok: false, errors: ['审阅包必须是一个 JSON 对象'] }

  const headerErrors: string[] = []
  if (raw.format !== PACKAGE_FORMAT) {
    headerErrors.push(`格式标识不符：应为「${PACKAGE_FORMAT}」，实际为「${raw.format === undefined ? '缺失' : String(raw.format)}」`)
  }
  if (typeof raw.packageVersion !== 'number') {
    headerErrors.push('缺少格式版本号 packageVersion')
  } else if (raw.packageVersion !== PACKAGE_VERSION) {
    headerErrors.push(`版本号不兼容：审阅包为 v${raw.packageVersion}，本机仅支持 v${PACKAGE_VERSION}，请升级后再导入`)
  }
  if (typeof raw.exportedAt !== 'number') headerErrors.push('缺少导出时间 exportedAt')
  if (headerErrors.length) return { ok: false, errors: headerErrors }

  if (!isObject(raw.data)) {
    return { ok: false, errors: ['缺少数据区 data（应包含 paragraphs / comments / versions）'] }
  }
  const data = raw.data
  if (!Array.isArray(data.paragraphs) || !Array.isArray(data.comments) || !Array.isArray(data.versions)) {
    return { ok: false, errors: ['data.paragraphs、data.comments、data.versions 必须都是数组'] }
  }

  const errors: string[] = []
  data.paragraphs.forEach((paragraph, index) => validateParagraph(paragraph, `正文第 ${index + 1} 项`, errors))
  data.comments.forEach((comment, index) => validateComment(comment, `意见第 ${index + 1} 项`, errors))
  data.versions.forEach((version, index) => validateVersion(version, `历史版本第 ${index + 1} 项`, errors))
  findDuplicateIds(data.paragraphs, '正文段落', errors)
  findDuplicateIds(data.comments, '意见', errors)
  findDuplicateIds(data.versions, '历史版本', errors)
  if (errors.length) return { ok: false, errors }

  const pkg = raw as unknown as ReviewPackage
  const paragraphIds = new Set<string>([...local.paragraphs.map((item) => item.id), ...pkg.data.paragraphs.map((item) => item.id)])
  const commentIds = new Set<string>([...local.comments.map((item) => item.id), ...pkg.data.comments.map((item) => item.id)])
  pkg.data.comments.forEach((comment) => {
    if (!paragraphIds.has(comment.paragraphId)) {
      errors.push(`意见 ${comment.id} 引用的段落 ${comment.paragraphId} 在本机与审阅包中都不存在，无法补齐`)
    }
    if (comment.mergedInto && !commentIds.has(comment.mergedInto)) {
      errors.push(`意见 ${comment.id} 的合并目标 ${comment.mergedInto} 在本机与审阅包中都不存在`)
    }
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, pkg, errors: [] }
}

/** 对象键排序后序列化，保证内容比较不受键顺序影响。 */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** 导入第二步：按编号逐条判定 新增 / 一致跳过 / 内容冲突。 */
export const planImport = (current: ReviewPackageData, pkg: ReviewPackage): ImportPlan => {
  const items: PlanItem[] = []
  const diff = <T extends { id: string }>(kind: EntityKind, locals: T[], incomings: T[]) => {
    const byId = new Map(locals.map((entry) => [entry.id, entry]))
    for (const incoming of incomings) {
      const local = byId.get(incoming.id)
      if (local === undefined) {
        items.push({ kind, id: incoming.id, decision: 'add', local: undefined, incoming })
      } else if (stableStringify(local) === stableStringify(incoming)) {
        items.push({ kind, id: incoming.id, decision: 'skip-identical', local, incoming })
      } else {
        items.push({ kind, id: incoming.id, decision: 'conflict', local, incoming })
      }
    }
  }
  diff('paragraph', current.paragraphs, pkg.data.paragraphs)
  diff('comment', current.comments, pkg.data.comments)
  diff('version', current.versions, pkg.data.versions)
  return { pkg, items }
}

export const entityLabel = (kind: EntityKind, value: unknown): string => {
  if (!isObject(value)) return `${kindLabel[kind]} ${String(value ?? '')}`.trim()
  if (kind === 'paragraph') return `正文段落 ${String(value.number ?? '')}（${String(value.id)}）`
  if (kind === 'comment') return `意见 ${String(value.id)} · ${String(value.author ?? '未知作者')} · 引用段落 ${String(value.paragraphId)}`
  return `历史版本「${String(value.label ?? '未命名版本')}」（${String(value.id)}）`
}
