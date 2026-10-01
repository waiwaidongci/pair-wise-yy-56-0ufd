import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { WeldState, selectPendingReviews } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import { ReviewBannerComponent } from '../shared/review-banner.component'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,ButtonModule,TimelineModule,TagModule,ReviewBannerComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>审核人按焊缝或检测计划确认、退回或要求复检；锁定后生成只读版本快照，已签字批次保留原快照。</p></div><p-button [label]="state.locked ? '已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked" (onClick)="lock()" /></div>
      <app-review-banner />
      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let item of reviewWelds"><div><b>{{item.weld.id}} · {{item.weld.component}}</b><small>{{item.weld.method}} · {{item.weld.welder}} · 返修 {{item.weld.repairs}} 次</small><small *ngIf="item.failed" class="danger">复检不合格已退回：{{item.recheck?.note}}</small><small *ngIf="!item.failed" class="success">复检合格，等待签字确认</small></div><p-tag [value]="item.weld.status" [severity]="item.failed ? 'danger' : 'warn'" /><p-button label="确认合格" size="small" [disabled]="item.failed" (onClick)="confirm(item.weld.id)" /><p-button label="退回返修" severity="danger" size="small" text (onClick)="reject(item.weld.id)" /></div><div class="review" *ngFor="let weld of expirable"><div><b>{{weld.id}} · {{weld.welder}}</b><small class="danger">资质 {{weld.qualification}} · 即将到期</small></div><p-button label="模拟资质失效并重算计划" icon="pi pi-exclamation-triangle" severity="help" size="small" (onClick)="expire(weld.id)" /></div><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" /></section>
      <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div></ng-template></p-timeline></aside></div>
      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot" *ngFor="let snap of state.snapshots"><div><b>{{snap.id}} · v{{snap.version}}</b><small>锁定于 {{snap.lockedAt}} · {{snap.welds.length}} 条焊缝 · {{snap.plans.length}} 个检测计划</small></div><p-tag value="已签字锁定" severity="success" /></div><div class="snapshot" *ngIf="!state.snapshots.length"><div><b>v{{state.version}}</b><small>当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划</small></div><p-tag [value]="state.locked ? '已签字锁定' : '可编辑'" [severity]="state.locked ? 'success' : 'warn'" /></div><p>版本快照记录焊缝状态、缺陷、返修方案、附件哈希和签字人。锁定后修改从当前版本派生新修订，已签字批次仍保留原快照，不覆盖原始检测记录。</p></section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.snapshot{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px;margin-bottom:8px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.mt-4{margin-top:16px}.danger{color:#dc2626}.success{color:#15803d}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return selectPendingReviews(this.state) }
  get expirable() { return (this.state?.welds ?? []).filter((w) => w.qualificationValid) }
  confirm(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'合格', note:'复检结论确认合格，工序关闭' })) }
  reject(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'返修中', note:'退回复核，重新返修' })) }
  expire(id: string) { this.store.dispatch(A.qualificationExpired({ weldId: id })) }
  lock() { this.store.dispatch(A.lockBaseline()) }
}
