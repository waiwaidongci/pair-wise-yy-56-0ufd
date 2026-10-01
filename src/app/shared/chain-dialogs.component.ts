import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { Defect, Weld } from '../types'

/**
 * 处置链共用录入入口：登记返修（位置/方法/结果）与提交复检结论。
 * 地图页与检测页共用同一组件，保证各页面操作同一条处置链。
 */
@Component({
  selector: 'app-chain-dialogs', standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, InputTextModule, TextareaModule],
  template: `
    <p-dialog header="登记返修（位置 / 方法 / 结果）" [(visible)]="repairDialog" [modal]="true" [style]="{width:'560px'}">
      <div class="form">
        <label>缺陷</label><input pInputText [value]="repairForm.defectId" disabled />
        <label>返修位置（0–100%）</label><input pInputText type="number" [(ngModel)]="repairForm.position" />
        <label>返修方法</label>
        <select [(ngModel)]="repairForm.method"><option>GMAW</option><option>FCAW</option><option>SMAW</option><option>GTAW</option><option>SAW</option></select>
        <p class="muted">同一处复检合格前不得开下一道工序；返修登记后结果为「返修中」。</p>
      </div>
      <ng-template #footer>
        <p-button label="取消" severity="secondary" (onClick)="repairDialog = false" />
        <p-button label="提交返修" (onClick)="submitRepair()" />
      </ng-template>
    </p-dialog>
    <p-dialog header="提交复检结论" [(visible)]="recheckDialog" [modal]="true" [style]="{width:'560px'}">
      <div class="form">
        <label>缺陷</label><input pInputText [value]="recheckForm.defectId" disabled />
        <label>复检结论</label>
        <select [(ngModel)]="recheckForm.conclusion"><option value="合格">合格</option><option value="不合格">不合格</option></select>
        <label>复检说明</label><textarea pTextarea [(ngModel)]="recheckForm.note" rows="3"></textarea>
        <p class="muted">复检不合格时相关计划立即重算并退回复核；合格则进入待复核签字。</p>
      </div>
      <ng-template #footer>
        <p-button label="取消" severity="secondary" (onClick)="recheckDialog = false" />
        <p-button label="提交复检" (onClick)="submitRecheck()" />
      </ng-template>
    </p-dialog>
  `,
  styles: [`.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.muted{color:#7a8798}`],
})
export class ChainDialogsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  repairDialog = false
  recheckDialog = false
  repairForm = { weldId: '', defectId: '', position: 0, method: 'GMAW' }
  recheckForm = { weldId: '', defectId: '', conclusion: '合格' as '合格' | '不合格', note: '' }

  openRepair(weld: Weld, defect: Defect) {
    this.repairForm = { weldId: weld.id, defectId: defect.id, position: defect.position, method: 'GMAW' }
    this.repairDialog = true
  }
  openRecheck(weld: Weld, defect: Defect) {
    this.recheckForm = { weldId: weld.id, defectId: defect.id, conclusion: '合格', note: '' }
    this.recheckDialog = true
  }
  submitRepair() {
    this.store.dispatch(A.recordRepair({ ...this.repairForm, requestId: `REQ-RP-${Date.now()}` }))
    this.repairDialog = false
  }
  submitRecheck() {
    this.store.dispatch(A.submitRecheck({ ...this.recheckForm, requestId: `REQ-RC-${Date.now()}` }))
    this.recheckDialog = false
  }
}
