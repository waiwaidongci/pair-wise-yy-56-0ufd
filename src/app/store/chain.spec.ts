// 处置链纯函数冒烟测试：npx tsc 编译后用 node 运行，不进入应用构建
import {
  registerDefect,
  registerRepair,
  registerReinspection,
  tryAdvanceProcess,
  recalcPlans,
} from './chain'
import type { ChainInput } from './chain'
import type { InspectionPlan, Weld } from '../types'

function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`断言失败：${msg}`)
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`断言失败：${msg}（实际 ${String(actual)}，期望 ${String(expected)}）`)
}
function deepEqual(a: unknown, b: unknown, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`断言失败：${msg}（${JSON.stringify(a)} !== ${JSON.stringify(b)}）`)
}

function weld(id: string, welder = '王凯'): Weld {
  return {
    id, drawing: 'd', component: 'c', joint: 'j', method: 'GMAW', welder,
    qualification: 'q', qualificationValid: true, inspectionRatio: 100, requiredRatio: 100,
    status: '待检测', x: 0, y: 0, defects: [],
  }
}
function plan(id: string, weldIds: string[], state: InspectionPlan['state'] = '执行中'): InspectionPlan {
  return { id, date: '2026-10-01', method: 'UT', weldIds: [...weldIds], inspector: 'i', state, revision: 1 }
}

let input: ChainInput = { welds: [weld('W-1'), weld('W-2', '孙鹏')], plans: [plan('P-1', ['W-1', 'W-2']), plan('P-2', ['W-1'])], reviews: [], audit: [] }

// 1) 先到先得：第一笔放行
const r1 = registerDefect(input, { requestId: 'REQ-1', weldId: 'W-1', inspector: '陈锋', position: 40, type: '夹渣', level: 'Ⅱ级', length: 10, method: 'UT', report: 'R1' })
ok(r1.accepted, '第一笔应放行')
eq(r1.welds[0].defects.length, 1, '应登记 1 个缺陷')
const defectId = r1.welds[0].defects[0].id

// 2) 同位置并发：后到留作冲突，不新增缺陷
const r2 = registerDefect({ ...input, welds: r1.welds, plans: r1.plans, reviews: r1.reviews, audit: r1.audit },
  { requestId: 'REQ-2', weldId: 'W-1', inspector: '赵岚', position: 40, type: '未熔合', level: 'Ⅲ级', length: 20, method: 'MT', report: 'R2' })
ok(!r2.accepted, '后到一笔应被拦截')
eq(r2.welds[0].defects.length, 1, '缺陷不重复登记')
eq(r2.welds[0].defects[0].conflicts.length, 1, '后到内容留作冲突')
eq(r2.reviews.length, 1, '应生成 1 条待复核结论')
eq(r2.reviews[0].kind, '录入冲突', '冲突类型正确')

// 3) 未闭合缺陷不得放行下道工序
const blocked = tryAdvanceProcess({ ...input, welds: r2.welds, plans: r2.plans, reviews: r2.reviews, audit: r2.audit }, { weldId: 'W-1', actor: '班组', nextProcess: '转序' })
ok(blocked.blocked, '未闭合缺陷必须拦截下道工序')

// 4) 登记返修（同一请求重放幂等）
let cur: ChainInput = { welds: r2.welds, plans: r2.plans, reviews: r2.reviews, audit: r2.audit }
const repairPayload = { requestId: 'REQ-3', weldId: 'W-1', defectId, position: 40, method: '碳弧气刨+GMAW', result: '待复检' as const, operator: '王凯' }
const rp1 = registerRepair(cur, repairPayload)
eq(rp1.welds[0].defects[0].repairs.length, 1, '应追加 1 次返修')
const rp1b = registerRepair({ ...cur, welds: rp1.welds, plans: rp1.plans, reviews: rp1.reviews, audit: rp1.audit }, repairPayload)
eq(rp1b.welds[0].defects[0].repairs.length, 1, '同请求编号重放不得重复追加返修次数')

