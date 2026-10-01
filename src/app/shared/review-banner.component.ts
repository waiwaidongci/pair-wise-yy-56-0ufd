import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { WeldState, selectPendingReviews } from '../store/weld.reducer'
import * as A from '../store/weld.actions'

/**
 * 各页面共用的「待复核结论」条：数据来自同一份 store，
 * 任何页面展开都是同一份复检结论与退回状态。
 */
@Component({
  selector: 'app-review-banner', standalone: true, imports: [CommonModule, ButtonModule, TagModule],
  template: `
    <section class="card review-panel">
      <h2 class="panel-title">待复核结论 <p-tag [value]="reviews.length + ' 项'" severity="warn" /></h2>
      <p class="muted" *ngIf="!reviews.length">当前没有待复核的复检结论。</p>
      <div class="review" *ngFor="let r of reviews">
        <div>
          <b>{{r.weld.id}} · {{r.defect.id}} · 第 {{r.repair.round}} 轮返修</b>
          <small>位置 {{r.repair.position}}% · {{r.repair.method}} · {{r.defect.type}} {{r.defect.length}}mm · {{r.defect.level}}</small>
          <small *ngIf="r.recheck">复检结论：<b [class.danger]="r.failed" [class.success]="!r.failed">{{r.recheck.conclusion}}</b> · {{r.recheck.inspector}} · {{r.recheck.time}} · {{r.recheck.note}}</small>
          <small *ngIf="!r.recheck">返修结果：{{r.repair.result}}，等待复检结论录入。</small>
        </div>
        <p-tag [value]="r.failed ? '复检不合格 · 已退回' : '复检合格 · 待签字'" [severity]="r.failed ? 'danger' : 'warn'" />
        <p-button *ngIf="!r.failed" label="确认合格" size="small" (onClick)="confirm(r.weld.id)" />
        <p-button label="退回返修" severity="danger" size="small" text (onClick)="reject(r.weld.id)" />
      </div>
    </section>
  `,
  styles: [`
    .review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}
    .review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}
    .muted{color:#7a8798}.danger{color:#dc2626}.success{color:#15803d}
    @media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}}
  `],
})
export class ReviewBannerComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  reviews: ReturnType<typeof selectPendingReviews> = []
  constructor() {
    this.store.select('welds').subscribe((state) => { this.reviews = selectPendingReviews(state) })
  }
  confirm(weldId: string) { this.store.dispatch(A.advanceWeld({ id: weldId, status: '合格', note: '复检结论确认合格，工序关闭' })) }
  reject(weldId: string) { this.store.dispatch(A.advanceWeld({ id: weldId, status: '返修中', note: '退回复核，重新返修' })) }
}
