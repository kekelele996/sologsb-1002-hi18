import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftOutlined, ArrowRightOutlined, BranchesOutlined, CheckOutlined, CloseOutlined,
  CommentOutlined, DiffOutlined, DeleteOutlined, ExportOutlined, FileDoneOutlined, FileTextOutlined,
  HistoryOutlined, ImportOutlined, LockOutlined, MenuFoldOutlined, MessageOutlined, PlusOutlined,
  RedoOutlined, SaveOutlined, SendOutlined, SwapOutlined, UndoOutlined, UnlockOutlined, UserSwitchOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Button, Card, Checkbox, Divider, Empty, Input, Modal, Radio, Segmented, Select, Space, Tag, Tooltip, Upload, message } from 'antd'
import { submitRemotePatch } from './services/mockApi'
import {
  buildImportPlan, createReviewPack, kindLabel, parseReviewPack, PACKAGE_VERSION,
  type ImportPlan, type ItemRef, type PackConflict, type ReviewPack, type SkippedItem,
} from './services/reviewPack'
import { useReviewStore } from './store/review'
import type { Comment, CommentType, Paragraph, Role, Version } from './types'

const roleMeta: Record<Role, { label: string; description: string; color: string }> = {
  author: { label: '作者工作区', description: '编辑正文，逐条接受或拒绝修改建议', color: '#2f6f5e' },
  reviewer: { label: '审稿人工作区', description: '引用原文、添加批注与修改建议并参与讨论', color: '#9a5b25' },
  editor: { label: '编辑工作区', description: '合并重复意见、锁定已确认段落并比较版本', color: '#5b4d8e' },
}
const roleIcon = (role: Role) => role === 'author' ? <FileDoneOutlined /> : role === 'reviewer' ? <CommentOutlined /> : <BranchesOutlined />
const formatDate = (value: number) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

const conflictMeta = (data: Paragraph | Comment | Version): { meta: string; body: string } => {
  if ('section' in data && 'number' in data && 'original' in data) {
    const paragraph = data as Paragraph
    return { meta: `${paragraph.section} · 段落 ${paragraph.number} · 状态：${paragraph.status === 'locked' ? '已锁定' : paragraph.status === 'accepted' ? '已确认' : '待处理'}`, body: paragraph.text }
  }
  if ('paragraphId' in data && 'replies' in data) {
    const comment = data as Comment
    const statusText = comment.status === 'merged' ? `已合并到 ${comment.mergedInto ?? ''}` : comment.status === 'accepted' ? '已接受' : comment.status === 'rejected' ? '已拒绝' : '待处理'
    const lines = [`【${comment.type === 'suggestion' ? '修改建议' : '段落批注'}】${comment.author} · ${statusText}`, `引用：${comment.quote}`, `意见：${comment.body}`]
    if (comment.suggestion) lines.push(`建议改为：${comment.suggestion}`)
    if (comment.replies.length) lines.push(`回复 ${comment.replies.length} 条：${comment.replies.map((reply) => `${reply.author}：${reply.body}`).join(' / ')}`)
    return { meta: `所属段落 ${comment.paragraphId}`, body: lines.join('\n') }
  }
  const version = data as Version
  return { meta: `保存于 ${formatDate(version.createdAt)} · 含 ${version.paragraphs.length} 段快照`, body: version.paragraphs.map((paragraph) => `${paragraph.number} ${paragraph.text}`).join('\n') }
}

function ConflictCompare({ conflict }: { conflict: PackConflict }) {
  const local = conflictMeta(conflict.local)
  const incoming = conflictMeta(conflict.incoming)
  return (
    <div className="pack-conflict-item">
      <div className="pack-conflict-title"><Tag color="red">{kindLabel(conflict.kind)}编号 {conflict.id}</Tag><span>{conflict.label}</span></div>
      <div className="conflict-content">
        <div><b>本机已有</b><small>{local.meta}</small><p>{local.body}</p></div>
        <div><b>审阅包中</b><small>{incoming.meta}</small><p>{incoming.body}</p></div>
      </div>
    </div>
  )
}