// 5) 复检不合格 -> 相关计划立即重算退回
cur = { welds: rp1b.welds, plans: rp1b.plans, reviews: rp1b.reviews, audit: rp1b.audit }
const ri1 = registerReinspection(cur, { requestId: 'REQ-4', weldId: 'W-1', defectId, method: 'UT', passed: false, inspector: '赵岚', report: '仍不合格' })
eq(ri1.welds[0].defects[0].gate, '待返修', '复检不合格缺陷回到待返修')
eq(ri1.welds[0].status, '返修中', '焊缝回到返修中')
const p1 = ri1.plans.find((p) => p.id === 'P-1')!
eq(p1.state, '待复核', '关联计划退回复核')
eq(p1.revision, 2, '计划修订号 +1')
deepEqual(p1.weldIds, ['W-2'], '问题焊缝应剔除')
deepEqual(p1.removedWeldIds, ['W-1'], '应记录剔除焊缝')
const p2 = ri1.plans.find((p) => p.id === 'P-2')!
eq(p2.state, '待复核', '所有含该焊缝的计划都退回')
ok(ri1.reviews.some((r) => r.kind === '复检不合格'), '应生成复检不合格待复核结论')

// 6) 同请求复检重放幂等，计划不重复剔除
const ri1b = registerReinspection({ welds: ri1.welds, plans: ri1.plans, reviews: ri1.reviews, audit: ri1.audit },
  { requestId: 'REQ-4', weldId: 'W-1', defectId, method: 'UT', passed: false, inspector: '赵岚', report: '仍不合格' })
eq(ri1b.welds[0].defects[0].reinspections.length, 1, '复检结论不重复追加')
deepEqual(ri1b.plans.find((p) => p.id === 'P-1')!.removedWeldIds, ['W-1'], '计划条目不重复追加')

// 7) 再返修 + 复检合格 -> 缺陷闭合、焊缝合格、可放行
cur = { welds: ri1b.welds, plans: ri1b.plans, reviews: ri1b.reviews, audit: ri1b.audit }
const rp2 = registerRepair(cur, { requestId: 'REQ-5', weldId: 'W-1', defectId, position: 40, method: 'GTAW 补焊', result: '待复检', operator: '王凯' })
eq(rp2.welds[0].defects[0].repairs.length, 2, '第二次返修正常累计')
const ri2 = registerReinspection({ welds: rp2.welds, plans: rp2.plans, reviews: rp2.reviews, audit: rp2.audit },
  { requestId: 'REQ-6', weldId: 'W-1', defectId, method: 'UT', passed: true, inspector: '赵岚', report: '合格' })
eq(ri2.welds[0].defects[0].gate, '已闭合', '复检合格缺陷闭合')
eq(ri2.welds[0].status, '合格', '焊缝转合格')
const pass = tryAdvanceProcess({ welds: ri2.welds, plans: ri2.plans, reviews: ri2.reviews, audit: ri2.audit }, { weldId: 'W-1', actor: '班组', nextProcess: '转序' })
ok(!pass.blocked, '闭合后应放行下道工序')

// 8) 焊工资质失效 -> 该焊工所有焊缝关联计划重算
const qual = registerRepair({ welds: ri2.welds, plans: ri2.plans, reviews: ri2.reviews, audit: ri2.audit },
  { requestId: 'REQ-7', weldId: 'W-2', defectId: 'X', position: 10, method: 'SMAW', result: '待复检', operator: '孙鹏', welder: '孙鹏', qualificationValid: false })
const p1after = qual.plans.find((p) => p.id === 'P-1')!
deepEqual(p1after.weldIds, [], '孙鹏的 W-2 也应剔除')
ok(p1after.removedWeldIds!.includes('W-2'), '剔除清单包含 W-2')
ok(qual.reviews.some((r) => r.kind === '资质失效'), '应生成资质失效待复核结论')

// 9) recalcPlans 直接验证：已完成计划也退回
const done = recalcPlans([plan('P-9', ['W-1'], '已完成')], ['W-1'], '复检不合格')
eq(done.plans[0].state, '待复核', '已完成计划同样退回')
eq(done.plans[0].revision, 2, '已完成计划也升修订号')

console.log('全部处置链断言通过 ✔')
