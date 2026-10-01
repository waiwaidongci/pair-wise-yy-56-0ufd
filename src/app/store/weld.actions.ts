import { createAction, props } from '@ngrx/store'
import type { DefectLevel, InspectionPlan, ReviewItem, Weld, WeldStatus } from '../types'

export type RequestLogKind = '缺陷登记' | '返修登记' | '复检登记'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[]; reviews: ReviewItem[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())

/** 旧版裸状态流转保留给"已闭合焊缝"的管理操作，处置链内的流转走下面三类登记 */
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())

export const defectSubmitted = createAction('[Chain] Defect Submitted', props<{
  requestId: string
  weldId: string
  inspector: string
  position: number
  defectType: string
  level: DefectLevel
  length: number
  method: string
  report: string
}>())

export const repairSubmitted = createAction('[Chain] Repair Submitted', props<{
  requestId: string
  weldId: string
  defectId: string
  position: number
  method: string
  result: '合格' | '不合格' | '待复检'
  operator: string
  /** 现场确认焊工资质已失效（如证书当日到期），立即触发相关计划重算退回 */
  qualificationInvalid?: boolean
}>())

export const reinspectionSubmitted = createAction('[Chain] Reinspection Submitted', props<{
  requestId: string
  weldId: string
  defectId: string
  method: string
  passed: boolean
  inspector: string
  report: string
}>())

/** 请求开启下一道工序；未闭合缺陷时被拦截并进入待复核 */
export const processAdvanceRequested = createAction('[Chain] Process Advance Requested', props<{
  weldId: string
  actor: string
  nextProcess: string
}>())

export const reviewResolved = createAction('[Review] Resolve', props<{ id: string; decision: '确认' | '退回方案'; actor: string }>())

export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan }>())

/** 模拟某笔请求写入失败：业务动作已带请求编号留痕，可稍后按编号恢复 */
export const writeFailed = createAction('[Outbox] Write Failed', props<{
  requestId: string
  kind: RequestLogKind
  summary: string
  /** 未落库请求的原始内容，恢复时按请求编号原样重放 */
  payload?: Record<string, unknown>
}>())
/** 按请求编号恢复：重放同一请求，靠编号去重，返修次数与计划条目不重复追加 */
export const writeRecovered = createAction('[Outbox] Write Recovered', props<{ requestId: string }>())

export const lockBaseline = createAction('[Approval] Lock Baseline', props<{ actor: string }>())
