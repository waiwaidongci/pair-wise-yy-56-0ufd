import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import { hasOpenDefect, totalRepairs } from '../types'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,ButtonModule,TimelineModule,TagModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>复检不合格、资质失效、录入冲突和工序拦截都进入同一份待复核结论；锁定批次生成只读快照，后续处置链变化不改快照。</p></div><p-button [label]="state.locked ? '批次已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked || !!pendingReviews.length" (onClick)="lock()" /></div>
      <p class="muted" *ngIf="pendingReviews.length">仍有 {{pendingReviews.length}} 条待复核结论未处理，暂不可锁定。</p>
      <div class="grid-2">
        <section class="card">
          <h2 class="panel-title">统一待复核结论</h2>
          <p class="muted" *ngIf="!state.reviews.length">暂无复核条目。</p>
          <div class="review" *ngFor="let r of state.reviews">
            <div><b><p-tag [value]="r.kind" [severity]="r.state === '待复核' ? 'danger' : r.state === '已确认' ? 'success' : 'warn'" /> {{r.target}} · {{r.time}}</b><p>{{r.summary}}</p><small class="block muted">{{r.detail}}</small><small class="block muted" *ngIf="r.relatedPlanIds.length">关联计划：{{r.relatedPlanIds.join('、')}}</small></div>
            <div class="review-actions" *ngIf="r.state === '待复核'">
              <p-button label="确认结论" size="small" (onClick)="resolve(r.id,'确认')" />
              <p-button label="退回复核" size="small" severity="danger" text (onClick)="resolve(r.id,'退回方案')" />
            </div>
            <p-tag *ngIf="r.state !== '待复核'" [value]="r.state" [severity]="r.state === '已确认' ? 'success' : 'warn'" />
          </div>
          <h2 class="panel-title second">待处理焊缝</h2>
          <div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small class="block muted">{{weld.method}} · {{weld.welder}} · 链上返修 {{totalRepairs(weld)}} 次<span *ngIf="hasOpen(weld)"> · 存在未闭合缺陷，不得放行</span></small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /></div>
          <p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" />
        </section>
        <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left" styleClass="audit-line"><ng-template #content let-event><div class="audit"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p><small class="muted" *ngIf="event.requestId">请求编号 {{event.requestId}}</small></div></ng-template></p-timeline></aside>
      </div>

      <section class="card mt-4">
        <h2 class="panel-title">版本快照</h2>
        <div class="snapshot" *ngIf="state.snapshot as snap">
          <div><b>锁定快照 v{{snap.version}}</b><small class="block muted">{{snap.lockedAt}} 由 {{snap.lockedBy}} 签字 · {{snap.welds.length}} 条焊缝 · {{snap.plans.length}} 个计划 · {{snap.reviews.length}} 条复核结论</small></div>
          <p-tag value="已签字锁定（只读）" severity="success" />
        </div>
        <div class="snapshot" *ngIf="!state.snapshot">
          <div><b>v{{state.version}}</b><small class="block muted">当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划</small></div>
          <p-tag value="可编辑" severity="warn" />
        </div>
        <p>快照记录焊缝状态、缺陷、逐次返修、复检结论、计划修订、冲突内容与签字人。锁定后处置链继续演进只产生新修订，原始批次快照保持不变。</p>
        <div class="snap-diff" *ngIf="state.snapshot">
          <small class="block muted">快照后链上又发生 {{state.audit.length}} 条新审计记录、版本推进至 v{{state.version}}；下方为当前工作版本数据，不覆盖快照。</small>
        </div>
      </section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b{display:flex;align-items:center;gap:6px}.review small{display:block}.muted{color:#7a8798;font-size:12px}.review p{margin:5px 0 3px;font-size:13px}.review-actions{display:flex;gap:6px}.second{margin-top:16px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.snapshot{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snap-diff{margin-top:10px}.mt-4{margin-top:16px}@media(max-width:760px){.review{grid-template-columns:1fr}.review .p-button{width:100%}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  totalRepairs = totalRepairs
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测'].includes(item.status)) }
  get pendingReviews() { return (this.state?.reviews ?? []).filter((r) => r.state === '待复核') }
  hasOpen(weld: Parameters<typeof hasOpenDefect>[0]) { return hasOpenDefect(weld) }
  resolve(id: string, decision: '确认' | '退回方案') { this.store.dispatch(A.reviewResolved({ id, decision, actor: '质量负责人' })) }
  lock() { this.store.dispatch(A.lockBaseline({ actor: '质量负责人' })) }
}