export default function App() {
  const {
    role, paragraphs, comments, versions, selectedParagraphId, commentFilter, revisionMode, dirty, conflicts,
    setRole, selectParagraph, setCommentFilter, setRevisionMode, updateParagraph, addComment, replyComment,
    resolveSuggestion, mergeComment, toggleLock, createVersion, addConflict, resolveConflict, dismissConflict,
    undo, redo, save, resetDemo, importReviewPack,
  } = useReviewStore()
  const [composerOpen, setComposerOpen] = useState(false)
  const [commentType, setCommentType] = useState<CommentType>('comment')
  const [commentBody, setCommentBody] = useState('')
  const [suggestion, setSuggestion] = useState('')
  const [quote, setQuote] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionA, setVersionA] = useState(versions[1]?.id ?? versions[0]?.id)
  const [versionB, setVersionB] = useState(versions[0]?.id)
  const [versionLabel, setVersionLabel] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null)
  const [importPack, setImportPack] = useState<ReviewPack | null>(null)
  const [importResult, setImportResult] = useState<{ added: ItemRef[]; skipped: SkippedItem[] } | null>(null)

  const selected = paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? paragraphs[0]
  const sections = useMemo(() => Array.from(new Set(paragraphs.map((paragraph) => paragraph.section))), [paragraphs])
  const paragraphCommentCounts = useMemo(() => comments.reduce<Record<string, number>>((acc, comment) => {
    acc[comment.paragraphId] = (acc[comment.paragraphId] ?? 0) + 1
    return acc
  }, {}), [comments])
  const duplicateParagraphIds = useMemo(() => new Set(Object.entries(paragraphCommentCounts).filter(([, count]) => count > 1).map(([id]) => id)), [paragraphCommentCounts])
  const visibleComments = useMemo(() => comments.filter((comment) => {
    if (commentFilter === 'open') return comment.status === 'open'
    if (commentFilter === 'suggestion') return comment.type === 'suggestion' && comment.status === 'open'
    if (commentFilter === 'duplicate') return duplicateParagraphIds.has(comment.paragraphId) && comment.status === 'open'
    return true
  }).sort((a, b) => b.createdAt - a.createdAt), [commentFilter, comments, duplicateParagraphIds])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      const state = useReviewStore.getState()
      const index = state.paragraphs.findIndex((paragraph) => paragraph.id === state.selectedParagraphId)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? state.redo() : state.undo()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); state.redo()
      } else if (event.key.toLowerCase() === 'j') {
        event.preventDefault(); const next = state.paragraphs[Math.min(state.paragraphs.length - 1, index + 1)]; if (next) state.selectParagraph(next.id)
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault(); const previous = state.paragraphs[Math.max(0, index - 1)]; if (previous) state.selectParagraph(previous.id)
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault(); state.setRevisionMode(!state.revisionMode)
      } else if (event.key.toLowerCase() === 'l' && state.role === 'editor') {
        event.preventDefault(); state.toggleLock(state.selectedParagraphId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const scrollToParagraph = (id: string) => {
    selectParagraph(id)
    document.getElementById(`paragraph-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const openComposer = (type: CommentType) => {
    const selectedText = window.getSelection()?.toString().trim()
    setQuote(selectedText && selected?.text.includes(selectedText) ? selectedText : selected?.text.slice(0, 64) ?? '')
    setSuggestion(type === 'suggestion' ? selected?.text ?? '' : '')
    setCommentType(type)
    setComposerOpen(true)
  }
  const submitComment = () => {
    if (!selected || !commentBody.trim()) { message.warning('请填写批注内容'); return }
    addComment({ paragraphId: selected.id, type: commentType, quote, body: commentBody.trim(), suggestion: commentType === 'suggestion' ? suggestion : undefined })
    setCommentBody(''); setSuggestion(''); setQuote(''); setComposerOpen(false)
    message.success(commentType === 'suggestion' ? '修改建议已提交' : '段落批注已添加')
  }
  const handleMockConflict = async () => {
    if (!selected) return
    const response = await submitRemotePatch(selected)
    addConflict({
      id: `conflict-${Date.now()}`, paragraphId: selected.id, localText: selected.text, remoteText: response.remoteText,
      localAuthor: roleMeta[role].label, remoteAuthor: response.remoteAuthor, detectedAt: Date.now(),
    })
    message.warning('模拟接口返回了同段落的远端修改，请处理冲突')
  }
  const handleCreateVersion = () => {
    if (versionLabel.trim()) createVersion(versionLabel.trim())
    else createVersion('')
    setVersionLabel('')
    message.success('当前版本已保存')
  }
  const comparedA = versions.find((version) => version.id === versionA)
  const comparedB = versions.find((version) => version.id === versionB)
  const comparedRows = comparedA && comparedB ? comparedA.paragraphs.map((paragraph, index) => ({ a: paragraph, b: comparedB.paragraphs[index] })) : []

  const reviewPack = useMemo(() => createReviewPack({ paragraphs, comments, versions }), [paragraphs, comments, versions])
  const reviewPackText = useMemo(() => JSON.stringify(reviewPack, null, 2), [reviewPack])

  const openExport = () => setExportOpen(true)
  const copyPack = async () => {
    try {
      await navigator.clipboard.writeText(reviewPackText)
      message.success('审阅包已复制，粘贴到新电脑即可导入')
    } catch {
      message.error('浏览器未授权剪贴板，请手动选择文本框内容复制')
    }
  }
  const downloadPack = () => {
    const blob = new Blob([reviewPackText], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `review-pack-v${PACKAGE_VERSION}-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    message.success('审阅包文件已下载')
  }

  const resetImportFlow = () => {
    setImportText(''); setImportErrors([]); setImportPlan(null); setImportPack(null); setImportResult(null)
  }
  const openImport = () => { resetImportFlow(); setImportOpen(true) }
  const pickImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setImportText(text); setImportErrors([]); setImportPlan(null); setImportPack(null); setImportResult(null)
    }
    reader.onerror = () => message.error('读取文件失败，请重试')
    reader.readAsText(file)
    return false
  }
  const checkImport = () => {
    if (!importText.trim()) { message.warning('请粘贴审阅包内容或选择 .json 文件'); return }
    let parsed: unknown
    try {
      parsed = JSON.parse(importText)
    } catch {
      setImportErrors(['JSON 解析失败，请确认复制完整或文件未损坏']); setImportPlan(null); return
    }
    const result = parseReviewPack(parsed)
    if (!result.ok) { setImportErrors(result.errors); setImportPlan(null); return }
    const state = useReviewStore.getState()
    setImportPack(result.pack)
    setImportPlan(buildImportPlan({ paragraphs: state.paragraphs, comments: state.comments, versions: state.versions }, result.pack))
    setImportErrors([])
    setImportResult(null)
  }
  const confirmImport = () => {
    if (!importPack || !importPlan) return
    const outcome = importReviewPack(importPack)
    if (!outcome.ok) { setImportPlan(outcome.plan); return }
    setImportResult(outcome.report)
    setImportPlan(null)
    setImportText('')
    message.success(`导入完成：新增 ${outcome.report.added.length} 条，跳过 ${outcome.report.skipped.length} 条`)
  }
  const groupedItems = (items: ItemRef[]) => (['paragraph', 'comment', 'version'] as const).map((kind) => ({
    kind, entries: items.filter((item) => item.kind === kind),
  })).filter((group) => group.entries.length)

  return (
    <div className="review-app">
      <header className="app-header">
        <div className="paper-identity">
          <div className="paper-mark">CR</div>
          <div><h1>学术论文协作审阅台</h1><p>Collaborative Research Review · MS-2026-0417</p></div>
        </div>
        <div className="role-switch">
          <Segmented block value={role} onChange={(value) => setRole(value as Role)} options={(Object.keys(roleMeta) as Role[]).map((item) => ({ label: <span>{roleIcon(item)} {roleMeta[item].label.replace('工作区', '')}</span>, value: item }))} />
        </div>
        <Space>
          <Badge dot={dirty}><Button icon={<SaveOutlined />} onClick={() => { save(); message.success('草稿已保存到浏览器') }}>保存</Button></Badge>
          <Button icon={<UndoOutlined />} disabled={!useReviewStore.getState().past.length} onClick={undo} />
          <Button icon={<RedoOutlined />} disabled={!useReviewStore.getState().future.length} onClick={redo} />
          <Button danger={conflicts.length > 0} icon={<SwapOutlined />} onClick={() => void handleMockConflict()}>模拟冲突</Button>
        </Space>
      </header>

      <div className="role-banner" style={{ '--role-color': roleMeta[role].color } as React.CSSProperties}>
        <span className="role-badge">{roleIcon(role)} {roleMeta[role].label}</span>
        <span>{roleMeta[role].description}</span>
        <span className="paper-state"><FileTextOutlined /> 论文正文 v2.4</span>
      </div>

      {conflicts.length > 0 && (
        <div className="conflict-stack">
          {conflicts.map((conflict) => (
            <Alert
              key={conflict.id} type="error" showIcon message={`段落冲突：${conflict.localAuthor} 与 ${conflict.remoteAuthor} 同时修改`}
              description={(
                <div className="conflict-content">
                  <div><b>本页版本</b><p>{conflict.localText}</p></div>
                  <div><b>模拟远端版本</b><p>{conflict.remoteText}</p></div>
                  <Space><Button size="small" onClick={() => resolveConflict(conflict.id, 'local')}>保留本页</Button><Button size="small" type="primary" onClick={() => resolveConflict(conflict.id, 'remote')}>采用远端</Button><Button size="small" type="text" onClick={() => dismissConflict(conflict.id)}>稍后处理</Button></Space>
                </div>
              )}
            />
          ))}
        </div>
      )}

      <main className="workspace">
        <aside className="toc-panel">
          <div className="panel-title"><MenuFoldOutlined /> 侧边目录</div>
          <nav>
            {sections.map((section) => (
              <div key={section} className="toc-section">
                <strong>{section}</strong>
                {paragraphs.filter((paragraph) => paragraph.section === section).map((paragraph) => (
                  <button key={paragraph.id} className={paragraph.id === selected?.id ? 'active' : ''} onClick={() => scrollToParagraph(paragraph.id)}>
                    <span>{paragraph.number}</span>
                    <span>{paragraph.text.slice(0, 24)}…</span>
                    {paragraph.status === 'locked' && <LockOutlined />}
                    {!!paragraphCommentCounts[paragraph.id] && <Badge count={paragraphCommentCounts[paragraph.id]} size="small" />}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="version-box">
            <div className="panel-title"><HistoryOutlined /> 版本</div>
            <Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="新版本名称" onPressEnter={handleCreateVersion} />
            <Button block icon={<PlusOutlined />} onClick={handleCreateVersion}>保存当前版本</Button>
            <Button block icon={<DiffOutlined />} onClick={() => setVersionOpen(true)}>比较两个版本</Button>
          </div>
        </aside>

        <section className="document-panel">
          <div className="document-toolbar">
            <div><h2>大语言模型辅助下的开源维护协作研究</h2><p>作者：林晓、陈默、王远 · 最近保存 {formatDate(Date.now())}</p></div>
            <Space>
              <Tooltip title="导出正文、意见、回复、合并关系与历史版本，用于换机或编辑交接">
                <Button size="small" icon={<ExportOutlined />} onClick={openExport}>导出审阅包</Button>
              </Tooltip>
              <Tooltip title="从审阅包按编号补齐内容，重复导入不会生成副本">
                <Button size="small" icon={<ImportOutlined />} onClick={openImport}>导入审阅包</Button>
              </Tooltip>
              <Checkbox checked={revisionMode} onChange={(event) => setRevisionMode(event.target.checked)}>修订模式</Checkbox>
              <Tag color={dirty ? 'gold' : 'green'}>{dirty ? '有未保存修改' : '已保存'}</Tag>
            </Space>
          </div>

          <div className="paper-sheet">
            <div className="paper-kicker">RESEARCH ARTICLE · CONFIDENTIAL REVIEW</div>
            {sections.map((section) => (
              <section key={section} className="paper-section">
                <h3>{section}</h3>
                {paragraphs.filter((paragraph) => paragraph.section === section).map((paragraph) => (
                  <article
                    id={`paragraph-${paragraph.id}`} key={paragraph.id} onMouseUp={() => setQuote(window.getSelection()?.toString().trim() ?? '')}
                    className={`paragraph-card ${paragraph.id === selected?.id ? 'selected' : ''} ${paragraph.highlighted ? 'highlighted' : ''} ${paragraph.status === 'locked' ? 'locked' : ''}`}
                    onClick={() => selectParagraph(paragraph.id)}
                  >
                    <div className="paragraph-meta">
                      <span className="paragraph-no">{paragraph.number}</span>
                      <span>段落 {paragraph.number.replace('.', '')}</span>
                      {paragraph.status === 'locked' && <Tag icon={<LockOutlined />} color="purple">已锁定</Tag>}
                      {paragraph.status === 'accepted' && <Tag icon={<CheckOutlined />} color="green">已确认</Tag>}
                      {!!paragraphCommentCounts[paragraph.id] && <Tag icon={<MessageOutlined />}>{paragraphCommentCounts[paragraph.id]} 条意见</Tag>}
                    </div>
                    {revisionMode ? (
                      <div className="revision-grid">
                        <div><small>原稿</small><p>{paragraph.original}</p></div>
                        <div><small>当前修订</small><p>{paragraph.text}</p></div>
                      </div>
                    ) : role === 'author' ? (
                      <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} value={paragraph.text} readOnly={paragraph.status === 'locked'} onChange={(event) => updateParagraph(paragraph.id, event.target.value)} />
                    ) : (
                      <p className="paragraph-text">{paragraph.text}</p>
                    )}
                    <div className="paragraph-actions">
                      {role === 'reviewer' && <><Button size="small" icon={<CommentOutlined />} onClick={(event) => { event.stopPropagation(); selectParagraph(paragraph.id); openComposer('comment') }}>添加批注</Button><Button size="small" icon={<FileDoneOutlined />} onClick={(event) => { event.stopPropagation(); selectParagraph(paragraph.id); openComposer('suggestion') }}>提出建议</Button></>}
                      {role === 'editor' && <Button size="small" icon={paragraph.status === 'locked' ? <UnlockOutlined /> : <LockOutlined />} onClick={(event) => { event.stopPropagation(); toggleLock(paragraph.id) }}>{paragraph.status === 'locked' ? '解除锁定' : '锁定段落'}</Button>}
                      {role === 'author' && <span className="author-tip">可直接修改正文，右侧逐条处理建议</span>}
                    </div>
                  </article>
                ))}
              </section>
            ))}
          </div>
        </section>

        <aside className="comments-panel">
          <div className="comments-header">
            <div><h2><CommentOutlined /> 审阅意见 <Badge count={comments.filter((comment) => comment.status === 'open').length} /></h2><p>引用原文、讨论与修订建议</p></div>
          </div>
          <div className="comment-filters">
            <Radio.Group value={commentFilter} onChange={(event) => setCommentFilter(event.target.value)} buttonStyle="solid" size="small">
              <Radio.Button value="all">全部</Radio.Button><Radio.Button value="open">待处理</Radio.Button><Radio.Button value="suggestion">建议</Radio.Button><Radio.Button value="duplicate">重复</Radio.Button>
            </Radio.Group>
          </div>
          <div className="comment-list">
            {visibleComments.map((comment) => {
              const paragraph = paragraphs.find((item) => item.id === comment.paragraphId)
              return (
                <Card key={comment.id} size="small" className={`comment-card ${comment.status}`} title={<span>{comment.author} <Tag>{comment.type === 'suggestion' ? '修改建议' : '段落批注'}</Tag></span>} extra={<small>{formatDate(comment.createdAt)}</small>}>
                  <button className="quote-line" onClick={() => paragraph && scrollToParagraph(paragraph.id)}>“{comment.quote}” · 段落 {paragraph?.number}</button>
                  <p className="comment-body">{comment.body}</p>
                  {comment.suggestion && <div className="suggestion-box"><small>建议改为</small><p>{comment.suggestion}</p></div>}
                  {comment.status !== 'open' && <Tag color={comment.status === 'accepted' ? 'green' : comment.status === 'rejected' ? 'red' : 'blue'}>{comment.status === 'accepted' ? '已接受' : comment.status === 'rejected' ? '已拒绝' : '已合并'}</Tag>}
                  <div className="replies">
                    {comment.replies.map((reply) => <div key={reply.id} className="reply"><b>{reply.author}</b><span>{reply.body}</span></div>)}
                  </div>
                  <div className="reply-box">
                    <Input size="small" value={replyDrafts[comment.id] ?? ''} onChange={(event) => setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: event.target.value }))} placeholder="回复讨论…" onPressEnter={() => { const body = replyDrafts[comment.id]?.trim(); if (body) { replyComment(comment.id, body); setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: '' })) } }} />
                    <Button size="small" type="text" icon={<SendOutlined />} onClick={() => { const body = replyDrafts[comment.id]?.trim(); if (body) { replyComment(comment.id, body); setReplyDrafts((drafts) => ({ ...drafts, [comment.id]: '' })) } }} />
                  </div>
                  {comment.status === 'open' && role === 'author' && comment.type === 'suggestion' && <div className="decision-row"><Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => resolveSuggestion(comment.id, true)}>接受修改</Button><Button danger size="small" icon={<CloseOutlined />} onClick={() => resolveSuggestion(comment.id, false)}>拒绝</Button></div>}
                  {comment.status === 'open' && role === 'editor' && duplicateParagraphIds.has(comment.paragraphId) && (() => {
                    const sibling = comments.find((item) => item.id !== comment.id && item.paragraphId === comment.paragraphId && item.status === 'open')
                    return sibling ? <Button size="small" type="dashed" icon={<BranchesOutlined />} onClick={() => mergeComment(comment.id, sibling.id)}>合并到“{sibling.author}”意见</Button> : null
                  })()}
                </Card>
              )
            })}
            {!visibleComments.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选下没有意见" />}
          </div>
          <div className="keyboard-hint"><span><kbd>J</kbd>/<kbd>K</kbd> 段落导航</span><span><kbd>T</kbd> 修订模式</span>{role === 'editor' && <span><kbd>L</kbd> 锁定</span>}<span><kbd>⌘Z</kbd> 撤销</span></div>
        </aside>
      </main>

      <Modal title={commentType === 'suggestion' ? '提出修改建议' : '添加段落批注'} open={composerOpen} onCancel={() => setComposerOpen(false)} onOk={submitComment} okText="提交" width={620}>
        <div className="composer">
          <label>引用原文</label>
          <Input.TextArea value={quote} onChange={(event) => setQuote(event.target.value)} autoSize={{ minRows: 2, maxRows: 4 }} />
          <label>{commentType === 'suggestion' ? '建议改为' : '批注内容'}</label>
          {commentType === 'suggestion' && <Input.TextArea value={suggestion} onChange={(event) => setSuggestion(event.target.value)} autoSize={{ minRows: 3, maxRows: 7 }} />}
          <label>说明</label>
          <Input.TextArea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="说明修改理由或希望作者关注的问题" autoSize={{ minRows: 2, maxRows: 5 }} />
        </div>
      </Modal>

      <Modal title="版本比较" open={versionOpen} onCancel={() => setVersionOpen(false)} footer={null} width={980}>
        <div className="compare-selectors">
          <Select value={versionA} onChange={setVersionA} options={versions.map((version) => ({ label: `${version.label} · ${formatDate(version.createdAt)}`, value: version.id }))} />
          <ArrowRightOutlined />
          <Select value={versionB} onChange={setVersionB} options={versions.map((version) => ({ label: `${version.label} · ${formatDate(version.createdAt)}`, value: version.id }))} />
        </div>
        <div className="version-table">
          <div className="version-head"><b>{comparedA?.label ?? '版本 A'}</b><b>{comparedB?.label ?? '版本 B'}</b></div>
          {comparedRows.map(({ a, b }) => (
            <div key={a.id} className={`version-row ${a.text !== b?.text ? 'changed' : ''}`}>
              <div><span>{a.number}</span>{a.text}</div><div><span>{b?.number ?? '—'}</span>{b?.text ?? '段落已删除'}</div>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        title={<span><ExportOutlined /> 导出审阅包</span>}
        open={exportOpen} onCancel={() => setExportOpen(false)} width={720}
        footer={<Space>
          <Button icon={<ExportOutlined />} onClick={() => void copyPack()}>复制全部内容</Button>
          <Button type="primary" icon={<FileTextOutlined />} onClick={downloadPack}>下载 .json 文件</Button>
        </Space>}
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={
          <span>包含正文 {paragraphs.length} 段、意见 {comments.length} 条（含回复与合并关系）、历史版本 {versions.length} 个；格式版本 v{PACKAGE_VERSION}。复制或下载后发送给新电脑上的编辑/作者即可导入。</span>
        } />
        <Input.TextArea value={reviewPackText} readOnly autoSize={{ minRows: 10, maxRows: 16 }} className="pack-json" />
      </Modal>

      <Modal
        title={<span><ImportOutlined /> 导入审阅包</span>}
        open={importOpen} onCancel={() => setImportOpen(false)} width={860}
        footer={importResult ? (
          <Button type="primary" onClick={() => setImportOpen(false)}>完成</Button>
        ) : (
          <Space>
            {!importPlan && <Button onClick={checkImport}>检查格式与版本号</Button>}
            {importPlan && <Button type="primary" disabled={importPlan.conflicts.length > 0} onClick={confirmImport}>
              按编号补齐{importPlan.added.length ? `（新增 ${importPlan.added.length} 条）` : ''}
            </Button>}
            <Button onClick={() => setImportOpen(false)}>{importPlan?.conflicts.length ? '关闭' : '取消'}</Button>
          </Space>
        )}
      >
        {!importResult && <>
          {!importPlan && <>
            <Space style={{ marginBottom: 8 }}>
              <Upload accept=".json,application/json" showUploadList={false} beforeUpload={pickImportFile}>
                <Button icon={<FileTextOutlined />}>选择 .json 文件</Button>
              </Upload>
              <span className="pack-hint">或直接粘贴对方复制的审阅包文本</span>
            </Space>
            <Input.TextArea value={importText} onChange={(event) => { setImportText(event.target.value); setImportErrors([]); setImportPlan(null); setImportPack(null) }} placeholder='{ "format": "sologsb-review-pack", ... }' autoSize={{ minRows: 6, maxRows: 12 }} className="pack-json" />
            {importErrors.length > 0 && (
              <Alert type="error" showIcon style={{ marginTop: 10 }} message="审阅包检查未通过，已停止导入"
                description={<ul className="pack-error-list">{importErrors.map((item, index) => <li key={index}>{item}</li>)}</ul>} />
            )}
          </>}

          {importPlan && <>
            {importPlan.conflicts.length > 0 ? (
              <Alert type="error" showIcon style={{ marginBottom: 12 }}
                message={`发现 ${importPlan.conflicts.length} 个同编号但内容不同的条目，已停止，未写入任何内容`}
                description="请先与对方核对下列两边内容，处理后重新导入；锁定状态、回复与合并关系均不会被覆盖。" />
            ) : (
              <Alert type="success" showIcon style={{ marginBottom: 12 }}
                message={`格式与版本号检查通过（v${PACKAGE_VERSION}），将按编号补齐 ${importPlan.added.length} 条，已有编号 ${importPlan.skipped.length} 条保持不动`}
                description="锁定、回复与合并关系按包内内容随新增条目保留；同一审阅包重复导入不会生成副本。" />
            )}

            <div className="pack-summary">
              <div className="pack-column pack-added">
                <b><PlusOutlined /> 新增（{importPlan.added.length}）</b>
                {groupedItems(importPlan.added).map((group) => (
                  <div key={group.kind} className="pack-group">
                    <small>{kindLabel(group.kind)} · {group.entries.length}</small>
                    {group.entries.map((item) => <Tag key={item.id} color="green" className="pack-tag">{item.label}</Tag>)}
                  </div>
                ))}
                {!importPlan.added.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有需要新增的条目（可能已导入过）" />}
              </div>
              <div className="pack-column pack-skipped">
                <b><CheckOutlined /> 跳过（{importPlan.skipped.length}）</b>
                {groupedItems(importPlan.skipped).map((group) => (
                  <div key={group.kind} className="pack-group">
                    <small>{kindLabel(group.kind)} · {group.entries.length}</small>
                    {group.entries.map((item) => (
                      <Tag key={item.id} className={`pack-tag ${(item as SkippedItem).reason === 'different' ? 'conflict-tag' : ''}`}>
                        {(item as SkippedItem).reason === 'different' ? '内容不同 · ' : '已存在 · '}{item.label}
                      </Tag>
                    ))}
                  </div>
                ))}
                {!importPlan.skipped.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="全部条目都是新增" />}
              </div>
            </div>

            {importPlan.conflicts.length > 0 && (
              <div className="pack-conflicts">
                <Divider orientation="left" plain>两边内容对照</Divider>
                {importPlan.conflicts.map((conflict) => <ConflictCompare key={`${conflict.kind}-${conflict.id}`} conflict={conflict} />)}
              </div>
            )}
          </>}
        </>}

        {importResult && <>
          <Alert type="success" showIcon style={{ marginBottom: 12 }}
            message={`导入完成：新增 ${importResult.added.length} 条，跳过 ${importResult.skipped.length} 条，未生成重复副本`} />
          <div className="pack-summary">
            <div className="pack-column pack-added">
              <b><PlusOutlined /> 已新增（{importResult.added.length}）</b>
              {groupedItems(importResult.added).map((group) => (
                <div key={group.kind} className="pack-group">
                  <small>{kindLabel(group.kind)} · {group.entries.length}</small>
                  {group.entries.map((item) => <Tag key={item.id} color="green" className="pack-tag">{item.label}</Tag>)}
                </div>
              ))}
              {!importResult.added.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无新增条目" />}
            </div>
            <div className="pack-column pack-skipped">
              <b><CheckOutlined /> 已跳过（{importResult.skipped.length}）</b>
              {groupedItems(importResult.skipped).map((group) => (
                <div key={group.kind} className="pack-group">
                  <small>{kindLabel(group.kind)} · {group.entries.length}</small>
                  {group.entries.map((item) => <Tag key={item.id} className="pack-tag">{item.label}</Tag>)}
                </div>
              ))}
              {!importResult.skipped.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无跳过条目" />}
            </div>
          </div>
        </>}
      </Modal>

      <footer className="app-footer">
        <span>本地草稿自动持久化 · 模拟接口用于演示多人修改后的冲突处理</span>
        <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => { resetDemo(); message.success('已重置示例数据') }}>重置示例</Button>
      </footer>
    </div>
  )
}
