import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftOutlined, ArrowRightOutlined, BranchesOutlined, CheckOutlined, CloseOutlined,
  CommentOutlined, CopyOutlined, DiffOutlined, DeleteOutlined, DownloadOutlined, ExportOutlined,
  FileDoneOutlined, FileTextOutlined, HistoryOutlined, ImportOutlined, LockOutlined, MenuFoldOutlined,
  MessageOutlined, MinusCircleOutlined, PlusCircleOutlined, PlusOutlined, RedoOutlined, SaveOutlined, SendOutlined,
  SwapOutlined, UndoOutlined, UnlockOutlined, UploadOutlined, UserSwitchOutlined, WarningOutlined,
} from '@ant-design/icons'
import { Alert, Badge, Button, Card, Checkbox, Divider, Empty, Input, Modal, Radio, Segmented, Select, Space, Tag, Tooltip, Upload, message } from 'antd'
import { submitRemotePatch } from './services/mockApi'
import { buildReviewPackage, entityLabel, kindLabel, parseReviewPackage, planImport, serializeReviewPackage } from './services/reviewPackage'
import type { ImportPlan, PlanItem } from './services/reviewPackage'
import { useReviewStore } from './store/review'
import type { Comment, CommentType, Paragraph, Role } from './types'

const roleMeta: Record<Role, { label: string; description: string; color: string }> = {
  author: { label: '作者工作区', description: '编辑正文，逐条接受或拒绝修改建议', color: '#2f6f5e' },
  reviewer: { label: '审稿人工作区', description: '引用原文、添加批注与修改建议并参与讨论', color: '#9a5b25' },
  editor: { label: '编辑工作区', description: '合并重复意见、锁定已确认段落并比较版本', color: '#5b4d8e' },
}
const roleIcon = (role: Role) => role === 'author' ? <FileDoneOutlined /> : role === 'reviewer' ? <CommentOutlined /> : <BranchesOutlined />
const formatDate = (value: number) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function App() {
  const {
    role, paragraphs, comments, versions, selectedParagraphId, commentFilter, revisionMode, dirty, conflicts,
    setRole, selectParagraph, setCommentFilter, setRevisionMode, updateParagraph, addComment, replyComment,
    resolveSuggestion, mergeComment, toggleLock, createVersion, addConflict, resolveConflict, dismissConflict,
    undo, redo, save, resetDemo, applyImportPlan,
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
  const [packageModal, setPackageModal] = useState<'export' | 'import' | null>(null)
  const [exportText, setExportText] = useState('')
  const [importText, setImportText] = useState('')
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null)
  const [importResult, setImportResult] = useState<{ added: PlanItem[]; skipped: PlanItem[] } | null>(null)
  const [importBusy, setImportBusy] = useState(false)

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

  const openExport = () => {
    const pkg = buildReviewPackage({ paragraphs, comments, versions })
    setExportText(serializeReviewPackage(pkg))
    setPackageModal('export')
  }
  const openImport = () => {
    setImportText(''); setImportErrors([]); setImportPlan(null); setImportResult(null)
    setPackageModal('import')
  }
  const closePackageModal = () => setPackageModal(null)
  const fallbackCopy = async (text: string) => {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    try { document.execCommand('copy') } finally { document.body.removeChild(area) }
  }
  const handleCopyExport = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(exportText)
      else await fallbackCopy(exportText)
      message.success('审阅包 JSON 已复制到剪贴板')
    } catch {
      await fallbackCopy(exportText)
      message.success('审阅包 JSON 已复制（兼容模式）')
    }
  }
  const handleDownloadExport = () => {
    const blob = new Blob([exportText], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `review-package-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const handleImportFile = async (file: File) => {
    setImportText(await file.text())
    setImportErrors([]); setImportPlan(null); setImportResult(null)
    message.info(`已读取文件 ${file.name}，请点击“检查格式并预览”`)
    return false
  }
  const currentRefs = {
    paragraphs: paragraphs.map((item) => ({ id: item.id })),
    comments: comments.map((item) => ({ id: item.id })),
  }
  const checkImport = () => {
    setImportBusy(true)
    try {
      const parsed = parseReviewPackage(importText, currentRefs)
      if (!parsed.ok || !parsed.pkg) {
        setImportErrors(parsed.errors)
        setImportPlan(null)
        message.error('审阅包格式或版本检查未通过，已停止')
        return
      }
      const plan = planImport({ paragraphs, comments, versions }, parsed.pkg)
      const conflictCount = plan.items.filter((item) => item.decision === 'conflict').length
      setImportErrors([])
      setImportPlan(plan)
      if (conflictCount > 0) message.error(`发现 ${conflictCount} 个同编号内容冲突，导入已停止，请核对两边内容`)
      else message.success('格式与版本号检查通过，请确认后补齐')
    } finally {
      setImportBusy(false)
    }
  }
  const confirmImport = () => {
    if (!importPlan) return
    const result = applyImportPlan(importPlan)
    const added = importPlan.items.filter((item) => item.decision === 'add')
    const skipped = importPlan.items.filter((item) => item.decision !== 'add')
    setImportResult({ added, skipped })
    setImportPlan(null)
    message.success(`导入完成：新增 ${result.added} 条，跳过 ${result.skipped} 条`)
  }
  const conflictItems = importPlan?.items.filter((item) => item.decision === 'conflict') ?? []
  const addedPreview = importPlan?.items.filter((item) => item.decision === 'add') ?? []
  const skippedPreview = importPlan?.items.filter((item) => item.decision === 'skip-identical') ?? []
  const renderPlanItem = (item: PlanItem) => (
    <li key={`${item.kind}-${item.id}`}>
      <Tag color={item.kind === 'paragraph' ? 'geekblue' : item.kind === 'comment' ? 'gold' : 'purple'}>{kindLabel[item.kind]}</Tag>
      {entityLabel(item.kind, item.incoming)}
    </li>
  )

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
          <Tooltip title="导出正文、意见、回复、合并关系与历史版本为可复制的审阅包"><Button icon={<ExportOutlined />} onClick={openExport}>导出审阅包</Button></Tooltip>
          <Tooltip title="粘贴或选择审阅包 JSON，按编号补齐到本机"><Button icon={<ImportOutlined />} onClick={openImport}>导入审阅包</Button></Tooltip>
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
        title="导出审阅包"
        open={packageModal === 'export'}
        onCancel={closePackageModal}
        width={720}
        footer={<Space>
          <Button icon={<CopyOutlined />} onClick={() => void handleCopyExport()}>复制 JSON</Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadExport}>下载文件</Button>
          <Button onClick={closePackageModal}>关闭</Button>
        </Space>}
      >
        <Alert type="info" showIcon className="package-alert"
          message="审阅包包含正文、意见（含回复与合并关系）和历史版本，可复制给换电脑的作者或交接的编辑；在另一台电脑上用“导入审阅包”按编号补齐。" />
        <Space className="package-stats">
          <Tag color="geekblue">正文 {paragraphs.length} 段</Tag>
          <Tag color="gold">意见 {comments.length} 条</Tag>
          <Tag>{comments.reduce((total, comment) => total + comment.replies.length, 0)} 条回复</Tag>
          <Tag color="purple">历史版本 {versions.length} 个</Tag>
        </Space>
        <Input.TextArea className="package-json" value={exportText} readOnly autoSize={{ minRows: 12, maxRows: 18 }} onFocus={(event) => event.target.select()} />
      </Modal>

      <Modal
        title="导入审阅包"
        open={packageModal === 'import'}
        onCancel={closePackageModal}
        width={780}
        className="package-import-modal"
        footer={importResult ? (
          <Space>
            <Button icon={<ImportOutlined />} onClick={openImport}>再导入一个</Button>
            <Button type="primary" onClick={closePackageModal}>完成</Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={closePackageModal}>取消</Button>
            <Button loading={importBusy} icon={<UploadOutlined />} onClick={checkImport} disabled={!importText.trim()}>检查格式并预览</Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={confirmImport}
              disabled={!importPlan || conflictItems.length > 0}>
              确认按编号补齐{importPlan && conflictItems.length === 0 ? `（新增 ${addedPreview.length} · 跳过 ${skippedPreview.length}）` : ''}
            </Button>
          </Space>
        )}
      >
        {importResult ? (
          <div className="package-body">
            <Alert type="success" showIcon message={`导入完成：新增 ${importResult.added.length} 条，跳过 ${importResult.skipped.length} 条；锁定、回复与合并关系均随条目保留`} />
            <div>
              <h5><PlusCircleOutlined className="text-success" /> 新增条目（{importResult.added.length}）</h5>
              {importResult.added.length
                ? <ul className="package-item-list">{importResult.added.map(renderPlanItem)}</ul>
                : <p className="package-empty">没有新增条目——该审阅包的内容本机已全部具备，重复导入不会生成副本。</p>}
            </div>
            <div>
              <h5><MinusCircleOutlined className="text-muted" /> 跳过条目（{importResult.skipped.length}）</h5>
              {importResult.skipped.length
                ? <ul className="package-item-list">{importResult.skipped.map(renderPlanItem)}</ul>
                : <p className="package-empty">无</p>}
            </div>
          </div>
        ) : (
          <div className="package-body">
            <Alert type="info" showIcon message="先检查格式与版本号；编号相同但内容不同的条目会同时列出两边并停止导入，确认后仅补齐本机缺少的编号，已有条目（含锁定、回复、合并关系）原样保留。" />
            <Space>
              <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => void handleImportFile(file)}>
                <Button icon={<UploadOutlined />}>选择审阅包文件</Button>
              </Upload>
              <span className="package-hint">也可以直接把审阅包 JSON 粘贴到下面</span>
            </Space>
            <Input.TextArea className="package-json" value={importText} autoSize={{ minRows: 7, maxRows: 12 }}
              placeholder='{"format":"sologsb-1002-review-package", ...}'
              onChange={(event) => { setImportText(event.target.value); setImportErrors([]); setImportPlan(null) }} />
            {importErrors.length > 0 && (
              <Alert type="error" showIcon icon={<WarningOutlined />}
                message={`检查未通过，已停止（${importErrors.length} 项）`}
                description={<ul className="package-error-list">{importErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>} />
            )}
            {importPlan && conflictItems.length > 0 && (
              <div>
                <Alert type="error" showIcon icon={<WarningOutlined />}
                  message={`发现 ${conflictItems.length} 个同编号内容冲突，导入已停止`}
                  description="下列编号两边内容不同（锁定状态、回复或合并关系可能也有差异）。为避免覆盖本机数据，请先人工核对并统一后重新导入；冲突条目不会被写入。" />
                <div className="package-conflicts">
                  {conflictItems.map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="package-conflict">
                      <h5><WarningOutlined /> {kindLabel[item.kind]} · {item.id}</h5>
                      <div className="package-conflict-grid">
                        <div><small>本机</small><pre>{JSON.stringify(item.local, null, 2)}</pre></div>
                        <div><small>审阅包</small><pre>{JSON.stringify(item.incoming, null, 2)}</pre></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {importPlan && conflictItems.length === 0 && (
              <div className="package-summary">
                <Alert type="success" showIcon message={`检查通过：将新增 ${addedPreview.length} 条，跳过 ${skippedPreview.length} 条；编号一致的条目不做改动。`} />
                <div>
                  <h5><PlusCircleOutlined className="text-success" /> 新增（{addedPreview.length}）</h5>
                  {addedPreview.length
                    ? <ul className="package-item-list">{addedPreview.map(renderPlanItem)}</ul>
                    : <p className="package-empty">无新增条目</p>}
                </div>
                <div>
                  <h5><MinusCircleOutlined className="text-muted" /> 跳过（{skippedPreview.length}）</h5>
                  {skippedPreview.length
                    ? <ul className="package-item-list">{skippedPreview.map(renderPlanItem)}</ul>
                    : <p className="package-empty">无</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <footer className="app-footer">
        <span>本地草稿自动持久化 · 模拟接口用于演示多人修改后的冲突处理</span>
        <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => { resetDemo(); message.success('已重置示例数据') }}>重置示例</Button>
      </footer>
    </div>
  )
}
